"""Optional adapter for the official DECA command-line reconstruction.

DECA is intentionally isolated from the main Python environment. This module
only launches its documented demo, converts the resulting OBJ to GLB, and
validates the browser asset. It does not download or redistribute DECA weights.
"""
import os
import subprocess
from pathlib import Path

import numpy as np
import trimesh

from .config import cfg


def _required_paths():
    root = Path(cfg.DECA_ROOT)
    script = root / "demos" / "demo_reconstruct.py"
    checkpoint = root / "data" / "deca_model.tar"
    flame = root / "data" / "generic_model.pkl"
    missing = [str(path) for path in (script, checkpoint, flame) if not path.exists()]
    if missing:
        raise RuntimeError(
            "DECA is not ready. Missing: " + ", ".join(missing) +
            ". Obtain the official DECA/FLAME assets under their license and configure DECA_ROOT."
        )
    if not cfg.DECA_PYTHON or not Path(cfg.DECA_PYTHON).exists():
        raise RuntimeError(
            "DECA Python runtime was not found. Create an isolated DECA environment "
            "and set DECA_PYTHON to its python executable."
        )
    return root, script


def _find_obj(folder: Path):
    detail = list(folder.rglob("*_detail.obj"))
    coarse = list(folder.rglob("*.obj"))
    if detail:
        return detail[0]
    if coarse:
        return coarse[0]
    raise RuntimeError("DECA completed without producing an OBJ mesh.")


def _validate_scene(scene):
    geometries = list(scene.geometry.values()) if isinstance(scene, trimesh.Scene) else [scene]
    if not geometries:
        raise RuntimeError("DECA produced an empty mesh.")
    vertex_count = face_count = 0
    for mesh in geometries:
        vertices = np.asarray(mesh.vertices)
        faces = np.asarray(mesh.faces)
        if vertices.ndim != 2 or vertices.shape[1] != 3 or not np.isfinite(vertices).all():
            raise RuntimeError("DECA mesh contains invalid vertices.")
        if faces.ndim != 2 or faces.shape[1] != 3 or len(faces) == 0:
            raise RuntimeError("DECA mesh contains no valid triangles.")
        if faces.min() < 0 or faces.max() >= len(vertices):
            raise RuntimeError("DECA mesh contains invalid face indices.")
        vertex_count += len(vertices)
        face_count += len(faces)
    if vertex_count < 1000 or face_count < 500:
        raise RuntimeError("DECA mesh is unexpectedly small and was rejected.")


def run(image_path: str, out_glb: str, out_stl: str, on_progress=None):
    root, script = _required_paths()
    task_dir = Path(out_glb).parent / (Path(out_glb).stem + "_deca")
    task_dir.mkdir(parents=True, exist_ok=True)
    args = [
        cfg.DECA_PYTHON, str(script), "-i", str(Path(image_path).resolve()),
        "-s", str(task_dir.resolve()), "--device", cfg.DECA_DEVICE,
        "--iscrop", "True", "--rasterizer_type", cfg.DECA_RASTERIZER,
        "--render_orig", "False", "--useTex", "False", "--extractTex", "True",
        "--saveObj", "True", "--saveVis", "False",
    ]
    if on_progress:
        on_progress(15)
    try:
        proc = subprocess.run(args, cwd=root, capture_output=True, text=True, timeout=cfg.DECA_TIMEOUT)
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"DECA timed out after {cfg.DECA_TIMEOUT}s.") from exc
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "DECA process failed.")[-2000:]
        raise RuntimeError(f"DECA reconstruction failed: {detail}")
    if on_progress:
        on_progress(75)
    obj = _find_obj(task_dir)
    scene = trimesh.load(str(obj), force="scene", process=False)
    _validate_scene(scene)
    scene.export(out_glb)
    if not os.path.exists(out_glb) or os.path.getsize(out_glb) < 1024:
        raise RuntimeError("GLB conversion failed or produced an empty file.")
    # DECA's OBJ is the browser asset; STL is not a reliable representation of
    # the textured face, so leave the printable output intentionally absent.
    if on_progress:
        on_progress(100)
    return out_glb, None