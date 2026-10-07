"""The core agent: fuse face recognition + Qdrant retrieval + the question, then ask Llama 3.

Modes are reserved for Part B (standard | twilight). The recognition path already enforces
the global invariant: a face below the match threshold is NEVER named — the agent hedges.
"""
import logging
import re
from typing import Optional

from app.config import get_settings
from app.services import (
    active_learning,
    calibration,
    face_service,
    groq_service,
    qdrant_service,
)

logger = logging.getLogger(__name__)
settings = get_settings()

SYSTEM_PROMPT = (
    "You are FacTech, a gentle memory companion for a person living with dementia. "
    "Speak in short, warm, reassuring sentences (no more than three). Never alarm them. "
    "When the context names a recognized person, state their name and relationship simply, "
    "e.g. 'This is Sara, your daughter.' If the context says a face was NOT confidently "
    "recognized, do NOT guess a name — gently say you're not sure and offer to find out. "
    "If asked where an object is, give the remembered location plainly."
)


def _recognize_person(image_bytes: bytes):
    emb = face_service.embed_face(image_bytes)
    if emb is None:
        return None, None
    hits = qdrant_service.search(settings.people_collection, emb.tolist(), limit=1)
    if not hits:
        return None, 0.0
    top = hits[0]
    similarity = float(top.score)
    # Invariant: only assert identity at/above the match threshold.
    if similarity >= (1.0 - settings.face_match_threshold):
        return top.payload, similarity
    return None, similarity


def _template_reply(person: Optional[dict]) -> str:
    """Deterministic reply used when Groq is unavailable (no API key)."""
    if person:
        rel = (person.get("relationship") or "").strip()
        who = person.get("name", "someone you know")
        who = f"{who}, your {rel}" if rel else who
        return f"This is {who}. You're safe, and they're happy to see you."
    return (
        "I'm right here with you, and you're safe. "
        "I'm not quite sure who that is yet — shall we find out together?"
    )


def answer(message: str, image_bytes: Optional[bytes] = None, mode: str = "standard") -> dict:
    person, score = None, None
    visual = "No visual context."
    if image_bytes:
        person, score = _recognize_person(image_bytes)
        if person:
            rel = person.get("relationship", "")
            visual = f"Recognized person: {person.get('name')} ({rel}). Notes: {person.get('notes', '')}."
        else:
            visual = "A face was seen but NOT confidently recognized."

    if groq_service.available():
        user_block = f"Visual context: {visual}\nPatient says/asks: {message}"
        reply = groq_service.chat(SYSTEM_PROMPT, user_block) or _template_reply(person)
    else:
        reply = _template_reply(person)

    return {"reply": reply, "context": visual, "person": person, "score": score}


# --- Feature 1: the gated chokepoint -----------------------------------------

# Does the patient actually want to identify someone? ("who is this?", "do you know her?")
_RECOG_PAT = re.compile(r"\b(who|whose|recogn|name|is this|that person|do you know)\b", re.I)


def _is_recognition_query(message: str) -> bool:
    return bool(message and _RECOG_PAT.search(message))


def _who(candidate: dict | None) -> str | None:
    if not candidate or not candidate.get("name"):
        return None
    rel = (candidate.get("relationship") or "").strip()
    return f"{candidate['name']}, your {rel}" if rel else candidate["name"]


def _get_response_strategy(
    tier: str, is_recog_query: bool, candidate: Optional[dict], face_present: bool
) -> dict:
    """Determines the agent's response strategy based on recognition confidence and user intent."""
    who_str = _who(candidate)

    if tier == "high" and who_str:
        return {
            "identify": True,
            "shown_name": (candidate or {}).get("name"),
            "visual": f"CONFIDENTLY recognized: {who_str}. Greet warmly and say who they are.",
            "fallback": f"This is {who_str}. You're safe, and they're happy to see you.",
        }

    if is_recog_query and tier == "medium" and who_str:
        return {
            "identify": True,
            "shown_name": (candidate or {}).get("name"),
            "visual": f"POSSIBLE match: {who_str}, but NOT certain. Suggest checking together; do not assert the name.",
            "fallback": f"This looks like {who_str}, but I'm not fully sure — shall we check together?",
        }

    if is_recog_query:
        return {
            "identify": True,
            "shown_name": None,
            "visual": "A face was seen but is NOT confidently recognized."
            if face_present
            else "No one is clearly in view.",
            "fallback": "I'm not sure who that is yet — let's find out together. You're safe.",
        }

    # Default: friendly conversation, no recognition context.
    return {
        "identify": False,
        "shown_name": None,
        "visual": "Friendly conversation; there is no specific person to identify.",
        "fallback": "Hello! I'm right here with you, and you're safe. How can I help you remember?",
    }


def answer_calibrated(message: str, image_bytes: Optional[bytes] = None, mode: str = "standard") -> dict:
    """The chokepoint every patient-facing identity answer routes through (Feature 1).

    Recognition framing is used only when a face is confidently present OR the patient
    explicitly asks who someone is — otherwise the agent just converses. A face below the
    'high' tier is never named.
    """
    calib = {"tier": "unknown", "p": 0.0, "score": 0.0, "margin": 0.0, "candidate": None}
    review_candidate_id = None
    face_present = False

    if image_bytes:
        emb = face_service.embed_face(image_bytes)
        if emb is not None:
            face_present = True
            vec = emb.tolist()
            hits = qdrant_service.search(settings.people_collection, vec, limit=5)
            calib = calibration.calibrate(hits)
            candidate = calib.get("candidate")
            if candidate:
                active_learning.maybe_auto_add(vec, candidate, calib)
                review_candidate_id = active_learning.queue_candidate(vec, candidate, calib)

    tier = calib["tier"]
    is_recog_query = _is_recognition_query(message)
    strategy = _get_response_strategy(tier, is_recog_query, calib.get("candidate"), face_present)

    reply = ""
    if groq_service.available():
        reply = groq_service.chat(
            SYSTEM_PROMPT, f"Visual context: {strategy['visual']}\nPatient says/asks: {message}"
        )
    reply = reply or strategy["fallback"]

    return {
        "reply": reply,
        "identify": strategy["identify"],  # whether this answer is a recognition result (UI shows the tier)
        "tier": tier,
        "p": calib["p"],
        "score": calib["score"],
        "margin": calib["margin"],
        "candidate": strategy["shown_name"],
        "review_candidate_id": review_candidate_id,
    }
