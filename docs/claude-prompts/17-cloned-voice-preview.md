# 17 — Cloned-voice preview + re-clone loop

## Context (verified by reading the repo)
- `frontend/src/components/PersonaEditor.jsx`: after a successful clone, `voiceCloneId` is set. The existing **Preview** button (`previewVoice`) calls `POST /tts` with `voice: voiceId` (the neural preset) and `clone_voice_id: voiceCloneId` — but it's positioned next to the voice **select**, so it previews the *preset* voice flow, not a clean "hear the clone" action after cloning.
- `app/api/persona_endpoint.py` `POST /tts`: if `clone_voice_id` is set AND `voice_clone_service.configured()`, it speaks in the cloned voice (returns `{audio_base64, cloned:true}`), else falls back to a neural preset. So previewing a clone just needs a `/tts` call with `clone_voice_id`.
- `voice_clone_service.tts(text, voice_id)` (ElevenLabs) uses fixed `voice_settings {stability:0.5, similarity_boost:0.85}`.

## Goal
After cloning, let the caregiver immediately **hear the cloned voice** on a sample sentence and **re-record / re-clone** if it's not right — a tight quality loop — before saving the persona.

## Implementation plan
1. In `PersonaEditor.jsx`, add a **"Preview cloned voice"** button inside the `pe-clone` block, shown only when `voiceCloneId && !cloning.active`. On click, `POST /tts` with `{ text: "Hello ${initial?.userName || 'dear'}, it's ${name}. I'm right here with you.", clone_voice_id: voiceCloneId }`, play the returned `audio_base64`, and show a small `cloned:true/false` indicator from the response so the user knows whether they heard the real clone or a fallback.
2. Add a **"Not quite right? Re-record"** affordance that clears `voiceSample`/`voiceCloneId` and scrolls to the recorder, so the loop is record → clone → preview → re-record.
3. Reuse the existing `audioRef` + previewing state pattern; cancel any in-flight audio before playing (mirror the single-voice discipline used in AvatarPage).
4. Optional: expose **stability / similarity** sliders that thread through to `/tts` → `voice_clone_service.tts(text, voice_id, stability, similarity)` (add params, default to current 0.5/0.85).

## Data contract
- Reuses `POST /tts` (`{ text, clone_voice_id }` → `{ status, audio_base64, cloned }`). Optional new `/tts` fields `stability`, `similarity` (floats 0–1) passed to `voice_clone_service.tts`.

## Acceptance criteria
- [ ] After a successful clone, a "Preview cloned voice" button plays a sentence in the cloned voice; the indicator shows `cloned: true`.
- [ ] If the backend has no key (cloning unavailable), the button is absent (covered by feature #1's capability gate).
- [ ] Re-record clears the clone and lets the user clone again without reopening the editor.
- [ ] Existing Preview (preset) and `/tts` behavior unchanged.

## Constraints / out of scope
- Reuse `/tts` + `voice_clone_service`; no new service. Needs an ElevenLabs key to verify end-to-end. No multi-sample enrollment here (see #19/manage). Keep dark inline-`<style>` theme.
