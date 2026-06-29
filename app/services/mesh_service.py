"""Photo -> 3D mesh, behind a SWAPPABLE provider (the "model provider" seam).

Every consumer (app/api/mesh_endpoint.py) only calls
  configured() / submit_image_to_3d() / get_task() / download_glb()
and get_task() ALWAYS returns the same normalized shape:
  { "status": "SUCCEEDED"|"FAILED"|"CANCELED"|"IN_PROGRESS",
    "progress": 0-100,
    "model_urls": { "glb": <url|None>, "stl": <url|None> },
    "task_error": { "message": <str> } | None }
so the endpoints + the three.js avatar + the STL print button never change when
you swap engines.

Providers (pick with settings.MODEL_3D_PROVIDER; "auto" = first configured):
  - meshy     : Meshy hosted API (subscription).
  - replicate : Replicate hosted, pay-per-use, NO local GPU (default model
                ndreca/hunyuan3d-2). Cheapest way off the Meshy subscription.
  - local     : YOUR OWN self-hosted GPU service at MODEL_3D_URL (TripoSR /
                InstantMesh / HRN wrapped in a small submit/poll FastAPI app).
"""
import os
import httpx
from app.core.config import settings

SUCCEEDED, FAILED, CANCELED, IN_PROGRESS = "SUCCEEDED", "FAILED", "CANCELED", "IN_PROGRESS"


def _err(message):
    return {"message": message} if message else None


class MeshyProvider:
    base = "https://api.meshy.ai"

    @property
    def api_key(self):
        return settings.MESHY_API_KEY or os.getenv("MESHY_API_KEY")

    def configured(self) -> bool:
        return bool(self.api_key)

    async def submit(self, image_url: str) -> str:
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        # Tuned for FACE likeness (verified vs docs.meshy.ai): image_enhancement=False
        # keeps the exact face; hd_texture + should_remesh=False keep detail.
        payload = {
            "image_url": image_url,
            "ai_model": "meshy-6",
            "should_texture": True,
            "enable_pbr": True,
            "hd_texture": True,
            "image_enhancement": False,
            "remove_lighting": True,
            "should_remesh": False,
            "topology": "triangle",
            "target_polycount": 50000,
            "target_formats": ["glb", "stl"],
        }
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(f"{self.base}/openapi/v1/image-to-3d", headers=headers, json=payload)
            r.raise_for_status()
            return r.json().get("result")

    async def status(self, task_id: str) -> dict:
        headers = {"Authorization": f"Bearer {self.api_key}"}
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(f"{self.base}/openapi/v1/image-to-3d/{task_id}", headers=headers)
            r.raise_for_status()
            t = r.json()
        urls = t.get("model_urls") or {}
        return {
            "status": t.get("status") or IN_PROGRESS,  # Meshy already uses SUCCEEDED/FAILED/...
            "progress": t.get("progress", 0),
            "model_urls": {"glb": urls.get("glb"), "stl": urls.get("stl") or urls.get("3mf")},
            "task_error": (t.get("task_error") or None),
        }


class ReplicateProvider:
    """Hosted, pay-per-use, no local GPU. https://replicate.com (REPLICATE_API_TOKEN)."""
    base = "https://api.replicate.com/v1"

    @property
    def api_key(self):
        return settings.REPLICATE_API_TOKEN or os.getenv("REPLICATE_API_TOKEN")

    def configured(self) -> bool:
        return bool(self.api_key)

    def _headers(self):
        return {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}

    async def submit(self, image_url: str) -> str:
        # Model endpoint avoids needing a version hash. The data-URI the app already
        # passes is accepted by Replicate directly (no separate upload).
        model = settings.REPLICATE_3D_MODEL
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(
                f"{self.base}/models/{model}/predictions",
                headers=self._headers(),
                json={"input": {"image": image_url}},
            )
            r.raise_for_status()
            return r.json().get("id")

    @staticmethod
    def _extract_glb(output):
        # Replicate output shape varies per model: a URL string, a list, or a dict.
        # NOTE: verify the exact output field for YOUR chosen model and adjust here.
        if isinstance(output, str):
            return output
        if isinstance(output, list) and output:
            glb = next((o for o in output if isinstance(o, str) and o.lower().endswith(".glb")), None)
            return glb or next((o for o in output if isinstance(o, str)), None)
        if isinstance(output, dict):
            for k in ("glb", "mesh", "model_file", "model", "output", "url"):
                v = output.get(k)
                if isinstance(v, str):
                    return v
        return None

    async def status(self, task_id: str) -> dict:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(f"{self.base}/predictions/{task_id}", headers=self._headers())
            r.raise_for_status()
            t = r.json()
        norm = {"succeeded": SUCCEEDED, "failed": FAILED, "canceled": CANCELED}.get(
            (t.get("status") or "").lower(), IN_PROGRESS)
        glb = self._extract_glb(t.get("output")) if norm == SUCCEEDED else None
        return {
            "status": norm,
            "progress": 100 if norm == SUCCEEDED else 0,
            "model_urls": {"glb": glb, "stl": None},
            "task_error": _err(t.get("error")),
        }


class LocalProvider:
    """YOUR OWN self-hosted GPU service. It must expose:
        POST {MODEL_3D_URL}/submit            body {"image": "<data-uri>"} -> {"task_id": "..."}
        GET  {MODEL_3D_URL}/status/{task_id}  -> { "status": ..., "progress": int,
                                                   "model_urls": {"glb": url, "stl": url} }
    Wrap TripoSR / InstantMesh / HRN in a small FastAPI worker that matches this.
    """
    @property
    def base(self):
        return (settings.MODEL_3D_URL or "").rstrip("/")

    def configured(self) -> bool:
        return bool(self.base)

    async def submit(self, image_url: str) -> str:
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(f"{self.base}/submit", json={"image": image_url})
            r.raise_for_status()
            d = r.json()
            return d.get("task_id") or d.get("id")

    async def status(self, task_id: str) -> dict:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(f"{self.base}/status/{task_id}")
            r.raise_for_status()
            t = r.json()
        raw = str(t.get("status") or "")
        norm = {
            "SUCCEEDED": SUCCEEDED, "succeeded": SUCCEEDED, "success": SUCCEEDED,
            "done": SUCCEEDED, "completed": SUCCEEDED,
            "FAILED": FAILED, "failed": FAILED, "error": FAILED,
            "CANCELED": CANCELED, "canceled": CANCELED, "cancelled": CANCELED,
        }.get(raw, IN_PROGRESS)
        urls = t.get("model_urls") or {}
        return {
            "status": norm,
            "progress": t.get("progress", 0),
            "model_urls": {"glb": urls.get("glb"), "stl": urls.get("stl")},
            "task_error": _err(t.get("error")),
        }


_PROVIDERS = {"meshy": MeshyProvider(), "replicate": ReplicateProvider(), "local": LocalProvider()}
_ORDER = ["meshy", "replicate", "local"]


class MeshService:
    """Dispatcher — picks the active provider, exposes the seam contract."""

    def _provider(self):
        choice = (settings.MODEL_3D_PROVIDER or "auto").lower()
        if choice in _PROVIDERS and choice != "auto":
            return _PROVIDERS[choice]
        for name in _ORDER:  # auto: first configured provider wins
            if _PROVIDERS[name].configured():
                return _PROVIDERS[name]
        return None

    def configured(self) -> bool:
        p = self._provider()
        return bool(p and p.configured())

    async def submit_image_to_3d(self, image_url: str) -> str:
        p = self._provider()
        if not p:
            raise RuntimeError("No 3D provider configured.")
        return await p.submit(image_url)

    async def get_task(self, task_id: str) -> dict:
        p = self._provider()
        if not p:
            return {"status": FAILED, "progress": 0, "model_urls": {},
                    "task_error": _err("No 3D provider configured.")}
        return await p.status(task_id)

    async def download_glb(self, url: str, dest_path: str):
        async with httpx.AsyncClient(timeout=180, follow_redirects=True) as client:
            r = await client.get(url)
            r.raise_for_status()
            with open(dest_path, "wb") as f:
                f.write(r.content)


mesh_service = MeshService()
