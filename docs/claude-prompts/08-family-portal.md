# 08 — Family Portal: shared updates feed

A paste-ready Claude Code prompt. Build the **family portal** for Factech AI: family members on their own devices send photos / short voice messages / text notes to a paired patient, and the patient's companion shows them in a warm **"From your family"** feed on Home and can narrate them aloud.

---

## 1. Context (verified against the repo — cite these files)

- **Backend = FastAPI.** `app/main.py` builds the app and includes routers with `app.include_router(<r>, prefix=settings.API_V1_STR)` where `settings.API_V1_STR == "/api/v1"` (`app/core/config.py` line 6). Routers live in `app/api/` (e.g. `persona_endpoint.py`), services in `app/services/`. CORS is wide-open (`allow_origins=["*"]`). In prod, the SPA is served from `frontend/dist`; any path starting with `api` is passed through (`app/main.py` lines 43-60).
- **Endpoint style.** `app/api/persona_endpoint.py` defines `router = APIRouter()` with `@router.post(...)` handlers taking `payload: dict = Body(...)` and returning plain dicts. Media already round-trips as **base64**: `/tts` returns `{"audio_base64": ...}` and `/clone-voice` accepts a base64 data-URL audio sample. Reuse this exact pattern — no new conventions.
- **TTS.** `app/services/tts_service.py` exposes `tts_service.synthesize(text, voice=None, rate="-8%") -> base64 mp3 str`. The HTTP surface is `POST /api/v1/tts` with body `{text, voice?, clone_voice_id?, rate?}` → `{status, audio_base64, mime, cloned}` (`persona_endpoint.py` lines 77-107). The frontend already narrates by POSTing to `/tts` and playing the base64 (`frontend/src/pages/AvatarPage.jsx` line 144). **Reuse `/tts` for narration — do not add a new TTS path.**
- **Qdrant.** ONE shared client in `app/core/db.py` (`qdrant_client`). Embedded mode locks the storage folder, so a second client crashes. This feature needs **no** vector search — do **not** import or construct a Qdrant client.
- **Frontend = React (Vite), localStorage-only.** `frontend/src/lib/store.js` is a `useSyncExternalStore` store persisted under key `factech_state_v1` with shape `{ profile, persona, memories[], transcript[], reminders[], insightsHistory[] }`. There is no backend persistence today. `App.jsx` renders `<Onboarding/>` until `profile && persona` exist, then a 3-tab kiosk (home / avatar / memories) via manual `view` state — **no `react-router-dom`**.
- **API base + HTTP client.** Every component uses `axios` (already a dependency) with `const API_BASE = import.meta.env.VITE_API_BASE || '/api/v1';` (e.g. `WellbeingInsights.jsx` line 6, `AvatarPage.jsx` line 9, `PersonaEditor.jsx`). Match this exactly.
- **Multilingual.** Narration language is derived from `persona.language` (`'hindi' | 'hinglish'` → `hi-IN`, else `en-US`) — see `App.jsx` lines 39-44. The companion also picks a `persona.voiceId` neural voice. Honor both.
- **Dark theme.** Every page uses an inline `<style>{`…`}`</style>` block, background `#0f172a`, violet→blue gradients (`linear-gradient(135deg,#7c3aed,#2563eb)`), large tap targets. See `HomeView.jsx` (`.hv-*`) and `MemoriesPage.jsx` (`.mem-*`) — clone this look.
- **Media-capture components already exist.** `frontend/src/components/AudioRecorder.jsx` (`onRecordingComplete(blob)`) and the `fileToDataUrl` image pattern in `MemoriesPage.jsx` (lines 6-11, 21-30). Reuse them for the family composer.

### Dependency on doc 02 (caregiver dashboard) + graceful fallback

`docs/claude-prompts/02-caregiver-dashboard.md` specs (but has **not** built) a SQLite/SQLModel backend with **pairing-code auth**: a `Patient(pairing_code: str, …)` table, `POST /auth/patient/register` → `{patient_id, pairing_code}`, `POST /auth/pair` (caregiver enters the code), and `GET/PUT /patient/{patient_id}/state`. `requirements.txt` has **no** SQLModel yet, so doc 02 is currently **absent**.

This feature must work **either way**:

- **If doc 02's backend exists** (a `Patient`/`PatientState` SQLModel layer with `app/core/database.py` + `get_session`): store family updates in the same SQLite DB (new `FamilyUpdate` table) and resolve a patient by its existing `pairing_code` / `patient_id`.
- **If it does NOT exist** (today's reality): degrade to a **JSON-file store** on the backend (`data/family/<patient_id>.json`) keyed by a self-issued patient id + share code. No SQLModel import required.

Implement a tiny seam (`app/services/family_store.py`) that **prefers SQLModel when importable, else falls back to JSON files** — so the same endpoints work in both worlds and "upgrade" automatically when doc 02 lands.

---

## 2. Goal

Let family members on **other devices** post photos / short voice notes / text to a paired patient, and let the patient's companion **show** those updates in a warm "From your family" feed on Home and **narrate** them aloud ("Look — Priya sent you a photo from the garden"). Must not break the offline kiosk, must be multilingual, must cap media size, and must hold no hardcoded secrets.

---

## 3. Implementation plan (numbered)

### A. Backend — storage seam (`app/services/family_store.py`, new)

1. Create `family_store.py` exposing a small interface used by the router:
   - `ensure_patient(patient_id: str | None, name: str | None) -> dict` → returns/creates a patient record `{patient_id, share_code}`. **If doc 02's SQLModel `Patient` is importable**, reuse its row + `pairing_code` as the `share_code`. **Else** create/lookup a JSON record under `data/family/_patients.json`. `share_code` = 6 uppercase chars `A-Z2-9` (exclude `O/0/I/1`) — match doc 02's pairing-code alphabet so codes are interchangeable.
   - `resolve_patient(code_or_id: str) -> dict | None` → look up a patient by `share_code`/`pairing_code` **or** by `patient_id`. Returns `{patient_id, name}` or `None`.
   - `add_update(patient_id, update: dict) -> dict` → append a `FamilyUpdate` (SQLModel row if present, else a record in `data/family/<patient_id>.json`); set `id` (uuid4), `created_at` (ISO-8601 Z), `seen=False`. Returns the stored update.
   - `list_updates(patient_id, since: str | None = None, limit: int = 50) -> list[dict]` → newest-first; if `since` (ISO) given, only updates strictly after it.
   - `mark_seen(patient_id, update_ids: list[str]) -> int` → set `seen=True`; returns count updated.
   - **Detection helper** `_sqlmodel_available()` → `True` only if `app.core.database` (doc 02) imports cleanly; cache the result. JSON path uses `pathlib` with a `threading.Lock` around read-modify-write so concurrent posts don't clobber. Create `data/family/` on first write.
2. **Do not** import `qdrant_client`. **Do not** construct a second SQLModel engine — if doc 02 exists, reuse *its* `engine`/`get_session`; if not, use JSON files only.

### B. Backend — router (`app/api/family_endpoint.py`, new; mount in `app/main.py`)

3. `router = APIRouter()`, handlers take `payload: dict = Body(...)`, return plain dicts — mirror `persona_endpoint.py`. Register in `app/main.py` alongside the others:
   ```python
   from app.api import family_endpoint
   app.include_router(family_endpoint.router, prefix=settings.API_V1_STR)
   ```
   Keep all existing `include_router` lines and the static / `frontend/dist` mounts untouched.

4. **`POST /family/patient/register`** — patient device self-registers (used only when doc 02's `/auth/patient/register` is absent).
   - Body: `{ "name": "Robert", "patient_id": "<existing-or-null>" }`
   - Resp: `{ "status": "ok", "patient_id": "p_…", "share_code": "AB3K7Z" }`
   - If `patient_id` already exists, return its existing `share_code` (idempotent).

5. **`POST /family/update`** — a family member posts an update for a patient.
   - Body:
     ```json
     {
       "code": "AB3K7Z",
       "from_name": "Priya",
       "kind": "photo",
       "text": "From the garden 🌼",
       "media_base64": "data:image/jpeg;base64,/9j/…",
       "lang": "en"
     }
     ```
     `kind ∈ {"photo","voice","text"}`. `code` is the patient's `share_code`/`pairing_code` **or** raw `patient_id`. `text` optional for photo/voice, required for text. `media_base64` is a data-URL (image or audio); omit for `kind:"text"`.
   - Server: resolve patient via `resolve_patient(code)` → 404-shaped `{"status":"error","message":"Invalid family code"}` if unknown. **Validate `media_base64` size ≤ 5 MB decoded** (reject `{"status":"error","message":"Media too large (max 5 MB)"}`). Sanitize `from_name`/`text` to ≤ 80 / ≤ 500 chars. Store via `add_update`.
   - Resp: `{ "status": "ok", "update": { …stored update without media echoed back, just id/created_at } }`.

6. **`GET /family/feed?patient_id=…&since=…`** — patient device pulls its feed.
   - Query: `patient_id` (required), `since` (optional ISO; for polling only-new). 
   - Resp:
     ```json
     { "status": "ok", "updates": [
       { "id":"u_…", "from_name":"Priya", "kind":"photo",
         "text":"From the garden 🌼", "media_base64":"data:image/jpeg;base64,…",
         "lang":"en", "created_at":"2026-06-14T09:12:00Z", "seen": false } ] }
     ```
     Newest-first, `limit` 50. Include `media_base64` so the companion can render the photo / play the voice inline.

7. **`POST /family/seen`** — mark updates as seen after the companion shows/narrates them.
   - Body: `{ "patient_id": "p_…", "update_ids": ["u_…","u_…"] }`
   - Resp: `{ "status": "ok", "updated": 2 }`

8. **Narration uses the EXISTING `/tts`** — do **not** add a TTS endpoint here. The frontend builds the spoken line and POSTs it to `/api/v1/tts` (section D.5).

### C. Authentication / pairing (reuse doc 02; no new secrets)

9. **Family members do not log in.** They post with the patient's **share code** (the same 6-char `pairing_code` from doc 02). This is intentionally low-friction "light auth" for elderly-care families — a per-patient bearer-ish token good enough for a hackathon, no passwords.
10. **Share-link convenience:** the patient/caregiver can hand out a URL `https://<host>/family/<share_code>` that deep-links the family composer prefilled with the code (frontend route handled by SPA fallback in `app/main.py`; no `react-router-dom` — read the code from `window.location.pathname`). The code in the link **is** the auth; treat it as a capability token.
11. **No hardcoded secrets.** Codes are generated server-side; nothing is committed. If doc 02 later adds real JWT for caregivers, the family share-code path stays independent and unchanged.

### D. Frontend

12. **`store.js` additions** (do **not** change the existing `factech_state_v1` shape; add fields/helpers only):
    - Add `familyUpdates: []` and `family: { patientId: null, shareCode: null }` to `defaultState`.
    - Export `getApiBase()` → `import.meta.env.VITE_API_BASE || '/api/v1'`.
    - Export `setFamilyPairing(patientId, shareCode)` → `set({ family: { patientId, shareCode } })`.
    - Export `mergeFamilyUpdates(incoming)` → de-dupe by `id`, keep newest-first, cap at 50; `set({ familyUpdates })`. Mark which ids are new (return them) so the caller can narrate only those.
    - Export `markFamilyUpdatesSeen(ids)` → flip `seen:true` locally (best-effort POST to `/family/seen` lives in the component, fire-and-forget).
    - Use `axios`; swallow network errors so the offline kiosk still works.
13. **Patient pairing bootstrap.** On first kiosk load, if `family.patientId` is null: if doc 02 already set a `patient_id`/`pairing_code` in onboarding, reuse it; else call `POST /family/patient/register` with `{ name: profile.name }`, then `setFamilyPairing(patient_id, share_code)`. Surface the `share_code` somewhere calm (e.g. a small "Share with family" affordance on Home) so the caregiver can pass it on. Fire-and-forget; never block the kiosk if the backend is down.
14. **"From your family" card on `HomeView.jsx`.** Add a new section (clone the `.hv-recent` look — `HomeView.jsx` lines 73-90):
    - Title "From your family" with a Heart/Users icon; show the latest 3 updates as warm cards (photo thumbnail, ▶ play button for voice, or text bubble) with `from_name` and a relative time.
    - A "See all" button → `onNavigate('family')` (add a `'family'` view to `App.jsx`'s manual switch, same pattern as `avatar`/`memories`).
    - Each card has a small "Read to me" / speaker button that narrates that single update (section D.5).
    - Poll `GET /family/feed?patient_id=…&since=<lastSeenCreatedAt>` every ~30 s while mounted (use `setInterval`, clear on unmount); on new updates call `mergeFamilyUpdates` and, if the companion isn't mid-conversation, auto-narrate the newest one once.
15. **Narrate-aloud helper** (shared util, e.g. `frontend/src/lib/narrate.js`):
    - Build a warm, in-character line by `kind` and language. EN examples: photo → `Look, ${from} sent you a photo${text ? ': ' + text : ''}.`; voice → `${from} recorded a voice message for you. Shall I play it?`; text → `${from} says: ${text}`. Provide Hindi / Hinglish variants selected from `persona.language` (mirror `App.jsx` lines 39-44).
    - POST `{ text: line, voice: persona.voiceId, rate: '-8%' }` to `${getApiBase()}/tts`, then play `audio_base64` (`new Audio('data:audio/mpeg;base64,' + r.data.audio_base64).play()`) — same as `AvatarPage.jsx` line 144. For `kind:"voice"` updates, after the intro line, play the family member's actual recorded `media_base64`.
    - Fall back to `window.speechSynthesis` if `/tts` fails (offline) — `App.jsx` already shows this pattern.
16. **Full feed view `frontend/src/pages/FamilyFeedPage.jsx`** (new): a scrollable list of all `familyUpdates` (photos large, voice with a player, text bubbles), each with sender + time + "Read to me". On open, POST seen ids to `/family/seen` and call `markFamilyUpdatesSeen`. Dark `.ff-*` styles cloning `MemoriesPage.jsx`.
17. **Family composer `frontend/src/pages/FamilyComposer.jsx`** (new, standalone — this is what the family member opens via the share link):
    - Reads the code from the URL path (`/family/:code`) or a manual input.
    - Fields: `from_name`, a kind toggle (Photo / Voice / Text), an image picker (reuse `fileToDataUrl`), an `AudioRecorder` for voice, and a text box. Enforce the 5 MB cap client-side too (show a friendly message).
    - Submit → `POST /family/update`. Success → "Sent 💜 Robert will see this soon." Dark theme, large tap targets, fully multilingual labels (use a tiny strings map keyed by a `?lang=` param, default English).
    - Render this page (instead of the kiosk/onboarding) when `window.location.pathname.startsWith('/family/')`, gated in `App.jsx` **before** the `profile && persona` check — so a family member never sees the patient's kiosk.

---

## 4. Data contract

**FamilyUpdate (stored + returned):**
```json
{
  "id": "u_<uuid4>",
  "patient_id": "p_<uuid4>",
  "from_name": "Priya",
  "kind": "photo | voice | text",
  "text": "From the garden 🌼",
  "media_base64": "data:image/jpeg;base64,…  | data:audio/webm;base64,…  | null",
  "lang": "en | hi | hinglish",
  "created_at": "2026-06-14T09:12:00Z",
  "seen": false
}
```

**Storage location**
- **With doc 02 present:** SQLModel `FamilyUpdate` table in the same SQLite DB (`factech.db`); patient resolved via doc 02's `Patient.pairing_code`. Reuse doc 02's `engine`/`get_session` — never a second engine.
- **Fallback (today):** JSON files under `data/<repo-root>/family/` — `data/family/_patients.json` (`{patient_id, name, share_code}` records) and `data/family/<patient_id>.json` (array of updates). Guard read-modify-write with a `threading.Lock`. Add `data/family/` and `*.db` to `.gitignore`.

**localStorage** (`factech_state_v1`, additive only): new `familyUpdates: []` and `family: { patientId, shareCode }`. Existing keys unchanged.

**Media handling / limits**
- Media travels as a **data-URL base64 string** (consistent with `/tts` and `/clone-voice`).
- **Hard cap: 5 MB decoded** per update, enforced server-side (reject) and client-side (friendly message). Accept images (`image/*`) and audio (`audio/webm`, `audio/mpeg`, `audio/wav`).
- `kind:"text"` has `media_base64: null` and requires non-empty `text`.

**share_code:** 6 chars, alphabet `A-Z2-9` (exclude `O/0/I/1`) — identical to doc 02's pairing code so the two are interchangeable.

---

## 5. Acceptance criteria + manual test path

**Acceptance criteria**
- [ ] `POST /api/v1/family/patient/register` returns a stable `patient_id` + 6-char `share_code`; calling again with the same `patient_id` is idempotent.
- [ ] `POST /api/v1/family/update` with a valid code stores an update and returns `{status:"ok"}`; an invalid code returns a friendly error (not a 500); media > 5 MB is rejected.
- [ ] `GET /api/v1/family/feed?patient_id=…` returns updates newest-first including `media_base64`; `since=<iso>` returns only newer ones.
- [ ] `POST /api/v1/family/seen` flips `seen` and returns the count.
- [ ] HomeView shows a "From your family" card with the latest updates; "See all" opens the full feed; each item can be narrated via `/tts` (and plays the actual voice clip for `kind:"voice"`).
- [ ] Narration language follows `persona.language` (English / Hindi / Hinglish) and uses `persona.voiceId`.
- [ ] All **existing** endpoints (`/voices`, `/persona/chat`, `/tts`, `/evaluate`, `/remember`, `/clone-voice`) and the kiosk still work unchanged.
- [ ] With the backend **down**, the patient kiosk still loads and operates; family-feed errors are swallowed silently.
- [ ] No second Qdrant client; no SQLModel import required for the fallback path; no hardcoded secrets; `data/family/` and `*.db` git-ignored.

**Manual test path (two browsers)**
1. Start backend `uvicorn app.main:app --reload` and `npm run dev` in `frontend/`.
2. **Browser A (patient):** finish onboarding as "Robert" + companion → kiosk loads → note the `share_code` shown under "Share with family" (e.g. `AB3K7Z`).
3. **Browser B (incognito, family):** open `http://localhost:5173/family/AB3K7Z` (or paste the code) → composer appears → enter `from_name: Priya`, pick **Photo**, choose a small image, caption "From the garden 🌼" → Send → see "Sent 💜".
4. **Browser A:** within ~30 s the "From your family" card shows Priya's photo and the companion **says aloud** "Look, Priya sent you a photo: From the garden." Tapping "Read to me" re-narrates. Open "See all" → full feed; items become `seen`.
5. **Browser B:** send a **Voice** note → Browser A shows it; tapping play plays the actual recording after the spoken intro.
6. Switch the companion's `persona.language` to Hindi/Hinglish → narration line switches language. Stop the backend → kiosk still works, no crash.

---

## 6. Constraints / do-not-break

- **Qdrant:** reuse the single `app/core/db.py::qdrant_client` only if you ever need vectors — this feature needs none, so **do not** import or construct any Qdrant client.
- **Keep every existing endpoint** and its request/response shape; only **add** a router + fields. Don't touch the static / `frontend/dist` mounts in `app/main.py`.
- **Reuse `/tts`** for narration; **reuse `AudioRecorder.jsx`** + the `fileToDataUrl` image pattern; **reuse `axios` + `import.meta.env.VITE_API_BASE || '/api/v1'`**.
- **No `react-router-dom`** — keep `App.jsx`'s manual `view`-state switch; read share-link paths from `window.location.pathname`.
- **Multilingual:** narration + composer respect `persona.language` (`hindi`/`hinglish` → `hi-IN`, else `en-US`), matching `App.jsx` lines 39-44.
- **Dark inline-`<style>` theme:** `#0f172a`, violet→blue gradients, large dementia-friendly tap targets — clone `.hv-*` / `.mem-*`.
- **No hardcoded secrets:** codes are server-generated capability tokens; nothing committed. CORS is already `*`.
- **Cap media at 5 MB** (server rejects + client warns). Fail-soft everywhere: a down backend never blocks the kiosk.
- **Build ON doc 02 if present, JSON-file fallback if not** — same endpoints in both worlds; never construct a second SQLModel engine.

---

## 7. Out of scope

- Real family accounts / passwords / OAuth (light share-code "auth" only).
- Two-way chat (patient replying to family), reactions, read-receipts surfaced to family.
- Push notifications / background delivery when the tab is closed.
- Cloud media storage / CDN / thumbnailing / video — base64 images + short audio only, 5 MB cap.
- Building doc 02's caregiver SQLite/JWT layer itself — only consume its pairing code when present.
- Moderation, spam controls, abuse reporting, rate limiting.
- Syncing `familyUpdates` into `memories[]` or the cloud `PatientState` (feed is its own store).
