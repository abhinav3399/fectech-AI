"""Image-to-3D generation endpoints.

Async pattern so no HTTP request is held open for the whole reconstruction:

  GET  /generate-3d/diagnostics -> is the configured provider ready?
  POST /generate-3d             -> validate photo, submit, return a task id
  GET  /generate-3d/{task_id}   -> poll progress; cache + return the GLB locally
  POST /generate-3d/{task_id}/cancel -> request cancellation

Every failure carries a stable `code` plus human-readable `message` so the UI
never has to show a bare "Could not start generation".
"""
import base64
import binascii
import io
import os
import re
import traceback

from fastapi import APIRouter, Body
from fastapi.responses import JSONResponse

from app.services.mesh_service import mesh_service, ProviderError

router = APIRouter()

MODELS_DIR = os.path.join("static", "models")
os.makedirs(MODELS_DIR, exist_ok=True)

MAX_IMAGE_BYTES = 8 * 1024 * 1024
MIN_DIMENSION = 256
MAX_DIMENSION = 6000
ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp"}


def _error(code, message, http_status=400, retryable=True, **extra):
    body = {"status": "error", "code": code, "message": message, "retryable": retryable}
    body.update(extra)
    return JSONResponse(status_code=http_status, content=body)


def _validate_data_url(image: str):
    """Validate format/size/dimensions before a worker is asked to process it.

    Returns (data_url, error_response). Exactly one is non-None.
    """
    match = re.match(r"^data:([^;,]+);base64,(.+)$", image or "", re.DOTALL)
    if not match:
        return None, _error(
            "invalid_image",
            "The photo must be uploaded as a base64 image (JPEG, PNG or WebP).",
        )
    mime, encoded = match.group(1).lower(), match.group(2)
    if mime not in ALLOWED_MIME:
        return None, _error(
            "unsupported_format",
            f"{mime or 'That file type'} is not supported. Use a JPEG, PNG or WebP photo.",
        )
    if len(encoded) > MAX_IMAGE_BYTES * 4 / 3 + 1024:
        return None, _error(
            "image_too_large",
            "That photo is larger than 8 MB. Use a smaller photo or let the app downscale it.",
        )
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        return None, _error("invalid_image", "The photo data is corrupted and could not be decoded.")
    if len(raw) < 100:
        # Tiny files are truncation/empty uploads. Don't reject a legitimately
        # small, highly-compressed PNG — the dimension check below handles that.
        return None, _error("invalid_image", "The photo file is empty or truncated.")
    try:
        from PIL import Image
        with Image.open(io.BytesIO(raw)) as probe:
            probe.verify()
        with Image.open(io.BytesIO(raw)) as probe:
            width, height = probe.size
    except Exception:
        return None, _error("invalid_image", "The photo could not be read. It may be corrupt or not a real image.")
    if min(width, height) < MIN_DIMENSION:
        return None, _error(
            "image_too_small",
            f"The photo is only {width}×{height}. Use at least {MIN_DIMENSION}×{MIN_DIMENSION} for a usable face mesh.",
        )
    if max(width, height) > MAX_DIMENSION:
        return None, _error(
            "image_too_large",
            f"The photo is {width}×{height}. Use a photo under {MAX_DIMENSION}px on the long edge.",
        )
    return image, None


def _worker_failure_message(message: str) -> tuple[str, str, bool]:
    """Map a worker error into (code, friendly message, retryable)."""
    text = (message or "").strip()
    lowered = text.lower()
    if "no face" in lowered or "face not" in lowered:
        return (
            "no_face_detected",
            "No face was detected in that photo. Use a clear, front-facing portrait with the whole face visible.",
            True,
        )
    if "memory" in lowered or "memoryerror" in lowered:
        return ("out_of_memory", "The device ran out of memory while building the model. Close other apps and retry with a smaller photo.", True)
    if "bad image" in lowered or "decode" in lowered:
        return ("invalid_image", "The photo could not be prepared for reconstruction.", True)
    if "unknown task" in lowered or "not found" in lowered:
        return ("task_lost", "The 3D worker restarted and lost this job. Please generate again.", True)
    if "timeout" in lowered or "timed out" in lowered:
        return ("generation_timeout", "3D generation timed out. Try again with a smaller, well-lit photo.", True)
    return ("generation_failed", text or "3D generation failed.", True)


@router.get("/generate-3d/diagnostics")
async def generate_3d_diagnostics():
    """Readiness probe used to enable/disable the Generate button."""
    try:
        return await mesh_service.diagnostics()
    except Exception as exc:
        return {"provider": mesh_service.active_provider_name(), "configured": True,
                "ready": False, "message": f"Could not check the 3D provider: {exc}"}


@router.post("/generate-3d")
async def generate_3d(payload: dict = Body(...)):
    diagnostics = await mesh_service.diagnostics()
    if not diagnostics.get("configured"):
        return _error("no_provider", diagnostics.get("message") or "No 3D provider is configured.", 503, False, provider=diagnostics.get("provider"))
    if diagnostics.get("provider") == "local" and not diagnostics.get("reachable"):
        return _error(
            "worker_unreachable",
            diagnostics.get("message") or "The local 3D worker is not running.",
            503,
            True,
            provider="local",
        )

    image, invalid = _validate_data_url((payload.get("image") or "").strip())
    if invalid is not None:
        return invalid

    try:
        task_id = await mesh_service.submit_image_to_3d(image)
        return {"status": "submitted", "task_id": task_id, "provider": mesh_service.active_provider_name()}
    except ProviderError as exc:
        return _error(exc.code, exc.message, exc.http_status, exc.retryable)
    except Exception as exc:
        print(f"[3D] unexpected submit error: {type(exc).__name__}: {exc}")
        return _error("generation_error", f"Could not start 3D generation: {exc}", 500)


async def _worker_message(task_id: str, message: str, task_error, code_override=None):
    code, friendly, retryable = _worker_failure_message(message)
    if code_override:
        code = code_override
    return _error(code, friendly, 200, retryable, task_id=task_id)


@router.get("/generate-3d/{task_id}")
async def generate_3d_status(task_id: str):
    if not mesh_service.configured():
        return _error("no_provider", "No 3D provider is configured.", 503, False)
    try:
        task = await mesh_service.get_task(task_id)
    except ProviderError as exc:
        return _error(exc.code, exc.message, exc.http_status, exc.retryable, task_id=task_id)
    except Exception as exc:
        print(f"[3D] status check failed: {type(exc).__name__}: {exc}")
        return _error("status_check_failed", f"Could not check 3D progress: {exc}", 502, True, task_id=task_id)

    st = task.get("status")
    progress = task.get("progress", 0)
    stage = task.get("stage") or ""

    if st == "SUCCEEDED":
        urls = task.get("model_urls") or {}
        glb = urls.get("glb")
        printable = urls.get("stl") or urls.get("3mf")
        if not glb:
            return _error("missing_asset", "Generation finished but the worker returned no GLB file.", 502, True, task_id=task_id)
        dest = os.path.join(MODELS_DIR, f"{task_id}.glb")
        local_url = f"/static/models/{task_id}.glb"
        if not os.path.exists(dest):
            try:
                await mesh_service.download_glb(glb, dest)
            except Exception as exc:
                print(f"[3D] could not cache GLB locally: {type(exc).__name__}: {exc}")
                # A worker-hosted URL is only useful if it is reachable from the
                # phone. Return it explicitly with a warning instead of pretending
                # the local copy exists.
                return {
                    "status": "SUCCEEDED",
                    "progress": 100,
                    "stage": "Complete",
                    "model_url": glb,
                    "printable_url": printable,
                    "warning": "The model could not be cached on the backend; using the worker URL.",
                }
        return {
            "status": "SUCCEEDED",
            "progress": 100,
            "stage": "Complete",
            "model_url": local_url,
            "printable_url": printable,
        }

    if st in ("FAILED", "CANCELED"):
        msg = (task.get("task_error") or {}).get("message") or "Generation failed."
        code = "canceled" if st == "CANCELED" else None
        return await _worker_message(task_id, msg, task.get("task_error"), code)

    return {"status": st or "IN_PROGRESS", "progress": progress, "stage": stage}


@router.post("/generate-3d/{task_id}/cancel")
async def generate_3d_cancel(task_id: str):
    try:
        canceled = await mesh_service.cancel(task_id)
    except Exception as exc:
        return _error("cancel_failed", f"Could not cancel generation: {exc}", 502)
    return {"status": "canceled" if canceled else "unsupported", "task_id": task_id}
