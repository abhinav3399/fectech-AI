"""Durable long-term episodic memory for the companion.

After each chat session we distill a few "memory facts" about the person and
store them here, keyed by user. At chat time we retrieve the most relevant
facts and feed them into the persona's system prompt so the companion can
recall prior visits ("yesterday you told me ...").

Reuses the single shared Qdrant client (app/core/db.py) and the all-MiniLM
encoder already loaded by semantic_memory — never a second client or model.
"""
import hashlib
import uuid
from datetime import datetime

from qdrant_client.models import (
    VectorParams, Distance, PointStruct, Filter, FieldCondition, MatchValue,
    FilterSelector, PointIdsList,
)

from app.core.db import qdrant_client
from app.services.semantic_memory import semantic_memory

COLLECTION = "episodic_memory"
VECTOR_SIZE = 384  # all-MiniLM-L6-v2 output dimension


def _user_key(user: dict) -> str:
    """Per-user scope. A stable hash of the person's name, so ANY distinct name —
    Latin, Devanagari, CJK, etc. — maps to its own distinct key (no script is
    silently collapsed). 'default' only when the name is genuinely empty. The name
    is coerced to str first, so a non-string payload never crashes the write path.
    Single-user kiosk today; upgrades cleanly the moment a real profile.name exists."""
    raw = (user or {}).get("name")
    raw = (str(raw) if raw is not None else "").strip().lower()
    if not raw:
        return "default"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


class EpisodicMemoryService:
    def __init__(self):
        # Reuse the shared client and the already-loaded encoder — no duplicates.
        self.client = qdrant_client
        self.encoder = semantic_memory.encoder
        self._ensure_collection()

    def _ensure_collection(self):
        # Non-destructive: only create when truly missing. Never recreate_collection
        # here — a transient get/connectivity blip on boot must NOT drop durable
        # user memories. collection_exists() returns a bool and won't 404-raise.
        try:
            if not self.client.collection_exists(COLLECTION):
                self.client.create_collection(
                    collection_name=COLLECTION,
                    vectors_config=VectorParams(size=VECTOR_SIZE, distance=Distance.COSINE),
                )
        except Exception as e:
            print(f"Episodic: ensure collection failed: {e}")
        # Index user_key so retrieval can filter per person (idempotent).
        try:
            self.client.create_payload_index(
                collection_name=COLLECTION,
                field_name="user_key",
                field_schema="keyword",
            )
        except Exception as e:
            print(f"Episodic index note: {e}")

    def add_memories(self, user: dict, facts: list) -> int:
        """Embed and store each non-empty fact. Returns how many were stored."""
        clean = [f.strip() for f in (facts or []) if isinstance(f, str) and f.strip()]
        if not clean:
            return 0
        key = _user_key(user)
        points = []
        for fact in clean:
            try:
                vec = self.encoder.encode(fact).tolist()
            except Exception as e:
                print(f"Episodic encode failed: {e}")
                continue
            points.append(PointStruct(
                id=str(uuid.uuid4()),
                vector=vec,
                payload={
                    "text": fact,
                    "user_key": key,
                    "created_at": datetime.utcnow().isoformat(),
                },
            ))
        if not points:
            return 0
        try:
            self.client.upsert(collection_name=COLLECTION, points=points)
        except Exception as e:
            print(f"Episodic upsert failed: {e}")
            return 0
        print(f"Episodic: stored {len(points)} memories for '{key}'")
        return len(points)

    def retrieve(self, user: dict, query: str, limit: int = 4) -> list:
        """Top-K relevant past facts for this user. Fail-soft -> []."""
        q = (query or "").strip()
        if not q:
            return []
        try:
            emb = self.encoder.encode(q).tolist()
            res = self.client.query_points(
                collection_name=COLLECTION,
                query=emb,
                query_filter=Filter(must=[
                    FieldCondition(key="user_key", match=MatchValue(value=_user_key(user)))
                ]),
                limit=limit,
            )
            return [p.payload["text"] for p in res.points if p.payload.get("text")]
        except Exception as e:
            print(f"Episodic retrieve failed: {e}")
            return []

    def list_recent(self, user: dict, limit: int = 60) -> list:
        """Every stored fact for this user as [{id, text, created_at}], newest first.
        For a caregiver 'what does it remember?' view. Fail-soft -> []."""
        try:
            pts, _ = self.client.scroll(
                collection_name=COLLECTION,
                scroll_filter=Filter(must=[
                    FieldCondition(key="user_key", match=MatchValue(value=_user_key(user)))
                ]),
                limit=limit, with_payload=True, with_vectors=False,
            )
            items = [{"id": str(p.id), "text": p.payload.get("text", ""),
                      "created_at": p.payload.get("created_at", "")}
                     for p in pts if p.payload.get("text")]
            items.sort(key=lambda x: x["created_at"], reverse=True)
            return items
        except Exception as e:
            print(f"Episodic list failed: {e}")
            return []

    def forget(self, point_id: str) -> int:
        """Delete ONE stored memory by its point id. Fail-soft -> 0."""
        try:
            self.client.delete(collection_name=COLLECTION,
                               points_selector=PointIdsList(points=[point_id]))
            return 1
        except Exception as e:
            print(f"Episodic forget failed: {e}")
            return 0

    def clear(self, user: dict) -> int:
        """Delete ALL stored memories for this user. Fail-soft -> 0."""
        try:
            self.client.delete(
                collection_name=COLLECTION,
                points_selector=FilterSelector(filter=Filter(must=[
                    FieldCondition(key="user_key", match=MatchValue(value=_user_key(user)))
                ])),
            )
            return 1
        except Exception as e:
            print(f"Episodic clear failed: {e}")
            return 0


# Global singleton — import this, never construct a second instance.
episodic_memory = EpisodicMemoryService()
