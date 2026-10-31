"""Live-server enrollment integration tests.

These require a running backend with real face/object models, so they are opt-in
via FACTECH_LIVE_API (default http://localhost:8010/api/v1). They must not fail a
normal offline unit-test run.
"""
import os
from io import BytesIO

import pytest
import requests

API_BASE = os.getenv("FACTECH_LIVE_API", "http://localhost:8010/api/v1")
live_only = pytest.mark.skipif(
    not os.getenv("FACTECH_LIVE_API"),
    reason="Set FACTECH_LIVE_API=http://host:port/api/v1 to run live enrollment tests.",
)


def _portrait_bytes() -> bytes:
    from PIL import Image
    buffer = BytesIO()
    Image.new("RGB", (512, 512), (120, 100, 90)).save(buffer, format="JPEG")
    return buffer.getvalue()


@pytest.mark.skipif(not os.getenv("FACTECH_LIVE_API"), reason="live API not configured")
def test_person_enrollment():
    url = f"{API_BASE}/remember/person"
    data = {"name": "Test Person", "relation": "Friend", "age": "30", "notes": "Integration test"}
    files = {"file": ("person.jpg", _portrait_bytes(), "image/jpeg")}
    response = requests.post(url, data=data, files=files, timeout=90)
    assert response.status_code == 200, response.text


@pytest.mark.skipif(not os.getenv("FACTECH_LIVE_API"), reason="live API not configured")
def test_object_enrollment():
    url = f"{API_BASE}/remember/object"
    data = {"name": "Test Wallet", "notes": "My black wallet"}
    files = {"file": ("object.jpg", _portrait_bytes(), "image/jpeg")}
    response = requests.post(url, data=data, files=files, timeout=60)
    assert response.status_code == 200, response.text


if __name__ == "__main__":
    print("Set FACTECH_LIVE_API and run pytest to execute these integration tests.")
