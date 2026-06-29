"""Pipeline A — AI single-image-to-3D MESH (TripoSR / InstantMesh) + Blender export.

This is a SCAFFOLD. It needs an NVIDIA GPU and the model installed; wiring it is
left as a follow-up. Set MODEL_3D_PIPELINE=A only once this is implemented.

To implement:
  1. pip install the model (e.g. TripoSR: github.com/VAST-AI-Research/TripoSR) +
     CUDA-matching torch.
  2. Load weights ONCE (import-time / module global), run on the preprocessed
     image to get an OBJ/PLY mesh (+ texture).
  3. Use model_service/blender_run.py-style Blender headless (or trimesh) to
     import that mesh, clean it, and export GLB (textured) + STL (watertight).
"""


def run(image_path: str, out_glb: str, out_stl: str, on_progress=None):
    raise NotImplementedError(
        "Pipeline A (TripoSR/InstantMesh) is not wired yet — it needs an NVIDIA GPU "
        "and the model installed. Use MODEL_3D_PIPELINE=B (depth-relief) for the "
        "local, no-GPU path, or implement model_service/meshgen.run per the README."
    )
