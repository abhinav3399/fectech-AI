# Feature: Phoneme/viseme lip-sync (real mouth shapes, not a jaw flap)

## Context (verified by reading the repo)
- **Lip-sync is an amplitude proxy.** `frontend/src/lib/audiolevel.js::getMouthSignal()` infers `open` from low-band FFT energy and `wide` from high-band energy — every sound is a generic jaw flap and **the lips never close** (no m/b/p), can't distinguish "oo" vs "ee". `TalkingPhoto.jsx` warps the mouth from `{open, wide}`; `Avatar3D.jsx` deforms baked lower-lip vertices the same way.
- **The cloned voices have no word timing.** Live/typed replies route through the voice seam to OpenVoice (`voice_service_ov`) or XTTS (`voice_service`) — neither emits phoneme/word timestamps. The fast **edge-tts** path (`app/services/tts_service.py::synthesize`, used for `/tts` neural) DOES support `WordBoundary` events.

## Goal
Drive recognizable mouth shapes — correctly **closing on m/b/p** and distinguishing rounded/spread vowels — for the biggest realism jump. Two complementary paths: (A) **phoneme-timed visemes** for the edge-tts neural voice; (B) an upgraded **audio-driven viseme estimate** for the cloned voices (which have no timing).

## Implementation plan
### Part A — Phoneme visemes for edge-tts (backend)
1. `tts_service.synthesize` — capture `edge_tts.Communicate` **WordBoundary** callbacks (offset/duration per word). Map words → ARPAbet (`g2p_en`/CMUdict) → an ARPAbet→viseme table (AA/E/I/O/U/M-closed/F/S/rest). Return a timed track `[{t_ms, viseme}]` alongside the base64 audio.
2. `persona_endpoint.py::/tts` — include `visemes` in the response when present (neural path only; cloned path omits it).
### Part B — Audio-driven visemes for ALL voices (frontend)
1. Upgrade `audiolevel.js` with `getViseme()` → `{open, shape}` where `shape ∈ {round, spread, closed, neutral}` estimated from the live spectrum (spectral centroid + band ratios + a closure cue on low-energy stops) — works for cloned audio since it reads the actual playback.
2. A viseme scheduler in `AvatarPage.jsx`/`TalkingPhoto.jsx`: if a `visemes` track is present (neural), schedule shapes against `audio.currentTime`; else fall back to `getViseme()`. 
3. `TalkingPhoto.jsx` shader + `Avatar3D.jsx` — add spread vs round (and a real closed state) on top of the existing `open` deform.

## Data contract
- `/tts` response (neural): `+ "visemes": [{ "t": 120, "v": "AA" }, { "t": 260, "v": "M" }, ...]`.

## Acceptance criteria
- [ ] On the neural voice, lips visibly **close** on m/b/p and round on "oo" vs spread on "ee" (viseme track scheduled to the audio clock).
- [ ] On the cloned voice (no track), the audio-driven estimate still produces varied open/round/spread/closed shapes — better than the old flat flap.
- [ ] No regression to the existing avatar render or the `GLBErrorBoundary`; reduce-motion still calms it.

## Constraints / do not break
- Cloned path uses the audio-driven estimate (don't fake timing it doesn't have). Keep `getMouthSignal` working for anything still using it. Richer 3D shapes beyond open/round/spread may need morph baking (`facemesh3d.py` + model re-gen) — ship the lip-only/photo version first.

## Out of scope
- A forced-aligner to get phoneme timing on cloned audio.
- Full ARKit viseme rigs.
