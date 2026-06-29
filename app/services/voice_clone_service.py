"""Voice cloning behind a SWAPPABLE provider (the "voice provider" seam).

Consumers (app/api/persona_endpoint.py) only ever call
  configured() / clone(...) / tts(...)
and never care which engine runs underneath.

Providers (pick with settings.VOICE_PROVIDER; "auto" = ElevenLabs if a key is
set, else the local worker if it's reachable):
  - local      : YOUR OWN self-hosted XTTS-v2 worker (voice_service/) at
                 settings.VOICE_SERVICE_URL. Fully offline, no API key.
  - elevenlabs : ElevenLabs hosted Instant Voice Clone (needs ELEVENLABS_API_KEY).

A local clone's voice_id is prefixed "local:" so tts() can always route a voice
back to the engine that made it, even if the provider config later changes.
"""
import os
import re
import json
import time
import base64
import httpx
from app.core.config import settings

EL_BASE = "https://api.elevenlabs.io"
_LOCAL_PREFIX = "local:"

_EXT_BY_MIME = {
    "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav",
    "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/m4a": "m4a",
}


def parse_data_url(data_url: str):
    """data:audio/webm;base64,XXXX -> (raw_bytes, (mime, filename))."""
    m = re.match(r"data:([^;]+);base64,(.*)", data_url or "", re.DOTALL)
    if not m:
        return None, None
    mime = m.group(1)
    raw = base64.b64decode(m.group(2))
    ext = _EXT_BY_MIME.get(mime, "mp3")
    return raw, (mime, f"sample.{ext}")


class _ElevenLabs:
    """Hosted Instant Voice Clone. Synthesizes MP3."""

    @property
    def api_key(self):
        return settings.ELEVENLABS_API_KEY or os.getenv("ELEVENLABS_API_KEY")

    def available(self) -> bool:
        return bool(self.api_key)

    async def clone(self, name, audio_bytes, mime, filename, labels=None) -> str:
        headers = {"xi-api-key": self.api_key}
        data = {"name": name, "remove_background_noise": "true"}
        if labels:
            data["labels"] = json.dumps({k: str(v) for k, v in labels.items() if v})
        files = {"files": (filename, audio_bytes, mime)}
        async with httpx.AsyncClient(timeout=180) as client:
            r = await client.post(f"{EL_BASE}/v1/voices/add", headers=headers, data=data, files=files)
            r.raise_for_status()
            return r.json().get("voice_id")

    async def tts(self, text, voice_id, model_id="eleven_multilingual_v2") -> bytes:
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


_OV_PREFIX = "ov:"  # OpenVoice worker (fast, English)
_DEVANAGARI = re.compile(r"[ऀ-ॿ]")  # Hindi -> must use XTTS (OpenVoice is English-only)


class _HttpWorker:
    """A local FastAPI voice worker (XTTS on 8810 or OpenVoice on 8811). Both speak the
    same contract: POST /clone -> voice_id, POST /tts -> base64 MP3. No API key."""

    def __init__(self, url_getter, prefix, kind):
        self._url_getter = url_getter
        self.prefix = prefix
        self.kind = kind
        self._alive = False
        self._checked_at = 0.0

    @property
    def url(self):
        return (self._url_getter() or "").rstrip("/")

    def available(self, ttl: float = 15.0) -> bool:
        """Cached liveness ping so /voices doesn't advertise cloning when the worker
        is down (a calm 'not set up' beats a clone button that errors)."""
        if not self.url:
            return False
        now = time.monotonic()
        if now - self._checked_at < ttl:
            return self._alive
        try:
            r = httpx.get(f"{self.url}/health", timeout=1.0)
            self._alive = r.status_code == 200 and r.json().get("ok") is True
        except Exception:
            self._alive = False
        self._checked_at = now
        return self._alive

    async def clone(self, name, audio_bytes, mime) -> str:
        b64 = base64.b64encode(audio_bytes).decode("utf-8")
        data_url = f"data:{mime or 'audio/wav'};base64,{b64}"
        async with httpx.AsyncClient(timeout=120) as client:
            r = await client.post(f"{self.url}/clone", json={"audio": data_url, "name": name})
            r.raise_for_status()
            j = r.json()
        if j.get("status") != "ok":
            raise RuntimeError(j.get("message") or f"{self.kind} clone failed")
        return self.prefix + j["voice_id"]

    async def tts(self, text, voice_id) -> bytes:
        vid = voice_id.split(":", 1)[1] if ":" in voice_id else voice_id
        async with httpx.AsyncClient(timeout=180) as client:
            r = await client.post(f"{self.url}/tts", json={"text": text, "voice_id": vid})
            r.raise_for_status()
            j = r.json()
        if j.get("status") != "ok":
            raise RuntimeError(j.get("message") or f"{self.kind} tts failed")
        return base64.b64decode(j["audio_base64"])


class VoiceCloneService:
    """Voice-provider seam over THREE engines, all behind one contract:
      - ov     : OpenVoice v2 (fast, English) — the live-conversation path
      - xtts   : XTTS-v2 (slower, high-fidelity, Hindi) — Hindi + fidelity fallback
      - el     : ElevenLabs (hosted, only if a key is set)
    A clone is made on every available LOCAL engine and the ids are joined with '|'
    (e.g. "ov:ab12|local:cd34"); tts() then routes per LANGUAGE: Hindi -> XTTS, else
    -> OpenVoice (fast)."""

    def __init__(self):
        self._el = _ElevenLabs()
        self._xtts = _HttpWorker(lambda: settings.VOICE_SERVICE_URL or os.getenv("VOICE_SERVICE_URL"), _LOCAL_PREFIX, "xtts")
        self._ov = _HttpWorker(lambda: settings.VOICE_SERVICE_OV_URL or os.getenv("VOICE_SERVICE_OV_URL"), _OV_PREFIX, "openvoice")

    def _clone_targets(self):
        """Which engine(s) a NEW clone is made on, per settings.VOICE_PROVIDER."""
        p = (settings.VOICE_PROVIDER or "auto").lower()
        if p == "off":
            return []
        if p == "elevenlabs":
            return [self._el] if self._el.available() else []
        if p == "local":
            return [w for w in (self._ov, self._xtts) if w.available()]
        # auto: prefer our local workers (clone on BOTH for fast-EN + Hindi/fidelity);
        # only fall back to ElevenLabs if no local worker is up and a key is set.
        locals_ = [w for w in (self._ov, self._xtts) if w.available()]
        if locals_:
            return locals_
        return [self._el] if self._el.available() else []

    def configured(self) -> bool:
        """Whether cloning is available at all (drives the UI's clone button)."""
        return len(self._clone_targets()) > 0

    async def clone(self, name, audio_bytes, mime, filename=None, labels=None) -> str:
        targets = self._clone_targets()
        if not targets:
            raise RuntimeError("no voice provider available")
        ids, errs = [], []
        for w in targets:
            try:
                if w is self._el:
                    ids.append(await w.clone(name, audio_bytes, mime, filename, labels))
                else:
                    ids.append(await w.clone(name, audio_bytes, mime))
            except Exception as e:
                errs.append(str(e))
        if not ids:
            raise RuntimeError(errs[0] if errs else "clone failed")
        return "|".join(ids)  # e.g. "ov:ab12|local:cd34"

    def _worker_for(self, seg):
        if seg.startswith(_OV_PREFIX):
            return self._ov
        if seg.startswith(_LOCAL_PREFIX):
            return self._xtts
        return None  # bare id -> ElevenLabs

    async def tts(self, text, voice_id, model_id="eleven_multilingual_v2") -> bytes:
        segs = [s for s in (voice_id or "").split("|") if s]
        is_hindi = bool(_DEVANAGARI.search(text or ""))
        # Hindi must go to XTTS (OpenVoice has no Hindi); English prefers fast OpenVoice.
        order = [self._xtts, self._ov] if is_hindi else [self._ov, self._xtts]
        for w in order:
            for seg in segs:
                if self._worker_for(seg) is w and w.available():
                    try:
                        return await w.tts(text, seg)
                    except Exception:
                        pass
        # ElevenLabs segment (bare id), if present and configured.
        for seg in segs:
            if self._worker_for(seg) is None and self._el.available():
                return await self._el.tts(text, seg, model_id)
        # Last resort: any reachable local worker with a matching segment.
        for seg in segs:
            w = self._worker_for(seg)
            if w and w.available():
                return await w.tts(text, seg)
        raise RuntimeError("no voice provider for this voice_id")


voice_clone_service = VoiceCloneService()
