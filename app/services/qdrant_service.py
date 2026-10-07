"""Qdrant access — collection bootstrap, upsert, cosine search.

QDRANT_MODE=local uses an in-memory store so the app runs with no external credentials.
"""
import logging
import uuid
from typing import Any, Optional

from qdrant_client import QdrantClient
from qdrant_client.models import Distance, PointStruct, VectorParams

from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

# collection name -> vector size
_COLLECTIONS: dict[str, int] = {
    settings.people_collection: settings.embedding_dim,
    settings.objects_collection: settings.embedding_dim,
}

_client: Optional[QdrantClient] = None


def get_client() -> QdrantClient:
    global _client
    if _client is None:
        if settings.qdrant_mode == "server" and settings.qdrant_url:
            logger.info("Qdrant: connecting to server %s", settings.qdrant_url)
            _client = QdrantClient(
                url=settings.qdrant_url, api_key=settings.qdrant_api_key or None
            )
        else:
            logger.warning(
                "Qdrant: QDRANT_MODE=local -> in-memory store (data is NOT persisted)."
            )
            _client = QdrantClient(location=":memory:")
    return _client


def ensure_collections() -> None:
    client = get_client()
    existing = {c.name for c in client.get_collections().collections}
    for name, dim in _COLLECTIONS.items():
        if name not in existing:
            client.create_collection(
                collection_name=name,
                vectors_config=VectorParams(size=dim, distance=Distance.COSINE),
            )
            logger.info("Qdrant: created collection '%s' (dim=%d)", name, dim)


def upsert(
    collection: str,
    vector: list[float],
    payload: dict[str, Any],
    point_id: Optional[str] = None,
) -> str:
    client = get_client()
    pid = point_id or str(uuid.uuid4())
    client.upsert(
        collection_name=collection,
        points=[PointStruct(id=pid, vector=vector, payload=payload)],
    )
    return pid


def search(collection: str, vector: list[float], limit: int = 1):
    """Return a list of ScoredPoint (cosine similarity in .score, payload in .payload)."""
    client = get_client()
    return client.query_points(
        collection_name=collection, query=vector, limit=limit, with_payload=True
    ).points


def scroll(collection: str, limit: int = 256):
    client = get_client()
    points, _ = client.scroll(
        collection_name=collection, limit=limit, with_payload=True
    )
    return points
