"""Single shared Qdrant client.

Embedded/local Qdrant locks its storage folder per-client, so two
QdrantClient(path=...) instances in the same process crash with
"Storage folder is already accessed by another instance".

Every service reuses the one client built here. This is also the single
seam to swap the storage layer (local <-> cloud <-> server) — services
never construct their own client.
"""
from qdrant_client import QdrantClient
from app.core.config import settings


def build_client() -> QdrantClient:
    if settings.QDRANT_MODE == "local":
        return QdrantClient(path=settings.QDRANT_PATH)
    return QdrantClient(
        url=settings.get_qdrant_url(),
        api_key=settings.QDRANT_API_KEY,
    )


# Shared singleton — import this, never construct a second client.
qdrant_client = build_client()
