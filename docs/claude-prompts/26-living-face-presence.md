# Feature: Living-face presence — blinking, breathing, micro-expressions, gaze

## Context (verified by reading the repo)
- **The avatar is a near-frozen mannequin.** `frontend/src/components/Avatar3D.jsx` does only a fixed sinusoidal head sway + amplitude-based lower-lip deform (from `lib/audiolevel.js::getMouthSignal`); **the eyes never blink, never look at anyone, and there is no expression** (the uncanny dead stare). `TalkingPhoto.jsx` warps the mouth region; `PhotoAvatar.jsx` is fully static.
- **Mouth-only morphs are baked into the GLB** by `model_service/facemesh3d.py` (mouth vertex indices/weights in `meshes[0].extras`, read as `mesh.userData.mouth`). Eyes/brows are NOT baked. A distress/affect signal now exists (`lib/distress.js`, `AvatarPage` `calmRef`). MediaPipe is NOT a frontend dep.

## Goal
Make the avatar feel present: gentle **blinking**, subtle **breathing/postural sway**, emotion-tinted **micro-expressions** (warm brow-raise + slight smile on greeting; soft concern when the patient sounds sad), and — Phase 2 — **eyes that find and hold the patient's face**. It softens/pauses when the patient looks away.

## Implementation plan
### Phase 1 — Behavior controller (no new deps, no model re-gen for the photo paths)
1. `Avatar3D.jsx` — add a `useFrame` behavior controller: a **Poisson blink** scheduler, a **breathing** vertical/scale offset, and a subtle idle sway already present (refine it). Blink/breathe work with eyelid scaling even before full eye morphs.
2. `TalkingPhoto.jsx` — add a subtle **blink overlay** (briefly darken/scale the eye band in the shader) + breathing zoom so the talking photo isn't static between mouth moves.
3. Drive a simple **expression intensity** from the Distress/affect signal (calm = soft, distressed = concerned brow) and from greetings.

### Phase 2 — Real eye morphs + gaze (3D)
1. Extend `model_service/facemesh3d.py` to bake **eyelid + eye-rotation + brow/smile morph targets** into the GLB extras (alongside the mouth). **Existing models must be regenerated** (carer: Edit → Photo → Regenerate) — call this out in the UI.
2. `Avatar3D.jsx` — a gaze solver mapping the patient's on-screen face position to eye/neck rotation. Face position needs `@mediapipe/tasks-vision` FaceLandmarker (a NEW frontend dep) — gate Phase 2 behind it; smooth + calibrate neutral gaze to avoid jitter.

## Acceptance criteria
- [ ] Phase 1: the 3D head and the talking photo blink at natural intervals and breathe; expression warms on greeting and softens to concern when distress is high; reduce-motion disables it.
- [ ] No regression to lip-sync or the `GLBErrorBoundary`; existing models still render (Phase-1 behaviors don't require re-gen).
- [ ] Phase 2 (if built): regenerated models expose eye/brow morphs; gaze tracks the webcam face smoothly; absent webcam → graceful neutral gaze.

## Constraints / do not break
- **Baked-morph caveat:** any `facemesh3d.py` change requires regenerating models — surface this clearly. Respect `data-reduce-motion`/`prefers-reduced-motion`. Keep motion calm and slow (dementia-safe) — no darting eyes or jitter. Phase 2's MediaPipe dep is opt-in only.

## Out of scope
- Full ARKit 52-blendshape rigs / photoreal talking video (needs a GPU model).
- Always-on camera beyond the gaze use (privacy) — Phase 2 reads face position only, on-device.
