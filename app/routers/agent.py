"""Feature 1 — the gated agent endpoint + caregiver review queue.

POST /agent/answer is the chokepoint: every identity answer carries a calibrated
confidence_tier, and the agent never names a face below the 'high' tier.
"""
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.services import active_learning, memory_agent

router = APIRouter(tags=["agent"])


@router.post("/agent/answer")
async def agent_answer(
    message: str = Form(""),
    image: Optional[UploadFile] = File(None),
):
    image_bytes = await image.read() if image is not None else None
    return memory_agent.answer_calibrated(message, image_bytes)


@router.get("/caregiver/review-queue")
async def review_queue():
    return active_learning.list_queue()


@router.post("/caregiver/review/{candidate_id}")
async def review(candidate_id: str, decision: str = Form(...)):
    if decision not in ("approve", "reject"):
        raise HTTPException(status_code=400, detail="decision must be 'approve' or 'reject'.")
    result = active_learning.resolve(candidate_id, decision)
    if not result.get("ok"):
        raise HTTPException(status_code=404, detail="candidate not found.")
    return result
