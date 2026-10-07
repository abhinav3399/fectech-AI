"""Feature 1 smoke test — the Calibrated Trust Core chokepoint (/agent/answer).

Verifies: a known face -> tier 'high' and is named; an unknown face -> not 'high'
and is NOT named (the core invariant); text-only -> unknown; review queue reachable.
"""
import io
import sys
import time

import httpx
import numpy as np
from PIL import Image

BASE = "http://localhost:8000"


def make_image(_label=""):
    """Random textured frame, unique per call (passes the 'has visual content' gate)."""
    arr = (np.random.default_rng().random((128, 128, 3)) * 255).astype("uint8")
    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, format="PNG")
    return buf.getvalue()


def wait_for_health(timeout=20.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            if httpx.get(f"{BASE}/health", timeout=2.0).status_code == 200:
                return
        except Exception:
            pass
        time.sleep(0.5)
    raise SystemExit("server not healthy")


def main():
    wait_for_health()
    sara = make_image("sara")
    stranger = make_image("stranger")

    with httpx.Client(base_url=BASE, timeout=10.0) as c:
        c.post(
            "/api/people",
            files={"image": ("sara.png", sara, "image/png")},
            data={"name": "Sara", "relationship": "daughter", "notes": ""},
        ).raise_for_status()

        # Known face via the gated chokepoint
        r = c.post(
            "/agent/answer",
            data={"message": "Who is this?"},
            files={"image": ("sara.png", sara, "image/png")},
        ).json()
        print("AGENT (known):", r)
        assert r["tier"] == "high", f"expected high, got {r['tier']}"
        assert r["candidate"] == "Sara"
        assert "Sara" in r["reply"]

        # Unknown face -> never named, never 'high'
        r = c.post(
            "/agent/answer",
            data={"message": "Who is this?"},
            files={"image": ("x.png", stranger, "image/png")},
        ).json()
        print("AGENT (unknown):", r)
        assert r["tier"] != "high", "stranger must not be high-confidence"
        assert r["candidate"] is None
        assert "Sara" not in r["reply"], "must not name an unknown face"

        # Text only -> unknown, generic reassurance
        r = c.post("/agent/answer", data={"message": "I feel lost"}).json()
        print("AGENT (text):", r)
        assert r["tier"] == "unknown"

        # Greeting -> conversational, NOT framed as recognition (no badge in UI)
        r = c.post("/agent/answer", data={"message": "hi"}).json()
        print("AGENT (greeting):", r)
        assert r["identify"] is False, "a greeting must not be framed as recognition"
        assert "recognize" not in r["reply"].lower()

        # Black/empty frame -> no phantom face, stays conversational
        black = io.BytesIO()
        Image.new("RGB", (128, 128), (0, 0, 0)).save(black, format="PNG")
        r = c.post(
            "/agent/answer",
            data={"message": "hi"},
            files={"image": ("black.png", black.getvalue(), "image/png")},
        ).json()
        print("AGENT (black frame):", r)
        assert r["identify"] is False, "an empty frame must not trigger recognition"
        assert r["candidate"] is None

        # Calibrated recognize endpoint exposes the tier
        r = c.post(
            "/api/recognize/face", files={"image": ("sara.png", sara, "image/png")}
        ).json()
        print("RECOGNIZE (calibrated):", r)
        assert r["recognized"] is True and r["tier"] == "high"

        # Review queue endpoint reachable
        q = c.get("/caregiver/review-queue").json()
        print("REVIEW QUEUE:", q)
        assert isinstance(q, list)

    print("\nFEATURE 1 CHECKS PASSED")


if __name__ == "__main__":
    sys.exit(main())
