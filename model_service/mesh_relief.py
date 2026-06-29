"""Build a FACE-SHAPED 3D relief (a bust) from a cropped face photo + depth + an
oval face mask — pure Python (numpy + trimesh), no Blender, no GPU.

The mask shapes the silhouette so the result is a face, not a square slab: only
the masked face region is meshed, the depth gives the surface contour, and the
front is thickened (flat back + side walls) into a watertight, printable bust.

Outputs: GLB (textured face for three.js) + STL (watertight, printable).
"""
import numpy as np
import trimesh
from PIL import Image
from .texture import bright_textured


def _resize(arr_or_img, grid):
    im = arr_or_img if isinstance(arr_or_img, Image.Image) else Image.fromarray(arr_or_img)
    return np.asarray(im.resize((grid, grid), Image.BILINEAR))


def build_relief(pil_img, depth, mask, out_glb, out_stl,
                 depth_mm=26.0, grid=180, base_mm=5.0, size_mm=110.0):
    img = pil_img.convert("RGB").resize((grid, grid), Image.LANCZOS)
    d = _resize((np.clip(depth, 0, 1) * 255).astype("uint8"), grid).astype(np.float32) / 255.0
    m = _resize((np.clip(mask, 0, 1) * 255).astype("uint8"), grid).astype(np.float32) / 255.0
    try:
        from scipy.ndimage import gaussian_filter
        d = gaussian_filter(d, sigma=1.3)  # smoother surface (less lumpy)
    except Exception:
        pass
    h = w = grid

    xs = np.linspace(-size_mm / 2, size_mm / 2, w)
    ys = np.linspace(size_mm / 2, -size_mm / 2, h)
    gx, gy = np.meshgrid(xs, ys)
    z = d * depth_mm * m  # tapers to 0 at the oval edge so it meets the base smoothly
    front = np.stack([gx, gy, z], axis=-1).reshape(-1, 3)
    back = front.copy(); back[:, 2] = -base_mm
    verts = np.concatenate([front, back], 0)
    off = h * w

    uu, vv = np.meshgrid(np.linspace(0, 1, w), np.linspace(1, 0, h))
    uv = np.concatenate([np.stack([uu, vv], -1).reshape(-1, 2)] * 2, 0)

    idx = np.arange(h * w).reshape(h, w)
    keep_v = m >= 0.5
    c00 = keep_v[:-1, :-1]; c01 = keep_v[:-1, 1:]; c10 = keep_v[1:, :-1]; c11 = keep_v[1:, 1:]
    keptq = c00 & c01 & c10 & c11                      # quads fully inside the face
    qi, qj = np.where(keptq)
    a = idx[qi, qj]; b = idx[qi, qj + 1]; c = idx[qi + 1, qj + 1]; e = idx[qi + 1, qj]
    front_f = np.concatenate([np.stack([a, b, c], 1), np.stack([a, c, e], 1)], 0)
    back_f = np.concatenate([np.stack([a, c, b], 1), np.stack([a, e, c], 1)], 0) + off

    # Side walls on the silhouette: quad edges whose neighbour quad is outside.
    pad = np.pad(keptq, 1, constant_values=False)
    walls = []

    def wall(boundary, ca, cb):
        bi, bj = np.where(boundary)
        if bi.size == 0:
            return
        pa = idx[bi + ca[0], bj + ca[1]]
        pb = idx[bi + cb[0], bj + cb[1]]
        walls.append(np.stack([pa, pb, pb + off], 1))
        walls.append(np.stack([pa, pb + off, pa + off], 1))

    wall(keptq & ~pad[0:-2, 1:-1], (0, 0), (0, 1))   # top
    wall(keptq & ~pad[2:, 1:-1], (1, 1), (1, 0))     # bottom
    wall(keptq & ~pad[1:-1, 0:-2], (1, 0), (0, 0))   # left
    wall(keptq & ~pad[1:-1, 2:], (0, 1), (1, 1))     # right

    faces = np.concatenate([front_f, back_f] + walls, 0)

    # GLB — textured face for the avatar. (Unreferenced background verts stay but
    # carry no faces, so the rendered silhouette is the face oval.)
    mesh = trimesh.Trimesh(vertices=verts, faces=faces, visual=bright_textured(uv, img), process=False)
    mesh.fix_normals()
    mesh.export(out_glb)

    # STL — watertight bust for printing.
    geo = trimesh.Trimesh(vertices=verts.copy(), faces=faces.copy(), process=True)
    geo.remove_unreferenced_vertices()
    geo.fix_normals()
    geo.export(out_stl)
    return out_glb, out_stl
