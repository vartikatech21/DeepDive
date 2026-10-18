"""PostgreSQL (Neon) access with asyncpg and pgvector. Raw SQL only, no ORM."""

import asyncpg
from pgvector.asyncpg import register_vector

from . import config

SCHEMA = f"""
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS repositories (
    id              BIGSERIAL PRIMARY KEY,
    repo_key        TEXT UNIQUE NOT NULL,          -- "owner/name", lower-case
    owner           TEXT NOT NULL,
    name            TEXT NOT NULL,
    full_name       TEXT NOT NULL,
    description     TEXT,
    default_branch  TEXT,
    commit_sha      TEXT,
    stars           INTEGER,
    html_url        TEXT,
    readme          TEXT,                          -- global context, part 1
    directory_tree  TEXT,                          -- global context, part 2
    status          TEXT NOT NULL DEFAULT 'queued',
    message         TEXT,
    files_total     INTEGER NOT NULL DEFAULT 0,
    files_done      INTEGER NOT NULL DEFAULT 0,
    chunk_count     INTEGER NOT NULL DEFAULT 0,
    error           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS files (
    id              BIGSERIAL PRIMARY KEY,
    repo_id         BIGINT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    full_file_path  TEXT NOT NULL,
    file_name       TEXT NOT NULL,
    directory_path  TEXT NOT NULL,
    language        TEXT,
    size_bytes      INTEGER NOT NULL,
    line_count      INTEGER NOT NULL,
    content         TEXT NOT NULL,
    UNIQUE (repo_id, full_file_path)
);

CREATE TABLE IF NOT EXISTS chunks (
    id              BIGSERIAL PRIMARY KEY,
    repo_id         BIGINT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    file_id         BIGINT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    file_name       TEXT NOT NULL,
    full_file_path  TEXT NOT NULL,
    directory_path  TEXT NOT NULL,
    content         TEXT NOT NULL,
    start_line      INTEGER NOT NULL,
    end_line        INTEGER NOT NULL,
    embedding       vector({config.EMBED_DIM}) NOT NULL
);

CREATE INDEX IF NOT EXISTS chunks_repo_idx ON chunks (repo_id);
-- HNSW approximate-nearest-neighbour index for the L2 distance operator (<->).
CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw ON chunks USING hnsw (embedding vector_l2_ops);
"""

_pool: asyncpg.Pool | None = None


async def _init_conn(conn: asyncpg.Connection) -> None:
    await register_vector(conn)  # lets asyncpg send/receive numpy arrays as pgvector values


async def connect() -> asyncpg.Pool:
    global _pool
    if not config.DATABASE_URL:
        raise RuntimeError("DATABASE_URL is not set. Add your Neon connection string to backend/.env.")
    # The extension must exist before register_vector can find the 'vector' type.
    conn = await asyncpg.connect(config.DATABASE_URL)
    try:
        await conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
    finally:
        await conn.close()
    _pool = await asyncpg.create_pool(
        config.DATABASE_URL, min_size=1, max_size=10, init=_init_conn, command_timeout=120,
        statement_cache_size=0,  # required behind Neon's pooled (PgBouncer) endpoint
    )
    async with _pool.acquire() as conn:
        await conn.execute(SCHEMA)
    return _pool


async def close() -> None:
    if _pool:
        await _pool.close()


def pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("Database is not connected.")
    return _pool
