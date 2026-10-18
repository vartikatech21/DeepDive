"""Vector retrieval with raw SQL and pgvector's L2 distance operator (<->). No LangChain, no ORM."""

from . import config, db, embeddings

# hnsw.iterative_scan (pgvector >= 0.8) keeps scanning the HNSW index until LIMIT rows survive the
# repo_id filter. Without it, an approximate index scan could return fewer than k chunks for one repo
# when many repos share the table.
TOP_K_SQL = """
SELECT id, file_name, full_file_path, directory_path, content, start_line, end_line,
       embedding <-> $2 AS distance
FROM chunks
WHERE repo_id = $1
ORDER BY embedding <-> $2
LIMIT $3
"""


async def top_k(repo_id: int, query: str, k: int | None = None) -> list[dict]:
    vector = (await embeddings.embed([query]))[0]
    async with db.pool().acquire() as conn, conn.transaction():
        try:
            async with conn.transaction():  # savepoint: a failure here must not abort the outer transaction
                await conn.execute("SET LOCAL hnsw.iterative_scan = strict_order")
        except Exception:  # noqa: BLE001 - older pgvector: plain HNSW scan still works
            pass
        rows = await conn.fetch(TOP_K_SQL, repo_id, vector, k or config.TOP_K)
    return [
        {**dict(r), "distance": round(float(r["distance"]), 4),
         # For unit vectors, L2 distance d and cosine similarity relate as cos = 1 - d²/2.
         "similarity": round(1 - float(r["distance"]) ** 2 / 2, 4)}
        for r in rows
    ]
