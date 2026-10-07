# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Factech AI is an AI **memory companion for dementia/Alzheimer's patients**. A carer builds a mimic of a real loved one (name, age, relationship, personality, shared memories, photo, voice); the app then talks **as** that person, shows a **3D face generated from their photo** that lip-syncs while speaking, and can speak in the person's **cloned voice**. Optimize every change for comfort, warmth, and dementia-safety; keep processing local/private by default.

## Run it (dev = three processes)

```bash
# 1. Main backend — MUST be port 8010 (the Vite proxy targets it; README's 8000 is stale)
uvicorn app.main:app --reload --port 8010

# 2. Photo→3D service (only needed when MODEL_3D_PROVIDER=local)
uvicorn model_service.app:app --port 8800

# 2b. Voice-cloning workers (when VOICE_PROVIDER=local/auto AND no ELEVENLABS_API_KEY). Two engines,
#     each in its OWN venv. A clone is made on both; English routes to OpenVoice, Hindi to XTTS.
voice_service_ov/.venv/Scripts/python -m uvicorn voice_service_ov.app:app --port 8811  # OpenVoice v2 (fast, English ~4s/line)
voice_service/.venv/Scripts/python -m uvicorn voice_service.app:app --port 8810        # XTTS-v2 (fidelity + Hindi ~8s/line)

# 3. Frontend (Vite dev server, http://localhost:5173)
cd frontend && npm run dev
```

The browser only talks to Vite; `frontend/vite.config.js` proxies `/api` and `/static` → `localhost:8010`. If you change the backend port, change the proxy too.

```bash
# Frontend
cd frontend && npm run build      # production build (also the compile check — run after JS edits)
cd frontend && npm run lint       # eslint

# Health / smoke
curl localhost:8010/health        # backend liveness + which keys are configured
curl localhost:8800/health        # model_service liveness + active 3D pipeline

# Tests — integration scripts using FastAPI TestClient (need enrolled Qdrant data / services up)
pytest tests/test_recognition.py          # or: python tests/test_recognition.py
```

`requirements.txt` is heavy (TensorFlow/keras-facenet, PyTorch via whisper/ultralytics, mediapipe, opencv). Install into the repo's `venv`. On Windows this repo is typically driven via `venv/Scripts/python.exe -m uvicorn ...`.

## Configuration (`.env` at repo root)

`GROQ_API_KEY` (required for chat). `QDRANT_MODE` = `local` (embedded, on-disk `QDRANT_PATH=qdrant_storage`, default) or `server` (+ `QDRANT_URL`/`QDRANT_API_KEY`). `MODEL_3D_PROVIDER` = `auto|meshy|replicate|local` with `MODEL_3D_URL` (e.g. `http://127.0.0.1:8800`). Optional: `ELEVENLABS_API_KEY` (voice cloning — without it, voice falls back to neural edge-tts), `MESHY_API_KEY`, `REPLICATE_API_TOKEN`, `TIMEZONE` (persona temporal grounding, default `Asia/Kolkata`). Config is loaded once via `app/core/config.py` (`settings`).

## Architecture (the big picture)

**Two FastAPI apps + one React app.** `app/main.py` is the product API; `model_service/app.py` is a standalone photo→3D worker the product calls over HTTP. In **production** the main backend also serves the built `frontend/dist` single-origin (SPA catch-all in `main.py`); in dev they're separate.

**The persona is the central primitive.** `app/services/llm_service.py::chat_as_persona` is the one "brain" the avatar speaks through. It assembles a system prompt from persona fields + conversation style + language rules (Hindi → Devanagari, Hinglish) + **temporal grounding** + recalled **episodic memories** + the **care plan**. The care-plan block is appended **last on purpose** so it overrides chattiness/tone (it's the strongest, most-recent instruction). It tries `llama-3.3-70b-versatile` then falls back to `llama-3.1-8b-instant`. `persona_endpoint.py` (`/persona/chat`, `/tts`, `/evaluate`, `/remember`, `/voices`, `/clone-voice`) is the persona-facing router; `endpoints.py` + `chat_endpoint.py` cover the older face-recognition/object/"who is this" flows.

**Two separate memory systems — don't conflate them.** `app/services/episodic_memory.py` stores **long-term conversational facts** in Qdrant (distilled by `llm_service.summarize_session` at session end, retrieved into the next chat). `memory_service.py` / `semantic_memory.py` / `face_service.py` handle **person/face enrollment + recognition** (VoxCeleb-style embeddings). Qdrant-local is on-disk — use non-destructive `collection_exists`, never `recreate_collection` (data loss).

**Photo→3D is a provider seam.** `app/services/mesh_service.py` dispatches to Meshy / Replicate / **Local** based on `MODEL_3D_PROVIDER`, normalizing every provider to `{status, progress, model_urls:{glb,stl}, task_error}`. `Local` calls `model_service` via a submit/poll contract: `POST /submit` (base64 image) → `GET /status/{task_id}` → `GET /files/{name}`. `model_service` runs entirely on **CPU, no GPU, no external service**: pipeline "C" in `facemesh3d.py` = MediaPipe FaceLandmarker (478 landmarks; needs `model_service/models/face_landmarker.task`) → Delaunay → a bright **emissive-textured** GLB (`texture.py` — trimesh's default PBR is metallic/near-black in three.js, so we force non-metallic + emissive) + a lit teeth/inner-mouth card + a printable STL. `config.py::PIPELINE` selects C (face mesh) / B (depth relief) / A (GPU, scaffolded). `USE_REAL_DEPTH` is opt-in (downloads a model); default is offline pseudo-depth.

**Lip-sync spans backend → GLB → three.js.** `facemesh3d.py` bakes mouth metadata into the GLB's `meshes[0].extras` (vertex indices, smooth Hann weights, upper/lower flags, openAxis) via raw JSON-chunk surgery. three.js `GLTFLoader` surfaces glTF mesh extras as `mesh.userData.mouth`; `frontend/src/components/Avatar3D.jsx` reads it and deforms the lower-lip vertices each frame, driven by `frontend/src/lib/audiolevel.js::getMouthSignal()` (a shared WebAudio AnalyserNode tapped off the TTS `<audio>` element). **Because mouth/teeth data is baked into the GLB, any change to `facemesh3d.py` weights/geometry requires regenerating the model from the UI (Edit → Photo → Regenerate)** — existing models won't pick it up.

**Voice: neural preset + a SWAPPABLE, multi-engine cloning seam.** `tts_service.py` = edge-tts neural voices (default, no key; accepts `rate`/`pitch` — the FAST ~1.5s path, pitch-tunable toward the loved one). `voice_clone_service.py` is the **voice-provider seam**: `configured()/clone()/tts()` over THREE engines, picked via `settings.VOICE_PROVIDER` (`auto|local|elevenlabs|off`):
- **OpenVoice v2** (`voice_service_ov/`, port **8811**, MIT) — MeloTTS base + tone-color converter; **fast (~4s/sentence) cloned English** (incl. Indian accent). The live-conversation path. `voice_id` prefix `ov:`.
- **XTTS-v2** (`voice_service/`, port **8810**, CPML/non-commercial) — slower (~8s/sentence after the conditioning-latent cache + P-core pin) but higher-fidelity and **does Hindi**. The fidelity + Hindi fallback. `voice_id` prefix `local:`.
- **ElevenLabs** — hosted, opt-in (`ELEVENLABS_API_KEY`); bare (un-prefixed) `voice_id`.

A clone is made on **every available local engine** and the ids are joined with `|` (e.g. `ov:ab12|local:cd34`). `tts()` routes by **language**: Devanagari/Hindi → XTTS, else → OpenVoice (fast), with graceful fallback. The frontend (`AvatarPage.jsx`) **streams the reply sentence-by-sentence** (first audio in a few seconds, no pile-ups via an AbortController) and has a **"Real voice" toggle** (clone everywhere vs fast neural). Both workers are offline & key-free, run in their **own venvs** (XTTS needs `torch<2.9`; OpenVoice needs `pyopenjtalk-plus`+`jamo`+MeloTTS-via-git`--no-deps`+nltk data — see `voice_service_ov/requirements.txt`), store voices under `voice_service*/voices/`, and normalize audio to MP3 via a bundled `imageio-ffmpeg`. `persona_endpoint.py::/tts` uses the cloned `clone_voice_id` when present, else a neural preset — callers never change when engines do.

**Frontend state is a tiny custom store, not Redux.** `frontend/src/lib/store.js` is a `useSyncExternalStore` store persisted to localStorage (`profile`, `persona`, `memories`, `transcript`, `reminders`, `insightsHistory`, `emergencyContacts`). The **design system is CSS custom properties** in `frontend/src/index.css :root` (Tailwind is present but the tokens are the source of truth). Theming/accessibility are attributes on `<html>`: `data-theme` (`lib/theme.js`), plus `--fs-scale` / `data-contrast` / `data-reduce-motion` (`lib/a11y.js`). App-wide feedback (`components/Feedback.jsx`: `toast()`, `confirmAction()`) is event-based — call it from anywhere without a provider. The 3D stack (three/fiber/drei) is split into its own bundle chunk (`vite.config.js` manualChunks); `Avatar3D` is wrapped in `GLBErrorBoundary` so a bad model never blanks the app.

## Deployment

`Dockerfile` builds the frontend then a Python image that serves both (single-origin, embedded local Qdrant, `$PORT`). `vercel.json` is **frontend-only**. `render_build.sh` installs deps + builds the frontend.
