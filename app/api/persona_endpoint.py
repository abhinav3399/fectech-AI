"""Endpoints for the single editable AI persona (the user's loved one).

One persona primitive powers the avatar's voice and in-character chat.
"""
import base64
from fastapi import APIRouter, Body
from app.services.llm_service import llm_service
from app.services.tts_service import tts_service
from app.services.voice_clone_service import voice_clone_service, parse_data_url

router = APIRouter()

# A small curated set of Microsoft neural voices the persona can speak with.
NEURAL_VOICES = [
    {"id": "hi-IN-SwaraNeural", "label": "Swara (Hindi, female)"},
    {"id": "hi-IN-MadhurNeural", "label": "Madhur (Hindi, male)"},
    {"id": "en-IN-NeerjaNeural", "label": "Neerja (Indian English, female)"},
    {"id": "en-IN-PrabhatNeural", "label": "Prabhat (Indian English, male)"},
    {"id": "en-US-JennyNeural", "label": "Jenny — warm (US, female)"},
    {"id": "en-US-GuyNeural", "label": "Guy — steady (US, male)"},
    {"id": "en-GB-SoniaNeural", "label": "Sonia (UK, female)"},
    {"id": "en-GB-RyanNeural", "label": "Ryan (UK, male)"},
    {"id": "en-AU-NatashaNeural", "label": "Natasha (AU, female)"},
]


@router.get("/voices")
async def list_voices():
    return {"voices": NEURAL_VOICES}


@router.post("/evaluate")
async def evaluate_conversation(payload: dict = Body(...)):
    """Caregiver wellbeing insights from the recent conversation."""
    transcript = payload.get("transcript") or []
    if len([t for t in transcript if (t.get("text") or "").strip()]) < 2:
        return {"status": "empty", "message": "Not enough conversation yet — talk a little first."}
    result = llm_service.evaluate_conversation(transcript, payload.get("persona"), payload.get("user"))
    if not result:
        return {"status": "error", "message": "Couldn't generate insights right now."}
    return {"status": "ok", "evaluation": result}


@router.post("/persona/chat")
async def persona_chat(payload: dict = Body(...)):
    """In-character reply from the persona."""
    text = (payload.get("text") or "").strip()
    persona = payload.get("persona") or {}
    user = payload.get("user") or {}
    history = payload.get("history") or []
    if not text:
        return {"status": "error", "text": ""}
    reply = llm_service.chat_as_persona(text, persona=persona, user=user, history=history)
    return {"status": "ok", "text": reply}


@router.post("/tts")
async def text_to_speech(payload: dict = Body(...)):
    """Synthesize text -> base64 MP3 for browser playback.

    If a cloned voice id is provided and ElevenLabs is configured, speak in the
    person's own cloned voice; otherwise fall back to a neural preset voice.
    """
    text = (payload.get("text") or "").strip()
    if not text:
        return {"status": "error", "audio_base64": None}

    clone_voice_id = payload.get("clone_voice_id")
    if clone_voice_id and voice_clone_service.configured():
        try:
            audio_bytes = await voice_clone_service.tts(text, clone_voice_id)
            return {
                "status": "ok",
                "audio_base64": base64.b64encode(audio_bytes).decode("utf-8"),
                "mime": "audio/mpeg",
                "cloned": True,
            }
        except Exception as e:
            print(f"Cloned TTS failed, falling back to neural: {e}")

    voice = payload.get("voice")
    audio = await tts_service.synthesize(text, voice)
    if not audio:
        return {"status": "error", "audio_base64": None}
    return {"status": "ok", "audio_base64": audio, "mime": "audio/mpeg", "cloned": False}


@router.post("/clone-voice")
async def clone_voice(payload: dict = Body(...)):
    """Instant voice clone from the uploaded/recorded sample -> voice_id."""
    if not voice_clone_service.configured():
        return {"status": "error", "message": "Voice cloning isn't set up yet. Add ELEVENLABS_API_KEY to .env and restart the backend."}
    audio = payload.get("audio")
    name = (payload.get("name") or "Companion voice").strip()[:100]
    labels = payload.get("labels") or {}
    raw, meta = parse_data_url(audio)
    if not raw:
        return {"status": "error", "message": "No valid audio sample to clone."}
    mime, filename = meta
    try:
        voice_id = await voice_clone_service.clone(name, raw, mime, filename, labels)
        if not voice_id:
            return {"status": "error", "message": "Cloning returned no voice id."}
        return {"status": "ok", "voice_id": voice_id}
    except Exception as e:
        return {"status": "error", "message": f"Cloning failed: {e}"}
