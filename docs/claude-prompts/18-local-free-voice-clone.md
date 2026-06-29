# 18 — Local / free voice cloning (no paid API) via the existing provider seam

## Context (verified by reading the repo)
- `app/services/voice_clone_service.py` is explicitly designed as a **provider seam** (its docstring: "Isolated so a different cloning engine (Cartesia, local XTTS, …) can replace it without touching endpoints or the frontend"). It exposes `configured() -> bool`, `clone(name, audio_bytes, mime, filename, labels) -> voice_id`, and `tts(text, voice_id) -> mp3 bytes`.
- `app/api/persona_endpoint.py` calls `voice_clone_service.configured()` / `.clone()` / `.tts()` only — so swapping the engine behind these three methods changes nothing upstream.
- `app/core/config.py` `Settings` reads `.env` (e.g. `ELEVENLABS_API_KEY`). No `VOICE_CLONE_PROVIDER` setting yet.

## Goal
Make voice cloning work **without a paid ElevenLabs plan** by adding a **local, open-source** cloning/TTS engine (e.g. **Coqui XTTS-v2** or **OpenVoice**) behind the same `voice_clone_service` interface, selectable via config, so the companion can speak in the person's voice for free.

## Implementation plan
1. **Config:** add `VOICE_CLONE_PROVIDER: str = "elevenlabs"` (values: `"elevenlabs" | "xtts" | "none"`) to `app/core/config.py`.
2. **Provider abstraction:** refactor `voice_clone_service.py` into a small factory that returns the configured provider, each implementing `configured()/clone()/tts()`:
   - `ElevenLabsProvider` — the current implementation (unchanged).
   - `XttsProvider` — wraps Coqui XTTS-v2 (`TTS` pip package). XTTS does **zero-shot** cloning: there's no separate "voice_id" registration — it clones from a reference WAV at synth time. So `clone()` should **persist the reference sample** to disk (e.g. `data/voices/<uuid>.wav`, converting webm→wav with ffmpeg/`pydub`) and return that path/id as the `voice_id`; `tts(text, voice_id)` calls `tts.tts_to_file(text=text, speaker_wav=<path>, language=<lang>)` and returns the MP3 bytes. `configured()` returns True if the model/deps are importable.
3. **Endpoints/frontend:** unchanged — they already only touch the three methods. Feature #1's `/voices` `cloning` flag now reflects whichever provider is configured.
4. **Deps & model:** add `TTS` (Coqui) to a separate optional `requirements-voice.txt` (it pulls torch + a ~2 GB model on first run). Document the one-time model download and the ffmpeg requirement. Guard imports so the backend still boots if the package/model is absent (`configured()` → False, graceful fallback to neural presets).
5. **Language:** map `persona.language` (english/hindi/hinglish) to the XTTS language code so cloned speech matches.

## Data contract
- Unchanged `/clone-voice` and `/tts` request/response shapes. `voice_id` becomes a local reference-sample id for XTTS. New `data/voices/` storage dir (gitignored).

## Acceptance criteria
- [ ] With `VOICE_CLONE_PROVIDER=xtts` and deps installed, recording a ~20–30s sample → Clone → the companion's `/tts` speaks in the cloned voice, **no ElevenLabs key needed**.
- [ ] With the provider unavailable/uninstalled, `configured()` is False, the UI shows the calm "cloning not enabled" note (feature #1), and neural presets still work.
- [ ] Switching `VOICE_CLONE_PROVIDER` back to `elevenlabs` restores the original behavior with no frontend/endpoint changes.
- [ ] Backend boots fine whether or not the heavy voice deps are installed.

## Constraints / out of scope
- Reuse the shared Qdrant client only if needed (it isn't). Keep the provider seam — do NOT touch endpoints/frontend logic beyond config. Heavy deps stay **optional** and lazily imported. No GPU assumption (XTTS runs on CPU, slower). No real-time streaming clone here (compose with feature #6 Part B later).
- NOTE: this requires a large model download + torch; install and verify in an environment that can host it (it won't run inside a minimal CI sandbox).
