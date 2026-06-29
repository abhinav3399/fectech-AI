# 19 — Graceful "voice cloning unavailable" UX

> **Status: implemented in this repo.** Kept as a portable, reusable prompt.

## Context (verified by reading the repo)
- Voice cloning is ElevenLabs-only. `app/services/voice_clone_service.py` → `configured()` returns `bool(ELEVENLABS_API_KEY)`. When no key is set, `POST /clone-voice` (`app/api/persona_endpoint.py`) returns `{status:"error", message:"Voice cloning isn't set up yet…"}`.
- `frontend/src/components/PersonaEditor.jsx` shows a **"Clone this voice"** button whenever a `voiceSample` exists, regardless of whether cloning is actually available — so users hit a confusing failure for an **optional** feature (the companion already falls back to natural preset voices).
- The editor already fetches `GET /voices` on mount to populate the voice `<select>`.

## Goal
When the backend has no cloning provider configured, **don't show a clone button that can only fail** — surface a calm note instead, so the optional feature degrades gracefully.

## Implementation plan
1. **Backend** (`app/api/persona_endpoint.py`): add a capability flag to `GET /voices` →
   `return {"voices": NEURAL_VOICES, "cloning": voice_clone_service.configured()}`.
2. **Frontend** (`PersonaEditor.jsx`):
   - Add `const [cloningAvailable, setCloningAvailable] = useState(false)`.
   - In the existing `/voices` fetch, also `setCloningAvailable(!!r.data?.cloning)`.
   - In the clone block, branch on `cloningAvailable`:
     - **true** → render the clone button (+ consent/tip, features #20/#21).
     - **false** → render a calm `.pe-clone-off` note: *"Voice cloning isn't enabled, so the companion will speak with a natural preset voice matched to their gender & accent. To clone their real voice, add an ElevenLabs key to the backend."*
   - Add a `.pe-clone-off` style inside the existing inline `<style>` (muted slate text, soft border) — dark theme, no new framework.

## Data contract
- `GET /voices` response gains `cloning: boolean` (additive; existing `voices` unchanged).

## Acceptance criteria
- [ ] With **no** `ELEVENLABS_API_KEY`, `/voices` returns `cloning:false` and the editor shows the calm note (no clone button, no red error).
- [ ] With a key, `cloning:true` and the clone button appears as before.
- [ ] Existing `/voices` voice list and the preset-voice flow are unchanged.

## Constraints / out of scope
- Reuse `voice_clone_service.configured()`; no new endpoint. Keep dark inline-`<style>`. No provider added here (see #18). Composes with #20 (quality guard) and #21 (consent).
