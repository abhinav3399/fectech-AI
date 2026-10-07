"""Shared embedding helpers.

`hash_embedding` is a DETERMINISTIC dev fallback: the same image bytes always map to
the same unit vector, so enroll -> recognize of the same photo matches end-to-end without
any ML model installed. Real face/object embeddings replace this once the ML extras are present.
"""
import hashlib

import numpy as np


def normalize(v: np.ndarray) -> np.ndarray:
    n = float(np.linalg.norm(v))
    return v / n if n > 0 else v


def hash_embedding(data: bytes, dim: int) -> np.ndarray:
    seed = int.from_bytes(hashlib.sha256(data).digest()[:8], "big")
    rng = np.random.default_rng(seed)
    return normalize(rng.standard_normal(dim).astype("float32"))
