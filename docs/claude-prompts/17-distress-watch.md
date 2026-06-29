# Feature: In-conversation Distress Watch + auto de-escalation (sundowning calm-mode)

## Context (verified by reading the repo)
- **Project:** Factech AI — AI memory companion for dementia/Alzheimer's patients. Backend = FastAPI (`app/main.py`, routers under `settings.API_V1_STR` = `/api/v1`). Frontend = React 19 + Vite in `frontend/`. API base = `import.meta.env.VITE_API_BASE || '/api/v1'`; Vite proxies `/api` → `localhost:8010`.
- **Distress is only detected on a button press today.** `app/api/persona_endpoint.py::/evaluate` runs ONE Groq JSON pass (`llm_service.evaluate_conversation`) over the recent transcript and returns `{mood, engagement, concerns[], summary, suggestions[]}`. It is invoked manually (WellbeingInsights), never live, mid-turn.
- **The persona "brain"** is `app/services/llm_service.py::chat_as_persona(user_text, persona, user, history, memories)`. It assembles a system prompt from persona fields + a `style` length rule (`brief|balanced|chatty|dosti`) + temporal grounding (`settings.TIMEZONE`) + recalled memories + the **care plan, appended LAST on purpose so it overrides tone**. The care plan lives on `persona.carePlan` = `{ tone, avoidTopics[], comfortTopics[], anchorAnswers[] }` (set in `frontend/src/components/PersonaEditor.jsx`, "Care plan" tab).
- **Audio analysis exists but only on OUTPUT.** `frontend/src/lib/audiolevel.js` has ONE shared `AudioContext`+`AnalyserNode` that `attachAudio()` taps off the TTS `<audio>` element (drives the avatar mouth via `getMouthSignal()`). **There is NO analyser on the patient's microphone.**
- **Live voice loop:** `frontend/src/pages/AvatarPage.jsx` — `startListening()` (Web Speech `SpeechRecognition`, callMode only) → `runTurn(text)` → `POST /persona/chat` → `speak(reply, {preferFast})`. `speak()` streams the reply sentence-by-sentence and POSTs `/tts` with `{text, voice, clone_voice_id?, pitch?}`. Typed turns also go through `runTurn`. `messagesRef.current` holds the running transcript.
- **TTS supports a `rate`** (`app/services/tts_service.py::synthesize(text, voice, rate, pitch)`, default `rate="-8%"`) and `/tts` passes `rate`/`pitch` through — so we can SLOW the neural voice when distressed.
- **MediaPipe is NOT a frontend dependency** (it's Python-only in `model_service/`). So facial-affect sensing would need `@mediapipe/tasks-vision` — keep that as an optional Phase 2; **Phase 1 = voice prosody + conversation content only** (no new heavy deps).
- **No backend caregiver alerting exists.** `frontend/src/components/EmergencyButton.jsx` + `store.emergencyContacts` are tel: links only.

## Goal
Continuously estimate the patient's distress DURING a conversation from (1) **voice prosody** (a new mic AnalyserNode) and (2) **conversation content** (repetition, "I want to go home", fear/pain words) — weighted higher in the evening "sundowning" window — and when a smoothed score crosses a threshold, **silently** steer the persona into validation-therapy calm-mode (slower, shorter, low-arousal, validate-the-feeling, redirect to a care-plan comfort topic) and slow the TTS. No clinical UI is shown to the patient. Sustained distress raises a gentle caregiver flag.

---

## Implementation plan

### Part A — Mic prosody signal (frontend, no new deps)
1. New module `frontend/src/lib/prosody.js`: open a SECOND `getUserMedia({audio})` → `AudioContext` → `AnalyserNode` (do NOT reuse the TTS analyser in `audiolevel.js`; that one is output). Export `startProsody()` / `stopProsody()` / `getProsody()` returning a smoothed `{ rms, pitchHz, pitchVar, speechRate, longPauseRatio }` from time/frequency data (pitch via autocorrelation; rate/pauses from voiced-energy gating). Fast-attack/slow-release smoothing like `audiolevel.js::getMouthSignal`.
2. Start prosody capture only in **callMode** (and stop on `endCall`); reuse the existing mic permission flow. Never record/store raw audio — features only.

### Part B — Distress scoring (frontend)
1. New `frontend/src/lib/distress.js`: `scoreDistress({ prosody, text, lastSpoken, history, lang, hour })` → `0..1`. Combine: prosody (high pitch/jitter/volume, anxious pauses), content keywords/repetition (multilingual: English + Hinglish + Devanagari sets), and a **sundowning multiplier** when `hour` is in the evening window (derive from `settings.TIMEZONE` via the server clock or local time). Keep a rolling buffer; require **hysteresis + a cooldown** so a normal lively chat never trips it.
2. In `AvatarPage.jsx`, compute the score each turn (in `runTurn`, using the latest prosody + the user's text + `messagesRef`). Maintain `distressRef` (0..1) and a `calmMode` boolean with enter/exit thresholds (e.g. enter >0.6 for 2 turns, exit <0.35).

### Part C — De-escalation (persona + voice)
1. `app/services/llm_service.py::chat_as_persona` — add an optional `distress: float = 0.0` (or `mood: str = None`) param. When high, append a directive AFTER the care-plan block (so it wins): *"The person seems anxious/distressed right now. Reply in 1 short, slow, reassuring sentence. Validate the feeling — never argue with or correct them, never quiz. Gently redirect to a comforting shared topic. Avoid anything on the avoid-list."* Pull a comfort topic from `persona.carePlan.comfortTopics`.
2. `app/api/persona_endpoint.py::/persona/chat` — accept an optional `distress` field in the payload and pass it to `chat_as_persona`. (Backward compatible — default 0.)
3. In `AvatarPage.jsx::runTurn`, include `distress: distressRef.current` in the `/persona/chat` body, and when `calmMode` is on, pass a slower `rate` (e.g. `rate: "-18%"`) into `speak()`/`/tts`.

### Part D — Gentle caregiver flag (lightweight; full SOS is a separate feature)
1. Persist a distress episode (timestamp, peak score, trigger snippet) into the client store (`frontend/src/lib/store.js`, add `distressLog: []` to `defaultState`, additive). If the user is signed in (accounts exist via `app/api/auth_endpoint.py` + `/state`), it rides along in the synced `UserState.data`.
2. On SUSTAINED distress (e.g. calmMode held > N turns), surface a calm, NON-alarming caregiver note via the existing `toast()`/Feedback channel and (optional) a flag the WellbeingInsights panel reads. Do NOT alarm the patient.

## Data contract
- `/persona/chat` body gains: `"distress": 0.0..1.0` (optional).
- `store.distressLog[]` item: `{ "ts": ISO, "peak": 0..1, "trigger": "short snippet", "calmMode": true }`.

## Acceptance criteria
- [ ] In a live call, simulated agitation (raised/anxious voice + "I want to go home" / repeated questions) flips `calmMode` within ~2 turns; the persona's next reply is visibly shorter, warmer, validating, and redirects to a comfort topic; the TTS is slower.
- [ ] A normal upbeat conversation does NOT trip calm-mode (hysteresis + cooldown verified).
- [ ] `/persona/chat` still works with no `distress` field (defaults to calm behavior). Existing chat/voice/clone flows unchanged.
- [ ] Multilingual: Hindi/Hinglish distress cues are detected; calm replies stay in the persona's language.
- [ ] No raw audio is recorded; only derived features. Mic analyser is separate from the TTS analyser and stops on `endCall`.
- [ ] A sustained episode writes a `distressLog` entry and a gentle caregiver note — never an alarm to the patient.

## Constraints / do not break
- Reuse `chat_as_persona`'s care-plan-last ordering; the distress directive must be appended AFTER it. Keep `style`, temporal grounding, memories, and language rules intact.
- Phase 1 uses NO new heavy deps (no MediaPipe). Facial affect via `@mediapipe/tasks-vision` is an explicit Phase 2 add only if requested.
- Keep the single localStorage key and the existing store API; only ADD `distressLog`.
- Keep the voice seam untouched (`voice_clone_service.py` routing) — only pass `rate` through `/tts`.
- Calm, dementia-safe, invisible-to-patient by default. No flashing, no scary copy.

## Out of scope
- Facial-affect sensing (MediaPipe) — Phase 2.
- The full tiered SOS escalation ladder — separate feature; here only a gentle local flag.
- Server-side ML; scoring is lightweight rules on-device + the existing Groq call.
