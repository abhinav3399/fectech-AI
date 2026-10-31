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


class ProviderError(RuntimeError):
    """A failure with a machine-readable code the UI can map to useful copy."""

    def __init__(self, code, message, *, http_status=502, retryable=True):
        super().__init__(message)
        self.code = code
        self.message = message
        self.http_status = http_status
        self.retryable = retryable


def _err(message):
    return {"message": message} if message else None


def _local_headers():
    token = (getattr(settings, "LOCAL_WORKER_TOKEN", None) or "").strip()
    return {"X-Local-Token": token} if token else {}


def _explain_transport_error(exc, base: str) -> ProviderError:
    """Turn httpx transport errors into actionable, non-generic messages."""
    if isinstance(exc, httpx.ConnectError):
        return ProviderError(
            "worker_unreachable",
            f"The local 3D worker is not reachable at {base}. Start it with "
            "`python -m uvicorn model_service.app:app --port 8800` (or run start_local.bat).",
            http_status=503,
        )
    if isinstance(exc, httpx.ConnectTimeout):
        return ProviderError(
            "worker_timeout",
            f"Timed out connecting to the local 3D worker at {base}. It may still be starting.",
            http_status=504,
        )
    if isinstance(exc, httpx.ReadTimeout):
        return ProviderError(
            "worker_timeout",
            "The local 3D worker took too long to respond. Try a smaller photo or retry.",
            http_status=504,
        )
    if isinstance(exc, httpx.HTTPStatusError):
        status = exc.response.status_code
        detail = ""
        try:
            detail = exc.response.json().get("detail") or exc.response.json().get("error") or ""
        except Exception:
            detail = (exc.response.text or "")[:200]
        if status == 401:
            return ProviderError("worker_auth_failed", "The local worker rejected the shared token. Check LOCAL_WORKER_TOKEN.", http_status=502, retryable=False)
        if status == 429:
            return ProviderError("worker_busy", "The local 3D worker is busy with another model. Wait for it to finish or cancel it.", http_status=409)
        return ProviderError(
            "worker_error",
            f"The local 3D worker returned HTTP {status}" + (f": {detail}" if detail else "."),
            http_status=502,
        )
    return ProviderError("worker_error", f"3D worker request failed: {type(exc).__name__}: {exc}", http_status=502)


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

    async def health(self) -> dict:
        """Cheap readiness probe used before enabling the Generate button."""
        if not self.base:
            return {"configured": False, "reachable": False, "message": "MODEL_3D_URL is not set."}
        try:
            async with httpx.AsyncClient(timeout=3) as client:
                r = await client.get(f"{self.base}/health", headers=_local_headers())
                r.raise_for_status()
                data = r.json() or {}
            return {
                "configured": True,
                "reachable": bool(data.get("ok")),
                "pipeline": data.get("pipeline"),
                "model_present": data.get("model_present"),
                "active_jobs": data.get("active_jobs", 0),
                "message": "Local worker ready." if data.get("ok") else "Local worker is running but not ready.",
            }
        except Exception as exc:
            err = _explain_transport_error(exc, self.base)
            return {"configured": True, "reachable": False, "message": err.message, "code": err.code}

    async def submit(self, image_url: str) -> str:
        timeout = float(getattr(settings, "MODEL_3D_TIMEOUT", 45) or 45)
        try:
            async with httpx.AsyncClient(timeout=max(10, timeout)) as client:
                r = await client.post(f"{self.base}/submit", json={"image": image_url}, headers=_local_headers())
                r.raise_for_status()
                d = r.json() or {}
        except Exception as exc:
            raise _explain_transport_error(exc, self.base) from exc
        task_id = d.get("task_id") or d.get("id")
        if not task_id:
            raise ProviderError("worker_bad_response", "The local 3D worker accepted the image but returned no task id.")
        return task_id

    async def cancel(self, task_id: str) -> bool:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.post(f"{self.base}/cancel/{task_id}", headers=_local_headers())
                return r.status_code < 400
        except Exception:
            return False

    async def status(self, task_id: str) -> dict:
        timeout = float(getattr(settings, "MODEL_3D_TIMEOUT", 45) or 45)
        try:
            async with httpx.AsyncClient(timeout=min(30, max(5, timeout))) as client:
                r = await client.get(f"{self.base}/status/{task_id}", headers=_local_headers())
                r.raise_for_status()
                t = r.json()
        except Exception as exc:
            raise _explain_transport_error(exc, self.base) from exc
        raw = str(t.get("status") or "").strip().upper()
        norm = {
            "SUCCEEDED": SUCCEEDED, "SUCCESS": SUCCEEDED, "DONE": SUCCEEDED,
            "COMPLETED": SUCCEEDED,
            "FAILED": FAILED, "ERROR": FAILED,
            "CANCELED": CANCELED, "CANCELLED": CANCELED,
        }.get(raw, IN_PROGRESS)
        urls = t.get("model_urls") or {}
        error = t.get("task_error") or t.get("error")
        if isinstance(error, str):
            error = _err(error)
        return {
            "status": norm,
            "progress": max(0, min(100, int(t.get("progress", 0) or 0))),
            "stage": t.get("stage") or "",
            "model_urls": {"glb": urls.get("glb"), "stl": urls.get("stl")},
            "task_error": error,
        }


_PROVIDERS = {"meshy": MeshyProvider(), "replicate": ReplicateProvider(), "local": LocalProvider()}
# Local-first: prefer the bundled worker; hosted providers only when selected.
_ORDER = ["local", "replicate", "meshy"]


class MeshService:
    """Dispatcher — picks the active provider, exposes the seam contract."""

    def active_provider_name(self) -> str:
        choice = (settings.MODEL_3D_PROVIDER or "auto").lower()
        if choice in _PROVIDERS and choice != "auto":
            return choice
        for name in _ORDER:
            if _PROVIDERS[name].configured():
                return name
        return "none"

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
            raise ProviderError(
                "no_provider",
                "No 3D provider is configured. Set MODEL_3D_PROVIDER=local (and start the bundled worker), "
                "or configure a hosted provider.",
                http_status=503,
                retryable=False,
            )
        return await p.submit(image_url)

    async def diagnostics(self) -> dict:
        """Readiness for the UI: which provider, whether it can actually run."""
        p = self._provider()
        name = self.active_provider_name()
        if not p:
            return {"provider": "none", "configured": False, "ready": False,
                    "message": "No 3D provider configured."}
        if hasattr(p, "health"):
            health = await p.health()
            return {"provider": name, "configured": True, **health,
                    "ready": bool(health.get("reachable")) and health.get("model_present") is not False}
        return {"provider": name, "configured": True, "ready": True,
                "message": "Hosted provider configured."}

    async def cancel(self, task_id: str) -> bool:
        p = self._provider()
        if not p or not hasattr(p, "cancel"):
            return False
        return await p.cancel(task_id)

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
            if not r.content or len(r.content) < 1000:
                raise ProviderError("invalid_asset", "The worker returned an empty or truncated 3D file.")
            with open(dest_path, "wb") as f:
                f.write(r.content)
            return len(r.content)


mesh_service = MeshService()
