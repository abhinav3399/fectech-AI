"""Centralized settings — every secret/threshold is read from .env here, never hardcoded."""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # --- Qdrant ---
    qdrant_mode: str = "local"  # "local" (in-memory) or "server"
    qdrant_url: str = ""
    qdrant_api_key: str = ""

    # --- Groq ---
    groq_api_key: str = ""
    # Current valid Groq model (llama3-70b-8192 was deprecated/removed by Groq).
    # Keep the 70B flagship for quality; chat() falls back to a smaller model if needed.
    groq_llm_model: str = "llama-3.3-70b-versatile"
    groq_llm_fallback_model: str = "llama-3.1-8b-instant"
    groq_whisper_model: str = "whisper-large-v3"

    # --- Embeddings / recognition ---
    embedding_dim: int = 512
    # Max cosine *distance* for a match. recognized when similarity >= (1 - threshold).
    face_match_threshold: float = 0.35

    # --- Feature 1: Calibrated Trust Core ---
    conf_high: float = 0.80          # >= this (with margin) -> assert identity
    conf_medium: float = 0.55        # >= this -> hedge ("looks like ... shall we check?")
    margin_min: float = 0.10         # min top1-vs-next-identity gap required for "high"
    auto_add_conf: float = 0.90      # high + score >= this -> auto-enroll as a new exemplar
    exemplar_max_per_person: int = 8 # cap exemplars per person
    quality_min_face_size: int = 80  # min face box px to be eligible as an exemplar (real backend)

    # --- Collection names ---
    people_collection: str = "people"
    objects_collection: str = "objects"

    # --- Web ---
    cors_origins: str = "http://localhost:5173"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
