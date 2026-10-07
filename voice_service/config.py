"""Config for the local voice-cloning worker. All env-overridable, sane offline
defaults so it runs with zero setup."""
import os


class Cfg:
    PORT = int(os.getenv("VOICE_SERVICE_PORT", "8810"))

    # Where cloned-voice reference clips + metadata are stored (one wav per voice).
    VOICES_DIR = os.getenv(
        "VOICE_VOICES_DIR", os.path.join(os.path.dirname(__file__), "voices")
    )

    # Coqui model id — the model manager downloads it on first load (~1.8GB).
    MODEL = os.getenv("VOICE_MODEL", "tts_models/multilingual/multi-dataset/xtts_v2")

    # This repo has no GPU; XTTS runs on CPU. Set VOICE_DEVICE=cuda if you have one.
    DEVICE = os.getenv("VOICE_DEVICE", "cpu")


cfg = Cfg()
