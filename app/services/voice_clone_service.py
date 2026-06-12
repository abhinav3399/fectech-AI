"""ElevenLabs voice cloning + cloned-voice TTS.

The "voice provider" seam: clone a voice from the uploaded sample once
(-> voice_id), then synthesize any text in that voice. Isolated so a different
cloning engine (Cartesia, local XTTS, ...) can replace it without touching
endpoints or the frontend.
"""
import os
import re
import json
import base64
import httpx
from app.core.config import settings

EL_BASE = "https://api.elevenlabs.io"

_EXT_BY_MIME = {
    "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav",
    "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/m4a": "m4a",
}


def parse_data_url(data_url: str):
    """data:audio/webm;base64,XXXX -> (raw_bytes, filename)."""
    m = re.match(r"data:([^;]+);base64,(.*)", data_url or "", re.DOTALL)
    if not m:
        return None, None
    mime = m.group(1)
    raw = base64.b64decode(m.group(2))
    ext = _EXT_BY_MIME.get(mime, "mp3")
    return raw, (mime, f"sample.{ext}")


class VoiceCloneService:
    @property
    def api_key(self):
        return settings.ELEVENLABS_API_KEY or os.getenv("ELEVENLABS_API_KEY")

    def configured(self) -> bool:
        return bool(self.api_key)

    async def clone(self, name: str, audio_bytes: bytes, mime: str, filename: str, labels: dict = None) -> str:
        """Instant Voice Clone from a sample. Returns the new voice_id."""
        headers = {"xi-api-key": self.api_key}
        data = {"name": name, "remove_background_noise": "true"}
        if labels:
            data["labels"] = json.dumps({k: str(v) for k, v in labels.items() if v})
        files = {"files": (filename, audio_bytes, mime)}
        async with httpx.AsyncClient(timeout=180) as client:
            r = await client.post(f"{EL_BASE}/v1/voices/add", headers=headers, data=data, files=files)
            r.raise_for_status()
            return r.json().get("voice_id")

    async def tts(self, text: str, voice_id: str, model_id: str = "eleven_multilingual_v2") -> bytes:
        """Speak text in the cloned voice. Returns MP3 bytes."""
        headers = {"xi-api-key": self.api_key, "Content-Type": "application/json", "Accept": "audio/mpeg"}
        payload = {
            "text": text,
            "model_id": model_id,
            "voice_settings": {"stability": 0.5, "similarity_boost": 0.85},
        }
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(f"{EL_BASE}/v1/text-to-speech/{voice_id}", headers=headers, json=payload)
            r.raise_for_status()
            return r.content


voice_clone_service = VoiceCloneService()
