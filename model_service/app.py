"""Local image -> 3D worker.

Implements the submit/poll contract the main app's LocalProvider expects
(app/services/mesh_service.py). Run standalone:

    uvicorn model_service.app:app --port 8800

Local-first setup:  MODEL_3D_PROVIDER=local  +  MODEL_3D_URL=http://127.0.0.1:8800
"""
import base64
import binascii
import io
import os
import re
import threading
import traceback

from fastapi import Body, FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse

from .config import cfg
from . import worker
from .pipeline import generate

app = FastAPI(title="Factech AI — local image->3D", version=cfg.VERSION)
os.makedirs(cfg.OUT_DIR, exist_ok=True)

_FACE_MODEL = os.path.join(os.path.dirname(__file__), "models", "face_landmarker.task")
_SLOTS = threading.Semaphore(max(1, cfg.MAX_CONCURRENT_JOBS))
MAX_IMAGE_BYTES = 8 * 1024 * 1024
MIN_DIMENSION = 256
MAX_DIMENSION = 6000
ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}


def _json_error(code: str, message: str, status: int):
    return JSONResponse({"detail": message, "code": code, "message": message}, status_code=status)


@app.middleware("http")
async def require_local_token(request: Request, call_next):
    """Optional shared-secret auth so a LAN-exposed worker is not open to anyone."""
    if cfg.WORKER_TOKEN and request.url.path != "/health":
        if request.headers.get("x-local-token", "") != cfg.WORKER_TOKEN:
            return _json_error("unauthorized", "A valid X-Local-Token header is required.", 401)
    return await call_next(request)


def _decode_and_validate(data_uri: str):
    """Return (raw_bytes, error_response). Validates before a task is accepted."""
    match = re.match(r"data:([^;,]+);base64,(.*)", data_uri or "", re.DOTALL)
    try:
        raw = base64.b64decode(match.group(2) if match else data_uri, validate=True)
    except (binascii.Error, ValueError):
        return None, _json_error("invalid_image", "The photo data is not valid base64.", 400)
    if len(raw) < 100:
        # Small compressed PNGs are valid; this only catches empty/truncated uploads.
        return None, _json_error("invalid_image", "The photo file is empty or truncated.", 400)
    if len(raw) > MAX_IMAGE_BYTES:
        return None, _json_error("image_too_large", "The photo is larger than 8 MB.", 413)
    try:
        from PIL import Image
        with Image.open(io.BytesIO(raw)) as probe:
            fmt = (probe.format or "").upper()
            probe.verify()
        with Image.open(io.BytesIO(raw)) as probe:
            width, height = probe.size
    except Exception:
        return None, _json_error("invalid_image", "The photo is corrupt or not a supported image.", 400)
    if fmt not in ALLOWED_FORMATS:
        return None, _json_error(
            "unsupported_format",
            f"{fmt or 'That file type'} is not supported. Use JPEG, PNG or WebP.",
            415,
        )
    if min(width, height) < MIN_DIMENSION:
        return None, _json_error(
            "image_too_small",
            f"The photo is only {width}×{height}; at least {MIN_DIMENSION}×{MIN_DIMENSION} is required.",
            422,
        )
    if max(width, height) > MAX_DIMENSION:
        return None, _json_error(
            "image_too_large",
            f"The photo is {width}×{height}; keep the long edge under {MAX_DIMENSION}px.",
            413,
        )
    return raw, None


def _pipeline_ready() -> bool:
    if cfg.PIPELINE in ("C", "B"):
        # B works without the landmark model; C needs it.
        return cfg.PIPELINE != "C" or os.path.exists(_FACE_MODEL)
    if cfg.PIPELINE == "DECA":
        return bool(cfg.DECA_PYTHON) and os.path.exists(
            os.path.join(cfg.DECA_ROOT, "data", "deca_model.tar")
        )
    return False


@app.get("/health")
def health():
    return {
        "ok": _pipeline_ready(),
        "version": cfg.VERSION,
        "pipeline": cfg.PIPELINE,
        "model_present": os.path.exists(_FACE_MODEL),
        "model_path": _FACE_MODEL,
        "blender": bool(cfg.BLENDER_PATH),
        "active_jobs": worker.active_count(),
        "max_concurrent": max(1, cfg.MAX_CONCURRENT_JOBS),
        "device": "cpu",
        "auth": bool(cfg.WORKER_TOKEN),
    }


@app.post("/submit")
def submit(payload: dict = Body(...)):
    image = payload.get("image")
    if not image:
        return _json_error("no_image", "No photo was provided.", 400)

    raw, invalid = _decode_and_validate(image)
    if invalid is not None:
        return invalid

    if not _pipeline_ready():
        message = (
            "The MediaPipe face model is missing. Run "
            "`python model_service/download_model.py` to install face_landmarker.task."
            if cfg.PIPELINE == "C"
            else f"Pipeline {cfg.PIPELINE} is not ready on this machine."
        )
        return _json_error("model_missing", message, 503)

    if worker.active_count() >= max(1, cfg.MAX_CONCURRENT_JOBS) + max(0, cfg.MAX_PENDING_JOBS):
        return _json_error("worker_busy", "The 3D worker queue is full. Wait for the current model to finish.", 429)

    tid = worker.create_job()
    src = os.path.join(cfg.OUT_DIR, f"{tid}_in.png")
    try:
        with open(src, "wb") as f:
            f.write(raw)
    except OSError as exc:
        worker.fail(tid, f"Could not store the uploaded photo: {exc}")
        return _json_error("storage_error", "The uploaded photo could not be saved on this machine.", 500)

    def progress(p):
        stage = ("Preparing photo" if p < 20 else
                 "Detecting face and building mesh" if p < 90 else
                 "Exporting GLB and STL")
        worker.set_progress(tid, p, stage)

    def job():
        acquired = _SLOTS.acquire()
        try:
            worker.set_stage(tid, "Starting reconstruction")
            glb, stl = generate(src, cfg.OUT_DIR, tid, on_progress=progress)
            base = cfg.PUBLIC_BASE.rstrip("/")
            stl_url = f"{base}/files/{os.path.basename(stl)}" if stl else None
            worker.complete(tid, f"{base}/files/{os.path.basename(glb)}", stl_url)
        except Exception as exc:
            if isinstance(exc, worker.JobCanceled):
                worker.cancel(tid)
            elif isinstance(exc, MemoryError):
                worker.fail(tid, "The device ran out of memory while building the 3D model.")
            else:
                traceback.print_exc()
                worker.fail(tid, str(exc) or type(exc).__name__)
        finally:
            if acquired:
                _SLOTS.release()

    worker.run_async(job)
    return {"task_id": tid, "status": "submitted"}


@app.get("/status/{task_id}")
def status(task_id: str):
    j = worker.get(task_id)
    out = {
        "status": j.get("status"),
        "stage": j.get("stage", ""),
        "progress": j.get("progress", 0),
        "model_urls": j.get("model_urls", {}),
    }
    if j.get("error"):
        out["task_error"] = {"message": j["error"]}
    return out


@app.post("/cancel/{task_id}")
def cancel(task_id: str):
    j = worker.get(task_id)
    if j.get("status") in ("SUCCEEDED", "FAILED", "CANCELED"):
        return {"status": j.get("status"), "canceled": False}
    worker.cancel(task_id)
    return {"status": "CANCELED", "canceled": True}


@app.get("/files/{name}")
def files(name: str):
    p = os.path.join(cfg.OUT_DIR, os.path.basename(name))
    if not os.path.exists(p):
        return JSONResponse({"error": "not found"}, status_code=404)
    return FileResponse(p)
