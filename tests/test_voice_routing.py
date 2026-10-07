"""Unit tests for the voice-provider routing logic (no network/models needed)."""
from app.services.voice_clone_service import VoiceCloneService, _DEVANAGARI


def test_language_detection():
    assert _DEVANAGARI.search("नमस्ते बेटा")        # Hindi (Devanagari) -> XTTS path
    assert not _DEVANAGARI.search("Hello there")    # English -> OpenVoice fast path
    assert not _DEVANAGARI.search("Kaise ho dost")  # Hinglish in Latin -> English path


def test_worker_routing_by_prefix():
    svc = VoiceCloneService()
    assert svc._worker_for("ov:abc123") is svc._ov          # OpenVoice
    assert svc._worker_for("local:abc123") is svc._xtts     # XTTS
    assert svc._worker_for("bareElevenLabsId") is None      # ElevenLabs (un-prefixed)
