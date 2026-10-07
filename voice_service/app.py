"""Local voice-cloning worker (XTTS-v2). No API key, runs independently.

Run it (its own isolated venv):
    voice_service/.venv/Scripts/python -m uvicorn voice_service.app:app --port 8810

Then point the main app at it (.env at repo root):
    VOICE_PROVIDER=local
    VOICE_SERVICE_URL=http://127.0.0.1:8810
(With VOICE_PROVIDER=auto — the default — the main app uses this worker
automatically whenever no ELEVENLABS_API_KEY is set and the worker is reachable.)

Contract — synchronous, because CPU XTTS on a short utterance is seconds not
minutes, so no submit/poll is needed (unlike the 3D model_service):
    POST /clone {audio:<data-url|base64>, name?}  -> {status, voice_id}
    POST /tts   {text, voice_id, language?}        -> {status, audio_base64, mime}
"""
import base64
import re

from fastapi import Body, FastAPI
from fastapi.responses import JSONResponse

from .config import cfg
from . import engine

app = FastAPI(title="Factech AI — local voice cloning (XTTS-v2)")


@app.on_event("startup")
def _warmup():
    # Load the model in the background so /health answers immediately while the
    # first synthesis won't pay the full cold-start cost.
    import threading

    threading.Thread(target=engine.warmup, daemon=True).start()


def _decode_audio(s: str) -> bytes:
    m = re.match(r"data:([^;]+);base64,(.*)", s or "", re.DOTALL)
    return base64.b64decode(m.group(2)) if m else base64.b64decode(s)


@app.get("/health")
def health():
    return {
        "ok": True,
        "engine": "xtts_v2",
        "device": cfg.DEVICE,
        "model_loaded": engine.is_loaded(),
    }


@app.post("/clone")
def clone(payload: dict = Body(...)):
    audio = payload.get("audio")
    if not audio:
        return JSONResponse({"status": "error", "message": "no audio provided"}, status_code=400)
    try:
        voice_id = engine.clone(_decode_audio(audio), (payload.get("name") or "").strip()[:100])
        return {"status": "ok", "voice_id": voice_id}
    except Exception as e:
        return JSONResponse({"status": "error", "message": str(e)}, status_code=400)


@app.post("/tts")
def tts(payload: dict = Body(...)):
    text = (payload.get("text") or "").strip()
    voice_id = payload.get("voice_id")
    if not text or not voice_id:
        return JSONResponse({"status": "error", "message": "text and voice_id required"}, status_code=400)
    try:
        mp3 = engine.synth(text, voice_id, payload.get("language"))
        return {"status": "ok", "audio_base64": base64.b64encode(mp3).decode("utf-8"), "mime": "audio/mpeg"}
    except Exception as e:
        return JSONResponse({"status": "error", "message": str(e)}, status_code=400)
