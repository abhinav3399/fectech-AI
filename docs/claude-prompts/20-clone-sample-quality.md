# 20 — Voice-clone sample-quality guard

> **Status: implemented in this repo.** Kept as a portable, reusable prompt.

## Context (verified by reading the repo)
- `frontend/src/components/PersonaEditor.jsx` records/uploads a voice sample to `voiceSample` (a `data:` URL) and `cloneVoice()` POSTs it to `/clone-voice`.
- There is **no client-side validation** of the sample. Instant voice cloning (ElevenLabs / XTTS) needs ~20–30s of clean speech; a 2-second or near-silent clip clones poorly or fails — and the user has no idea why.

## Goal
Stop bad clones at the source: **validate the sample's duration and loudness before sending it**, with a clear, friendly message and a tip — so only usable samples reach the cloning engine.

## Implementation plan
1. Add a module-level `sampleQuality(dataUrl)` helper that decodes the audio via WebAudio (`AudioContext.decodeAudioData`) and returns `{ duration, rms }` (RMS = sqrt(mean(sample²)) over channel 0). Return `null` on any failure so it never blocks when analysis isn't possible.
2. In `cloneVoice()`, before the network POST:
   - `const q = await sampleQuality(voiceSample)`
   - if `q && q.duration < 15` → set a clear error: *"Sample is only Ns — record about 20–30 seconds of clear speech for a good clone."* and return.
   - if `q && q.rms < 0.004` → *"Sample is very quiet — record again a little louder, closer to the mic."* and return.
3. Add a persistent **tip line** under the clone button: *"Tip: 20–30 seconds of clear speech (no background noise) makes the best clone."* (`.pe-tip`, muted).

## Data contract
- No backend/API change. Pure client-side guard on `voiceSample` before `POST /clone-voice`.

## Acceptance criteria
- [ ] A <15s sample shows the "too short" message and does **not** POST.
- [ ] A silent/very quiet sample shows the "too quiet" message and does not POST.
- [ ] A good (≥15s, audible) sample proceeds to clone as before.
- [ ] If WebAudio decode fails (unsupported format), it does **not** block — the server still decides.

## Constraints / out of scope
- Frontend-only; reuse existing state/UX, dark inline-`<style>`. Thresholds are heuristics (tune as needed). No server-side audio analysis here.
