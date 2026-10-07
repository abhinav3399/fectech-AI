"""Environment-driven config for the local image->3D service."""
import os

_PORT = int(os.getenv("MODEL_SERVICE_PORT", "8800"))


class Cfg:
    PORT = _PORT
    # Where generated files are written + served from /files/<name>.
    OUT_DIR = os.getenv("MODEL_SERVICE_OUT", os.path.join(os.path.dirname(__file__), "data"))
    # Absolute base the MAIN backend uses to GET the produced glb/stl.
    PUBLIC_BASE = os.getenv("MODEL_SERVICE_PUBLIC_BASE", f"http://127.0.0.1:{_PORT}")

    # "C" = MediaPipe 3D FACE MESH (default; real face, CPU, no GPU) -> falls back to B.
    # "B" = depth-relief (CPU-capable, no AI mesh model).
    # "A" = AI mesh model (TripoSR/InstantMesh) — needs an NVIDIA GPU (scaffolded).
    PIPELINE = os.getenv("MODEL_3D_PIPELINE", "C").upper()  # C=clean face mesh (default), B=head relief, A=GPU
    DECA_ROOT = os.getenv("DECA_ROOT", os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "vendor", "DECA")))
    DECA_PYTHON = os.getenv("DECA_PYTHON", "")
    DECA_DEVICE = os.getenv("DECA_DEVICE", "cpu")
    DECA_RASTERIZER = os.getenv("DECA_RASTERIZER", "pytorch3d")
    DECA_TIMEOUT = int(os.getenv("DECA_TIMEOUT", "900"))
    FACE_SIZE_MM = float(os.getenv("FACE_SIZE_MM", "110"))   # face mesh width
    FACE_Z_SCALE = float(os.getenv("FACE_Z_SCALE", "0.85"))  # depth exaggeration (1=proportional)

    # If set to a real Blender executable, the relief is built + exported in
    # Blender (higher quality, reliable texture packing). Else a pure-Python
    # (numpy + trimesh) fallback runs so the service works anywhere.
    BLENDER_PATH = os.getenv("BLENDER_PATH", "")

    # Real monocular depth model — OPT-IN only (it downloads ~100MB from HuggingFace
    # the first time). Default path uses the built-in pseudo-depth, so the service
    # works offline with no downloads. Set USE_REAL_DEPTH=1 to enable the real model.
    USE_REAL_DEPTH = os.getenv("USE_REAL_DEPTH", "0") in ("1", "true", "True", "yes")
    DEPTH_MODEL = os.getenv("DEPTH_MODEL", "depth-anything/Depth-Anything-V2-Small-hf")

    # Relief geometry.
    GRID = int(os.getenv("RELIEF_GRID", "180"))          # heightfield resolution
    RELIEF_DEPTH_MM = float(os.getenv("RELIEF_DEPTH_MM", "30"))  # max protrusion (3D pop)
    BASE_MM = float(os.getenv("RELIEF_BASE_MM", "4"))    # backing thickness
    SIZE_MM = float(os.getenv("RELIEF_SIZE_MM", "120"))  # plaque width/height


cfg = Cfg()
