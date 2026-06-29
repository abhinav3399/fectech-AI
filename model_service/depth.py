"""Monocular depth from a single image.

Uses Depth Anything V2 (via transformers) when torch + transformers are
installed; otherwise falls back to a luminance + center-bias pseudo-depth so the
relief pipeline still runs with ZERO ML dependencies (lower fidelity).
Returns a HxW float32 array in [0,1], where 1 = nearest (protrudes most).
"""
import numpy as np
from PIL import Image
from .config import cfg

_PIPE = None


def estimate_depth(pil_img: Image.Image) -> np.ndarray:
    # Default: fast, offline pseudo-depth. The real model only runs when explicitly
    # enabled (USE_REAL_DEPTH=1), so we never trigger a surprise model download.
    if not cfg.USE_REAL_DEPTH:
        return _pseudo_depth(pil_img)
    try:
        return _model_depth(pil_img)
    except Exception as e:
        print(f"[depth] real depth model failed ({e}); using pseudo-depth fallback.")
        return _pseudo_depth(pil_img)


def _get_pipe():
    global _PIPE
    if _PIPE is None:
        from transformers import pipeline  # heavy: torch required
        _PIPE = pipeline("depth-estimation", model=cfg.DEPTH_MODEL)
    return _PIPE


def _model_depth(pil_img: Image.Image) -> np.ndarray:
    out = _get_pipe()(pil_img)
    d = np.asarray(out["depth"], dtype=np.float32)
    d = (d - d.min()) / (d.max() - d.min() + 1e-6)  # near = 1
    return d


def _pseudo_depth(pil_img: Image.Image) -> np.ndarray:
    """Crude but real: brightness + a radial centre bias so the face protrudes."""
    g = np.asarray(pil_img.convert("L"), dtype=np.float32) / 255.0
    h, w = g.shape
    yy, xx = np.mgrid[0:h, 0:w]
    cx, cy = (w - 1) / 2.0, (h - 1) / 2.0
    r = np.sqrt(((xx - cx) / (w / 2)) ** 2 + ((yy - cy) / (h / 2)) ** 2)
    centre = np.clip(1.0 - r, 0.0, 1.0)
    d = 0.6 * centre + 0.4 * g
    # light smoothing (box blur) without scipy
    k = 3
    pad = np.pad(d, k, mode="edge")
    acc = np.zeros_like(d)
    for dy in range(-k, k + 1):
        for dx in range(-k, k + 1):
            acc += pad[k + dy: k + dy + h, k + dx: k + dx + w]
    d = acc / ((2 * k + 1) ** 2)
    d = (d - d.min()) / (d.max() - d.min() + 1e-6)
    return d.astype(np.float32)
