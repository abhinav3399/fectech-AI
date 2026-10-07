"""Orchestrates one image -> 3D job. Returns (glb_path, stl_path)."""
import os
import numpy as np
from PIL import Image
from .config import cfg
from .preprocess import prepare_face
from .depth import estimate_depth
from .facemask import head_mask
from . import mesh_relief


def generate(image_path: str, out_dir: str, task_id: str, on_progress=None):
    def prog(p):
        if on_progress:
            on_progress(p)

    prog(5)
    glb = os.path.join(out_dir, f"{task_id}.glb")
    stl = os.path.join(out_dir, f"{task_id}.stl")

    # --- Pipeline A: AI mesh model (TripoSR / InstantMesh) — GPU required. ---
    if cfg.PIPELINE == "A":
        from . import meshgen  # raises NotImplementedError until you wire a model
        return meshgen.run(image_path, glb, stl, on_progress=prog)

    # --- Optional DECA: official FLAME-based reconstruction in an isolated env. ---
    if cfg.PIPELINE == "DECA":
        from . import deca_runner
        return deca_runner.run(image_path, glb, stl, on_progress=prog)

    # --- Pipeline C (default): real 3D FACE MESH (MediaPipe, CPU). ---
    if cfg.PIPELINE == "C":
        try:
            from . import facemesh3d
            if facemesh3d.available():
                prog(20)
                facemesh3d.build_face_mesh(image_path, glb, stl,
                                           size_mm=cfg.FACE_SIZE_MM, z_scale=cfg.FACE_Z_SCALE,
                                           base_mm=cfg.BASE_MM)
                prog(100)
                return glb, stl
            print("[pipeline] face_landmarker.task missing; falling back to relief.")
        except Exception as e:
            print(f"[pipeline] face-mesh failed ({e}); falling back to depth-relief.")

    # --- Pipeline B (default): face-isolated depth-relief. ---
    img = prepare_face(image_path)   # detect + tightly crop the FACE only
    prog(25)
    depth = estimate_depth(img)
    prog(45)
    mask = head_mask(cfg.GRID, depth)  # full head silhouette (face + hair + ears)
    prog(60)

    if cfg.BLENDER_PATH and os.path.exists(cfg.BLENDER_PATH):
        # Higher-quality build + texture-safe export in Blender (full-frame for now).
        from . import blender_run
        depth_png = os.path.join(out_dir, f"{task_id}_depth.png")
        img_png = os.path.join(out_dir, f"{task_id}_color.png")
        img.save(img_png)
        Image.fromarray((np.clip(depth, 0, 1) * 255).astype("uint8")).save(depth_png)
        blender_run.build_relief(img_png, depth_png, glb, stl,
                                 depth_mm=cfg.RELIEF_DEPTH_MM, size_mm=cfg.SIZE_MM, base_mm=cfg.BASE_MM)
    else:
        # Pure-Python, face-masked relief — works with no Blender / no GPU.
        mesh_relief.build_relief(img, depth, mask, glb, stl,
                                 depth_mm=cfg.RELIEF_DEPTH_MM, grid=cfg.GRID,
                                 base_mm=cfg.BASE_MM, size_mm=cfg.SIZE_MM)
    prog(100)
    return glb, stl
