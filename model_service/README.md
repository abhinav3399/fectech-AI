# model_service — local image → 3D (no paid API)

A standalone, fully-local service that turns a single face photo into a 3D model
(**GLB** for the three.js avatar + **STL** for 3D printing). It speaks the exact
submit/poll contract the main app's `LocalProvider` expects
(`app/services/mesh_service.py`), so it plugs in via `MODEL_3D_URL` with **no
app-code changes**.

## Contract
```
POST /submit            {"image": "data:image/png;base64,..."}  -> {"task_id": "abc123"}
GET  /status/{task_id}  -> {"status": "SUCCEEDED|FAILED|CANCELED|IN_PROGRESS",
                            "progress": 0-100,
                            "model_urls": {"glb": "<url>", "stl": "<url>"}}
GET  /files/{name}      -> the produced .glb / .stl
GET  /health            -> {ok, pipeline, blender}
```

## Pipelines
- **B — depth-relief (default, runs anywhere).** Photo → depth map → a 2.5D
  facial **relief** (heightfield), solidified into a watertight, printable bust.
  - Depth: **Depth Anything V2** (if `torch`+`transformers` installed), else a
    built-in luminance/centre **pseudo-depth** fallback (zero ML deps).
  - Build/export: pure-Python (numpy + trimesh) by default; **Blender** if
    `BLENDER_PATH` is set (higher quality, texture-safe GLB).
  - Honest: this is a **relief / bas-relief**, not a full 360° head. It's local,
    needs no GPU, and prints cleanly.
- **A — AI mesh (TripoSR / InstantMesh) + Blender.** Best likeness, **needs an
  NVIDIA GPU**. Scaffolded in `meshgen.py`; not wired yet.

## Install & run
```bash
# from the repo root
pip install -r model_service/requirements.txt        # core (Pipeline B pure-Python)
# optional, better relief:  pip install rembg torch transformers
uvicorn model_service.app:app --port 8800
```
Then in the **main app's `.env`**:
```ini
MODEL_3D_PROVIDER=local
MODEL_3D_URL=http://127.0.0.1:8800
```
Restart the main backend. Now Edit → Photo → **Generate 3D model from photo** uses
this service. (The app code is unchanged — only `.env`.)

## Config (env vars)
| Var | Default | Meaning |
|---|---|---|
| `MODEL_3D_PIPELINE` | `B` | `B` depth-relief, `A` AI mesh (GPU) |
| `BLENDER_PATH` | _(empty)_ | path to Blender exe → use Blender to build/export |
| `DEPTH_MODEL` | `depth-anything/Depth-Anything-V2-Small-hf` | real depth model |
| `RELIEF_DEPTH_MM` | `22` | max protrusion |
| `RELIEF_GRID` | `180` | heightfield resolution |
| `RELIEF_SIZE_MM` / `RELIEF_BASE_MM` | `120` / `4` | plaque size / backing |
| `MODEL_SERVICE_PORT` / `MODEL_SERVICE_PUBLIC_BASE` | `8800` | port / URL the app fetches files from |

## Quick test (no app needed)
```bash
curl -s -X POST localhost:8800/submit -H "Content-Type: application/json" \
  -d "{\"image\":\"data:image/png;base64,<...>\"}"
# -> {"task_id":"..."}; then poll:
curl -s localhost:8800/status/<task_id>
```

## Honest caveats / fidelity ceiling
- A single photo → 3D is **approximate**. Pipeline B is a **relief**, not a true
  head; Pipeline A (when wired) hallucinates the unseen sides. The **real 2D
  photo stays the faithful avatar** — 3D is a supplementary, printable aid.
- The pseudo-depth fallback is crude; install `torch`+`transformers` for real
  Depth Anything V2, and/or set `BLENDER_PATH` for the better build.
