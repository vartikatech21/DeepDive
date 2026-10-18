"""Settings, read from environment variables or backend/.env."""

import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, default))
    except ValueError:
        return default


# Neon connection string, e.g. postgresql://user:pass@ep-xxx.region.aws.neon.tech/repolens?sslmode=require
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()

# Groq (text generation). Free key: https://console.groq.com/keys
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "").strip()
GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b").strip()
GROQ_FALLBACK_MODEL = os.getenv("GROQ_FALLBACK_MODEL", "openai/gpt-oss-20b").strip()

# GitHub personal access token (classic or fine-grained, read-only is enough).
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "").strip()
# Bulk ingestion pacing: parallel downloads, and a pause after every request.
GITHUB_CONCURRENCY = _int("GITHUB_CONCURRENCY", 8)
GITHUB_REQUEST_DELAY = _float("GITHUB_REQUEST_DELAY", 0.1)

# Local embedding model (sentence-transformers). all-MiniLM-L6-v2 -> 384-dimensional vectors.
EMBED_MODEL = os.getenv("EMBED_MODEL", "sentence-transformers/all-MiniLM-L6-v2").strip()
EMBED_DIM = _int("EMBED_DIM", 384)

# Retrieval and prompt sizes. Groq's free tier limits tokens per minute, so the prompt has a budget.
TOP_K = _int("TOP_K", 8)
CONTEXT_CHAR_BUDGET = _int("CONTEXT_CHAR_BUDGET", 22000)  # ~5,500 tokens of context
TREE_CHAR_BUDGET = _int("TREE_CHAR_BUDGET", 6000)
README_CHAR_BUDGET = _int("README_CHAR_BUDGET", 3000)

# Files bigger than this are skipped (almost always generated or data files).
MAX_FILE_KB = _int("MAX_FILE_KB", 512)
CHUNK_LINES = _int("CHUNK_LINES", 60)

CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()]
