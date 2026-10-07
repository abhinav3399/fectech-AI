"""Fast, dependency-light unit tests (no ML stack, no live services) — safe for CI."""
from app.core.config import settings, Settings


def test_cors_origins_parsing():
    s = Settings(ALLOWED_ORIGINS="http://a.com, http://b.com ,")
    assert s.cors_origins == ["http://a.com", "http://b.com"]


def test_cors_never_wildcard_by_default():
    # A health-data product must not ship a "*" CORS default.
    assert "*" not in settings.cors_origins


def test_core_defaults():
    assert settings.API_V1_STR == "/api/v1"
    assert isinstance(settings.cors_origins, list) and len(settings.cors_origins) >= 1
