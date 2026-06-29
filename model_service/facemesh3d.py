"""Real 3D FACE MESH from a single photo — MediaPipe FaceLandmarker (478 3D
landmarks) + Delaunay, fully local on CPU. No GPU, no external platform.

Produces a textured 3D face (GLB, for the avatar) and a thickened, printable
version (STL). This is the FACE (front), not a full 360 head — a full head needs
a GPU AI model — but it has real eye/nose/mouth depth and the person's
proportions, textured with their photo.
"""
import os
import numpy as np
import trimesh
from PIL import Image
from scipy.spatial import Delaunay
from .texture import bright_textured
import mediapipe as mp
from mediapipe.tasks import python as mptask
from mediapipe.tasks.python import vision

_MODEL = os.path.join(os.path.dirname(__file__), "models", "face_landmarker.task")
_LMK = None


def available() -> bool:
    return os.path.exists(_MODEL)


def _landmarker():
    global _LMK
    if _LMK is None:
        opts = vision.FaceLandmarkerOptions(
            base_options=mptask.BaseOptions(model_asset_path=_MODEL), num_faces=1)
        _LMK = vision.FaceLandmarker.create_from_options(opts)
    return _LMK


def _orient_front(verts, faces):
    """Flip any triangle whose normal points away from the +Z camera (so the
    textured face is visible from the front)."""
    v0, v1, v2 = verts[faces[:, 0]], verts[faces[:, 1]], verts[faces[:, 2]]
    nz = np.cross(v1 - v0, v2 - v0)[:, 2]
    f = faces.copy()
    f[nz < 0] = f[nz < 0][:, ::-1]
    return f


def _filter_long(verts, faces, factor=1.9):
    """Drop triangles that bridge concavities (very long edges) so the silhouette
    follows the face instead of the convex hull."""
    p = verts[:, :2]
    longest = np.maximum.reduce([
        np.linalg.norm(p[faces[:, 0]] - p[faces[:, 1]], axis=1),
        np.linalg.norm(p[faces[:, 1]] - p[faces[:, 2]], axis=1),
        np.linalg.norm(p[faces[:, 2]] - p[faces[:, 0]], axis=1),
    ])
    return faces[longest <= factor * np.median(longest)]


def _solidify(verts, faces, back_mm):
    """Thicken the face shell into a watertight, printable solid."""
    n = len(verts)
    back = verts.copy(); back[:, 2] -= back_mm
    allv = np.concatenate([verts, back], 0)
    edges = np.sort(np.concatenate(
        [faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]], 0), axis=1)
    uniq, counts = np.unique(edges, axis=0, return_counts=True)
    bnd = uniq[counts == 1]
    walls = []
    for a, b in bnd:
        walls.append([a, b, b + n]); walls.append([a, b + n, a + n])
    allf = np.concatenate(
        [faces, faces[:, ::-1] + n, np.array(walls) if walls else np.empty((0, 3), int)], 0)
    m = trimesh.Trimesh(vertices=allv, faces=allf, process=True)
    m.remove_unreferenced_vertices(); m.fix_normals()
    return m


# MediaPipe canonical LIP landmark indices (inner ring + outer ring). Because the
# GLB vertices are the 478 landmarks in order (Delaunay over them, process=False),
# a landmark index IS its vertex index in the exported mesh.
_LIP_INNER = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308,
              191, 80, 81, 82, 13, 312, 311, 310, 415]
_LIP_OUTER = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291,
              185, 40, 39, 37, 0, 267, 269, 270, 409]


def _mouth_metadata(verts, faces):
    """Lip-sync metadata: the mouth vertex indices, a per-vertex open weight
    (1 near the lip centre, fading out), an upper/lower flag, the mouth centre
    and the 'open' direction — so the frontend can deform the mouth to the voice."""
    n = len(verts)
    inner = [i for i in _LIP_INNER if i < n]
    lips = set(inner) | {i for i in _LIP_OUTER if i < n}
    if not inner:
        raise ValueError("no lip landmarks in mesh")
    center = verts[inner].mean(axis=0)

    # One-ring neighbours of the lips give a natural falloff into the cheeks/chin.
    nb = set()
    for tri in faces:
        a, b, c = int(tri[0]), int(tri[1]), int(tri[2])
        if a in lips or b in lips or c in lips:
            nb.update((a, b, c))
    region = sorted(lips | nb)

    p = verts[region][:, :2]
    d = np.linalg.norm(p - center[:2], axis=1)
    rmax = float(d.max()) or 1.0
    x = np.clip(d / rmax, 0.0, 1.0)
    # Smooth raised-cosine (Hann) falloff: 1 at the mouth centre, easing to 0 at the
    # region edge with a FLAT derivative, so neighbouring vertices move almost together
    # (a coherent jaw drop) instead of tearing into per-vertex saw-tooth spikes.
    weights = 0.5 * (1.0 + np.cos(np.pi * x))
    lower = verts[region][:, 1] < center[1]                   # below the mouth centre

    return {
        "indices": [int(i) for i in region],
        "weights": [round(float(x), 4) for x in weights],
        "lower": [bool(x) for x in lower],
        "center": [round(float(center[0]), 4), round(float(center[1]), 4), round(float(center[2]), 4)],
        "openAxis": [0.0, -1.0, 0.0],
    }


def _inject_mouth_extras(glb_path, mouth, mesh_name=None):
    """Write the mouth metadata into a GLB mesh's `extras` (three.js exposes glTF
    mesh extras as Mesh.userData). Targets the mesh named `mesh_name` (the face),
    else the first mesh. Pure binary surgery on the JSON chunk; the BIN chunk is
    left untouched. Returns True on success."""
    import json
    import struct
    with open(glb_path, "rb") as f:
        blob = f.read()
    if blob[:4] != b"glTF":
        return False
    off = 12  # 4 magic + 4 version + 4 length
    clen = struct.unpack("<I", blob[off:off + 4])[0]
    if blob[off + 4:off + 8] != b"JSON":
        return False
    json_bytes = blob[off + 8:off + 8 + clen]
    tail = blob[off + 8 + clen:]                              # BIN chunk(s), unchanged
    gltf = json.loads(json_bytes.decode("utf-8"))
    meshes = gltf.get("meshes") or []
    if not meshes:
        return False
    target = 0
    if mesh_name:
        for i, mdef in enumerate(meshes):
            if mdef.get("name") == mesh_name:
                target = i
                break
    extras = meshes[target].get("extras") or {}
    extras["mouth"] = mouth
    meshes[target]["extras"] = extras
    new_json = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    new_json += b" " * ((4 - len(new_json) % 4) % 4)         # pad to 4 bytes
    chunk0 = struct.pack("<I", len(new_json)) + b"JSON" + new_json
    out = blob[:12] + chunk0 + tail
    out = out[:8] + struct.pack("<I", len(out)) + out[12:]   # fix total length
    with open(glb_path, "wb") as f:
        f.write(out)
    return True


def _teeth_texture(size=128):
    """A small, vertically-SYMMETRIC teeth/gum strip (symmetry makes UV flip
    irrelevant): a dark-but-not-black gap line in the middle, enamel-white teeth
    above & below it, soft-pink gums at the edges, faint vertical tooth lines."""
    from PIL import Image
    h = w = size
    arr = np.zeros((h, w, 3), np.uint8)
    t = np.abs((np.arange(h) - (h - 1) / 2.0) / ((h - 1) / 2.0))   # 0 centre -> 1 edges
    for i in range(h):
        ti = t[i]
        if ti < 0.07:
            arr[i, :] = (78, 40, 44)        # mouth-gap shadow (dark maroon, never black)
        elif ti < 0.60:
            arr[i, :] = (240, 235, 226)     # enamel white
        else:
            arr[i, :] = (208, 120, 122)     # pink gum
    band = (t >= 0.07) & (t < 0.60)
    for c in range(0, w, max(1, w // 8)):
        arr[band, c] = (212, 206, 196)      # faint tooth separations
    return Image.fromarray(arr, "RGB")


def _build_inner_mouth(verts, inner_idx):
    """A lit teeth/inner-mouth card seated just behind the lip ring. Hidden when the
    lips are closed, revealed as the mouth opens — so an open mouth shows teeth, not a
    black hole. Static (no rig), which reads fine for the small lip-sync opening."""
    P = verts[inner_idx]
    cx, cy = float(P[:, 0].mean()), float(P[:, 1].mean())
    w = float(P[:, 0].max() - P[:, 0].min())
    hgt = max(float(P[:, 1].max() - P[:, 1].min()), 3.0)
    half_w = max(w * 0.60, 6.0)
    top = cy + hgt * 0.70
    bot = cy - (hgt * 0.70 + 9.0)                       # extend down to back an OPEN mouth
    z_back = float(P[:, 2].min()) - 4.0                 # recessed behind the lips
    nx, ny = 14, 12
    gx, gy = np.meshgrid(np.linspace(cx - half_w, cx + half_w, nx),
                         np.linspace(top, bot, ny))
    r = np.sqrt(((gx - cx) / half_w) ** 2 + ((gy - cy) / hgt) ** 2)
    gz = z_back - np.clip(1.0 - r, 0.0, 1.0) * 2.0      # gentle backward bow at the centre
    V = np.stack([gx.ravel(), gy.ravel(), gz.ravel()], axis=1)
    uv = np.stack([((gx - (cx - half_w)) / (2.0 * half_w)).ravel(),
                   ((top - gy) / (top - bot)).ravel()], axis=1)
    idx = np.arange(nx * ny).reshape(ny, nx)
    a = idx[:-1, :-1].ravel(); b = idx[:-1, 1:].ravel()
    c = idx[1:, 1:].ravel(); d = idx[1:, :-1].ravel()
    F = np.concatenate([np.stack([a, b, c], 1), np.stack([a, c, d], 1)], 0)
    return trimesh.Trimesh(vertices=V, faces=F, visual=bright_textured(uv, _teeth_texture()), process=False)


def _hair_color(arr, P):
    """Median colour of a reliable hair patch just above the hairline (near centre).
    Returns None if there's no room above the face (photo cropped to the face)."""
    h_img, w_img = arr.shape[:2]
    cxn = float(P[:, 0].mean())
    fwn = float(P[:, 0].max() - P[:, 0].min())
    foreheadn = float(P[:, 1].min())                     # top of the face (0 = image top)
    if foreheadn <= 0.04:
        return None
    y0, y1 = int(foreheadn * 0.40 * h_img), max(int(foreheadn * 0.96 * h_img), 1)
    x0, x1 = int((cxn - 0.16 * fwn) * w_img), int((cxn + 0.16 * fwn) * w_img)
    patch = arr[max(0, y0):y1, max(0, x0):max(x0 + 1, x1)].reshape(-1, 3)
    if patch.size < 9:
        return None
    # Bias to the DARKER half of the patch — that's the hair, not skin/background highlights.
    lum = patch.mean(axis=1)
    dark = patch[lum <= np.median(lum)]
    return tuple(int(c) for c in np.median(dark if len(dark) else patch, axis=0))


def _build_hair_cap(verts, P, img):
    """A snug, hair-COLOURED dome over the top and back of the head (colour sampled from
    the hair just above the forehead). A believable approximation — no GPU strand hair —
    baked as its own lit GLB mesh. Returns None if the photo has no hair room."""
    arr = np.asarray(img.convert("RGB"))
    hair_rgb = _hair_color(arr, P)
    if hair_rgb is None:
        return None

    cx = float(verts[:, 0].mean())
    top_y = float(verts[:, 1].max())
    fw = float(verts[:, 0].max() - verts[:, 0].min())
    fz = float(verts[int(np.argmax(verts[:, 1])), 2])    # z at the top-of-forehead vertex
    rx, ry, rz = 0.52 * fw, 0.40 * fw, 0.60 * fw

    nu, nv = 28, 18
    uu, tt = np.meshgrid(np.linspace(0.0, 1.0, nu), np.linspace(-1.0, 1.0, nv))
    ang = uu * np.pi                                     # 0 front hairline -> pi back nape
    width = rx * (0.66 + 0.34 * np.sin(ang))            # narrow at the hairline, full over the crown
    gx = cx + tt * width
    gy = top_y - 0.10 * fw + ry * np.sin(ang)            # starts at the hairline, domes up over the crown
    gz = fz - 0.05 * fw + rz * 0.5 * (np.cos(ang) - 1.0)  # tucks BEHIND the forehead, sweeps up and back
    V = np.stack([gx.ravel(), gy.ravel(), gz.ravel()], axis=1)

    idx = np.arange(nu * nv).reshape(nv, nu)
    a = idx[:-1, :-1].ravel(); b = idx[:-1, 1:].ravel()
    c = idx[1:, 1:].ravel(); d = idx[1:, :-1].ravel()
    F = np.concatenate([np.stack([a, b, c], 1), np.stack([a, c, d], 1)], 0)

    swatch = Image.new("RGB", (8, 8), hair_rgb)          # solid hair colour; lit + emissive (never black)
    uvh = np.stack([(0.5 * (tt + 1)).ravel(), uu.ravel()], axis=1)
    return trimesh.Trimesh(vertices=V, faces=F, visual=bright_textured(uvh, swatch), process=False)


def build_face_mesh(image_path, out_glb, out_stl, size_mm=110.0, z_scale=0.85, base_mm=6.0):
    img = Image.open(image_path).convert("RGB")
    arr = np.ascontiguousarray(np.array(img))
    res = _landmarker().detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=arr))
    if not res.face_landmarks:
        raise ValueError("no face detected by mediapipe")
    L = res.face_landmarks[0]
    P = np.array([[p.x, p.y, p.z] for p in L], dtype=np.float64)  # normalized x,y,z

    cx, cy, cz = P[:, 0].mean(), P[:, 1].mean(), P[:, 2].mean()
    fw = max(P[:, 0].max() - P[:, 0].min(), 1e-6)
    s = size_mm / fw  # z is in the same scale as x (per MediaPipe), so scale alike
    verts = np.stack([(P[:, 0] - cx) * s, -(P[:, 1] - cy) * s, -(P[:, 2] - cz) * s * z_scale], axis=1)
    uv = np.stack([P[:, 0], 1.0 - P[:, 1]], axis=1)  # map the photo onto the face

    # Full Delaunay triangulation of the face landmarks — COMPLETE surface, NO holes.
    # (Previously a long-edge filter dropped interior triangles and tore black gaps.)
    faces = Delaunay(P[:, :2]).simplices

    # Open the inner mouth: drop the triangles that bridge the inner-lip ring, so the
    # mouth is a REAL opening backed by the teeth card — not a stretched dark gash.
    inner = [i for i in _LIP_INNER if i < len(verts)]
    if inner:
        faces = faces[~np.all(np.isin(faces, np.array(inner)), axis=1)]

    # GLB — textured, front-facing 3D face for the avatar.
    glb_mesh = trimesh.Trimesh(vertices=verts, faces=_orient_front(verts, faces),
                               visual=bright_textured(uv, img), process=False)
    try:
        # Gentle Taubin smoothing -> cleaner, less faceted surface (UVs preserved).
        trimesh.smoothing.filter_taubin(glb_mesh, iterations=5)
    except Exception:
        pass

    # Assemble face + lit teeth/inner-mouth card into one GLB scene — the card shows
    # through the opening as the lips part. Falls back to face-only on any error.
    try:
        scene = trimesh.Scene()
        scene.add_geometry(glb_mesh, geom_name="face")
        scene.add_geometry(_build_inner_mouth(glb_mesh.vertices, inner), geom_name="mouth_inner")
        # Hair cap — approximate (no GPU). On by default; set HAIR_CAP=0 to ship a bald, clean head.
        if os.getenv("HAIR_CAP", "1").lower() not in ("0", "false", "no"):
            hair = _build_hair_cap(glb_mesh.vertices, P, img)
            if hair is not None:
                scene.add_geometry(hair, geom_name="hair")
        scene.export(out_glb)
    except Exception as e:
        print(f"facemesh3d: inner-mouth/hair skipped ({e})")
        glb_mesh.export(out_glb)

    # Bake lip-sync mouth metadata into the FACE mesh extras so the avatar can "talk".
    # Failure here must never block generation — the frontend falls back to the nod.
    try:
        _inject_mouth_extras(out_glb, _mouth_metadata(glb_mesh.vertices, faces), mesh_name="face")
    except Exception as e:
        print(f"facemesh3d: mouth metadata skipped ({e})")

    # STL — thickened, printable (face only; the small mouth opening gets walled).
    _solidify(glb_mesh.vertices, faces, base_mm).export(out_stl)
    return out_glb, out_stl
