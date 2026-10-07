"""Isolate the FACE from the photo: detect the face (OpenCV), crop tightly to it
(+ a margin for forehead/chin/hair), drop the rest of the scene. The result is a
square face crop; the oval face mask (facemask.py) then shapes the silhouette so
the 3D model is a face, not a square slab of the whole picture.
"""
import cv2
import numpy as np
from PIL import Image
from .config import cfg

_cascade = None


def _detector():
    global _cascade
    if _cascade is None:
        import os
        path = os.path.join(cv2.data.haarcascades, "haarcascade_frontalface_default.xml")
        _cascade = cv2.CascadeClassifier(path)
    return _cascade


def _largest_face(rgb: np.ndarray):
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    faces = _detector().detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(60, 60))
    if len(faces) == 0:
        return None
    return max(faces, key=lambda f: f[2] * f[3])  # (x, y, w, h)


def prepare_face(path: str) -> Image.Image:
    img = Image.open(path).convert("RGB")
    rgb = np.array(img)
    box = _largest_face(rgb)
    if box is not None:
        x, y, w, h = [int(v) for v in box]
        # Expand generously to include HAIR (above), EARS (sides) and neck (below).
        ex, top, bottom = int(w * 0.85), int(h * 1.2), int(h * 0.8)
        x0 = max(0, x - ex); x1 = min(img.width, x + w + ex)
        y0 = max(0, y - top); y1 = min(img.height, y + h + bottom)
        # Square it up around the face so the crop isn't stretched.
        bw, bh = x1 - x0, y1 - y0
        side = max(bw, bh)
        cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
        x0 = max(0, cx - side // 2); y0 = max(0, cy - side // 2)
        x1 = min(img.width, x0 + side); y1 = min(img.height, y0 + side)
        img = img.crop((x0, y0, x1, y1))
    else:
        # No face found — fall back to a centered square crop.
        s = min(img.size)
        l = (img.width - s) // 2; t = (img.height - s) // 2
        img = img.crop((l, t, l + s, t + s))
    return img.resize((cfg.GRID, cfg.GRID), Image.LANCZOS)
