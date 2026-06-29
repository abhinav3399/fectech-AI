"""Image-to-3D generation endpoints (Meshy).

Async pattern so we never hold an HTTP request open for the ~1-3 min generation:
  POST /generate-3d           -> submit the face photo, return a task id
  GET  /generate-3d/{task_id} -> poll; when done, download the GLB locally and
                                 return a same-origin /static/models/<id>.glb url
"""
import os
from fastapi import APIRouter, Body
from app.services.mesh_service import mesh_service

router = APIRouter()

MODELS_DIR = os.path.join("static", "models")
os.makedirs(MODELS_DIR, exist_ok=True)

NOT_CONFIGURED = {
    "status": "error",
    "message": ("3D generation isn't set up yet. Configure a provider in .env "
                "(REPLICATE_API_TOKEN for the no-GPU hosted path, MODEL_3D_URL for your "
                "own GPU service, or MESHY_API_KEY) and restart the backend."),
}


@router.post("/generate-3d")
async def generate_3d(payload: dict = Body(...)):
    if not mesh_service.configured():
        return NOT_CONFIGURED
    image = (payload.get("image") or "").strip()
    if not image:
        return {"status": "error", "message": "No image provided."}
    try:
        task_id = await mesh_service.submit_image_to_3d(image)
        if not task_id:
            return {"status": "error", "message": "Meshy did not return a task id."}
        return {"status": "submitted", "task_id": task_id}
    except Exception as e:
        return {"status": "error", "message": f"Could not start generation: {e}"}


@router.get("/generate-3d/{task_id}")
async def generate_3d_status(task_id: str):
    if not mesh_service.configured():
        return NOT_CONFIGURED
    try:
        task = await mesh_service.get_task(task_id)
    except Exception as e:
        return {"status": "error", "message": f"Status check failed: {e}"}

    st = task.get("status")
    progress = task.get("progress", 0)

    if st == "SUCCEEDED":
        urls = task.get("model_urls") or {}
        glb = urls.get("glb")
        # STL (or 3MF) is the 3D-printable format — hand back Meshy's URL directly so the
        # caregiver can download it for printing (it's a one-off, no need to cache locally).
        printable = urls.get("stl") or urls.get("3mf")
        if not glb:
            return {"status": "error", "message": "Generation finished but no GLB was returned."}
        dest = os.path.join(MODELS_DIR, f"{task_id}.glb")
        if not os.path.exists(dest):
            try:
                await mesh_service.download_glb(glb, dest)
            except Exception:
                # If we can't cache it locally, hand back Meshy's URL directly.
                return {"status": "SUCCEEDED", "progress": 100, "model_url": glb, "printable_url": printable}
        return {"status": "SUCCEEDED", "progress": 100, "model_url": f"/static/models/{task_id}.glb", "printable_url": printable}

    if st in ("FAILED", "CANCELED"):
        msg = (task.get("task_error") or {}).get("message") or "Generation failed."
        return {"status": st, "message": msg}

    return {"status": st or "IN_PROGRESS", "progress": progress}
