# 21 — Voice-clone consent gate

> **Status: implemented in this repo (consent checkbox).** The delete / multi-sample / settings parts below are optional follow-ups.

## Context (verified by reading the repo)
- `frontend/src/components/PersonaEditor.jsx` clones a **real person's** voice with one click and no consent step.
- `app/services/voice_clone_service.py` registers the clone with ElevenLabs (a real third-party voice) but there is no way to **delete** it later, and `tts()` uses fixed `voice_settings {stability:0.5, similarity_boost:0.85}`.

## Goal
Make cloning a real person's voice **ethical and manageable**: require explicit consent before cloning, and (optionally) let the caregiver remove a cloned voice and tune its settings.

## Implementation plan
### Implemented (consent gate)
1. Add `const [cloneConsent, setCloneConsent] = useState(false)`.
2. In the clone block, add a checkbox: *"I have this person's permission to clone their voice."* (`.pe-consent`).
3. Disable the clone button until `cloneConsent` is true (`disabled={cloning.active || !cloneConsent}`).

### Optional follow-ups (not yet implemented)
4. **Delete a cloned voice:** add `voice_clone_service.delete(voice_id)` → `DELETE {EL_BASE}/v1/voices/{voice_id}`; expose `POST /delete-voice {voice_id}`; in the editor add a "Remove cloned voice" button (shown when `voiceCloneId` set) that calls it and clears `voiceCloneId`.
5. **Voice settings sliders:** expose stability / similarity (0–1) in the editor, persist on the persona, and thread them through `POST /tts` → `voice_clone_service.tts(text, voice_id, stability, similarity)` (default to current 0.5/0.85).
6. **Multiple samples:** allow uploading several reference clips (ElevenLabs `voices/add` accepts multiple files) for higher fidelity.

## Data contract
- Consent is local UI state only (gates the action). Optional: `POST /delete-voice {voice_id} -> {status}`; optional `/tts` fields `stability`, `similarity`; optional `persona.voiceSettings`.

## Acceptance criteria
- [ ] The clone button is disabled until the consent box is checked.
- [ ] (Follow-up) Deleting a cloned voice removes it from ElevenLabs and clears `voiceCloneId`.
- [ ] (Follow-up) Adjusting stability/similarity changes the cloned-voice output.

## Constraints / out of scope
- Consent is product UX, not a legal record. Delete/settings need an ElevenLabs key to verify. Reuse `voice_clone_service`; keep dark inline-`<style>`. No PHI/audit-log handling here.
