"""Photo-to-3D API regression tests.

Covers the cases the UI must explain: invalid/unsupported/too-small/too-large
photos, missing provider, unreachable worker, timeout, busy worker, no face,
missing asset, cancellation, and a successful local model.
"""
import base64
import io

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

import app.api.mesh_endpoint as mesh_api
from app.services.mesh_service import ProviderError


def image_data_url(width=512, height=512, fmt="PNG"):
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (130, 100, 90)).save(buffer, format=fmt)
    return f"data:image/{fmt.lower()};base64," + base64.b64encode(buffer.getvalue()).decode()


@pytest.fixture
def client(monkeypatch, tmp_path):
    application = FastAPI()
    application.include_router(mesh_api.router, prefix="/api/v1")
    monkeypatch.setattr(mesh_api, "MODELS_DIR", str(tmp_path))
    return TestClient(application)


def patch_diagnostics(monkeypatch, **overrides):
    payload = {
        "provider": "local",
        "configured": True,
        "reachable": True,
        "ready": True,
        "pipeline": "C",
        "model_present": True,
        "message": "Local worker ready.",
    }
    payload.update(overrides)

    async def diagnostics():
        return payload

    monkeypatch.setattr(mesh_api.mesh_service, "diagnostics", diagnostics)


def patch_submit(monkeypatch, behaviour):
    async def submit(image):
        return behaviour(image)

    monkeypatch.setattr(mesh_api.mesh_service, "submit_image_to_3d", submit)


def test_unreachable_worker_returns_actionable_503(client, monkeypatch):
    patch_diagnostics(monkeypatch, reachable=False, ready=False, message="The local 3D worker is not running.")
    response = client.post("/api/v1/generate-3d", json={"image": image_data_url()})
    assert response.status_code == 503
    body = response.json()
    assert body["code"] == "worker_unreachable"
    assert "start_local" in body["message"] or "not running" in body["message"]


def test_no_provider_returns_503(client, monkeypatch):
    patch_diagnostics(monkeypatch, provider="none", configured=False, ready=False, message="No 3D provider configured.")
    response = client.post("/api/v1/generate-3d", json={"image": image_data_url()})
    assert response.status_code == 503
    assert response.json()["code"] == "no_provider"


def test_invalid_base64_is_rejected(client):
    response = client.post("/api/v1/generate-3d", json={"image": "not-a-data-url"})
    assert response.status_code == 400
    assert response.json()["code"] == "invalid_image"


def test_unsupported_format_is_rejected(client):
    buffer = io.BytesIO()
    from PIL import Image as PILImage
    PILImage.new("RGB", (512, 512), (10, 20, 30)).save(buffer, format="GIF")
    data = "data:image/gif;base64," + base64.b64encode(buffer.getvalue()).decode()
    response = client.post("/api/v1/generate-3d", json={"image": data})
    assert response.status_code == 400
    assert response.json()["code"] == "unsupported_format"


def test_low_resolution_photo_is_rejected(client):
    response = client.post("/api/v1/generate-3d", json={"image": image_data_url(120, 120)})
    assert response.status_code == 400
    assert response.json()["code"] == "image_too_small"


def test_oversized_photo_is_rejected(client, monkeypatch):
    monkeypatch.setattr(mesh_api, "MAX_IMAGE_BYTES", 1000)
    response = client.post("/api/v1/generate-3d", json={"image": image_data_url()})
    assert response.status_code == 400
    assert response.json()["code"] == "image_too_large"


def test_corrupt_image_is_rejected(client):
    data = "data:image/png;base64," + base64.b64encode(b"not really a png but long enough" * 40).decode()
    response = client.post("/api/v1/generate-3d", json={"image": data})
    assert response.status_code == 400
    assert response.json()["code"] == "invalid_image"


def test_successful_submit_returns_task_id(client, monkeypatch):
    patch_diagnostics(monkeypatch)
    patch_submit(monkeypatch, lambda image: "task-123")
    response = client.post("/api/v1/generate-3d", json={"image": image_data_url()})
    assert response.status_code == 200
    assert response.json() == {"status": "submitted", "task_id": "task-123", "provider": "local"}


def test_busy_worker_maps_to_409(client, monkeypatch):
    patch_diagnostics(monkeypatch)

    def busy(_image):
        raise ProviderError("worker_busy", "The worker is busy.", http_status=409)

    patch_submit(monkeypatch, busy)
    response = client.post("/api/v1/generate-3d", json={"image": image_data_url()})
    assert response.status_code == 409
    assert response.json()["code"] == "worker_busy"


def test_timeout_maps_to_504(client, monkeypatch):
    patch_diagnostics(monkeypatch)

    def timeout(_image):
        raise ProviderError("worker_timeout", "Timed out.", http_status=504)

    patch_submit(monkeypatch, timeout)
    response = client.post("/api/v1/generate-3d", json={"image": image_data_url()})
    assert response.status_code == 504
    assert response.json()["code"] == "worker_timeout"


def test_successful_generation_caches_real_glb(client, monkeypatch, tmp_path):
    patch_diagnostics(monkeypatch)

    async def get_task(task_id):
        return {
            "status": "SUCCEEDED",
            "progress": 100,
            "stage": "Complete",
            "model_urls": {"glb": "http://worker/files/x.glb", "stl": "http://worker/files/x.stl"},
            "task_error": None,
        }

    async def download(url, dest):
        with open(dest, "wb") as handle:
            handle.write(b"glTF" + b"\x00" * 4096)
        return 4096

    monkeypatch.setattr(mesh_api.mesh_service, "get_task", get_task)
    monkeypatch.setattr(mesh_api.mesh_service, "download_glb", download)

    response = client.get("/api/v1/generate-3d/task-abc")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "SUCCEEDED"
    assert body["model_url"] == "/static/models/task-abc.glb"
    assert (tmp_path / "task-abc.glb").stat().st_size > 1000


def test_missing_glb_in_success_response_is_an_error(client, monkeypatch):
    patch_diagnostics(monkeypatch)

    async def get_task(task_id):
        return {"status": "SUCCEEDED", "progress": 100, "model_urls": {}, "task_error": None}

    monkeypatch.setattr(mesh_api.mesh_service, "get_task", get_task)
    response = client.get("/api/v1/generate-3d/task-abc")
    assert response.status_code == 502
    assert response.json()["message"].startswith("Generation finished but")


def test_no_face_failure_is_specific(client, monkeypatch):
    patch_diagnostics(monkeypatch)

    async def get_task(task_id):
        return {
            "status": "FAILED",
            "progress": 0,
            "model_urls": {},
            "task_error": {"message": "no face detected by mediapipe"},
        }

    monkeypatch.setattr(mesh_api.mesh_service, "get_task", get_task)
    response = client.get("/api/v1/generate-3d/task-abc")
    assert response.status_code == 200
    body = response.json()
    assert body["code"] == "no_face_detected"
    assert "front-facing" in body["message"]


def test_out_of_memory_failure_is_specific(client, monkeypatch):
    patch_diagnostics(monkeypatch)

    async def get_task(task_id):
        return {"status": "FAILED", "progress": 0, "model_urls": {},
                "task_error": {"message": "The device ran out of memory while building the 3D model."}}

    monkeypatch.setattr(mesh_api.mesh_service, "get_task", get_task)
    body = client.get("/api/v1/generate-3d/task-abc").json()
    assert body["code"] == "out_of_memory"


def test_cancel_is_forwarded(client, monkeypatch):
    patch_diagnostics(monkeypatch)

    async def cancel(task_id):
        return True

    monkeypatch.setattr(mesh_api.mesh_service, "cancel", cancel)
    response = client.post("/api/v1/generate-3d/task-abc/cancel")
    assert response.status_code == 200
    assert response.json()["status"] == "canceled"


def test_cancel_unsupported_is_reported(client, monkeypatch):
    patch_diagnostics(monkeypatch)

    async def cancel(task_id):
        return False

    monkeypatch.setattr(mesh_api.mesh_service, "cancel", cancel)
    response = client.post("/api/v1/generate-3d/task-abc/cancel")
    assert response.json()["status"] == "unsupported"
