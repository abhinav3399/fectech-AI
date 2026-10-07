"""Groq access — Llama 3 chat + Whisper transcription.

Without GROQ_API_KEY the service degrades gracefully: chat() returns "" so callers can
build a templated reply, and transcribe() returns "" (no STT). The app stays fully runnable.
"""
import logging
from typing import Optional

from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

_client = None


def available() -> bool:
    return bool(settings.groq_api_key)


def _get_client():
    global _client
    if _client is None and available():
        from groq import Groq

        _client = Groq(api_key=settings.groq_api_key)
    return _client


def chat(system_prompt: str, user_message: str, temperature: float = 0.4) -> str:
    client = _get_client()
    if client is None:
        return ""  # caller falls back to a templated reply
    # Try the configured model first, then fall back to a smaller/current one so a
    # single model hiccup (deprecated id, outage, rate-limit) never blanks the reply.
    models = [settings.groq_llm_model, settings.groq_llm_fallback_model]
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_message},
    ]
    last_err = None
    for model in models:
        try:
            resp = client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=temperature,
                max_tokens=300,
            )
            text = (resp.choices[0].message.content or "").strip()
            if text:
                return text
        except Exception as e:  # noqa: BLE001 - network/model errors are expected
            last_err = e
            logger.warning("groq_service chat failed on %s: %s", model, e)
    if last_err:
        logger.warning("groq_service chat failed on all models: %s", last_err)
    return ""  # caller falls back to a templated reply


def transcribe(audio_bytes: bytes, filename: str = "audio.webm") -> str:
    client = _get_client()
    if client is None:
        logger.warning("groq_service: no GROQ_API_KEY -> transcription returns empty text.")
        return ""
    resp = client.audio.transcriptions.create(
        file=(filename, audio_bytes), model=settings.groq_whisper_model
    )
    return (resp.text or "").strip()
