"""Face-shaped silhouette mask (a soft vertical oval) for the cropped face, so the
relief is a face shape rather than a square. Optionally tightened by the depth so
only the protruding face — not flat background inside the oval — is kept.
"""
import numpy as np


def oval_mask(grid: int, rx: float = 0.46, ry: float = 0.495, feather: float = 0.07) -> np.ndarray:
    """1 inside the face oval, 0 outside, soft edge. rx/ry are radii as a fraction
    of width/height (a face is a touch narrower than tall)."""
    h = w = grid
    yy, xx = np.mgrid[0:h, 0:w]
    cx, cy = (w - 1) / 2.0, (h - 1) / 2.0
    d = np.sqrt(((xx - cx) / (rx * w)) ** 2 + ((yy - cy) / (ry * h)) ** 2)
    m = np.clip((1.0 - d) / max(feather, 1e-3), 0.0, 1.0)
    return m.astype(np.float32)


def head_mask(grid: int, depth: np.ndarray = None) -> np.ndarray:
    """Full HEAD silhouette (face + hair + ears): a generous rounded-rectangle
    (superellipse) region, softly tightened by the depth so it follows the near
    head and drops the far background."""
    h = w = grid
    yy, xx = np.mgrid[0:h, 0:w]
    cx, cy = (w - 1) / 2.0, (h - 1) / 2.0
    # Clean OVAL head shape (a touch narrower than tall), covering hair + chin and
    # catching the ears at the widest point.
    nx = (xx - cx) / (0.43 * w); ny = (yy - cy) / (0.49 * h)
    ell = np.sqrt(nx ** 2 + ny ** 2)
    region = np.clip((1.0 - ell) / 0.10, 0.0, 1.0)
    m = region
    if depth is not None:
        from PIL import Image
        d = np.asarray(Image.fromarray((np.clip(depth, 0, 1) * 255).astype("uint8"))
                       .resize((grid, grid))).astype(np.float32) / 255.0
        near = np.clip((d - 0.32) / 0.30, 0.0, 1.0)  # head is near, background far
        m = region * (0.5 + 0.5 * near)              # keep the region, tighten to the head
    return m.astype(np.float32)


def face_mask(grid: int, depth: np.ndarray = None) -> np.ndarray:
    m = oval_mask(grid)
    if depth is not None:
        # Keep only the nearer half inside the oval (drops flat background regions).
        from PIL import Image
        d = np.asarray(Image.fromarray((np.clip(depth, 0, 1) * 255).astype("uint8"))
                       .resize((grid, grid))).astype(np.float32) / 255.0
        near = np.clip((d - 0.25) / 0.5, 0.0, 1.0)  # soft threshold
        m = m * (0.6 + 0.4 * near)  # gentle bias toward the face; keep most of the oval
    return m.astype(np.float32)
