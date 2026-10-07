"""End-to-end smoke test for the FacTech AI base build.

Runs against a live server on :8000. Exercises health, enroll, recognize (match +
no-match), and the memory-agent chat path — verifying the 'never confidently wrong'
invariant (an unknown face is not named).
"""
import io
import sys
import time

import httpx
import numpy as np
from PIL import Image

BASE = "http://localhost:8000"


def make_image(_label: str = "") -> bytes:
    """Random textured frame, unique per call (passes the 'has visual content' gate).
    Reuse the returned bytes for both enroll and recognize to get a self-match."""
    arr = (np.random.default_rng().random((128, 128, 3)) * 255).astype("uint8")
    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, format="PNG")
    return buf.getvalue()


def wait_for_health(timeout: float = 20.0) -> dict:
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        try:
            r = httpx.get(f"{BASE}/health", timeout=2.0)
            if r.status_code == 200:
                return r.json()
        except Exception as e:  # noqa: BLE001
            last = e
        time.sleep(0.5)
    raise SystemExit(f"Server did not become healthy in {timeout}s (last error: {last})")


def main() -> None:
    health = wait_for_health()
    print("HEALTH:", health)

    sara = make_image("sara")
    stranger = make_image("stranger")

    with httpx.Client(base_url=BASE, timeout=10.0) as c:
        # Enroll
        r = c.post(
            "/api/people",
            files={"image": ("sara.png", sara, "image/png")},
            data={"name": "Sara", "relationship": "daughter", "notes": "visits Sundays"},
        )
        r.raise_for_status()
        print("ENROLL:", r.json())

        # Recognize the same photo -> should match
        r = c.post("/api/recognize/face", files={"image": ("sara.png", sara, "image/png")})
        match = r.json()
        print("RECOGNIZE (same):", match)
        assert match["recognized"] is True, "same photo should be recognized"
        assert match["person"]["name"] == "Sara"

        # Recognize a different photo -> should NOT match (invariant)
        r = c.post("/api/recognize/face", files={"image": ("x.png", stranger, "image/png")})
        nomatch = r.json()
        print("RECOGNIZE (stranger):", nomatch)
        assert nomatch["recognized"] is False, "stranger must not be recognized"

        # Chat WITH the known face -> reply names Sara
        import base64

        r = c.post(
            "/api/chat",
            json={"message": "Who is this?", "image": base64.b64encode(sara).decode()},
        )
        chat_known = r.json()
        print("CHAT (known):", chat_known)
        assert "Sara" in chat_known["reply"], "known face should be named"

        # Chat WITH an unknown face -> must NOT invent a name
        r = c.post(
            "/api/chat",
            json={"message": "Who is this?", "image": base64.b64encode(stranger).decode()},
        )
        chat_unknown = r.json()
        print("CHAT (unknown):", chat_unknown)
        assert "Sara" not in chat_unknown["reply"], "must not name an unknown face"

    print("\nALL SMOKE CHECKS PASSED")


if __name__ == "__main__":
    sys.exit(main())
