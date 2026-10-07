"""Conversation — speech-to-text and the memory-agent chat endpoint."""
import base64
import binascii

from fastapi import APIRouter, File, HTTPException, UploadFile

from app.models.schemas import ChatRequest, ChatResponse
from app.services import groq_service, memory_agent

router = APIRouter(prefix="/api", tags=["chat"])


@router.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    data = await audio.read()
    text = groq_service.transcribe(data, audio.filename or "audio.webm")
    return {"text": text}


@router.post("/chat", response_model=ChatResponse)
async def chat(payload: ChatRequest):
    image_bytes = None
    if payload.image:
        raw = payload.image.split(",", 1)[-1]  # tolerate a data: URL prefix
        try:
            image_bytes = base64.b64decode(raw)
        except (binascii.Error, ValueError):
            raise HTTPException(status_code=400, detail="image must be base64-encoded.")
    result = memory_agent.answer(payload.message, image_bytes)
    return result
