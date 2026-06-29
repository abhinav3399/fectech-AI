"""Endpoints for the single editable AI persona (the user's loved one).

One persona primitive powers the avatar's voice and in-character chat.
"""
import base64
from fastapi import APIRouter, Body
from app.services.llm_service import llm_service
from app.services.tts_service import tts_service
from app.services.voice_clone_service import voice_clone_service, parse_data_url
from app.services.episodic_memory import episodic_memory

router = APIRouter()

# Defensive caps so a runaway transcript / huge paste can't blow the token budget
# or stall the model. Applied gracefully (clamp, never reject) for a calm UX.
MAX_TEXT = 4000
MAX_HISTORY = 24
MAX_TRANSCRIPT = 80


def _clamp_text(v):
    return (v or "").strip()[:MAX_TEXT]

# A small curated set of Microsoft neural voices the persona can speak with.
# Indian + expressive voices first — they have the most natural Indian speaking flow.
NEURAL_VOICES = [
    {"id": "hi-IN-SwaraNeural", "label": "Swara — Hindi, female (natural)"},
    {"id": "hi-IN-MadhurNeural", "label": "Madhur — Hindi, male (natural)"},
    {"id": "en-IN-NeerjaExpressiveNeural", "label": "Neerja — Indian, female (expressive ⭐)"},
    {"id": "en-IN-NeerjaNeural", "label": "Neerja — Indian English, female"},
    {"id": "en-IN-PrabhatNeural", "label": "Prabhat — Indian English, male"},
    {"id": "en-US-JennyNeural", "label": "Jenny — US, female"},
    {"id": "en-US-GuyNeural", "label": "Guy — US, male"},
    {"id": "en-GB-SoniaNeural", "label": "Sonia — UK, female"},
    {"id": "en-GB-RyanNeural", "label": "Ryan — UK, male"},
]


@router.get("/voices")
async def list_voices():
    # `cloning` lets the UI hide the clone button + show a calm note when no
    # ElevenLabs key is configured, instead of failing with a scary error.
    return {"voices": NEURAL_VOICES, "cloning": voice_clone_service.configured()}


@router.post("/evaluate")
async def evaluate_conversation(payload: dict = Body(...)):
    """Caregiver wellbeing insights from the recent conversation."""
    transcript = (payload.get("transcript") or [])[-MAX_TRANSCRIPT:]
    if len([t for t in transcript if (t.get("text") or "").strip()]) < 2:
        return {"status": "empty", "message": "Not enough conversation yet — talk a little first."}
    result = llm_service.evaluate_conversation(transcript, payload.get("persona"), payload.get("user"))
    if not result:
        return {"status": "error", "message": "Couldn't generate insights right now."}
    return {"status": "ok", "evaluation": result}


@router.post("/persona/chat")
async def persona_chat(payload: dict = Body(...)):
    """In-character reply from the persona, grounded in long-term memories."""
    text = _clamp_text(payload.get("text"))
    persona = payload.get("persona") or {}
    user = payload.get("user") or {}
    history = (payload.get("history") or [])[-MAX_HISTORY:]
    if not text:
        return {"status": "error", "text": ""}
    # Pull the most relevant memories from past conversations (fail-soft -> []).
    mems = episodic_memory.retrieve(user, text, limit=4)
    try:
        distress = float(payload.get("distress") or 0.0)
    except (TypeError, ValueError):
        distress = 0.0
    reply = llm_service.chat_as_persona(text, persona=persona, user=user, history=history, memories=mems, distress=distress)
    return {"status": "ok", "text": reply}


@router.post("/persona/opener")
async def persona_opener(payload: dict = Body(...)):
    """A PROACTIVE, in-character check-in: the companion gently starts the
    conversation itself (used when the patient has gone quiet). Generated through
    the same persona brain so it's warm, time-aware, and follows the care plan."""
    persona = payload.get("persona") or {}
    user = payload.get("user") or {}
    directive = (
        "[Begin the conversation yourself, gently and warmly. Greet them by their first name "
        "in a way that suits the current time of day, and ask ONE caring question — how they "
        "feel, or a warm shared memory. Keep it to 1-2 short sentences. Do NOT mention that "
        "they were quiet or away, never say you are an AI, and never quiz or test them.]"
    )
    reply = llm_service.chat_as_persona(directive, persona=persona, user=user, history=[], memories=[])
    return {"status": "ok", "text": reply}


@router.post("/persona/reminisce")
async def persona_reminisce(payload: dict = Body(...)):
    """Warm, in-character REMINISCENCE about a specific shared memory — evidence-based
    comfort for dementia patients. INVITE the patient to relive it; never test them."""
    persona = payload.get("persona") or {}
    user = payload.get("user") or {}
    memory = _clamp_text(payload.get("memory")) or "a happy time we spent together"
    directive = (
        "[Bring up this shared memory we have and lovingly invite them to relive it with you — "
        "in the first person, warm, with affectionate, specific, HAPPY detail. INVITE, never "
        "test: do NOT ask 'do you remember?' and never quiz them. Keep it to 2-3 gentle sentences, "
        "only positive framing, and never say you are an AI. The memory: " + memory + "]"
    )
    reply = llm_service.chat_as_persona(directive, persona=persona, user=user, history=[], memories=[])
    return {"status": "ok", "text": reply}


@router.post("/memory/list")
async def memory_list(payload: dict = Body(...)):
    """The facts the companion currently remembers about this user (caregiver view)."""
    return {"status": "ok", "memories": episodic_memory.list_recent(payload.get("user") or {})}


@router.post("/memory/forget")
async def memory_forget(payload: dict = Body(...)):
    """Forget ONE stored memory by id."""
    pid = (payload.get("id") or "").strip()
    if not pid:
        return {"status": "error", "message": "no id"}
    return {"status": "ok" if episodic_memory.forget(pid) else "error"}


@router.post("/memory/clear")
async def memory_clear(payload: dict = Body(...)):
    """Forget ALL stored memories for this user."""
    return {"status": "ok" if episodic_memory.clear(payload.get("user") or {}) else "error"}


@router.post("/remember")
async def remember_session(payload: dict = Body(...)):
    """End-of-session: distill the conversation into durable memories and store them."""
    transcript = (payload.get("transcript") or [])[-MAX_TRANSCRIPT:]
    persona = payload.get("persona") or {}
    user = payload.get("user") or {}
    non_empty = [t for t in transcript if (t.get("text") or "").strip()]
    if len(non_empty) < 2:
        return {"status": "empty", "stored": 0, "facts": []}
    facts = llm_service.summarize_session(transcript, persona, user)
    if not facts:
        return {"status": "empty", "stored": 0, "facts": []}
    stored = episodic_memory.add_memories(user, facts)
    return {"status": "ok", "stored": stored, "facts": facts}


@router.post("/tts")
async def text_to_speech(payload: dict = Body(...)):
    """Synthesize text -> base64 MP3 for browser playback.

    If a cloned voice id is provided and ElevenLabs is configured, speak in the
    person's own cloned voice; otherwise fall back to a neural preset voice.
    """
    text = _clamp_text(payload.get("text"))
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
            print(f"Cloned TTS failed ({type(e).__name__}: {e!r}); using neural")

    voice = payload.get("voice")
    # Slightly slower, calmer delivery = more natural flow (gentler for elders).
    rate = payload.get("rate") or "-8%"
    pitch = payload.get("pitch")  # e.g. "-15Hz" — tunes the fast preset toward the loved one's voice
    audio = await tts_service.synthesize(text, voice, rate=rate, pitch=pitch)
    if not audio:
        return {"status": "error", "audio_base64": None}
    return {"status": "ok", "audio_base64": audio, "mime": "audio/mpeg", "cloned": False}


@router.post("/clone-voice")
async def clone_voice(payload: dict = Body(...)):
    """Instant voice clone from the uploaded/recorded sample -> voice_id."""
    if not voice_clone_service.configured():
        return {"status": "error", "message": "Voice cloning service isn't running. Start a local voice worker (OpenVoice on port 8811 or XTTS on 8810), or set ELEVENLABS_API_KEY."}
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
