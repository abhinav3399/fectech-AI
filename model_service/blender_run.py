"""Drive Blender headless to build + export the relief (optional, higher quality).

Used only when BLENDER_PATH points at a real Blender executable. Blender packs
the texture reliably into the GLB and exports a clean STL.
"""
import os
import subprocess

_SCRIPT = os.path.join(os.path.dirname(__file__), "blender", "build_relief.py")


def build_relief(color_png: str, depth_png: str, out_glb: str, out_stl: str,
                 depth_mm: float = 22.0, size_mm: float = 120.0, base_mm: float = 4.0):
    from .config import cfg
    cmd = [
        cfg.BLENDER_PATH, "-b", "-noaudio", "-P", _SCRIPT, "--",
        color_png, depth_png, out_glb, out_stl,
        str(depth_mm), str(size_mm), str(base_mm),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if proc.returncode != 0 or not os.path.exists(out_glb):
        raise RuntimeError(f"Blender build failed (code {proc.returncode}).\n{proc.stdout[-1500:]}\n{proc.stderr[-1500:]}")
    return out_glb, out_stl
