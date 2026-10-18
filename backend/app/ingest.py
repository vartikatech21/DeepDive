"""Bulk ingestion: GitHub -> chunks with metadata -> local embeddings -> Neon (pgvector).

Runs as a background asyncio task. Progress is stored on the repositories row so the
frontend can poll it.
"""

import asyncio
import logging
import time
from pathlib import PurePosixPath

from . import chunker, config, db, embeddings, github
from .tree import build_tree

log = logging.getLogger("uvicorn.error")

BATCH_FILES = 40

# repo_key -> running task (kept so tasks aren't garbage-collected and aren't started twice)
_tasks: dict[str, asyncio.Task] = {}

ACTIVE = ("queued", "fetching", "ingesting")


async def get_repo(repo_key: str):
    return await db.pool().fetchrow("SELECT * FROM repositories WHERE repo_key = $1", repo_key)


async def _update(repo_id: int, **fields) -> None:
    cols = list(fields)
    sets = ", ".join(f"{c} = ${i + 2}" for i, c in enumerate(cols))
    await db.pool().execute(
        f"UPDATE repositories SET {sets}, updated_at = now() WHERE id = $1", repo_id, *[fields[c] for c in cols]
    )


async def start(ref: github.RepoRef, refresh: bool = False):
    """Starts ingestion unless the repo is already ingested or in progress. Returns the repositories row."""
    running = _tasks.get(ref.key)
    if running and not running.done():
        return await get_repo(ref.key)
    row = await get_repo(ref.key)
    if row and row["status"] == "ready" and not refresh:
        return row
    row = await db.pool().fetchrow(
        """
        INSERT INTO repositories (repo_key, owner, name, full_name, status, message)
        VALUES ($1, $2, $3, $4, 'queued', 'Starting…')
        ON CONFLICT (repo_key) DO UPDATE
            SET status = 'queued', message = 'Starting…', error = NULL, files_done = 0, updated_at = now()
        RETURNING *
        """,
        ref.key, ref.owner, ref.name, f"{ref.owner}/{ref.name}",
    )
    _tasks[ref.key] = asyncio.create_task(_run(ref, row["id"]))
    return row


async def _run(ref: github.RepoRef, repo_id: int) -> None:
    started = time.time()
    try:
        async with github.GitHubClient() as gh:
            await _update(repo_id, status="fetching", message="Reading repository info from GitHub…")
            meta = await gh.repo(ref)
            branch = meta.get("default_branch") or "main"
            commit_sha, blobs, truncated = await gh.tree(ref, branch)
            readme = await gh.readme(ref)

            # Global context: README + a directory tree of the whole repo (minus junk folders).
            visible = [b["path"] for b in blobs if not any(p in chunker.SKIP_DIRS for p in b["path"].split("/")[:-1])]
            directory_tree = build_tree(visible, meta.get("name") or ref.name)
            selected = [b for b in blobs if chunker.should_index(b["path"], b.get("size", 0))]

            await _update(
                repo_id,
                full_name=meta.get("full_name") or f"{ref.owner}/{ref.name}",
                owner=(meta.get("owner") or {}).get("login") or ref.owner,
                name=meta.get("name") or ref.name,
                description=meta.get("description"),
                default_branch=branch,
                commit_sha=commit_sha,
                stars=meta.get("stargazers_count"),
                html_url=meta.get("html_url"),
                readme=readme,
                directory_tree=directory_tree,
                files_total=len(selected),
                files_done=0,
                chunk_count=0,
                status="ingesting",
                message=f"Downloading and embedding {len(selected):,} files…"
                + (" (GitHub truncated the file list: repo has over 100,000 files)" if truncated else ""),
            )
            # Re-ingesting replaces the old data (chunks are removed by ON DELETE CASCADE).
            await db.pool().execute("DELETE FROM files WHERE repo_id = $1", repo_id)

            batches = [selected[i:i + BATCH_FILES] for i in range(0, len(selected), BATCH_FILES)]
            files_done = chunk_count = 0
            # Pipeline: download batch N+1 from GitHub while batch N is being embedded.
            next_fetch = asyncio.create_task(_fetch(gh, ref, batches[0])) if batches else None
            for i in range(len(batches)):
                fetched = await next_fetch
                next_fetch = asyncio.create_task(_fetch(gh, ref, batches[i + 1])) if i + 1 < len(batches) else None
                chunk_count += await _store(repo_id, fetched)
                files_done += len(batches[i])
                await _update(repo_id, files_done=files_done, chunk_count=chunk_count)

        await _update(
            repo_id, status="ready", chunk_count=chunk_count,
            message=f"Ready: {chunk_count:,} chunks in {time.time() - started:.0f}s ({gh.requests_made} GitHub requests)",
        )
        log.info("Ingested %s: %d chunks in %.0fs", ref.key, chunk_count, time.time() - started)
    except github.GitHubError as e:
        await _update(repo_id, status="error", error=str(e), message=str(e))
    except Exception as e:  # noqa: BLE001 - surface anything unexpected in the UI
        log.exception("Ingestion failed for %s", ref.key)
        await _update(repo_id, status="error", error=f"Ingestion failed: {e}", message="Ingestion failed")


async def _fetch(gh: github.GitHubClient, ref: github.RepoRef, batch: list[dict]) -> list[tuple[str, str]]:
    texts = await asyncio.gather(*(gh.blob_text(ref, b["sha"]) for b in batch))
    return [(b["path"], t) for b, t in zip(batch, texts) if t is not None and not chunker.looks_binary_or_minified(t)]


async def _store(repo_id: int, files: list[tuple[str, str]]) -> int:
    """Chunks, embeds and inserts one batch of files in a single transaction. Returns the number of chunks."""
    if not files:
        return 0
    per_file = [(path, text, chunker.chunk_file(path, text)) for path, text in files]
    all_chunks = [c for _, _, cs in per_file for c in cs]
    vectors = await embeddings.embed([c.embedding_text() for c in all_chunks]) if all_chunks else []

    async with db.pool().acquire() as conn, conn.transaction():
        rows = await conn.fetch(
            """
            INSERT INTO files (repo_id, full_file_path, file_name, directory_path, language, size_bytes, line_count, content)
            SELECT $1, * FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::int[], $7::int[], $8::text[])
            RETURNING id, full_file_path
            """,
            repo_id,
            [p for p, _, _ in per_file],
            [PurePosixPath(p).name for p, _, _ in per_file],
            [_dir(p) for p, _, _ in per_file],
            [chunker.language_for(p) for p, _, _ in per_file],
            [len(t.encode("utf-8")) for _, t, _ in per_file],
            [t.count("\n") + 1 for _, t, _ in per_file],
            [t.replace("\x00", "") for _, t, _ in per_file],
        )
        file_ids = {r["full_file_path"]: r["id"] for r in rows}
        if all_chunks:
            # COPY is the fastest way to bulk-insert rows (vectors included) into Postgres.
            await conn.copy_records_to_table(
                "chunks",
                columns=["repo_id", "file_id", "file_name", "full_file_path", "directory_path",
                         "content", "start_line", "end_line", "embedding"],
                records=[
                    (repo_id, file_ids[c.full_file_path], c.file_name, c.full_file_path, c.directory_path,
                     c.content.replace("\x00", ""), c.start_line, c.end_line, v)
                    for c, v in zip(all_chunks, vectors)
                ],
            )
    return len(all_chunks)


def _dir(path: str) -> str:
    parent = str(PurePosixPath(path).parent)
    return "" if parent == "." else parent
