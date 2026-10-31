"""Durable job store + background worker (single local process).

Jobs are mirrored to ``OUT_DIR/jobs/<id>.json`` so restarting the worker (or the
dev server auto-reload) does not turn an in-flight task into a bare "unknown
task" the user cannot interpret.
"""
import json
import os
import threading
import time
import uuid

from .config import cfg

_JOBS = {}
_lock = threading.Lock()


class JobCanceled(Exception):
    """Raised inside a job when the caller requests cancellation."""


def _jobs_dir() -> str:
    path = os.path.join(cfg.OUT_DIR, "jobs")
    os.makedirs(path, exist_ok=True)
    return path


def _path(tid: str) -> str:
    return os.path.join(_jobs_dir(), f"{os.path.basename(tid)}.json")


def _persist(job: dict):
    try:
        tmp = _path(job["id"]) + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(job, f, ensure_ascii=False)
        os.replace(tmp, _path(job["id"]))
    except Exception:
        # Persistence is best-effort; an unwritable data dir must not fail a job.
        pass


def _load(tid: str):
    try:
        with open(_path(tid), "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _update(tid: str, **changes):
    with _lock:
        job = _JOBS.get(tid)
        if not job:
            return None
        job.update(changes)
        job["updated_at"] = time.time()
        snapshot = dict(job)
    _persist(snapshot)
    return snapshot


def create_job() -> str:
    tid = uuid.uuid4().hex[:12]
    job = {
        "id": tid,
        "status": "QUEUED",
        "stage": "Waiting for the model worker",
        "progress": 0,
        "model_urls": {},
        "created_at": time.time(),
        "updated_at": time.time(),
    }
    with _lock:
        _JOBS[tid] = job
    _persist(job)
    return tid


def set_stage(tid: str, stage: str):
    _update(tid, stage=stage)


def set_progress(tid: str, p: int, stage: str = None):
    if is_canceled(tid):
        raise JobCanceled()
    changes = {"status": "IN_PROGRESS", "progress": int(p)}
    if stage:
        changes["stage"] = stage
    _update(tid, **changes)


def complete(tid: str, glb_url: str, stl_url: str = None):
    _update(tid, status="SUCCEEDED", stage="Complete", progress=100,
            model_urls={"glb": glb_url, "stl": stl_url}, error=None)


def fail(tid: str, message: str):
    _update(tid, status="FAILED", stage="Failed", progress=0,
            model_urls={}, error=str(message))


def cancel(tid: str):
    _update(tid, status="CANCELED", stage="Canceled", error="Generation was canceled.")


def is_canceled(tid: str) -> bool:
    with _lock:
        job = _JOBS.get(tid)
        return bool(job and job.get("status") == "CANCELED")


def get(tid: str) -> dict:
    with _lock:
        job = _JOBS.get(tid)
        if job:
            return dict(job)
    persisted = _load(tid)
    if persisted:
        # A task persisted as in-flight but no longer in memory was interrupted by
        # a worker restart; report that honestly rather than "unknown task".
        if persisted.get("status") in ("IN_PROGRESS", "QUEUED"):
            persisted["status"] = "FAILED"
            persisted["stage"] = "Interrupted"
            persisted["error"] = (
                "The 3D worker restarted before this model finished. Please generate again."
            )
        return persisted
    return {"id": tid, "status": "FAILED", "stage": "Unknown", "progress": 0,
            "model_urls": {}, "error": "unknown task"}


def active_count() -> int:
    with _lock:
        return sum(1 for j in _JOBS.values() if j.get("status") in ("IN_PROGRESS", "QUEUED"))


def run_async(fn):
    threading.Thread(target=fn, daemon=True).start()
