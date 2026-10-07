"""FastAPI service exposing the submit/poll contract the main app's LocalProvider
expects (app/services/mesh_service.py). Run standalone:

    uvicorn model_service.app:app --port 8800

Then in the main app's .env:  MODEL_3D_PROVIDER=local  +  MODEL_3D_URL=http://127.0.0.1:8800
"""
import base64
import os
import re

from fastapi import Body, FastAPI
from fastapi.responses import FileResponse, JSONResponse

from .config import cfg
from . import worker
from .pipeline import generate

app = FastAPI(title="Factech AI — local image->3D")
os.makedirs(cfg.OUT_DIR, exist_ok=True)


def _decode_image(data_uri: str, dest: str):
    m = re.match(r"data:([^;]+);base64,(.*)", data_uri or "", re.DOTALL)
    raw = base64.b64decode(m.group(2)) if m else base64.b64decode(data_uri)  # tolerate raw base64
    with open(dest, "wb") as f:
        f.write(raw)


@app.get("/health")
def health():
    return {"ok": True, "pipeline": cfg.PIPELINE, "blender": bool(cfg.BLENDER_PATH)}


@app.post("/submit")
def submit(payload: dict = Body(...)):
    image = payload.get("image")
    if not image:
        return JSONResponse({"error": "no image provided"}, status_code=400)
    tid = worker.create_job()
    src = os.path.join(cfg.OUT_DIR, f"{tid}_in.png")
    try:
        _decode_image(image, src)
    except Exception as e:
        worker.fail(tid, f"bad image: {e}")
        return {"task_id": tid}

    def job():
        try:
            glb, stl = generate(src, cfg.OUT_DIR, tid,
                                on_progress=lambda p: worker.set_progress(tid, p))
            base = cfg.PUBLIC_BASE.rstrip("/")
            stl_url = f"{base}/files/{os.path.basename(stl)}" if stl else None
            worker.complete(tid, f"{base}/files/{os.path.basename(glb)}", stl_url)
        except Exception as e:
            import traceback
            traceback.print_exc()
            worker.fail(tid, str(e))

    worker.run_async(job)
    return {"task_id": tid}


@app.get("/status/{task_id}")
def status(task_id: str):
    j = worker.get(task_id)
    out = {"status": j.get("status"), "progress": j.get("progress", 0),
           "model_urls": j.get("model_urls", {})}
    if j.get("error"):
        out["task_error"] = {"message": j["error"]}
    return out


@app.get("/files/{name}")
def files(name: str):
    p = os.path.join(cfg.OUT_DIR, os.path.basename(name))
    if not os.path.exists(p):
        return JSONResponse({"error": "not found"}, status_code=404)
    return FileResponse(p)
