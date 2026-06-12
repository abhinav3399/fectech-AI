"""Meshy image-to-3D provider.

Turns the persona's face photo into a real 3D mesh. Isolated behind this
service so the provider can be swapped (Meshy -> Tripo -> ...) without touching
the endpoints or the frontend (the "model provider" seam).
"""
import os
import httpx
from app.core.config import settings

MESHY_BASE = "https://api.meshy.ai"


class MeshService:
    @property
    def api_key(self):
        return settings.MESHY_API_KEY or os.getenv("MESHY_API_KEY")

    def configured(self) -> bool:
        return bool(self.api_key)

    async def submit_image_to_3d(self, image_url: str) -> str:
        """Create an image-to-3d task. image_url may be a public URL or a
        'data:image/...;base64,...' data URI. Returns the task id."""
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        payload = {
            "image_url": image_url,
            "ai_model": "latest",
            "should_texture": True,
            "enable_pbr": True,
            "topology": "triangle",
            "target_polycount": 30000,
        }
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(f"{MESHY_BASE}/openapi/v1/image-to-3d", headers=headers, json=payload)
            r.raise_for_status()
            return r.json().get("result")

    async def get_task(self, task_id: str) -> dict:
        headers = {"Authorization": f"Bearer {self.api_key}"}
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(f"{MESHY_BASE}/openapi/v1/image-to-3d/{task_id}", headers=headers)
            r.raise_for_status()
            return r.json()

    async def download_glb(self, url: str, dest_path: str):
        async with httpx.AsyncClient(timeout=180, follow_redirects=True) as client:
            r = await client.get(url)
            r.raise_for_status()
            with open(dest_path, "wb") as f:
                f.write(r.content)


mesh_service = MeshService()
