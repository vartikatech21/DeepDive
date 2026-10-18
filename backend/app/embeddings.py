"""Local embeddings with sentence-transformers, running inside the FastAPI process.

No API, so no rate limits and no cost. Encoding is CPU-bound, so it runs in a worker thread
(asyncio.to_thread) to keep the event loop free for other requests.
"""

import asyncio
import threading

import numpy as np

from . import config

_model = None
_lock = threading.Lock()


def _get_model():
    global _model
    with _lock:
        if _model is None:
            from sentence_transformers import SentenceTransformer  # heavy import: load on first use

            _model = SentenceTransformer(config.EMBED_MODEL, device="cpu")
        return _model


def _encode(texts: list[str]) -> np.ndarray:
    # Normalised vectors: L2 distance (<->) then ranks exactly like cosine similarity.
    return _get_model().encode(
        texts, batch_size=32, normalize_embeddings=True, convert_to_numpy=True, show_progress_bar=False
    ).astype(np.float32)


async def embed(texts: list[str]) -> np.ndarray:
    return await asyncio.to_thread(_encode, texts)


async def warm_up() -> None:
    """Loads the model at startup so the first question isn't slow."""
    await embed(["warm up"])


def is_loaded() -> bool:
    return _model is not None
