"""Feature 1 — active-learning re-enrollment + caregiver review queue.

- High-confidence sightings auto-enroll as extra exemplars (keeps embeddings fresh as
  faces age), capped per person.
- Boundary ('medium') sightings are queued for caregiver confirmation (uncertainty
  sampling). Approve -> the probe becomes a new exemplar; reject -> discarded.

The queue is in-memory for this build (clearly a TODO to persist in Qdrant/DB).
"""
import uuid
from typing import Optional

from app.config import get_settings
from app.services import qdrant_service

settings = get_settings()

# candidate_id -> {id, person_id, name, relationship, score, tier, embedding}
_REVIEW_QUEUE: dict[str, dict] = {}


def _exemplar_count(person_id: str) -> int:
    return sum(
        1
        for p in qdrant_service.scroll(settings.people_collection)
        if (p.payload or {}).get("person_id") == person_id
    )


def _add_exemplar(embedding: list[float], payload: dict) -> str:
    return qdrant_service.upsert(
        settings.people_collection,
        embedding,
        {
            "person_id": payload.get("person_id"),
            "name": payload.get("name"),
            "relationship": payload.get("relationship", ""),
            "notes": payload.get("notes", ""),
            "exemplar": True,
        },
    )


def maybe_auto_add(embedding: list[float], candidate: dict, calib: dict) -> bool:
    """Auto-enroll confident, non-duplicate sightings as fresh exemplars."""
    pid = candidate.get("person_id")
    if not pid:
        return False
    if (
        calib["tier"] == "high"
        and calib["score"] >= settings.auto_add_conf
        and calib["score"] < 0.999  # skip near-identical duplicates
        and _exemplar_count(pid) < settings.exemplar_max_per_person
    ):
        _add_exemplar(embedding, candidate)
        return True
    return False


def queue_candidate(embedding: list[float], candidate: dict, calib: dict) -> Optional[str]:
    """Queue an uncertain (medium-tier) sighting for caregiver confirmation."""
    if calib["tier"] != "medium":
        return None
    cid = str(uuid.uuid4())
    _REVIEW_QUEUE[cid] = {
        "id": cid,
        "person_id": candidate.get("person_id"),
        "name": candidate.get("name"),
        "relationship": candidate.get("relationship", ""),
        "score": calib["score"],
        "tier": calib["tier"],
        "embedding": embedding,
    }
    return cid


def list_queue() -> list[dict]:
    return [{k: v for k, v in c.items() if k != "embedding"} for c in _REVIEW_QUEUE.values()]


def resolve(candidate_id: str, decision: str) -> dict:
    cand = _REVIEW_QUEUE.pop(candidate_id, None)
    if cand is None:
        return {"ok": False, "reason": "not_found"}
    if decision == "approve":
        _add_exemplar(cand["embedding"], cand)
        return {"ok": True, "action": "added_exemplar", "person_id": cand["person_id"]}
    return {"ok": True, "action": "rejected"}
