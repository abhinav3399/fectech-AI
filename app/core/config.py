from pydantic_settings import BaseSettings
from typing import Optional

class Settings(BaseSettings):
    PROJECT_NAME: str = "Memory for the Forgotten"
    API_V1_STR: str = "/api/v1"
    
    QDRANT_HOST: str = "localhost"
    QDRANT_PORT: int = 6333
    QDRANT_URL: Optional[str] = None
    QDRANT_API_KEY: Optional[str] = None
    QDRANT_MODE: str = "server" # 'local' or 'server'
    QDRANT_PATH: str = "qdrant_storage"
    
    GROQ_API_KEY: Optional[str] = None
    # Optional free local LLM. Ollama serves models on this URL without an API key.
    OLLAMA_URL: str = "http://127.0.0.1:11434"
    OLLAMA_MODEL: str = "llama3.2:3b"
    OLLAMA_ENABLED: bool = True
    MESHY_API_KEY: Optional[str] = None
    ELEVENLABS_API_KEY: Optional[str] = None

    # CORS allowlist (comma-separated). Dev only needs the Vite origin; in single-origin
    # production the SPA is same-origin so this rarely matters. NEVER use "*" with credentials.
    # Capacitor Android apps use capacitor://localhost as their origin.
    ALLOWED_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8010,capacitor://localhost,http://localhost"

    # --- Accounts & persistence (SQLite by default; swap to Postgres for scale) ---
    DATABASE_URL: str = "sqlite:///./factech.db"
    # Signs auth tokens. MUST be overridden in production (set SECRET_KEY in the environment).
    SECRET_KEY: str = "dev-only-change-me-in-production"
    AUTH_TOKEN_TTL_HOURS: int = 720  # 30 days

    @property
    def cors_origins(self) -> list:
        return [o.strip() for o in (self.ALLOWED_ORIGINS or "").split(",") if o.strip()]

    # Local timezone for the companion's temporal awareness ("Good morning",
    # "it's getting late") — IANA name, e.g. Asia/Kolkata, Europe/London.
    TIMEZONE: str = "Asia/Kolkata"

    # --- Photo -> 3D engine (pluggable behind app/services/mesh_service.py) ---
    # "auto" picks the first configured provider; or force one: meshy | replicate | local.
    MODEL_3D_PROVIDER: str = "auto"
    # Replicate (hosted, pay-per-use, no local GPU). Token from replicate.com.
    REPLICATE_API_TOKEN: Optional[str] = None
    REPLICATE_3D_MODEL: str = "ndreca/hunyuan3d-2"
    # Your own self-hosted GPU service (submit/poll). e.g. http://127.0.0.1:8800
    MODEL_3D_URL: Optional[str] = None

    # --- Voice cloning engine (pluggable behind app/services/voice_clone_service.py) ---
    # "auto" = ElevenLabs if ELEVENLABS_API_KEY is set, else the local XTTS worker
    # if it's reachable. Force one: local | elevenlabs | off.
    VOICE_PROVIDER: str = "auto"
    # Your own self-hosted local voice worker (voice_service/, XTTS-v2 — no API key).
    # Defaulted so it "just works" once the worker is running; clear it to disable.
    VOICE_SERVICE_URL: Optional[str] = "http://127.0.0.1:8810"
    # Fast local clone worker (voice_service_ov/, OpenVoice v2 — ~4s/sentence, English).
    # Used as the FAST path; XTTS stays the Hindi + high-fidelity fallback.
    VOICE_SERVICE_OV_URL: Optional[str] = "http://127.0.0.1:8811"

    def get_qdrant_url(self) -> str:
        if self.QDRANT_URL:
            return self.QDRANT_URL
        return f"http://{self.QDRANT_HOST}:{self.QDRANT_PORT}"

    class Config:
        env_file = ".env"

settings = Settings()
