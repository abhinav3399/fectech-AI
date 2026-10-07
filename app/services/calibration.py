"""Feature 1 — calibrated confidence tiers (the 'never confidently wrong' core).

Turns a raw cosine top-1 score into a calibrated probability and a decision tier, using
both the absolute score and the top1-vs-next-identity margin (open-set rejection).

Tiers:
  high    -> assert identity
  medium  -> hedge ("looks like Sara — shall we check?")
  low     -> a weak signal exists but is unreliable; do not name
  unknown -> no usable match; offer to enroll

NOTE: the probability is a lightweight logistic on the score. Replace with a fitted
Platt/temperature scaler once labeled enrollment-vs-impostor pairs are available.
"""
import math
from typing import Optional

from app.config import get_settings

settings = get_settings()


def _logistic(x: float, center: float, k: float = 8.0) -> float:
    return 1.0 / (1.0 + math.exp(-k * (x - center)))


def calibrate(hits) -> dict:
    """hits: list of ScoredPoint sorted desc by score; each payload has 'person_id'."""
    if not hits:
        return {"tier": "unknown", "p": 0.0, "score": 0.0, "margin": 0.0, "candidate": None}

    top = hits[0]
    score = float(top.score)
    top_pid = (top.payload or {}).get("person_id")

    # Margin against the best-scoring DIFFERENT identity (open-set rejection signal).
    other = next(
        (h for h in hits[1:] if (h.payload or {}).get("person_id") != top_pid), None
    )
    margin = score - float(other.score) if other is not None else score

    center = (settings.conf_high + settings.conf_medium) / 2.0
    p = round(_logistic(score, center), 3)

    if score >= settings.conf_high and margin >= settings.margin_min:
        tier = "high"
    elif score >= settings.conf_medium:
        tier = "medium"
    elif score > 0:
        tier = "low"
    else:
        tier = "unknown"

    return {
        "tier": tier,
        "p": p,
        "score": round(score, 4),
        "margin": round(margin, 4),
        "candidate": top.payload,  # caller decides whether to surface the name
    }
