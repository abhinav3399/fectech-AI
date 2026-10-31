"""Worker input validation and readiness tests (no model inference run here)."""
import base64
import io

from PIL import Image

from model_service.app import _decode_and_validate


def _encode(width, height, fmt="PNG"):
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (90, 120, 140)).save(buffer, format=fmt)
    return f"data:image/{fmt.lower()};base64," + base64.b64encode(buffer.getvalue()).decode()


def test_valid_portrait_bytes_are_accepted():
    raw, error = _decode_and_validate(_encode(512, 512))
    assert error is None
    assert raw and len(raw) > 1000


def test_low_resolution_is_rejected():
    raw, error = _decode_and_validate(_encode(100, 100))
    assert raw is None
    assert error.status_code == 422


def test_unsupported_gif_is_rejected():
    raw, error = _decode_and_validate(_encode(512, 512, fmt="GIF"))
    assert raw is None
    assert error.status_code == 415


def test_corrupt_bytes_are_rejected():
    raw, error = _decode_and_validate("data:image/png;base64," + base64.b64encode(b"x" * 4000).decode())
    assert raw is None
    assert error.status_code == 400


def test_invalid_base64_is_rejected():
    raw, error = _decode_and_validate("data:image/png;base64,!!!!")
    assert raw is None
    assert error.status_code == 400
