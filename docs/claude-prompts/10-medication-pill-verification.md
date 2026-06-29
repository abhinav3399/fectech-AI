# Feature: Medication pill verification by camera

## 1. Context (verified by reading the repo)
- **Project:** Factech AI — AI memory companion for dementia/Alzheimer's patients. Backend = FastAPI (entry `app/main.py`, routers mounted under `settings.API_V1_STR` = `/api/v1`). Frontend = React 19 + Vite in `frontend/`.
- **Object recognition flow already exists** and is the template to reuse:
  - `app/api/endpoints.py` → `POST /remember/object` (lines 251–291): accepts `name`, `notes`, `file`; calls `object_service.generate_embedding(path)`, `encode_image_base64(path)`, then `memory_service.store_object_memory(object_id, embedding, metadata)`.
  - `app/api/endpoints.py` → `POST /find/object` (lines 293–390): saves temp file, `object_service.generate_embedding(...)`, `memory_service.search_object(embedding)`, returns `{"status":"identified", "object":{...}}` when `matches[0].score > 0.6`, else falls back to YOLO `object_service.detect_objects(...)` auto-enroll, else `{"status":"unknown","object":null}`. **Note its threshold is 0.6 and it auto-enrolls unknowns — we must NOT copy that auto-enroll behavior for medication (safety).**
- **`app/services/object_service.py`** — global `detector = ObjectDetector()`. `generate_embedding(image_path)` returns a **1280-d** MobileNetV2 (`include_top=False, pooling='avg'`) embedding (list of floats). `detect_objects(image_path)` returns YOLOv8n `[{object, confidence, box}]`.
- **`app/services/memory_service.py`** — `memory_service` reuses the ONE shared client (`self.client = qdrant_client` from `app/core/db.py`). `_ensure_collections()` (lines 14–40) creates `faces` (512), `objects` (1280, COSINE), `patients` (512). `store_object_memory(object_id, embedding, metadata)` upserts into `objects` with payload `{"object_id": ..., **metadata, "timestamp": iso}`. `search_object(embedding, limit=1)` → `query_points(collection_name="objects", query=embedding, limit=...).points`.
- **ONE shared Qdrant client** lives in `app/core/db.py` (`qdrant_client`). Embedded Qdrant locks its folder per-client — NEVER construct a second `QdrantClient`. Any new collection must be created via `memory_service.client` / `qdrant_client`.
- **TTS:** `POST /tts` in `app/api/persona_endpoint.py` (lines 77–107). Body = `{ text, voice?, clone_voice_id?, rate? }`; returns `{"status":"ok","audio_base64": <mp3>, "mime":"audio/mpeg"}`. Frontend plays it via `new Audio(`data:audio/mpeg;base64,${audio_base64}`)` — see `AvatarPage.jsx` lines 144–158 and `PersonaEditor.jsx` lines 69–72. `tts_service.synthesize(text, voice, rate)` underneath returns base64 MP3.
- **Camera UI** patterns to copy:
  - `frontend/src/components/FaceRecognition.jsx` — full modal: getUserMedia, `captureFromVideo()` → `canvas.toDataURL('image/jpeg', 0.9)`, `dataUrlToBlob(dataUrl)` helper (lines 7–14), `FormData().append('file', blob, 'face.jpg')`, `axios.post(`${API_BASE}/...`)`, staged UI (`camera | working | result | enroll | done`), inline `<style>` dark theme (`#1e293b`, violet→blue gradient `#7c3aed`→`#2563eb`). **This is the closest template — clone its structure.**
  - `frontend/src/components/CameraView.jsx` — simpler `onCapture(blob)` via `canvas.toBlob(...)`.
  - `const API_BASE = import.meta.env.VITE_API_BASE || '/api/v1';` (top of both face components).
- **Reminders / medication store** — `frontend/src/lib/store.js`: `reminders[]` items = `{ id, title, time, type, lastFired }`, `type ∈ medication|meal|appointment|general` (see `Reminders.jsx` `TYPES`, lines 5–10). `addReminder({title,time,type})`. localStorage key = `factech_state_v1`; default shape merged via `{ ...defaultState, ...JSON.parse(raw) }` so adding keys is back-compatible.
- **Multilingual:** `persona.language ∈ English | Hindi | Hinglish`. Frontend maps to TTS lang `hi-IN` vs `en-US` (`AvatarPage.jsx` line 47, `App.jsx` lines 38–43). Preserve this.

## 2. Goal
Let a **caregiver enroll** each medication once (photo + name + dose + schedule time), then let the **patient point the camera at a pill/box** and get a clear, safe confirmation: *"Yes — that's your 9 AM blue tablet"* spoken aloud, OR a firm fallback *"I don't recognize this — please check with your caregiver."* It must **never falsely confirm**: use a high confidence threshold and a clear unknown/unsafe path. Reuse the existing object-embedding + Qdrant flow via a **dedicated `medications` Qdrant collection** (justified below), and tie matches into the existing `type:'medication'` reminders.

---

## 3. Implementation plan

### A. Backend — new `medications` Qdrant collection (justify + create)
1. **Decision: use a dedicated `medications` collection, NOT the shared `objects` collection.** Justification: (a) `/find/object` (lines 336–369) **auto-enrolls** unknown YOLO detections and uses a permissive 0.6 threshold — acceptable for "find my glasses" but **dangerous for medication** (a false positive could confirm the wrong pill). A separate collection isolates meds from that behavior and from noise in `objects`. (b) Medication needs extra payload (`dose`, `schedule_time`, `appearance`) and a stricter, independent threshold. (c) Same 1280-d MobileNetV2 embedding, so it reuses `object_service.generate_embedding(...)` with zero new model cost.
2. **`app/services/memory_service.py`** — in `_ensure_collections()` add (mirroring the `objects` block, lines 24–31):
   ```python
   try:
       self.client.get_collection("medications")
   except Exception:
       self.client.recreate_collection(
           collection_name="medications",
           vectors_config=VectorParams(size=1280, distance=Distance.COSINE),
       )
   ```
   Add two methods next to `store_object_memory` / `search_object`:
   ```python
   def store_medication_memory(self, med_id: str, embedding: list, metadata: dict):
       from datetime import datetime
       point_id = str(uuid.uuid4())
       metadata.setdefault("timestamp", datetime.now().isoformat())
       self.client.upsert(collection_name="medications",
           points=[PointStruct(id=point_id, vector=embedding, payload={"med_id": med_id, **metadata})], wait=True)
       return point_id

   def search_medication(self, embedding: list, limit=3):
       return self.client.query_points(collection_name="medications", query=embedding, limit=limit).points
   ```
   Use **limit=3** so we can apply a margin check (top-1 must clearly beat top-2). Reuse the shared `self.client` only — do not import/construct a client.

### B. Backend — new endpoints in `app/api/endpoints.py` (reuse `object_service` + `memory_service` + `encode_image_base64`)
3. **`POST /medication/enroll`** (caregiver). Mirror `remember_object` (lines 251–291):
   - **Form fields:** `name: str = Form(...)`, `dose: str = Form(...)`, `schedule_time: str = Form(...)` (HH:MM), `appearance: str = Form(None)` (e.g. "blue round tablet"), `notes: str = Form(None)`, `file: UploadFile = File(...)`.
   - Save temp file → `embedding = object_service.generate_embedding(str(temp_path))` → `img_b64 = encode_image_base64(str(temp_path))` → `memory_service.store_medication_memory(med_id=str(uuid4()), embedding, metadata={...})` with the payload in §4. Always `finally: temp_path.unlink()`.
   - **Response:** `{"status":"stored","medication":{"med_id","name","dose","schedule_time"}}`.
4. **`POST /medication/verify`** (patient). Mirror `find_object` (lines 293–390) **but with the safe, stricter logic — do NOT auto-enroll**:
   - Save temp file → `embedding = object_service.generate_embedding(str(temp_path))` → `matches = memory_service.search_medication(embedding, limit=3)`.
   - **Confidence gate (high, with margin):** confirm ONLY if `matches and matches[0].score >= MED_MATCH_THRESHOLD (= 0.85)` **AND** (only one match OR `matches[0].score - matches[1].score >= MED_MARGIN (= 0.06)`). Define both constants at top of file with a comment that they are safety-critical.
   - **Confirmed →** build a localized confirmation line (see §B.6) and return:
     ```json
     {"status":"confirmed","medication":{"med_id","name","dose","schedule_time","appearance","image"},"confidence":0.91,"spoken":"Yes — that's your Aspirin, the 9 AM blue tablet.","schedule_match":{"due_now":true,"reminderHint":"9:00 AM"}}
     ```
   - **Not confirmed (low score, no margin, or no matches) →** return the **unsafe/unknown** path (NEVER guess a name):
     ```json
     {"status":"unrecognized","medication":null,"confidence":<top score or 0>,"spoken":"I'm not sure about this one. Please check with your caregiver before taking it."}
     ```
   - Always `finally: temp_path.unlink()`. Wrap in try/except → `HTTPException(500)` like the existing handlers.
5. **Optional cross-check against today's schedule (server-side, best-effort):** accept an optional `now_hhmm: str = Form(None)` (frontend passes the device clock). If provided and the matched med's `schedule_time` is within ±60 min, set `schedule_match.due_now = true` and append a gentle nudge to `spoken` ("It's about time for it."). If it's clearly the wrong time, set `due_now=false` and add a soft caution ("But it's not due until 9 AM — please check with your caregiver."). **Never block** — this is informational only. Keep it simple (string HH:MM diff); no timezone libs.
6. **Spoken text is built server-side AND localized.** Accept `lang: str = Form("en-US")` on `/medication/verify`. For `hi-IN`, return Hindi `spoken` copy; otherwise English. Keep templates short and warm. (The frontend will POST this `spoken` text to `/tts`; do NOT call TTS from these endpoints — keep them stateless, matching how the codebase leaves `tts_service.speak` commented out in `endpoints.py`.)

### C. Frontend — caregiver "Enroll medication" flow
7. **New component `frontend/src/components/MedicationEnroll.jsx`** (modal, clone `FaceRecognition.jsx` structure + its inline `<style>` dark theme and `dataUrlToBlob` helper):
   - Stages: `camera | review | form | working | done`. Capture photo via getUserMedia + `canvas.toDataURL`, OR an **Upload** fallback button (like `FaceRecognition.onUpload`).
   - Form inputs: **Name** (text), **Dose** (text, e.g. "1 tablet / 75 mg"), **Schedule time** (`<input type="time">`, default `09:00`), **Appearance** (text, optional, e.g. "blue round tablet").
   - On save: `FormData` with `name,dose,schedule_time,appearance,notes,file(blob)` → `axios.post(`${API_BASE}/medication/enroll`, fd, {timeout:40000})`. On `status:'stored'` show a confirmation and **offer to also add a matching `type:'medication'` reminder** by calling `addReminder({ title: name, time: schedule_time, type: 'medication' })` from `store.js` (one tap, so enrollment and the reminder stay in sync).
   - Surface this in the caregiver/Reminders area — add an **"Enroll medication (photo)"** button near the Reminders add form (`frontend/src/components/Reminders.jsx`) or wherever object/face enrollment is launched. Reuse `lucide-react` `Pill` / `Camera` icons.

### D. Frontend — patient "Check my medicine" flow
8. **New component `frontend/src/components/MedicationCheck.jsx`** (modal, clone `FaceRecognition.jsx`):
   - Big friendly title "Is this my medicine?". Camera + capture (and Upload fallback). On capture: `FormData` with `file(blob)`, `lang` (mapped from `persona.language` → `hi-IN`/`en-US`), and `now_hhmm` (device `HH:MM`). `axios.post(`${API_BASE}/medication/verify`, fd, {timeout:40000})`.
   - **`status:'confirmed'`** → green/positive card: med name, dose, "9 AM blue tablet", thumbnail (`medication.image`), and the `confidence` as `match XX%`. Then **speak** `r.data.spoken` by POSTing it to `/tts` and playing the returned MP3 (copy the `new Audio('data:audio/mpeg;base64,'+audio_base64)` pattern from `AvatarPage.jsx` lines 144–158; fall back to `window.speechSynthesis` with the right `lang` if TTS is down).
   - **`status:'unrecognized'`** → a clearly different **caution** card (amber/red, not green): show the `spoken` warning prominently and a "Show caregiver" hint. Speak the same warning. **Do NOT display any guessed medication name.**
   - Add a patient-facing **"Check my medicine"** button (camera/pill icon) on `HomeView.jsx` next to existing camera actions.

---

## 4. Data contract (be exact)

- **`POST /medication/enroll` request (multipart/form-data):** `name` (str, required), `dose` (str, required), `schedule_time` (str `HH:MM`, required), `appearance` (str, optional), `notes` (str, optional), `file` (image, required).
- **Qdrant `medications` collection:** vector = 1280-d MobileNetV2, distance COSINE. **Point payload:**
  ```json
  {
    "med_id": "uuid",
    "name": "Aspirin",
    "dose": "1 tablet (75 mg)",
    "schedule_time": "09:00",
    "appearance": "blue round tablet",
    "type": "medication",
    "notes": "Take with food.",
    "image_base64": "data:image/jpeg;base64,...",
    "timestamp": "ISO-8601"
  }
  ```
- **`POST /medication/verify` request (multipart/form-data):** `file` (image, required), `lang` (str, default `en-US`), `now_hhmm` (str `HH:MM`, optional).
- **`/medication/verify` response (confirmed):**
  ```json
  { "status": "confirmed",
    "medication": { "med_id":"uuid","name":"Aspirin","dose":"1 tablet (75 mg)","schedule_time":"09:00","appearance":"blue round tablet","image":"data:image/jpeg;base64,..." },
    "confidence": 0.91,
    "spoken": "Yes — that's your Aspirin, the 9 AM blue tablet.",
    "schedule_match": { "due_now": true, "reminderHint": "9:00 AM" } }
  ```
- **`/medication/verify` response (unrecognized / unsafe):**
  ```json
  { "status":"unrecognized", "medication": null, "confidence": 0.42,
    "spoken": "I'm not sure about this one. Please check with your caregiver before taking it." }
  ```
- **Safety constants (top of `app/api/endpoints.py`):** `MED_MATCH_THRESHOLD = 0.85`, `MED_MARGIN = 0.06`. (Note in a comment: deliberately stricter than `/find/object`'s 0.6 because false confirmation is a safety risk.)
- **Store keys (`frontend/src/lib/store.js`):** **no new top-level key required** — reuse `reminders[]` with `type:'medication'`. Enrollment optionally calls existing `addReminder({title:name, time:schedule_time, type:'medication'})`. (If you later want a med catalog on the client, add an additive `medications: []` to `defaultState` — but it is NOT required; Qdrant is the source of truth for enrolled meds.)
- **localStorage:** keep the single key `factech_state_v1`; back-compat merge handles any additive change.

---

## 5. Acceptance criteria + manual test path
- [ ] Backend boots; `GET /api/v1/openapi.json` lists `POST /medication/enroll` and `POST /medication/verify`. The `medications` collection is created via the **shared** client (no "Storage folder already accessed" error).
- [ ] **Enroll:** Caregiver opens "Enroll medication", photographs a pill/box, enters Name="Aspirin", Dose, Time=09:00, Appearance="blue round tablet", saves → `{"status":"stored"}` and (if accepted) a `type:'medication'` reminder appears in `Reminders.jsx`.
- [ ] **Confirm (same pill):** Patient opens "Check my medicine", points at the *same* medication → `status:"confirmed"`, correct name/dose, `confidence >= 0.85`, and the device **speaks** "Yes — that's your Aspirin…".
- [ ] **Reject (different/unknown item):** point at a random object (or a different pill) → `status:"unrecognized"`, **no medication name shown**, amber/red caution card, and it **speaks** "…please check with your caregiver." (i.e. it does NOT falsely confirm).
- [ ] **Schedule cross-check:** with `now_hhmm` near 09:00, confirmed response has `schedule_match.due_now=true` and a "time for it" nudge; far from 09:00 → `due_now=false` with a soft caution. Never blocks.
- [ ] **Multilingual:** a Hindi/Hinglish persona yields Hindi `spoken` copy and the audio plays in `hi-IN` (cloned/neural via `/tts`, with `speechSynthesis` fallback).
- [ ] **Existing endpoints untouched:** `/recognize/person`, `/remember/person`, `/remember/patient`, `/remember/object`, `/find/object`, `/tts` all still work; `objects` collection behavior unchanged.
- [ ] **Manual path:** start backend (`uvicorn app.main:app --port 8010`) + `cd frontend && npm run dev`; enroll one med; verify the same med (confirmed) and a wrong item (unrecognized); confirm spoken output in both English and Hindi personas.

---

## 6. Constraints / do not break (SAFETY-CRITICAL)
- **NEVER falsely confirm.** High threshold (`MED_MATCH_THRESHOLD = 0.85`) **plus** a top-1-vs-top-2 margin (`MED_MARGIN = 0.06`). When in doubt → `unrecognized` with the "ask your caregiver" message. **Do NOT auto-enroll or YOLO-guess** on the verify path (unlike `/find/object`). Never display a guessed name on the reject path.
- **Reuse the shared `qdrant_client`** from `app/core/db.py` via `memory_service.client`. Never construct a second `QdrantClient` (embedded mode locks the folder).
- **Reuse existing services:** `object_service.generate_embedding` (1280-d), `encode_image_base64`, `memory_service`. Do not add a new embedding model.
- **Keep all existing endpoints and the `objects` collection intact**; only ADD the two medication endpoints + the `medications` collection + the two memory_service methods.
- **Multilingual** via `persona.language` → `hi-IN`/`en-US`; speak through the existing `/tts` endpoint (server returns base64 MP3; play with `new Audio(...)`, fall back to `speechSynthesis`).
- **Frontend conventions:** API base `import.meta.env.VITE_API_BASE || '/api/v1'`; dark theme via inline `<style>` blocks (`#1e293b`/`#0f172a`, violet→blue `#7c3aed`→`#2563eb`); large dementia-friendly tap targets; `lucide-react` icons (`Pill`, `Camera`). Clone `FaceRecognition.jsx` structure.
- **No hardcoded secrets.** No API keys in code; nothing new needed here (reuses existing services/config).
- Keep the single `localStorage` key `factech_state_v1` and the existing store API; only additively extend if needed.
- Endpoints stay **stateless** re: audio — they return `spoken` text; the frontend calls `/tts`. (Matches how `endpoints.py` leaves `tts_service.speak` commented out.)

## 7. Out of scope
- **No medical/clinical claims, no dosing advice, no drug-interaction checks.** The app confirms *visual identity of an enrolled item* only; the spoken copy must say "check with your caregiver", never "safe to take".
- **No OCR of printed labels and no external drug databases** (no RxNorm/NDC lookups, no reading blister-pack text). Matching is purely against caregiver-enrolled photos.
- No pill-count / "did you actually swallow it" adherence proof (that's Feature #03's adherence loop — this feature may *create* a `type:'medication'` reminder but does not implement the Taken/Snooze/Skip logging).
- No real auth / multi-user (single-user kiosk model, as elsewhere).
- No fine-grained per-pill cropping/segmentation beyond the existing full-image MobileNetV2 embedding (good enough when the medication dominates the frame; note this in a code comment).
