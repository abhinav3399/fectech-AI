"""Config for the OpenVoice v2 worker (fast local clone). Env-overridable."""
import os


class Cfg:
    PORT = int(os.getenv("VOICE_OV_PORT", "8811"))
    VOICES_DIR = os.getenv("VOICE_OV_DIR", os.path.join(os.path.dirname(__file__), "voices"))
    # MeloTTS English accent for the base voice. EN_INDIA matches this app's Indian-English
    # personas best; options: EN-US, EN-BR, EN_INDIA, EN-AU, EN-Default.
    SPEAKER = os.getenv("VOICE_OV_SPEAKER", "EN_INDIA")
    DEVICE = os.getenv("VOICE_OV_DEVICE", "cpu")


cfg = Cfg()
