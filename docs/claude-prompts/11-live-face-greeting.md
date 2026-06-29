# 11 — Live "Who is this?" with a warm greeting

## 1. Context (verified by reading the repo)

Project: **Factech AI** — AI memory companion for dementia/Alzheimer's patients. FastAPI backend + React/Vite frontend; client-only state (`localStorage`), shared embedded Qdrant.

Verified facts (cite these — don't re-derive):

- **Backend recognition endpoint** `app/api/endpoints.py` → `POST /recognize/person` (line ~38). Accepts `file: UploadFile`. Pipeline: save temp → `face_service.generate_embedding(str(temp_path))` → `memory_service.search_face(embedding)` → if best match `score > 0.4` returns:
  ```json
  { "status": "identified",
    "person": { "name", "relation", "confidence", "id", "notes", "image", "audio" } }
  ```
  Otherwise `{ "status": "no_face_detected", "person": null }` or `{ "status": "unknown", "person": null }`. The `# background_tasks.add_task(tts_service.speak, ...)` line is **commented out** — the server does NOT speak; the browser does.
- **Face embedding** `app/services/face_service.py` → `face_service.generate_embedding(image_path)` uses OpenCV Haar cascade + Keras-FaceNet (512-dim), returns `[]` when no face is found. No new model is needed.
- **Memory search** `app/services/memory_service.py` → `memory_service.search_face(embedding, limit=1)` queries **both** `faces` and `patients` collections and merges by score. Reuses the **single shared `qdrant_client`** from `app/core/db.py` (embedded Qdrant locks its folder per-client — never make a second client).
- **Episodic memory (optional enrichment)** `app/services/episodic_memory.py` → `episodic_memory.retrieve(user: dict, query: str, limit=4) -> list[str]` returns top-K durable facts for a user; fail-soft `[]`. Reuses the shared client + the all-MiniLM encoder.
- **TTS endpoint** `app/api/persona_endpoint.py` → `POST /tts` body `{ text, voice, clone_voice_id, rate? }` → `{ status, audio_base64, mime: "audio/mpeg", cloned }`. Backed by `app/services/tts_service.py` `synthesize(text, voice, rate)` (edge-tts → base64 MP3; default `rate="-8%"` for calmer delivery).
- **Frontend one-shot UI** `frontend/src/components/FaceRecognition.jsx`. Today it is **manual**: opens camera (`getUserMedia({ video:{facingMode:'user'} })`), user presses **Capture** → `captureFromVideo()` (canvas `toDataURL('image/jpeg',0.9)`) → `recognize(dataUrl)` POSTs `FormData` (`file`, via `dataUrlToBlob`) to `${API_BASE}/recognize/person`. `stage` machine: `camera | working | result | enroll | done`. **`recognize()` calls `stopStream()` on entry** (one-shot kills the camera). Dark inline `<style>` theme. `API_BASE = import.meta.env.VITE_API_BASE || '/api/v1'`. Opened from HomeView "Who is this?" tile; `onClose` prop tears it down.
- **Single-voice speak discipline** — established in `frontend/src/pages/AvatarPage.jsx` `speak()` (line ~122): a `speakIdRef` single-flight token (`const myId = ++speakIdRef.current`), pause+detach the prior `Audio` (`audioRef.current.pause(); onended=null; onerror=null`), `window.speechSynthesis.cancel()`, POST `/tts` with `{ text, voice: persona.voiceId, clone_voice_id: persona.voiceCloneId }`, play `new Audio('data:audio/mpeg;base64,'+audio_base64)`, and **bail on every await if `speakIdRef.current !== myId`**. Browser `speechSynthesis` is the fallback when TTS is down. **Reuse this exact discipline** — never let two clips overlap.
- **Multilingual** comes from `persona.language` (`store.js` → `persona`). Mapping already used in `AvatarPage.jsx`: `hindi`/`hinglish` → `ttsLang = 'hi-IN'`, else `en-IN`/`en-US`. Greetings are templated per language (see AvatarPage line ~74).
- **Store** `frontend/src/lib/store.js` → `useAppState()` exposes `{ profile, persona, ... }`. `profile.name` may exist (used as episodic `user`).

## 2. Goal

Upgrade `FaceRecognition.jsx` from a one-shot snapshot into a **continuous live mode**: the camera periodically grabs a frame, recognizes who's in front, and **when a known person appears the companion auto-announces them warmly out loud** — name + relationship + one shared memory/note ("This is your daughter Priya. She loves the garden.") — **without the patient pressing anything**. Debounce so the same person isn't greeted repeatedly. Manual Capture / Upload / Enroll stay available.

## 3. Implementation plan

All changes are **frontend-only** in `frontend/src/components/FaceRecognition.jsx` (plus an optional tiny backend enrichment in §4). Do not touch the face model or the embedding pipeline.

### 1. Add a "Live" mode toggle + state
- Add `const [live, setLive] = useState(true)` (default ON when opened — this is the new behavior) and a UI toggle in `.fr-head` (e.g. a small "Live"/"Pause" pill button).
- Add a scan status state: `const [scanStatus, setScanStatus] = useState('idle')` with values `idle | scanning | recognised | unknown`.
- Refs for the loop and debounce (refs, not state, so the interval reads fresh values without re-subscribing):
  - `const scanTimerRef = useRef(null)` — the `setInterval` id.
  - `const inFlightRef = useRef(false)` — true while a `/recognize/person` request is awaiting (skip overlapping scans).
  - `const greetedRef = useRef(new Map())` — `personKey -> lastGreetedEpochMs` for per-person cooldown.
  - `const speakIdRef = useRef(0)` and `const audioRef = useRef(null)` — single-flight speak (copy from AvatarPage).

### 2. Live-capture loop (every ~2.5s grab a frame → POST)
- Start the loop only when `live === true`, `ready === true` (camera metadata loaded), the stream is alive, and we're on a camera stage (not mid-enroll). Tear it down otherwise.
  ```js
  useEffect(() => {
    if (!live || !ready) return;
    const tick = async () => {
      if (inFlightRef.current) return;            // don't stack requests
      if (document.hidden) return;                // pause when tab/app backgrounded
      const dataUrl = captureFromVideo();         // REUSE existing helper
      if (!dataUrl) return;
      await scanFrame(dataUrl);
    };
    scanTimerRef.current = setInterval(tick, 2500); // throttle: ~2.5s
    return () => { clearInterval(scanTimerRef.current); scanTimerRef.current = null; };
  }, [live, ready]);
  ```
- **Critical:** the live loop must **NOT call `stopStream()`** — the existing `recognize()` kills the camera, which is correct for one-shot but wrong for live. Write a **separate** `scanFrame(dataUrl)` that keeps the camera running (see step 4). Leave the manual `recognize()`/`capture()`/`onUpload()` paths exactly as they are (they still stop the stream and switch to `result`/`enroll`).

### 3. Per-person debounce / cooldown (greet at most once per N minutes)
- Define `const GREET_COOLDOWN_MS = 3 * 60 * 1000;` (3 minutes — tune via a const, no magic numbers).
- Build a stable `personKey` from the response: prefer `person.id`, else `person.name` (e.g. `const key = person.id || person.name;`).
- Before greeting: `const last = greetedRef.current.get(key) || 0; if (Date.now() - last < GREET_COOLDOWN_MS) return;` — skip the announcement (but still update the on-screen card). On greet, set `greetedRef.current.set(key, Date.now())`.
- This means: a recognised person is **spoken** at most once per 3 min, even though frames keep scanning every 2.5s.

### 4. `scanFrame()` — recognise without tearing down, then react to status
```js
const scanFrame = async (dataUrl) => {
  inFlightRef.current = true;
  setScanStatus('scanning');
  try {
    const fd = new FormData();
    fd.append('file', dataUrlToBlob(dataUrl), 'face.jpg'); // REUSE existing helpers
    const r = await axios.post(`${API_BASE}/recognize/person`, fd, { timeout: 15000 });
    const d = r.data || {};
    if (d.status === 'identified' && d.person && (d.person.confidence ?? 0) >= CONF_THRESHOLD) {
      setResult(d.person);
      setScanStatus('recognised');
      maybeGreet(d.person);                 // cooldown-gated announcement
    } else {
      setScanStatus(d.status === 'identified' ? 'unknown' : 'unknown'); // low-confidence = unknown
      // do NOT auto-open enroll in live mode (that's a manual action)
    }
  } catch (e) {
    setScanStatus('idle');                   // network blip — silently retry next tick
  } finally {
    inFlightRef.current = false;
  }
};
```
- `const CONF_THRESHOLD = 0.55;` — a frontend gate **stricter than the backend's 0.4** so a fleeting low-confidence match never triggers a wrong, distressing greeting. Tune via const.
- Keep the **15s** timeout (shorter than the one-shot's 40s) so a slow request can't pile up across ticks.

### 5. Build the spoken greeting (name + relation + notes), localized
- Build the line from the verified payload fields, with a per-language template mirroring `AvatarPage.jsx`:
  ```js
  const lang = (persona?.language || '').toLowerCase();
  const rel = person.relation && person.relation !== 'Unknown' ? person.relation : null;
  const note = (person.notes || '').trim();
  let line;
  if (lang === 'hindi') {
    line = rel ? `ये आपके ${rel} ${person.name} हैं।` : `ये ${person.name} हैं।`;
    if (note) line += ` ${note}`;
  } else if (lang === 'hinglish') {
    line = rel ? `Ye aapke ${rel} ${person.name} hain.` : `Ye ${person.name} hain.`;
    if (note) line += ` ${note}`;
  } else {
    line = rel ? `This is your ${rel}, ${person.name}.` : `This is ${person.name}.`;
    if (note) line += ` ${note}`;
  }
  ```
- **Optional enrichment** (do only if cheap and safe): if `note` is empty/generic, fetch one shared memory. Recommended: add a tiny backend helper rather than calling episodic_memory from the browser. In `app/api/endpoints.py` `recognize/person`, when a person is identified, set a new response field `person.memory` by calling `episodic_memory.retrieve({"name": name}, name, limit=1)` (fail-soft to `None`). Then frontend appends `person.memory` to the greeting when `note` is empty. Keep it backward-compatible (new optional field; old clients ignore it). If this adds risk, **skip enrichment** and just use `notes` — that already carries the shared line ("This is X, your Y.").

### 6. Speak via `/tts` — single voice, cancel prior audio
- Copy `speak(text)` from `AvatarPage.jsx` verbatim (the `speakIdRef`/`audioRef` single-flight version), POSTing `{ text, voice: persona?.voiceId, clone_voice_id: persona?.voiceCloneId, rate: '-8%' }` to `${API_BASE}/tts`, playing `audio_base64`, bailing on `speakIdRef.current !== myId` after each await, and falling back to `window.speechSynthesis` (set `u.lang` from the `ttsLang` mapping) when TTS is down.
- `maybeGreet(person)` = cooldown check (§3) → build line (§5) → `speak(line)` → stamp `greetedRef`.

### 7. Clear UI states + camera teardown
- Surface `scanStatus` in `.fr-stage` as an overlay/badge: `scanning` → "Looking around…"; `recognised` → show the existing `.fr-result` card (name / "your {relation}" / notes / match %), reusing current markup; `unknown` → a soft "I don't recognise anyone yet" hint (no enroll auto-popup in live mode). Keep a subtle pulsing dot so the patient sees it's actively watching.
- **Teardown:** extend the existing `close()` and the unmount cleanup to also `clearInterval(scanTimerRef.current)`, stop the `audioRef.current`, and `window.speechSynthesis.cancel()` — in addition to the existing `stopStream()`. Pausing live (toggle off) must clear the interval but may keep the camera preview. Closing must stop everything.
- Manual **Capture**, **Upload**, and **Enroll** flows remain; entering `working/result/enroll` should pause the live loop (guard the `tick` on stage) so manual and live don't fight over the camera.

## 4. Data contract

`POST /recognize/person` is unchanged for the live loop — it already returns everything needed:

| Field | Type | Source | Use |
|---|---|---|---|
| `status` | `"identified" \| "unknown" \| "no_face_detected"` | endpoint | drive `scanStatus` |
| `person.name` | string | payload | greeting + card |
| `person.relation` | string (`"Unknown"` when none) | payload | greeting ("your {relation}") |
| `person.notes` | string | payload | greeting (the shared line) |
| `person.confidence` | number 0–1 | `best_match.score` | **frontend gate ≥ 0.55** |
| `person.id` | string | `person_id` payload | debounce key |
| `person.image` | base64 data-url \| null | `image_base64` | optional card image |
| `person.audio` | base64 \| null | `audio_base64` | (unused here) |

**Optional new field** (only if you implement §5 enrichment): `person.memory: string | null` — one retrieved episodic fact, appended to the greeting when `notes` is empty. Additive and backward-compatible.

## 5. Acceptance criteria + manual test

Acceptance:
- Opening "Who is this?" starts **live scanning automatically** (no button press); a status indicator shows it's watching.
- When an **enrolled** person faces the camera, within a few seconds the companion **speaks** "This is your {relation}, {name}. {notes}" once, and the result card appears.
- The **same** person is **not** re-greeted again for ≥ 3 minutes, even though scanning continues.
- A **different** enrolled person is greeted promptly (separate cooldown).
- **Unknown / no face** → no greeting, status shows "no one recognised yet"; the patient is never told a wrong name (confidence gate).
- **Only one voice** ever plays — a new greeting cancels any in-progress one (no overlap).
- Greeting language follows `persona.language` (Hindi / Hinglish / English).
- Closing the modal (or toggling Pause) stops the camera, the scan interval, and any audio — no leaked tracks or timers.
- Manual **Capture / Upload / Remember** still work exactly as before.

Manual test:
1. `uvicorn app.main:app --reload` and `cd frontend && npm run dev`. Enroll a person (existing "Remember" flow or `/remember/person`). Confirm with `GET /api/v1/debug/names`.
2. Set `persona.language` = English; open "Who is this?". Face the camera → hear "This is your {relation}, {name}…" once. Stay in frame ~30s → not repeated. Leave + return within 3 min → silent; after 3 min → greeted again.
3. Point at an unknown face / empty frame → no greeting, "no one recognised yet".
4. Switch `persona.language` to Hindi/Hinglish → greeting is localized.
5. Trigger two greetings in quick succession (two enrolled faces) → the second cleanly interrupts the first; never two voices at once.
6. Open DevTools Network → confirm `/recognize/person` fires ~every 2.5s and requests do **not** stack (no growing pending queue). Close modal → requests, camera, audio all stop.

## 6. Constraints / do-not-break

- **Reuse** the existing `POST /recognize/person`, `face_service.generate_embedding`, `memory_service.search_face`, and the **single shared `qdrant_client`** — no new endpoint for the loop, no second Qdrant client/model.
- **Don't hammer the backend:** throttle to ~2.5s, skip when a request is in flight (`inFlightRef`), and pause when `document.hidden`. 15s request timeout.
- **Confidence threshold** ≥ 0.55 on the frontend (stricter than backend 0.4) to avoid wrong/distressing greetings.
- **One voice at a time** — reuse the `speakIdRef`/`audioRef` single-flight discipline from `AvatarPage.jsx`; cancel prior `Audio` and `speechSynthesis` before speaking.
- **Multilingual** via `persona.language` (Hindi / Hinglish / English templates), mirroring AvatarPage.
- **Per-person cooldown** (3 min) via `greetedRef` Map keyed by `person.id || person.name`.
- **Dark inline `<style>`** theme — extend the existing `.fr-*` styles; no external CSS, no new component library.
- **No hardcoded secrets**; keep `API_BASE = import.meta.env.VITE_API_BASE || '/api/v1'`.
- Keep the manual one-shot `recognize()` path (which **does** call `stopStream()`) untouched; the live loop uses the separate `scanFrame()` that does **not** stop the stream.
- Clean teardown of interval, stream, and audio on close/pause/unmount — no leaked `getUserMedia` tracks.

## 7. Out of scope

- No new or different face-recognition model (keep OpenCV Haar + Keras-FaceNet).
- No always-on / background surveillance — scanning only runs while the modal is open and live mode is on; closing fully tears it down.
- No server-side audio playback (`tts_service.speak` stays commented out; the browser speaks).
- No changes to enrollment, objects, or the patients/faces schema beyond the optional additive `person.memory` field.
- No new caregiver settings UI for thresholds/cooldowns (consts in the component are fine for now).
