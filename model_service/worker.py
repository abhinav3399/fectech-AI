"""In-memory job store + background worker (submit/poll, single process)."""
import threading
import uuid

_JOBS = {}
_lock = threading.Lock()


def create_job() -> str:
    tid = uuid.uuid4().hex[:12]
    with _lock:
        _JOBS[tid] = {"status": "IN_PROGRESS", "progress": 0, "model_urls": {}}
    return tid


def set_progress(tid: str, p: int):
    with _lock:
        if tid in _JOBS and _JOBS[tid]["status"] == "IN_PROGRESS":
            _JOBS[tid]["progress"] = int(p)


def complete(tid: str, glb_url: str, stl_url: str = None):
    with _lock:
        _JOBS[tid] = {"status": "SUCCEEDED", "progress": 100,
                      "model_urls": {"glb": glb_url, "stl": stl_url}}


def fail(tid: str, message: str):
    with _lock:
        _JOBS[tid] = {"status": "FAILED", "progress": 0, "model_urls": {}, "error": message}


def get(tid: str) -> dict:
    with _lock:
        j = _JOBS.get(tid)
        return dict(j) if j else {"status": "FAILED", "progress": 0,
                                  "model_urls": {}, "error": "unknown task"}


def run_async(fn):
    threading.Thread(target=fn, daemon=True).start()
