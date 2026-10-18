"""RepoLens API (FastAPI, fully async)."""

import asyncio
import json
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from . import config, db, embeddings, github, ingest, llm, retrieval

log = logging.getLogger("uvicorn.error")


@asynccontextmanager
async def lifespan(_: FastAPI):
    await db.connect()
    # Jobs can't survive a restart: mark any that were running as interrupted.
    await db.pool().execute(
        "UPDATE repositories SET status = 'error', error = 'Ingestion was interrupted by a server restart. Re-analyse to resume.', "
        "message = 'Interrupted' WHERE status = ANY($1::text[])",
        list(ingest.ACTIVE),
    )
    warm = asyncio.create_task(embeddings.warm_up())  # load the embedding model without blocking startup
    yield
    warm.cancel()
    await db.close()


app = FastAPI(title="RepoLens API", version="2.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"])


def key(owner: str, name: str) -> str:
    return f"{owner}/{name}".lower()


async def ready_repo(owner: str, name: str):
    row = await ingest.get_repo(key(owner, name))
    if not row:
        raise HTTPException(404, "This repository hasn't been analysed yet.")
    if row["status"] != "ready":
        raise HTTPException(409, f"This repository isn't ready yet (status: {row['status']}).")
    return row


def public(row) -> dict:
    d = dict(row)
    d.pop("readme", None)
    d.pop("directory_tree", None)
    for k in ("created_at", "updated_at"):
        d[k] = d[k].isoformat() if d.get(k) else None
    return d


@app.get("/api/health")
async def health():
    try:
        await db.pool().fetchval("SELECT 1")
        database = True
    except Exception:  # noqa: BLE001
        database = False
    return {
        "ok": database,
        "database": database,
        "llm_configured": bool(config.GROQ_API_KEY),
        "github_configured": bool(config.GITHUB_TOKEN),
        "llm_model": config.GROQ_MODEL,
        "embedding_model": config.EMBED_MODEL,
        "embedding_model_loaded": embeddings.is_loaded(),
    }


class AnalyzeRequest(BaseModel):
    url: str = Field(max_length=300)
    refresh: bool = False


@app.post("/api/repos")
async def analyze(req: AnalyzeRequest):
    try:
        ref = github.parse_repo_url(req.url)
    except github.GitHubError as e:
        raise HTTPException(400, str(e))
    if not config.GITHUB_TOKEN:
        raise HTTPException(503, "GITHUB_TOKEN is not set on the server. Add it to backend/.env and restart.")
    row = await ingest.start(ref, refresh=req.refresh)
    return {"owner": ref.owner, "name": ref.name, **public(row)}


@app.get("/api/repos/{owner}/{name}")
async def repo_status(owner: str, name: str):
    row = await ingest.get_repo(key(owner, name))
    if not row:
        raise HTTPException(404, "Not analysed yet.")
    out = public(row)
    if row["status"] == "ready":
        langs = await db.pool().fetch(
            "SELECT language, COUNT(*) AS files, SUM(line_count) AS lines FROM files "
            "WHERE repo_id = $1 AND language IS NOT NULL GROUP BY language ORDER BY lines DESC",
            row["id"],
        )
        total = sum(r["lines"] for r in langs if r["language"] not in ("Markdown", "JSON", "YAML", "TOML", "XML")) or 1
        out["languages"] = [
            {"lang": r["language"], "files": r["files"], "lines": r["lines"], "percent": round(100 * r["lines"] / total, 1)}
            for r in langs if r["language"] not in ("Markdown", "JSON", "YAML", "TOML", "XML")
        ]
    return out


@app.get("/api/repos/{owner}/{name}/context")
async def global_context(owner: str, name: str):
    """The global context injected into every prompt: README + directory tree."""
    row = await ready_repo(owner, name)
    return {"readme": row["readme"] or "", "directory_tree": row["directory_tree"] or ""}


@app.get("/api/repos/{owner}/{name}/files")
async def list_files(owner: str, name: str):
    row = await ready_repo(owner, name)
    rows = await db.pool().fetch(
        "SELECT full_file_path, line_count, size_bytes FROM files WHERE repo_id = $1 ORDER BY full_file_path", row["id"]
    )
    return {"files": [[r["full_file_path"], r["line_count"], r["size_bytes"]] for r in rows]}


@app.get("/api/repos/{owner}/{name}/file")
async def get_file(owner: str, name: str, path: str = Query(..., max_length=1000)):
    row = await ready_repo(owner, name)
    f = await db.pool().fetchrow(
        "SELECT full_file_path, file_name, directory_path, language, line_count, size_bytes, content "
        "FROM files WHERE repo_id = $1 AND full_file_path = $2",
        row["id"], path,
    )
    if not f:
        raise HTTPException(404, "File not found.")
    ref = row["commit_sha"] or row["default_branch"]
    return {**dict(f), "github_url": f"https://github.com/{row['full_name']}/blob/{ref}/{path}"}


@app.get("/api/repos/{owner}/{name}/search")
async def search(owner: str, name: str, q: str = Query(..., min_length=1, max_length=500), k: int = Query(8, ge=1, le=30)):
    """Retrieval only (no LLM): useful for demonstrating the vector search."""
    row = await ready_repo(owner, name)
    hits = await retrieval.top_k(row["id"], q, k)
    return {"results": [{**{x: h[x] for x in h if x != "content"}, "preview": h["content"][:500]} for h in hits]}


class ChatMessage(BaseModel):
    role: str
    content: str = Field(max_length=8000)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=40)


@app.post("/api/repos/{owner}/{name}/chat")
async def chat(owner: str, name: str, req: ChatRequest):
    """RAG pipeline, streamed as Server-Sent Events:
    status -> sources (retrieved chunks) -> token... -> done   (or error)
    """
    row = await ready_repo(owner, name)
    if req.messages[-1].role != "user":
        raise HTTPException(400, "The last message must be the user's question.")
    question = req.messages[-1].content
    history = [m.model_dump() for m in req.messages[:-1]]
    # Short follow-ups ("and in Python?") borrow the previous question's topic for retrieval.
    prev = [m.content for m in req.messages[:-1] if m.role == "user"]
    retrieval_query = f"{prev[-1]} {question}" if prev and len(question) < 60 else question

    def sse(event: dict) -> str:
        return f"data: {json.dumps(event)}\n\n"

    async def events():
        try:
            yield sse({"type": "status", "label": "Embedding the question and searching pgvector…"})
            chunks = await retrieval.top_k(row["id"], retrieval_query)
            context, used = llm.build_context(dict(row), chunks)
            yield sse({
                "type": "sources",
                "label": f"Retrieved {len(used)} chunks + directory tree",
                "sources": [
                    {"path": c["full_file_path"], "start_line": c["start_line"], "end_line": c["end_line"],
                     "similarity": c["similarity"]}
                    for c in used
                ],
            })
            yield sse({"type": "status", "label": "Generating a grounded answer with Groq…"})
            model_used = None
            async for model_used, delta in llm.stream_answer(llm.build_messages(context, question, history)):
                yield sse({"type": "token", "text": delta})
            yield sse({"type": "done", "model": model_used})
        except llm.LLMError as e:
            yield sse({"type": "error", "message": str(e)})
        except Exception as e:  # noqa: BLE001
            log.exception("Chat failed")
            yield sse({"type": "error", "message": f"Something went wrong: {e}"})

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
