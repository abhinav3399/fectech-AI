"""Unit tests for the provider contract used by the 3D polling UI."""
from app.services.mesh_service import LocalProvider


def test_local_status_normalizes_worker_states(monkeypatch):
    class Response:
        def raise_for_status(self):
            pass

        def json(self):
            return {
                "status": "completed",
                "progress": 140,
                "model_urls": {"glb": "/files/avatar.glb"},
                "error": None,
            }

    class Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def get(self, url):
            return Response()

    monkeypatch.setattr("app.services.mesh_service.httpx.AsyncClient", lambda **kwargs: Client())
    provider = LocalProvider()
    result = __import__("asyncio").run(provider.status("task"))

    assert result["status"] == "SUCCEEDED"
    assert result["progress"] == 100
    assert result["model_urls"]["glb"] == "/files/avatar.glb"