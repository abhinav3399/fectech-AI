# Factech AI — All Feature Implementation Prompts

Paste-ready prompts for Claude Code (or any agentic coding tool) to implement every
proposed feature, each grounded in the real codebase (verified file paths, function
names, data shapes).

## How to use
1. Open a fresh Claude Code session **in this repo**.
2. Scroll to the feature you want and copy its whole section (from its `## Context`
   heading down to the end of its `## Out of scope`).
3. Paste it as your prompt. Each feature section is self-contained — the shared
   context below is optional extra grounding.
4. Implement one feature at a time.

## Contents
**Core (1–5)**
1. Long-term episodic memory ⭐ (DONE)  ·  2. Caregiver dashboard + cloud sync + auth  ·  3. Reminders + medication adherence (PWA/Push)  ·  4. Daily orientation "Today"  ·  5. One-tap SOS + distress alert

**Conversation quality (6)**
6. Avatar conversation overhaul — one voice, interruptible, non-repetitive (Part A DONE)

**Companion & care (7–16)**
7. Reminiscence / life-story builder  ·  8. Family portal feed  ·  9. Music & nostalgia therapy  ·  10. Medication pill verification  ·  11. Live "Who is this?" greeting  ·  12. Voice journaling  ·  13. Sundowning calm mode  ·  14. Cognitive games  ·  15. Care plan & caregiver notes  ·  16. Health & vitals tracker

> Effort: **S** = hours, **M** = a day or so, **L** = multi-day.
> Suggested order: 1 (done) → 4 → 15 → 9 → 6/Part B → 2 → (8, 16) → the rest.

---

# Shared Project Context (optional preamble)

# PROJECT CONTEXT — Factech AI

> Optional preamble. Each feature prompt is already self-contained (it has its own
> verified context block), so you can paste a feature file on its own — or prepend
> this for extra grounding.

**Mission:** An AI memory companion that helps dementia/Alzheimer's patients reconnect with loved ones through an in-character persona chat.

## Stack
- **Backend:** FastAPI (`app/main.py`). Routers mounted under `settings.API_V1_STR` (e.g. `/api/v1`). Services in `app/services/`, endpoints in `app/api/`, core in `app/core/`.
- **Vector DB:** Qdrant. **ONE shared `qdrant_client` lives in `app/core/db.py` — every service MUST import it; never construct a second client** (embedded mode locks the storage folder).
- **LLM:** Groq (Llama 3.1-8b-instant / 3.3-70b-versatile) in `app/services/llm_service.py` (singleton `llm_service`). Methods: `generate_response` (memory Q&A), `chat_as_persona` (in-character loved-one chat — the heart of the app), `evaluate_conversation` (returns JSON: mood/engagement/topics/concerns/summary/suggestions).
- **TTS:** edge-tts in `tts_service.py`; optional ElevenLabs voice cloning in `voice_clone_service.py`.
- **Frontend:** React + Vite. State is **localStorage-only** (`frontend/src/lib/store.js`, key `factech_state_v1`): `{ profile, persona, memories[], transcript[], reminders[], insightsHistory[] }`. **No backend persistence, no real auth yet** (`LoginPage.jsx` is a stub). API base: `import.meta.env.VITE_API_BASE || '/api/v1'`.

## Files you'll most often touch
- `app/services/llm_service.py` — Groq prompts/methods
- `app/api/persona_endpoint.py` — voices, chat, tts, clone, evaluate
- `frontend/src/lib/store.js` — client state + actions
- `frontend/src/pages/AvatarPage.jsx` — voice/text persona chat
- `frontend/src/pages/HomeView.jsx` — greeting, reminders, insights
- `frontend/src/components/PersonaEditor.jsx` — persona config

## Constraints
- Reuse the shared `qdrant_client` and existing service singletons — no duplicate clients/models.
- Preserve multilingual support: English / Hindi (Devanagari) / Hinglish via `persona.language`.
- Match UX: inline `<style>` blocks, dark theme (`#0f172a` / violet-blue), warm dementia-friendly copy, large tap targets.
- No hardcoded secrets — read keys from `settings` / env.

---

# Feature 1 — Long-term episodic memory for the companion ⭐

> **Status: implemented and adversarially reviewed.** Kept for reference.

## Context (verified by reading the repo)

Project: **Factech AI** — an AI memory companion for dementia/Alzheimer's patients. FastAPI backend + React/Vite frontend; client-only state, no backend persistence yet.

Current behavior I verified:
- `app/services/llm_service.py` → `chat_as_persona(self, user_text, persona, user, history)` builds a system prompt and only feeds `(history or [])[-12:]` (line ~214). It has **no access to anything before the current session**.
- `frontend/src/pages/AvatarPage.jsx` → `runTurn()` (line ~151) sends `history = messagesRef.current.slice(-8)` to `POST {API_BASE}/persona/chat`. The whole chat lives in component `messages` state and is wiped on reload; the persona forgets everything between visits.
- `app/api/persona_endpoint.py` → `POST /persona/chat` (line ~45) reads `text/persona/user/history` and calls `chat_as_persona`. `POST /evaluate` (line ~33) already takes a `transcript` + `persona` + `user` and calls `llm_service.evaluate_conversation(...)` (which returns JSON via Groq with `response_format={"type":"json_object"}`).
- `app/services/semantic_memory.py` already loads `SentenceTransformer('all-MiniLM-L6-v2')` (384-dim) and **reuses the shared `qdrant_client`** from `app/core/db.py`. Collection pattern: `get_collection` in try/except, else `recreate_collection(VectorParams(size=384, distance=Distance.COSINE))`, plus a keyword payload index. Search uses `self.client.query_points(...).points` and returns `match.payload`.
- `app/core/db.py` exposes the **single shared `qdrant_client`** — services MUST reuse it (embedded mode locks the folder per-client).
- `frontend/src/lib/store.js` persists `{ profile, persona, memories, transcript, reminders, insightsHistory }` to `localStorage["factech_state_v1"]`. `profile.name` is set during onboarding (`frontend/src/components/Onboarding.jsx`, `setProfile({ name, age })`). `addTurn(role, text)` appends to `transcript` (capped 300).
- `app/services/conversation_service.py` holds one global context dict (single-user "kiosk" assumption).

## Goal

Give the companion **durable long-term episodic memory**: after each chat session, summarize it into a few embedded "memory facts" stored in Qdrant keyed by user, and at chat time retrieve the top-K relevant facts and inject them into `chat_as_persona`'s system prompt so it can naturally recall prior visits ("yesterday you told me…").

## Implementation plan

### 1. New service: `app/services/episodic_memory.py`
Create `EpisodicMemoryService`, modeled on `semantic_memory.py`:
- **Reuse the existing encoder, do NOT load a second SentenceTransformer.** Import the singleton and reuse its model: `from app.services.semantic_memory import semantic_memory` and use `semantic_memory.encoder`. (Loading all-MiniLM twice wastes RAM/startup.) Also reuse `from app.core.db import qdrant_client` — never construct a new client.
- Collection name: `"episodic_memory"`, `VectorParams(size=384, distance=Distance.COSINE)`. Create it with the same `get_collection`/`recreate_collection` try/except pattern. Create a **keyword payload index on `user_key`** (mirror the `name` index in `semantic_memory.py`).
- Helper `_user_key(user: dict) -> str`: slugify `(user.get("name") or "default").strip().lower()` (spaces→`_`, keep alnum/`_`), fallback `"default"`. This is the per-user scope given today's single-user assumption; it upgrades cleanly the moment `profile.name` exists.
- `def add_memories(self, user: dict, facts: list[str]) -> int`: for each non-empty fact, embed with `semantic_memory.encoder.encode(fact).tolist()`, upsert a `PointStruct(id=str(uuid4()), vector=..., payload={"text": fact, "user_key": _user_key(user), "created_at": datetime.utcnow().isoformat()})`. Return count stored.
- `def retrieve(self, user: dict, query: str, limit: int = 4) -> list[str]`: embed `query`, `query_points(collection_name="episodic_memory", query=emb, query_filter=Filter(must=[FieldCondition(key="user_key", match=MatchValue(value=_user_key(user)))]), limit=limit)`, return `[p.payload["text"] for p in res.points if p.payload.get("text")]`. Guard against empty query (return `[]`).
- Export a module-level singleton `episodic_memory = EpisodicMemoryService()`.
- Wrap Qdrant calls defensively (try/except, log + return safe default) so a memory hiccup never breaks chat.

### 2. New summarizer method on `LLMService` (`app/services/llm_service.py`)
Add `def summarize_session(self, transcript: list, persona: dict = None, user: dict = None) -> list[str]`:
- If `not self.client` or fewer than ~2 non-empty turns → return `[]`.
- Build a transcript string exactly like `evaluate_conversation` does (reuse that `user_name`/`persona_name` + `transcript[-40:]` line-formatting logic).
- Groq call with `response_format={"type":"json_object"}`, model `"llama-3.1-8b-instant"`, low temperature (~0.3). System prompt: *"Extract durable, factual long-term memories about the person from this conversation — things worth remembering for future chats (people/pets they mentioned, events, feelings, preferences, plans, worries). Write each as a short third-person sentence about the person (e.g. 'They visited their daughter Meera on Sunday and felt happy.'). Ignore small talk and greetings. Respond ONLY with JSON: {"facts": [ ...up to 6 strings... ]}. Empty array if nothing durable."*
- Preserve multilingual content: tell the model to **keep facts in the same language the person used** (do not translate Hindi/Hinglish to English).
- Parse JSON, return `result.get("facts", [])[:6]` (strings only, stripped, non-empty). On any error return `[]`.

### 3. Retrieval injection into the chat path (`app/services/llm_service.py`)
- Add an **optional** param to `chat_as_persona`: `memories: list = None` (default `None`) — keep the existing signature backward-compatible (append the param at the end).
- After the persona system prompt is assembled and before appending history, if `memories`: add a block to `system_prompt`, e.g.:
  `"\nThings you remember from your past conversations together (use them naturally, never list them mechanically, and only if relevant): " + " ".join(f"- {m}" for m in memories[:5])`.
- The endpoint (step 4) does the retrieval and passes `memories=` in — do NOT call Qdrant from inside `llm_service` (keep it provider-only; services depending on services stays in the endpoint/service layer like today).

### 4. Endpoints (`app/api/persona_endpoint.py`)
- **Modify `POST /persona/chat`** to retrieve before generating:
  ```python
  from app.services.episodic_memory import episodic_memory
  ...
  mems = episodic_memory.retrieve(user, text, limit=4)  # safe [] on failure
  reply = llm_service.chat_as_persona(text, persona=persona, user=user, history=history, memories=mems)
  ```
  Response stays `{"status":"ok","text": reply}` (unchanged contract).
- **Add `POST /remember`** (end-of-session summarization, kept separate so it can be called on session end without blocking chat):
  - Request JSON: `{ "transcript": [ {"role":"user"|"bot","text":"..."} ... ], "persona": {...}, "user": {"name": "..."} }`
  - Body: `facts = llm_service.summarize_session(transcript, persona, user)`; if `facts`, `stored = episodic_memory.add_memories(user, facts)`.
  - Response: `{ "status":"ok", "stored": <int>, "facts": [...] }`; if nothing to store, `{ "status":"empty", "stored":0, "facts":[] }`.
  - Mirror the `/evaluate` guard: if fewer than 2 non-empty turns, return `{"status":"empty","stored":0,"facts":[]}`.
- No `main.py` change needed — `persona_endpoint.router` is already mounted under `settings.API_V1_STR` (`app/main.py` line ~38).

### 5. Frontend wiring (`frontend/src/pages/AvatarPage.jsx` + `frontend/src/lib/store.js`)
- **`store.js`**: add a small helper `sessionTurns()` that returns the in-session turns to summarize. Simplest correct approach: reuse the existing persisted `transcript` (already populated by `addTurn` in `runTurn`). `export function clearTranscript()` already exists — keep it. No new localStorage key strictly required; if you prefer a marker, add `lastRememberedAt` to the store, but the transcript-based approach is sufficient.
- **`AvatarPage.jsx`**: add `flushSession()` that, when there are ≥2 turns this session, POSTs to `{API_BASE}/remember` with `{ transcript: <current session turns mapped to {role,text}>, persona: {…same fields already sent in runTurn…}, user: { name: profile?.name } }`. Map `role: 'bot'` exactly as the backend expects (it already treats non-`user` as assistant). Fire-and-forget (`.catch(()=>{})`); never block UI.
  - Call `flushSession()` from: (a) the existing page-unmount cleanup `useEffect` (line ~51, the same one that stops mic/speech), and (b) `endCall()` (line ~245) when a live call ends. Debounce so two triggers don't double-summarize the same turns (e.g. track a `rememberedCountRef` of how many transcript turns were already summarized, only send the new tail).
  - Use `navigator.sendBeacon` as a best-effort on unmount if available (page close), else `axios.post`. Keep it resilient.
- Do not change the greeting, proactive-nudge, TTS, or call logic beyond adding the flush hooks.

## Data contract

- **Qdrant collection**: `episodic_memory`, vector size **384**, distance **COSINE**, keyword payload index on `user_key`.
- **Point payload**: `{ "text": string, "user_key": string, "created_at": ISO-8601 string }`.
- **`/remember` request**: `{ "transcript": [{"role":"user"|"bot","text":string}], "persona": object, "user": {"name": string} }`
- **`/remember` response**: `{ "status":"ok"|"empty"|"error", "stored": int, "facts": string[] }`
- **`summarize_session` LLM JSON**: `{ "facts": string[] }` (≤6).
- **`chat_as_persona` new param**: `memories: list[str] | None` (appended to signature; defaults `None`).
- **localStorage**: unchanged key `factech_state_v1`; no shape break. (Optional additive `lastRememberedAt`.)
- **user_key**: slug of `user.name` lowercased; `"default"` when absent.

## Acceptance criteria

- [ ] Starting the backend does **not** load a second SentenceTransformer model (grep: only `semantic_memory.py` calls `SentenceTransformer(...)`); only the shared `qdrant_client` is used (no new `QdrantClient(...)`).
- [ ] On first boot the `episodic_memory` collection auto-creates (384-dim, COSINE) without crashing an existing DB.
- [ ] Manual path: with the app running, open Avatar, tell the persona something memorable across several turns (e.g. "Yesterday my granddaughter Anaya visited and we baked cookies"). Leave the page (or End the call) → a `POST /api/v1/remember` fires and returns `stored ≥ 1` with sensible `facts`.
- [ ] Reload the page / start a new session as the same `profile.name`, ask "do you remember Anaya?" → the reply references the prior memory (because `/persona/chat` injected the retrieved fact). Verify by logging the `mems` passed into `chat_as_persona`.
- [ ] `POST /persona/chat` still returns `{"status":"ok","text":...}` even when the `episodic_memory` collection is empty or Qdrant errors (retrieval failure → `[]`, chat unaffected).
- [ ] Hindi/Hinglish session produces facts in the same language and the recalled memory surfaces in the persona's localized reply (multilingual preserved).
- [ ] `/evaluate`, `/tts`, `/voices`, `/clone-voice`, and existing memory/face endpoints are unchanged and still work.

## Constraints / do not break

- **Reuse the shared `qdrant_client`** (`app/core/db.py`) and the **existing `all-MiniLM-L6-v2` encoder** from `semantic_memory.py`. Do not instantiate a second client or model.
- Keep `chat_as_persona`'s existing behavior identical when `memories` is `None`/empty (backward compatible — frontend old payloads must still work).
- Keep all existing endpoints and response shapes working (`/persona/chat`, `/evaluate`, `/tts`, etc.).
- **Preserve multilingual support** (`persona.language`: english/hindi/hinglish) — never translate stored facts.
- Match existing style: defensive try/except with `print(...)` debug logs (as elsewhere), inline `<style>` blocks + dark theme in JSX, single global service singletons.
- No secrets hardcoded — reuse `settings`/`GROQ_API_KEY` already wired in `LLMService`.
- Memory work must be **fire-and-forget on the frontend**; never block or delay the chat/voice loop. Retrieval must be fast (top-4) and fail-soft.

## Out of scope

- Real multi-user auth / backend session management (still single-user kiosk; `user_key` is the seam for later).
- Memory editing/deletion UI, decay/forgetting, dedup of near-identical facts, or a caregiver "what it remembers" viewer.
- Migrating existing `text_knowledge`, `faces`, `objects`, `patients` collections.
- Switching Qdrant from embedded/local to server, or any infra change.
- Changing the wellbeing `/evaluate` flow or `insightsHistory`.

---

# Feature 2 — Remote caregiver dashboard + cloud sync + light auth

## Context (verified by reading the repo)

Project: **Factech AI** — a FastAPI + React (Vite) AI memory companion for dementia patients. Verified current behavior:

- **All state is client-only.** `frontend/src/lib/store.js` is a `useSyncExternalStore` store persisted to `localStorage` under key `factech_state_v1`. Shape (line 7): `{ profile, persona, memories[], transcript[], reminders[], insightsHistory[] }`. There is **no backend persistence and no auth**. Helpers: `setProfile`, `setPersona`, `addTurn`, `addReminder`, `markReminderFired(id, dayKey)`, `addInsight(ev)` (pushes `{date, mood, engagement}`, capped at 30).
- **No real routing.** `frontend/src/main.jsx` renders `<App/>` directly. `frontend/src/App.jsx` gates on `profile && persona` (line 56): if missing → `<Onboarding/>`, else a 3-tab kiosk (home/avatar/memories). **`frontend/src/pages/LoginPage.jsx` (a role-picker stub), `LandingPage.jsx`, and `CaregiverDashboard.jsx` exist but are orphaned — they are NOT imported anywhere in `App.jsx`/`main.jsx`.** `package.json` has **no `react-router-dom`** (routing is manual state).
- **Wellbeing eval already exists.** `app/services/llm_service.py::evaluate_conversation` (line 73) returns JSON `{mood: 'positive'|'neutral'|'low'|'anxious', engagement: 'high'|'medium'|'low', topics[], concerns[], summary, suggestions[]}`. Exposed at **`POST /evaluate`** in `app/api/persona_endpoint.py` (line 33), mounted under `settings.API_V1_STR` = `/api/v1` (`app/main.py` line 36-39). `frontend/src/components/WellbeingInsights.jsx` calls it and renders a mood-trend bar chart from `insightsHistory`.
- **Reminders carry medication data.** `store.js::addReminder` stores `{id, title, time, type, lastFired}` where `type` can be `'medication'` — this is the hook for adherence. `App.jsx` fires them via `setInterval` only while the tab is open.
- **DB seam.** `app/core/db.py` exposes a single shared `qdrant_client` (embedded mode locks the folder — never construct a second client). `app/core/config.py` `Settings` reads from `.env`. `requirements.txt` has **no** SQLAlchemy/SQLModel/JWT libs yet.

## Goal

Add a minimal SQLite persistence + pairing-code auth layer so a remote family caregiver on a different device can pair to a patient and view that patient's wellbeing trends, flagged concerns, last-active time, and medication adherence — without breaking the existing offline kiosk experience.

## Requirements / Implementation Plan

### A. Backend — dependencies & config

1. Add to `requirements.txt`: `sqlmodel==0.0.22` (pulls SQLAlchemy), `python-jose[cryptography]==3.3.0`, `passlib[bcrypt]==1.7.4`.
2. Extend `app/core/config.py` `Settings` with: `DATABASE_URL: str = "sqlite:///./factech.db"`, `AUTH_SECRET: str = "change-me-in-env"` (override via `.env`; never hardcode a real secret), `ACCESS_TOKEN_TTL_MIN: int = 60*24*30`. Do not touch existing Qdrant fields.

### B. Backend — persistence layer (new files)

3. **Create `app/core/database.py`**: build a SQLModel engine from `settings.DATABASE_URL` (`connect_args={"check_same_thread": False}` for SQLite), expose `engine`, `init_db()` (calls `SQLModel.metadata.create_all(engine)`), and `get_session()` FastAPI dependency (`with Session(engine) as s: yield s`). This is a relational store **separate from Qdrant** — do not route any of this through `qdrant_client`.
4. **Create `app/models/db_models.py`** (SQLModel tables):
   - `Patient(id: str PK uuid, name, age: int|None, pairing_code: str unique 6-char, created_at)`
   - `Caregiver(id PK uuid, email unique, password_hash, name|None, created_at)`
   - `CaregiverPatientLink(id PK, caregiver_id FK, patient_id FK, created_at)` (many-to-many)
   - `PatientState(patient_id PK/FK, profile_json, persona_json, reminders_json, updated_at)` — one row per patient; mirrors the syncable slice of `store.js`. Store JSON as `str` columns.
   - `InsightSnapshot(id PK, patient_id FK, date, mood, engagement, summary|None, concerns_json)` — one row per evaluation; mirrors `insightsHistory` plus concerns/summary for the caregiver view.
5. **Create `app/core/security.py`**: `hash_password`, `verify_password` (passlib bcrypt), `create_access_token(sub, claims)`, `decode_token`, and a `get_current_caregiver` dependency that reads `Authorization: Bearer <jwt>` and returns the `Caregiver`. Add `gen_pairing_code()` → 6 uppercase alphanumerics (exclude ambiguous `O/0/I/1`).
6. Call `init_db()` on FastAPI startup in `app/main.py` (add a `@app.on_event("startup")` or lifespan — match existing simple style; do not remove the existing static/frontend mounts).

### C. Backend — new endpoints (new router `app/api/auth_endpoint.py`, mounted under `settings.API_V1_STR` in `app/main.py` alongside the others)

All paths below are relative to `/api/v1`.

7. **`POST /auth/patient/register`** — body `{name, age?}` → creates `Patient` + empty `PatientState`, returns `{patient_id, pairing_code}`. (Called once from patient Onboarding.)
8. **`POST /auth/caregiver/register`** — body `{email, password, name?}` → creates `Caregiver`, returns `{token, caregiver: {id,email,name}}`. 409 if email exists.
9. **`POST /auth/caregiver/login`** — body `{email, password}` → `{token, caregiver}` or 401.
10. **`POST /auth/pair`** *(auth required)* — body `{pairing_code}` → links current caregiver to the patient, returns `{patient_id, patient_name}`; 404 on bad code.
11. **`GET /patient/{patient_id}/state`** — returns the synced `PatientState` as `{profile, persona, reminders, updated_at}` (JSON-parsed). Used by the patient device to restore after localStorage loss and (read-only) by paired caregivers.
12. **`PUT /patient/{patient_id}/state`** — body `{profile, persona, reminders}` → upserts `PatientState`, bumps `updated_at`, returns `{ok: true, updated_at}`. This is the patient→cloud push.
13. **`POST /patient/{patient_id}/insight`** — body `{mood, engagement, summary?, concerns?}` → inserts an `InsightSnapshot`. Called right after a successful `/evaluate` so the caregiver sees trends.
14. **`GET /caregiver/overview`** *(auth required)* → for every patient linked to the caregiver, return:
```json
{ "patients": [ {
  "patient_id": "…", "name": "…",
  "last_active": "2026-06-13T10:00:00Z",          // == PatientState.updated_at
  "insights": [ {"date":"…","mood":"neutral","engagement":"high"} ],   // last 30, ascending
  "latest_concerns": ["repeated the same question"],
  "latest_summary": "…",
  "medication_adherence": { "scheduled": 2, "taken_today": 1, "items": [ {"title":"Donepezil","time":"08:00","taken":true} ] }
} ] }
```
   Compute `medication_adherence` from `PatientState.reminders` where `type=='medication'`: `taken == (lastFired == today's date key, YYYY-MM-DD)`. If no medication reminders, return `{scheduled:0, taken_today:0, items:[]}` so the UI can show a graceful empty state (this is where feature #3 plugs in later).

Keep request/response JSON exactly as above so the frontend contract is stable. Use the `get_session` dependency; protect caregiver routes with `get_current_caregiver`.

### D. Frontend — sync layer in `store.js`

15. Add (without changing the existing `factech_state_v1` shape) these localStorage keys: `factech_auth` = `{token, caregiver}` (caregiver session) and add `auth: { patientId, pairingCode }` into the existing patient state object (so the patient device knows its own id). Export new helpers: `setAuth(patientId, pairingCode)`, `getApiBase()` (`import.meta.env.VITE_API_BASE || '/api/v1'`).
16. Add **`syncStateUp()`**: if `state.auth?.patientId`, `PUT /patient/{id}/state` with `{profile, persona, reminders}`. Call it (debounced ~2s) from `set()` whenever profile/persona/reminders change — implement a tiny debounce so rapid edits coalesce. Fire-and-forget; swallow network errors so offline still works.
17. In `addInsight(ev)` (store.js line 76): after pushing locally, if `state.auth?.patientId` also `POST /patient/{id}/insight` with `{mood, engagement, summary: ev.summary, concerns: ev.concerns}`. Keep it best-effort.
18. Use `axios` (already a dependency) for these calls.

### E. Frontend — patient onboarding hooks

19. In `frontend/src/components/Onboarding.jsx` `finish()` (after `setPersona`): call `POST /auth/patient/register` with `{name, age}`, then `setAuth(patient_id, pairing_code)`, and show the 6-char pairing code on a final confirmation step ("Share this code with your caregiver: **AB3K7Z**"). Match the existing `.ob-*` dark style.

### F. Frontend — caregiver flow & screen

20. **Wire routing in `App.jsx`** (currently orphaned). Add top-level role state persisted to localStorage (`factech_role`): on first load with no patient profile AND no caregiver token, render the existing `frontend/src/pages/LoginPage.jsx` role picker (it already calls `onSelectRole('patient'|'caregiver')`). `patient` → existing Onboarding/kiosk flow. `caregiver` → caregiver auth + dashboard. Do **not** add `react-router-dom`; keep the manual view-state pattern already in `App.jsx`.
21. **Rewrite `frontend/src/pages/LoginPage.jsx`** wiring: keep its visuals; on `caregiver` selection route into a new caregiver auth view.
22. **Create `frontend/src/pages/CaregiverLogin.jsx`**: email+password register/login form (toggle), then a "Pair a patient" input for the 6-char code (`POST /auth/pair`). Persist `factech_auth`. Dark `#0f172a` / violet-blue gradient, large tap targets, inline `<style>` — match `LoginPage.jsx`/`Onboarding.jsx`.
23. **Create `frontend/src/pages/CaregiverOverview.jsx`**: on mount, `GET /caregiver/overview` with `Authorization: Bearer <token>`. For each patient render a card with:
   - **Last active** (relative time from `last_active`).
   - **Wellbeing trend**: reuse the exact bar-chart pattern + `MOOD`/`ENGAGE` color maps from `frontend/src/components/WellbeingInsights.jsx` (lines 8-14, 72-86) over `insights` (`{date,mood,engagement}`). Extract that bar chart into a small shared component `frontend/src/components/MoodTrend.jsx` and reuse it in both places (do not duplicate the logic).
   - **Flagged concerns** (`latest_concerns`) + **summary** (`latest_summary`).
   - **Medication adherence** panel from `medication_adherence` (today's taken/scheduled, per-item checkmarks); show a friendly "No medication reminders yet" empty state when `scheduled === 0`.
   - A "Refresh" button and a logout that clears `factech_auth`.
   Provide manual refresh; optional `setInterval` polling every ~60s while mounted.

## Data contract (precise)

- **localStorage keys:** `factech_state_v1` (unchanged shape + new `auth:{patientId,pairingCode}` field), `factech_auth` = `{token, caregiver:{id,email,name}}`, `factech_role` = `'patient'|'caregiver'`.
- **insightsHistory / trend item:** `{date: ISO, mood: 'positive'|'neutral'|'low'|'anxious', engagement: 'high'|'medium'|'low'}` (matches `store.js` line 78 and `WellbeingInsights` `MOOD`/`ENGAGE`).
- **PatientState sync payload:** `{profile, persona, reminders}` (the syncable slice; memories/transcript stay local — out of scope to sync).
- **pairing_code:** 6 chars, `A-Z2-9` excluding `O/0/I/1`.
- **Qdrant:** untouched. No new collections, no new vectors. The relational layer is SQLite via SQLModel and must not import or wrap `qdrant_client`.
- **JWT:** HS256, `sub = caregiver_id`, signed with `settings.AUTH_SECRET`.

## Acceptance criteria

- [ ] `pip install -r requirements.txt` succeeds; backend starts; `factech.db` is created on first run; existing `/api/v1/voices`, `/persona/chat`, `/tts`, `/evaluate` still work.
- [ ] Patient device: completing Onboarding registers a patient and displays a 6-char pairing code; reopening the app restores profile/persona (state survives a `PUT /state`).
- [ ] Editing a reminder or running Wellbeing "Evaluate" pushes data up: `GET /patient/{id}/state` reflects reminders, and `InsightSnapshot` rows accumulate.
- [ ] Caregiver flow on a **second browser/device**: register → login → enter the patient's pairing code → land on the overview showing that patient's last-active, mood-trend chart, concerns, summary.
- [ ] Add a `type:'medication'` reminder on the patient and mark it fired today → caregiver overview shows `taken_today` incrementing and the item checkmarked.
- [ ] With no medication reminders, the adherence panel shows the empty state, not an error.
- [ ] Offline patient (backend down) still works: Onboarding/kiosk function, sync errors are swallowed silently.
- [ ] Multilingual persona (English/Hindi/Hinglish) is preserved end-to-end (persona JSON round-trips through `PatientState`).

## Manual test path

1. Start backend (`uvicorn app.main:app --reload`) and `npm run dev` in `frontend/`.
2. Browser A → pick **User** → onboard "Robert" + companion → copy pairing code; have a 2+ turn chat on Avatar; run Wellbeing "Evaluate".
3. Browser B (incognito) → pick **Caregiver** → register → login → paste pairing code → confirm Robert's trend/concerns/summary appear and last-active is recent.
4. Browser A → add a medication reminder, let it fire (or trigger). Refresh Browser B → adherence updates.

## Constraints / DO NOT BREAK

- Reuse the shared `qdrant_client` for any vector work; this feature must **not** create a second Qdrant client or a new Qdrant collection — SQLite is a separate engine in `app/core/database.py`.
- Keep all existing endpoints and their request/response shapes working; only **add** routers/fields.
- Preserve multilingual support via `persona.language`; round-trip persona JSON losslessly.
- No `react-router-dom`; keep the existing manual view-state routing in `App.jsx`.
- Match existing style: inline `<style>` blocks in JSX, dark theme `#0f172a` + violet-blue gradients, large dementia-friendly tap targets.
- No secrets hardcoded — `AUTH_SECRET`, `DATABASE_URL` come from `app/core/config.py`/`.env`. Add `factech.db` and `*.db` to `.gitignore`.
- Sync must be fail-soft: a down backend never blocks the patient kiosk.

## Out of scope

- Syncing `memories[]` and full `transcript[]` to the cloud (only profile/persona/reminders + insight snapshots sync).
- Migrating the single-user `conversation_service.py` global context to multi-tenant.
- Push notifications / background reminders when the tab is closed.
- Building feature #3 (medication scheduling) itself — only expose the adherence panel that consumes its data, with a graceful empty state until it lands.
- Password reset, email verification, OAuth, refresh tokens, rate limiting (light auth only).

---

# Feature 3 — Reliable reminders + medication adherence (PWA + Web Push)

# Feature: Reliable reminders + medication adherence (PWA + Web Push)

## Context (verified by reading the repo)
- **Project:** Factech AI — an AI memory companion for dementia/Alzheimer's patients. Backend = FastAPI (entry `app/main.py`, routers mounted under `settings.API_V1_STR` = `/api/v1`). Frontend = React 19 + Vite 7 in `frontend/`.
- **Reminders today fire only while the tab is open.** `frontend/src/App.jsx` lines 17–53 run a `useEffect` that polls `getState()` every 30s via `setInterval`; when `nowMin >= tMin && nowMin - tMin <= 60 && r.lastFired !== today`, it calls `markReminderFired(r.id, today)`, sets a banner, and speaks via `window.speechSynthesis`. There is **no service worker** (verified: no `vite-plugin-pwa`, no `registerSW`, no `manifest` anywhere) and **no proof a med was taken**.
- **Reminder data model** lives in `frontend/src/lib/store.js` (`addReminder`, lines 60–67): `{ id, title, time, type, lastFired }`. `type` ∈ `medication | meal | appointment | general` (see `Reminders.jsx` `TYPES`, lines 5–10). State persists to `localStorage` key `factech_state_v1`; default shape (line 7) = `{ profile, persona, memories[], transcript[], reminders[], insightsHistory[] }`. **There is no `adherence[]` array yet.**
- **Reminders UI** = `frontend/src/components/Reminders.jsx`, rendered inside `frontend/src/pages/HomeView.jsx` (line 68). Add form supports title/type/time only.
- **Backend conventions:** persona/voice endpoints in `app/api/persona_endpoint.py` use `APIRouter()` + `payload: dict = Body(...)`, return plain dicts with `{"status": "ok"|"error", ...}`. Routers are included in `app/main.py` lines 36–39 with `prefix=settings.API_V1_STR`. There is **no reminders/push endpoint today** (verified). Config is `pydantic-settings` in `app/core/config.py` (`.env` driven). Qdrant uses ONE shared client `qdrant_client` in `app/core/db.py` — never construct a second one.
- **Dev origin:** `frontend/vite.config.js` proxies `/api` → `http://localhost:8010`. Frontend API base = `import.meta.env.VITE_API_BASE || '/api/v1'`.
- **Multilingual:** `persona.language` ∈ English / Hindi / Hinglish; `App.jsx` lines 38–43 already pick `hi-IN` vs `en-US` and build localized reminder lines. Preserve this.

## Goal
Make the frontend an installable PWA whose reminders fire even when the tab/app is closed (via Notifications API + optional Web Push), and add a medication **adherence loop** (Taken / Snooze / Skip) that logs every outcome with a timestamp into a new `store.js` `adherence[]` array and syncs it to new backend endpoints for the caregiver dashboard.

---

## Implementation plan

### Part A — PWA + service worker (frontend)
1. **Add deps** to `frontend/package.json` devDependencies: `vite-plugin-pwa` (and its peer `workbox-window` if the plugin requires it). Run the install.
2. **`frontend/vite.config.js`** — import `VitePWA` and add it to `plugins`. Use:
   - `registerType: 'autoUpdate'`
   - `injectRegister: 'auto'`
   - `manifest`: `{ name: 'Factech AI', short_name: 'Factech', description: 'AI memory companion', theme_color: '#0f172a', background_color: '#0f172a', display: 'standalone', start_url: '/', icons: [192, 512 maskable+any] }`. Create icon PNGs under `frontend/public/` (a simple violet-gradient heart/bell glyph is fine) and reference them.
   - `strategies: 'injectManifest'`, `srcDir: 'src'`, `filename: 'sw.js'` so we can hand-write push handling. (If `injectManifest` is heavy, fall back to `generateSW` + a separate registered push SW — but keep ONE service worker.)
   - **Keep the proxy block intact.**
3. **`frontend/src/sw.js`** (new hand-written service worker). Must:
   - Pre-cache the app shell (use workbox `precacheAndRoute(self.__WB_MANIFEST)` when using injectManifest).
   - Handle `push` events: parse `event.data.json()` → `{ title, body, reminderId, type, tag, lang }`, call `self.registration.showNotification(title, { body, tag, requireInteraction: true, actions: type === 'medication' ? [{action:'taken',title:'✓ Taken'},{action:'snooze',title:'Snooze 10m'},{action:'skip',title:'Skip'}] : [], data: {...} })`.
   - Handle `notificationclick`: if `event.action` is one of `taken|snooze|skip`, `postMessage` to all clients (and/or store to IndexedDB for offline) so the page can log adherence; otherwise focus/open the app. Close the notification.
4. **`frontend/src/main.jsx`** — keep `createRoot` as-is; PWA registration is auto-injected by the plugin. Add a tiny module `frontend/src/lib/push.js` exporting:
   - `async function ensureNotificationPermission()` → `Notification.requestPermission()`.
   - `async function subscribeToPush()` → fetch VAPID public key from `GET {API_BASE}/push/vapid-public-key`, `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`, then `POST {API_BASE}/push/subscribe` with the subscription JSON. Store the returned `sub_id` (or the endpoint) in `store.js`.
   - A `navigator.serviceWorker` `message` listener that, on `{type:'adherence', action, reminderId}`, calls `logAdherence(...)` (Part C).
5. **Local-notification fallback (must work even if backend push is unavailable):** if push subscription fails or `VITE_PUSH_ENABLED` is false, keep the existing in-tab `setInterval` checker in `App.jsx`, but when a reminder is due ALSO fire a local `self.registration.showNotification(...)` via the SW (so a notification appears even if the tab is backgrounded but the SW is alive). Document clearly in code comments that true closed-app delivery requires backend Web Push.

### Part B — Backend push + scheduler (FastAPI)
1. **`requirements.txt`** — add `pywebpush` and `apscheduler`.
2. **`app/core/config.py`** — add settings: `VAPID_PUBLIC_KEY: Optional[str] = None`, `VAPID_PRIVATE_KEY: Optional[str] = None`, `VAPID_SUBJECT: str = "mailto:care@factech.ai"`. Read from `.env`. **Do not hardcode keys.** Add a one-line note in README/`.env.example` that keys are generated with `vapid --gen` or `py_vapid`.
3. **New file `app/api/reminders_endpoint.py`** with `router = APIRouter()`, following persona_endpoint style (`payload: dict = Body(...)`, `{"status": ...}` returns). Endpoints:
   - `GET /push/vapid-public-key` → `{"status":"ok","key": settings.VAPID_PUBLIC_KEY}` (or `{"status":"disabled"}` if unset).
   - `POST /push/subscribe` — body = `{ "user_id": str, "subscription": {endpoint, keys:{p256dh,auth}}, "persona_language": str }` → upsert into a JSON store (see Part D); return `{"status":"ok","sub_id": str}`.
   - `POST /push/unsubscribe` — body `{ "sub_id": str }` → remove; `{"status":"ok"}`.
   - `POST /reminders/sync` — body `{ "user_id": str, "reminders": [ {id,title,time,type,lastFired,enabled} ] }` → replace this user's scheduled reminders; reschedule jobs; `{"status":"ok","count": n}`. (Frontend pushes the canonical list whenever reminders change.)
   - `POST /adherence/log` — body = adherence record (Part D shape) → append to store; `{"status":"ok"}`.
   - `GET /adherence?user_id=...&days=7` → `{"status":"ok","items":[...]}` for the caregiver dashboard (ties into Feature #2).
4. **Scheduler** — module `app/services/reminder_scheduler.py`:
   - Build a single `AsyncIOScheduler` (APScheduler) started in a FastAPI `@app.on_event("startup")` (or lifespan) in `app/main.py`.
   - For each synced reminder, schedule a daily cron job at its `HH:MM`. On fire, look up all subscriptions for that user, build the localized payload (reuse the `App.jsx` line/`lang` logic server-side: medication/meal/appointment/general strings, `hi-IN` vs `en-US`), and send via `pywebpush.webpush(...)`. On `WebPushException` 404/410, delete the dead subscription.
   - Guard the whole scheduler behind "VAPID configured" — if keys are absent, log a warning and skip (app still runs; frontend uses local fallback).
5. **`app/main.py`** — `from app.api import reminders_endpoint` and `app.include_router(reminders_endpoint.router, prefix=settings.API_V1_STR)` alongside the existing includes (lines 36–39). Start the scheduler on startup, shut it down on shutdown. **Do not touch the existing frontend-serving block or other routers.**

### Part C — Adherence loop (frontend)
1. **`frontend/src/lib/store.js`** — add `adherence: []` to `defaultState` (line 7) and add helpers:
   - `export function logAdherence({ reminderId, reminderTitle, type, status })` → push `{ id, reminderId, reminderTitle, type, status, ts: ISO }` (status ∈ `taken|snoozed|skipped`), `set(...)`, and best-effort `POST {API_BASE}/adherence/log` (fire-and-forget, never block UI). Cap array (e.g. `.slice(-500)`).
   - `export function syncReminders()` → best-effort `POST {API_BASE}/reminders/sync` with current `reminders`. Call it from `addReminder`/`removeReminder`/`markReminderFired` so backend schedule stays current.
   - Extend `addReminder` (lines 60–67) to also persist `enabled: true` and `snoozeUntil: null`.
2. **`frontend/src/App.jsx`** — when a **medication** reminder fires (currently lines 40–47), instead of only a passive banner, show an **Adherence prompt** card with three large dementia-friendly buttons: **✓ Taken**, **Snooze 10 min**, **Skip**. Wire to `logAdherence` (and clear/snooze the banner). Non-med reminders keep the existing gentle banner. Honor a `snoozeUntil` so snoozed meds re-prompt in 10 minutes. Keep `speechSynthesis` + multilingual lines.
3. **`frontend/src/components/Reminders.jsx`** — add an **"Enable notifications"** button (calls `ensureNotificationPermission()` + `subscribeToPush()`), shown when permission isn't granted. Add a small **adherence summary** line per medication reminder (e.g. "Taken 5/7 this week") read from `store.adherence`. Match existing `.rm-*` inline `<style>` dark theme.
4. Optionally surface a compact **"Medication adherence"** strip on `HomeView.jsx` for caregivers (last 7 days), reusing the same store data.

### Part D — Data contract (be exact)
- **Reminder (store.js + sync payload):**
  ```json
  { "id": "str", "title": "str", "time": "HH:MM", "type": "medication|meal|appointment|general", "lastFired": "YYYY-MM-DD|null", "enabled": true, "snoozeUntil": "ISO|null" }
  ```
- **Adherence record (`store.adherence[]` + `POST /adherence/log` body):**
  ```json
  { "id": "str", "user_id": "str", "reminderId": "str", "reminderTitle": "str", "type": "medication", "status": "taken|snoozed|skipped", "ts": "ISO-8601" }
  ```
- **Push subscription (`POST /push/subscribe` body):**
  ```json
  { "user_id": "str", "subscription": { "endpoint": "str", "keys": { "p256dh": "str", "auth": "str" } }, "persona_language": "English|Hindi|Hinglish" }
  ```
- **Push notification payload (server → SW):**
  ```json
  { "title": "str", "body": "str", "reminderId": "str", "type": "medication", "tag": "rem-<id>", "lang": "hi-IN|en-US" }
  ```
- **Backend persistence (until Feature #2 supersedes it):** store subscriptions, synced reminders, and adherence logs in JSON files under a `data/` dir (e.g. `data/push_subscriptions.json`, `data/reminder_schedule.json`, `data/adherence_log.json`) keyed by `user_id`. **Do NOT add Qdrant collections for this** (no embeddings needed). If you reuse Qdrant for any reason, you MUST use the shared `qdrant_client` from `app/core/db.py` — never build a new client.
- **localStorage:** keep the single key `factech_state_v1`; only ADD `adherence` (and the two new reminder fields). Migration is automatic via `{ ...defaultState, ...JSON.parse(raw) }` (store.js line 12).

---

## Acceptance criteria
- [ ] `npm run build` in `frontend/` produces a service worker + `manifest.webmanifest`; Chrome DevTools → Application shows the app as installable with the Factech manifest and icons.
- [ ] Granting notification permission and subscribing succeeds; `data/push_subscriptions.json` gets a record after `POST /push/subscribe`.
- [ ] `GET /api/v1/push/vapid-public-key` returns the public key (or `{"status":"disabled"}` when unset). Backend boots fine with **no** VAPID keys (scheduler logs a warning and skips; app still serves).
- [ ] With VAPID keys set: adding a med reminder for ~1 min ahead, then **closing the tab**, produces a system notification at the scheduled time with **Taken / Snooze / Skip** action buttons.
- [ ] Tapping **Taken** (from notification or in-app prompt) appends a `status:"taken"` record to `store.adherence` AND `POST /adherence/log` lands it in `data/adherence_log.json`. **Snooze** re-prompts the med ~10 min later; **Skip** logs `skipped`.
- [ ] `GET /api/v1/adherence?user_id=...&days=7` returns the logged items.
- [ ] `Reminders.jsx` shows a "Taken X/7 this week" summary per medication and an "Enable notifications" CTA when permission isn't granted.
- [ ] **Fallback path:** with push disabled/unavailable, the existing in-tab reminder still fires the banner + speech, and a local notification appears if the SW is registered. Nothing crashes.
- [ ] Multilingual preserved: a Hindi/Hinglish persona yields `hi-IN` reminder copy in both the banner and the push payload.
- [ ] Existing endpoints (`/voices`, `/persona/chat`, `/tts`, `/clone-voice`, `/evaluate`) and the avatar chat flow are unchanged and still pass.

## Constraints / do not break
- **Reuse the shared `qdrant_client`** from `app/core/db.py` if Qdrant is touched at all — never instantiate a second `QdrantClient` (embedded mode locks the folder). This feature should need NO Qdrant.
- Keep the single `localStorage` key `factech_state_v1` and the existing store API; only additively extend it.
- Keep `frontend/vite.config.js` `/api` proxy intact; keep `import.meta.env.VITE_API_BASE || '/api/v1'` as the API base. All `fetch`/`axios` calls go through it.
- **No secrets hardcoded.** VAPID + any keys come from `.env` / `settings`. Provide `.env.example` entries and a one-line key-gen note.
- Match existing style: inline `<style>` blocks in JSX, dark theme (`#0f172a`, violet→blue gradients `#7c3aed`→`#2563eb`), large tap targets, warm dementia-friendly copy. Reuse existing `lucide-react` icons (`Pill`, `Bell`, `CalendarClock`, etc.).
- Preserve multilingual behavior driven by `persona.language`.
- Keep all existing routers/includes in `app/main.py` and the frontend-serving block untouched; only ADD the reminders router + scheduler startup.
- All backend network sends (`pywebpush`) must be wrapped so a failing send never crashes the scheduler or the request; dead subscriptions (404/410) are pruned.

## Out of scope
- Real auth / multi-user accounts (app is single-user "kiosk" today; use a stable `user_id` like `"kiosk"` or the profile name until Feature #2's auth exists).
- The full caregiver dashboard UI (Feature #2) — only expose `GET /adherence` and write the data it will consume.
- iOS Safari Web Push quirks beyond best-effort (note in code that iOS requires the app installed to home screen + iOS 16.4+).
- Replacing the existing in-tab reminder logic — it stays as the fallback, not removed.
- Cron/recurrence beyond a simple daily `HH:MM` reminder (no weekly/interval/end-date rules).
- Voice-clone TTS for notifications (notifications use the OS, not the persona voice).

---

# Feature 4 — Daily orientation / "Today" grounding

## Context (verified by reading the repo)

Project: **Factech AI** — a React + FastAPI AI memory companion for dementia patients. I read the relevant files; current behavior:

- `frontend/src/pages/HomeView.jsx` shows only a time-of-day greeting (`greeting()` at lines 8–13 → "Good morning/afternoon/evening") + the user's name. It renders `<Reminders />` (line 68) but has **no date/day display and no "today's schedule" summary**.
- `frontend/src/lib/store.js`: client-only store persisted to localStorage key `factech_state_v1`. Shape `{ profile, persona, memories[], transcript[], reminders[], insightsHistory[] }` (line 7). `profile` = `{ name, age }`. Each reminder = `{ id, title, time:"HH:MM", type, lastFired }` (lines 60–67). `addReminder` sorts by `time`.
- `frontend/src/pages/AvatarPage.jsx` posts to `${API_BASE}/persona/chat` (lines 162–167) with `{ text, persona, user:{name}, history }`. It does **not** send any date/schedule. Suggestion chips include `'What should I do today?'` (line 316) but the model has no real schedule context.
- `app/services/llm_service.py` → `chat_as_persona(self, user_text, persona=None, user=None, history=None)` (line 128) builds the in-character system prompt. It has **zero awareness of today's date, day of week, or reminders**. Multilingual handling is at lines 196–210 (`language == "hindi"` → Devanagari, `"hinglish"` → Roman Hinglish). Must be preserved.
- `app/api/persona_endpoint.py` → `POST /persona/chat` (line 45) reads `text, persona, user, history` from the body and calls `llm_service.chat_as_persona(...)` (line 54).
- `frontend/src/App.jsx` already has a global reminder checker (lines 17–53) using `today = now.toISOString().slice(0,10)` and `markReminderFired`. Reuse this `YYYY-MM-DD` "day key" convention.

## Goal

Give the user a persistent **"Today" panel** on Home and feed a compact **today-context** into `chat_as_persona` so the companion can proactively orient the user and correctly answer "what day is it / what do I do today" — in English, Hindi (Devanagari) **or** Hinglish, matching `persona.language`.

## Requirements / Implementation Plan

### 1. Backend — `app/services/llm_service.py`
- Change the signature of `chat_as_persona` to accept a new optional arg:
  `def chat_as_persona(self, user_text, persona=None, user=None, history=None, today=None):`
  where `today` is a dict (may be `None` / `{}`). Expected keys (all optional, defensively read with `.get`):
  - `date_human` (str, e.g. "Saturday, 13 June 2026")
  - `weekday` (str, e.g. "Saturday")
  - `part_of_day` (str: "morning" | "afternoon" | "evening")
  - `reminders` (list of `{title, time_human, type}`, e.g. `{ "title":"Blood pressure pill", "time_human":"9:00 AM", "type":"medication" }`)
  - `caregiver_visit` (str or null, e.g. "Priya is visiting at 4:00 PM")
- Build a `today_block` string ONLY when `today` is truthy, and append it to `system_prompt` **after** the persona/personality lines but **before** the `language == "hindi" / "hinglish"` blocks (so the language instruction still wins and the date is naturally translated). Use exactly this shape (keep it compact, ~6 lines):

  ```
  TODAY'S REAL-WORLD CONTEXT (for grounding — use it naturally, do not read it like a list):
  - Today is {date_human} ({part_of_day}).
  - The user is {user_name}.
  - Today's reminders/plans: {for each → "{time_human} — {title} ({type})"} ; or "nothing scheduled".
  - {caregiver_visit line, only if present}
  Use this so you can gently orient {user_name} about the day, the date and what's planned WITHOUT
  quizzing them. If they ask what day it is or what they do today, answer warmly and correctly from this.
  Mention the date/plans only when it fits naturally — never dump the whole schedule unprompted.
  ```
- **Critical:** do not hardcode the date string in Python from `datetime.now()` — the date/strings come from the client `today` payload (the kiosk's local timezone is authoritative). Server may run in UTC. If `today` is missing, behave exactly as before (no regression).
- The existing model fallback loop (lines 223–236) and `max_tokens`/style logic stay unchanged.

### 2. Backend — `app/api/persona_endpoint.py`
- In `persona_chat` (line 45), read `today = payload.get("today") or {}` and pass it through:
  `reply = llm_service.chat_as_persona(text, persona=persona, user=user, history=history, today=today)`.
- Keep the response shape identical: `{ "status": "ok", "text": reply }`. Endpoint must keep working when `today` is absent.

### 3. Frontend — `frontend/src/lib/store.js`
- Add a helper that builds the today-context object from current state (single source of truth, reused by Home + Avatar). Add:
  ```js
  // Friendly today/orientation context, derived from reminders[] + profile.
  export function getTodayContext() {
    const s = state;
    const now = new Date();
    const part = now.getHours() < 12 ? 'morning' : now.getHours() < 18 ? 'afternoon' : 'evening';
    const date_human = now.toLocaleDateString(undefined, { weekday:'long', day:'numeric', month:'long', year:'numeric' });
    const weekday = now.toLocaleDateString(undefined, { weekday:'long' });
    const to12 = (t) => { const [h,m]=(t||'00:00').split(':').map(Number); const ap=h>=12?'PM':'AM'; return `${((h+11)%12)+1}:${String(m).padStart(2,'0')} ${ap}`; };
    const reminders = (s.reminders||[]).map(r => ({ title:r.title, time_human:to12(r.time), type:r.type }));
    const caregiver_visit = s.profile?.caregiverVisit || null; // optional free-text, may be unset
    return { date_human, weekday, part_of_day: part, reminders, caregiver_visit };
  }
  ```
  Reuse the same 12-hour format as `Reminders.jsx` `fmt()` (lines 12–17). `caregiverVisit` is an **optional** string on `profile`; do not require it. (If you wire an input for it, add it to the existing Onboarding/PersonaEditor profile edit — otherwise leave it null-safe.)
- Add a tiny "seen today" flag for the optional proactive line (req 6):
  ```js
  export function markOrientedToday(dayKey) { set({ orientedOn: dayKey }); }
  ```
  Add `orientedOn: null` to `defaultState`.

### 4. Frontend — `frontend/src/pages/HomeView.jsx` (the "Today" panel)
- Import `getTodayContext` from the store. Compute it inside the component (it re-derives on each render; `useAppState()` already re-renders on reminder changes).
- Render a new **Today panel** directly under the `<h1 className="hv-name">` greeting block and **above** the persona spotlight (so date grounding is the first thing seen). Match the existing dark/glass style (reuse `.hv-tile`/`.rm` visual language: `rgba(30,41,59,0.55)`, `border: 1px solid rgba(255,255,255,0.09)`, `border-radius: 18px`, violet accents `#a78bfa`). Large, readable text (dementia-friendly).
- Panel contents:
  - Big line: the **weekday + date** (e.g. "Saturday, 13 June 2026") and a friendly part-of-day line ("It's the afternoon.").
  - **Today's plan**: list each reminder as `{time_human} · {title}` with the same type icon/color map used in `Reminders.jsx` (`Pill`/`Utensils`/`CalendarClock`/`Bell`). If `caregiver_visit` is set, show it as a highlighted line. If no reminders, show a warm empty state ("Nothing planned today — a calm day. {persona.name} is here whenever you'd like to talk.").
- Do NOT duplicate the full add/remove reminder UI — that stays in `<Reminders />` lower down. The Today panel is read-only orientation.

### 5. Frontend — `frontend/src/pages/AvatarPage.jsx`
- Import `getTodayContext` from the store. In `runTurn` (lines 151–179), include it in the `/persona/chat` POST body:
  ```js
  const r = await axios.post(`${API_BASE}/persona/chat`, {
    text: q,
    persona: { ...same as today... },
    user: { name: profile?.name },
    history,
    today: getTodayContext(),
  }, { timeout: 30000 });
  ```
  Compute `getTodayContext()` at call time (fresh per turn) — do not memoize at mount.
- **Optional gentle proactive orientation (first open of the day):** in the existing first-open greeting effect (lines 57–69), after setting the warm greet, if `getState().orientedOn !== <todayKey>` AND there is at least one reminder today, append one short localized orientation sentence to the same greeting (e.g. EN: "By the way, today is {weekday} — you have {first reminder} later."; Hindi/Hinglish variants mirroring the existing inline localized strings at lines 62–66). Then call `markOrientedToday(todayKey)` so it fires at most once per day. Use `new Date().toISOString().slice(0,10)` as `todayKey` (same convention as `App.jsx`). Keep it ONE gentle sentence — never a schedule dump.

## Data Contract

- **`/persona/chat` request (extended, backward-compatible):**
  ```json
  {
    "text": "what day is it?",
    "persona": { "name":"...", "relationship":"...", "personality":"...", "gender":"...", "age":0, "accent":"...", "language":"hindi|hinglish|english", "style":"..." },
    "user": { "name": "..." },
    "history": [ { "role":"user|bot", "text":"..." } ],
    "today": {
      "date_human": "Saturday, 13 June 2026",
      "weekday": "Saturday",
      "part_of_day": "afternoon",
      "reminders": [ { "title":"Blood pressure pill", "time_human":"9:00 AM", "type":"medication" } ],
      "caregiver_visit": "Priya visits at 4:00 PM"
    }
  }
  ```
  `today` is **optional**; omit-safe. Response unchanged: `{ "status":"ok", "text":"..." }`.
- **Store / localStorage** (`factech_state_v1`): add `orientedOn: string|null` (a `YYYY-MM-DD` day key). Optional `profile.caregiverVisit: string|null`. No new collections. **No Qdrant changes, no new vectors, no models.**

## Acceptance Criteria

- [ ] HomeView shows a "Today" panel above the persona spotlight with the correct weekday + full date and a friendly part-of-day line, styled to match the dark/glass theme.
- [ ] Today panel lists today's reminders (12-hour time + title + type icon) and shows the warm empty state when there are none.
- [ ] Adding a reminder in `<Reminders />` makes it appear in the Today panel without reload (store re-render).
- [ ] In Avatar chat, asking **"What day is it?"** → companion answers the correct weekday/date. Asking **"What should I do today?"** (existing chip) → companion names today's actual reminders, not a generic reply.
- [ ] Same questions in a Hindi persona answer in **Devanagari** with the date in Hindi; in a Hinglish persona answer in Roman Hinglish. (Language blocks at llm_service lines 196–210 still take effect.)
- [ ] With NO reminders set, chat still works and the companion gives a gentle "nothing scheduled, calm day" style answer — no crash, no empty schedule dump.
- [ ] `POST /persona/chat` with the old payload (no `today` key) still returns `{status:"ok", text:...}` — no 500.
- [ ] Optional: on the first Avatar open of a given day with ≥1 reminder, the greeting includes one short orientation sentence; reopening the same day does not repeat it (`orientedOn` set).
- [ ] Manual test path: `uvicorn`/Docker backend up + `cd frontend && npm run dev` → complete onboarding → on Home add a "Lunch 1:00 PM (meal)" reminder → confirm it shows in Today panel → go to Talk → type "what do I do today?" → companion mentions lunch at 1 PM → switch persona language to Hindi in Edit → ask again → answer is in Devanagari.

## Constraints / Do NOT break

- **Reuse the shared `app/core/db.py` `qdrant_client`** — this feature needs no DB at all; do not construct any client/model.
- **Preserve multilingual output**: keep the Hindi/Hinglish blocks; inject `today_block` BEFORE them so the language instruction governs translation. Never force English dates into a Hindi reply.
- Keep `/persona/chat`, `/tts`, `/voices`, `/evaluate`, `/clone-voice` all working with their current request/response shapes. `today` must be purely additive and optional.
- Match existing style: inline `<style>` blocks in JSX, dark theme (`#0f172a`, violet-blue gradients), large tap targets, warm dementia-friendly copy. Reuse the type→icon/color map and `fmt()` time format from `Reminders.jsx`.
- Date/time must derive from the **client's local clock** (kiosk), not the server (server may be UTC). No hardcoded dates.
- No secrets, no new env vars, no new dependencies.
- Single-user kiosk assumption stays — no per-user state, no auth changes.

## Out of Scope

- Calendar/timezone settings UI, recurring/multi-day events, or anything beyond today.
- Backend persistence of reminders or any server-side schedule store (reminders stay in `store.js`).
- Push/OS notifications or reminders firing while the tab is closed (existing `App.jsx` setInterval limitation is unchanged).
- Voice-clone, face recognition, memory Q&A (`generate_response`), and wellbeing `evaluate` flows — leave untouched.
- New Qdrant collections, embeddings, or model changes.

---

# Feature 5 — One-tap SOS / emergency + distress auto-alert

## Context (verified by reading the repo)

Project: **Factech AI** — a React + FastAPI AI memory companion for dementia/Alzheimer's patients. I read these files; the claims below are true as of now:

- **No safety/SOS escape hatch exists today.** `frontend/src/App.jsx` renders only `NavBar` + a reminder banner + the active view; `frontend/src/pages/HomeView.jsx` has a greeting, persona spotlight, 3 quick tiles (Talk / Memories / Who is this?), `<Reminders/>`, `<WellbeingInsights/>`. There is no help/emergency button anywhere.
- **Client-only state**, no backend persistence/auth. `frontend/src/lib/store.js` is a `useSyncExternalStore` store persisted to `localStorage` key `factech_state_v1`. Default shape: `{ profile: null, persona: null, memories: [], transcript: [], reminders: [], insightsHistory: [] }`. It exposes `getState`, `useAppState`, `setProfile`, `setPersona`, `addReminder`, etc. There is **no** emergency-contact concept.
- **Onboarding** (`frontend/src/components/Onboarding.jsx`) step 1 collects `name` + `age` via `setProfile({ name, age })`; step 2 builds the persona via `PersonaEditor`. **PersonaEditor** (`frontend/src/components/PersonaEditor.jsx`) edits the persona object only (no contact fields).
- **Backend** entry `app/main.py` mounts routers with `app.include_router(<router>, prefix=settings.API_V1_STR)` where `settings.API_V1_STR == "/api/v1"` (see `app/core/config.py`). Existing routers: `endpoints`, `chat_endpoint`, `persona_endpoint`, `mesh_endpoint`. `app/api/persona_endpoint.py` defines `router = APIRouter()` with `@router.post("/evaluate")`, `/persona/chat`, `/tts`, etc.
- **Distress signal already exists.** `app/services/llm_service.py::evaluate_conversation` returns JSON with keys `mood` (one of `'positive'|'neutral'|'low'|'anxious'`), `engagement`, `topics`, `concerns` (array, may be empty), `summary`, `suggestions`. `frontend/src/components/WellbeingInsights.jsx` POSTs `${API_BASE}/evaluate` and sets `evalData` (it already renders `evalData.concerns` under "Worth noticing"). `API_BASE = import.meta.env.VITE_API_BASE || '/api/v1'`.
- Shared Qdrant client lives in `app/core/db.py` (`qdrant_client`) — services must reuse it, never construct a second client (embedded mode locks the folder). This feature does **not** need Qdrant.

## Goal

Add a prominent, always-reachable one-tap **"Call for help"** SOS button that `tel:`-dials a stored caregiver phone number AND POSTs an alert to a new backend endpoint, plus a gentle in-app **distress auto-alert** path triggered when the existing wellbeing evaluation reports an anxious/low mood or non-empty concerns — keeping it dead simple and reassuring for a confused user.

## Requirements / Implementation plan

### 1. Data model — emergency contact in `store.js`
- Add `emergencyContacts: []` to `defaultState` in `frontend/src/lib/store.js` (keep the localStorage key `factech_state_v1` unchanged; existing saved state stays valid because `load()` already spreads `...defaultState`).
- Add these exported functions (mirror the existing `addReminder`/`removeReminder` style and id scheme `String(Date.now()) + Math.random().toString(36).slice(2,7)`):
  - `addEmergencyContact({ name, phone, relationship })` → pushes `{ id, name, phone: phone.trim(), relationship: relationship || 'caregiver' }`; returns it.
  - `removeEmergencyContact(id)`.
  - `setEmergencyContacts(list)` (used by Onboarding/PersonaEditor save flows).
- Contact object shape (the data contract): `{ id: string, name: string, phone: string, relationship: string }`. `phone` is a raw user-entered string; sanitize to a `tel:` href at dial time (strip spaces/dashes/parens, keep leading `+`).

### 2. Backend — new alert endpoint
- Create `app/api/alerts_endpoint.py` with `router = APIRouter()` and a single in-memory ring buffer (single-user kiosk assumption — match `conversation_service` global-state pattern; do NOT add Qdrant):
  - `POST /alert` — request body (FastAPI `Body(...)` dict, same style as `persona_endpoint`):
    ```json
    { "type": "sos | distress", "patient": "string (profile name, optional)", "message": "string", "timestamp": "ISO8601 string (optional; server fills if missing)" }
    ```
    Behavior: append `{ id, type, patient, message, timestamp, received_at }` to a module-level `ALERTS = []` (cap to last 100). Log to stdout. Response:
    ```json
    { "status": "ok", "alert_id": "<id>", "received_at": "<ISO8601>" }
    ```
    Be tolerant: default `type` to `"sos"`, default `timestamp`/`received_at` to `datetime.utcnow().isoformat()`.
  - `GET /alerts` — returns `{ "status": "ok", "alerts": [...] }` (most-recent-first), so a caregiver view can poll later.
- Mount it in `app/main.py`: `from app.api import alerts_endpoint` and `app.include_router(alerts_endpoint.router, prefix=settings.API_V1_STR)`. Do not reorder/remove existing includes.
- No secrets, no external SMS/email provider in this change — backend just records the alert (a real notifier is out of scope; leave a `# TODO: forward to caregiver pairing / SMS` comment).

### 3. Frontend — SOS button (always reachable)
- Create `frontend/src/components/SosButton.jsx`. Render it once globally in `App.jsx` (after `<NavBar/>`, inside the main flex container) so it is fixed and present on every view, including when a reminder banner is showing.
- Markup/behavior:
  - A **fixed** floating button, bottom-right (`position: fixed; bottom: 24px; right: 24px; z-index: 2500`), large tap target (min 64px), red gradient, label "Help" with a phone icon (`Phone` from `lucide-react`), `aria-label="Call for help"`. Must not overlap the AvatarPage chat input awkwardly on mobile — give it a subtle shadow and keep it above content.
  - On tap → open a **confirmation modal** (big, reassuring, dark theme `#0f172a`, large buttons). Copy example: "Do you want to call for help?" with a big primary "Yes, call <contactName>" and a big ghost "No, I'm okay".
  - On confirm:
    1. POST `${API_BASE}/alert` with `{ type: 'sos', patient: profile?.name, message: `${profile?.name||'The patient'} pressed Call for help.`, timestamp: new Date().toISOString() }` (fire-and-forget; wrap in try/catch, never block the call on a failed POST).
    2. Trigger the phone call: set `window.location.href = `tel:${sanitizedPhone}`` for the first emergency contact (or a settings-chosen primary). If no contact exists, show a gentle "No emergency contact saved yet — ask a family member to add one in settings" message instead of dialing.
    3. Show a big reassuring confirmation UI: "Calling <name> now. Help is on the way. Stay where you are." with a calm checkmark.
  - `API_BASE = import.meta.env.VITE_API_BASE || '/api/v1'` (match every other component). Read contacts/profile via `useAppState()`.
- Match existing style: inline `<style>{`...`}</style>` block in the JSX, dark theme, violet/blue gradients for secondary actions but **red** (#ef4444 / #dc2626) for the SOS itself so it reads as emergency.

### 4. Frontend — capture the emergency contact
- **Onboarding** (`frontend/src/components/Onboarding.jsx`): add one optional field group in step 1 (or a brief step between 1 and 2) for the primary caregiver: "Caregiver name", "Caregiver phone". On `continueToPersona()` (or step save), if a phone is entered, call `setEmergencyContacts([{ id, name, phone, relationship: 'caregiver' }])`. Keep step gating working (App still gates on `profile && persona`). Reuse the existing `.ob-field` styles.
- **PersonaEditor / settings**: add an "Emergency contact" section (name + phone + optional relationship, with add/remove for multiple) so it can be set/edited later. Wire it through the existing `onSave` flow used by `AvatarPage`'s edit modal and Onboarding — but write contacts via `setEmergencyContacts`/`addEmergencyContact` (NOT into the persona object), so emergency contacts persist independently of the persona. Reuse `.pe-field` styling.

### 5. Frontend — distress → alert path
- In `frontend/src/components/WellbeingInsights.jsx`, after a successful evaluation (`r.data?.status === 'ok'`, where `evalData` is set), add distress detection:
  - `const distressed = evalData.mood === 'anxious' || evalData.mood === 'low' || (Array.isArray(evalData.concerns) && evalData.concerns.length > 0);`
- When `distressed`, surface a **gentle, non-alarming in-app prompt** (not the patient-facing red SOS — this is caregiver-facing, calm wording, e.g. "It might help to check in with <patient>." plus a "Notify caregiver" button). On clicking "Notify caregiver" (and, if a caregiver-pairing feature exists, automatically), POST `${API_BASE}/alert` with `{ type: 'distress', patient: profile?.name, message: <evalData.summary or first concern>, timestamp: new Date().toISOString() }`. Debounce so the same evaluation does not fire multiple alerts (e.g. track the last alerted summary in component state).
- Do NOT auto-dial on distress — distress only raises a backend alert + soft prompt; only the explicit SOS button dials.

## Data contract (precise)

- **localStorage key:** `factech_state_v1` (unchanged). New store field: `emergencyContacts: Array<{ id, name, phone, relationship }>`.
- **POST `/api/v1/alert` request:** `{ type: "sos"|"distress", patient?: string, message: string, timestamp?: ISO8601 }`
- **POST `/api/v1/alert` response:** `{ status: "ok", alert_id: string, received_at: ISO8601 }`
- **GET `/api/v1/alerts` response:** `{ status: "ok", alerts: Array<{ id, type, patient, message, timestamp, received_at }> }`
- No Qdrant collections, no vectors, no new env vars/secrets.

## Acceptance criteria

- [ ] Backend: `uvicorn app.main:app` starts clean; `curl -X POST localhost:8000/api/v1/alert -H "Content-Type: application/json" -d '{"type":"sos","patient":"Robert","message":"test"}'` returns `{status:"ok", alert_id, received_at}`; `GET /api/v1/alerts` lists it. Existing endpoints (`/voices`, `/evaluate`, `/persona/chat`, `/tts`) still respond.
- [ ] A red "Help" button is visible and fixed on every screen (Home, Avatar, Memories) and over the reminder banner.
- [ ] Tapping it shows a large confirmation modal; confirming POSTs to `/alert` and invokes a `tel:` dial to the saved caregiver, then shows the reassuring "Calling … help is on the way" screen.
- [ ] With **no** contact saved, confirming shows the gentle "no contact saved" message and does **not** crash or dial.
- [ ] Onboarding can capture a caregiver name+phone; it appears in `getState().emergencyContacts` (check via DevTools / `localStorage`), and is editable later in PersonaEditor/settings.
- [ ] In WellbeingInsights, an evaluation returning `mood: 'anxious'`/`'low'` or non-empty `concerns` shows a calm caregiver prompt with a "Notify caregiver" action that POSTs `{ type: 'distress', ... }`; clicking it twice for the same evaluation does not double-fire.
- [ ] Multilingual persona behavior (English/Hindi/Hinglish) is unaffected.

## Constraints / Do not break

- Reuse the shared `qdrant_client` if you ever touch Qdrant (you should not need to here). Never construct a second `QdrantClient`.
- Keep all existing endpoints and their request/response shapes working; only ADD the alerts router + its `include_router` line in `app/main.py`.
- Preserve the `factech_state_v1` localStorage key and existing fields; only add `emergencyContacts`. Existing saved profiles must keep working.
- Match existing code style: inline `<style>` blocks in JSX, dark theme (`#0f172a`, violet/blue gradients; red only for the SOS), large dementia-friendly tap targets, warm reassuring copy. Use `lucide-react` icons already in the dep tree (`Phone`, `PhoneOff`, `Heart`, `X`, `AlertCircle`).
- API base must be `import.meta.env.VITE_API_BASE || '/api/v1'` everywhere — no hardcoded hosts, no secrets in code.
- Preserve multilingual support driven by `persona.language` (do not alter persona/chat/TTS logic).

## Out of scope

- Real SMS/email/push delivery, Twilio, or any external notifier (backend just records the alert; leave a TODO).
- Caregiver authentication, a caregiver dashboard UI, or real multi-user backend persistence (single-user kiosk assumption stays).
- Geolocation, native device calling beyond `tel:`, or background/while-tab-closed alerting.
- Changing `evaluate_conversation`'s prompt or the persona chat model.

---

# Feature 6 — Avatar conversation overhaul (one voice, interruptible, non-repetitive)

> **Status: Part A (bug fixes) implemented.** Part B (barge-in, streaming, lip-sync, mood) below.

# Overhaul the Avatar conversation: one voice, interruptible, non-repetitive, alive

You are working in the **Factech AI** repo: a React (Vite) + FastAPI "AI memory companion" for dementia patients. The **Avatar** page is a voice + text chat that role-plays a persona of the user's loved one. Your job is to fix the broken conversation experience and then layer in high-impact upgrades. Work directly in the existing repo; reuse existing services and endpoints.

---

## 1. Context — current broken behavior (verified against the code)

The companion currently feels like a rough prototype. Re-read these files before editing; the line numbers below are accurate as of now.

**`frontend/src/pages/AvatarPage.jsx`** (the whole experience lives here):
- **Greeting** `useEffect` (lines 65–78): builds a localized greeting from `profile?.name` (the **full** name) and calls `setMessages([...])`. It does **not** speak, and it does **not** reset `lastActivityRef`.
- **Proactive nudge** `useEffect` (lines 88–108): a `setInterval(…, 5000)` that fires when `Date.now() - lastActivityRef.current >= 22000` and `nudgeCountRef.current < 2`. Lines come from a hardcoded `linesFor(lang, name)` (lines 89–93) using `profile?.name`, then calls `speak(line)` (line 105). It never sets `busyRef`, so two nudges (and a nudge + a reply) can run concurrently. On an idle open it emits **both** canned check-ins (`"Are you still there, Abhinav Panwar? I'm right here with you."` / `"How are you feeling right now, Abhinav Panwar?"`) within ~40s.
- **`speak(text)`** (lines 112–149): creates `new Audio(data:…base64)`, assigns `audioRef.current`, `await audio.play()`. It **does NOT** `pause()` the prior `audioRef.current` or `window.speechSynthesis.cancel()` before starting → **overlapping voices**. On any `catch` (including a rejected `audio.play()`) it falls through to `window.speechSynthesis.speak(u)` (lines 135–145) **even if the MP3 is still buffering/playing** → the **same line spoken by two engines**. `afterSpeak()` (lines 116–120) flips `isSpeaking`/`busyRef` and restarts the mic after 700ms in call mode.
- **`runTurn`** (160–188): sends `user: { name: profile?.name }` (full name, line 174) to `/persona/chat`; fallbacks (177, 183) also embed the full name.
- **Auto-talk voice loop** (`startListening` 233–271, `endCall` 285–295): non-continuous `SpeechRecognition`, echo guard via `lastSpokenRef` (lines 113, 249–250). `endCall` already pauses `audioRef` + cancels speechSynthesis — your new central stop should match this.

**`frontend/src/App.jsx`** (separate concern, real third voice): a global reminder `useEffect` (17–53) calls `window.speechSynthesis.speak(u)` (line 23/45) with **no** `cancel()` first and no awareness of the avatar — it can talk over the avatar's MP3.

**Backend (re-use, do not duplicate):**
- `app/services/llm_service.py` → `chat_as_persona(user_text, persona, user, history, memories)` (179–298): builds the persona system prompt; `user_name = user.get("name") or "dear"` (line 194, **full name**); already has anti-repetition (226–227), multilingual EN/Hindi-Devanagari/Hinglish (258–272), style rules (201–207), a memories block (239–246), and model fallback `llama-3.3-70b-versatile → llama-3.1-8b-instant` (285) at `temperature=0.85`. There is **no** instruction to shorten the name or use it sparingly.
- `app/services/tts_service.py` → `async synthesize(text, voice=None, rate=None) -> base64 MP3` (56–92) via edge-tts; supports a `rate` like `"-8%"`.
- `app/api/persona_endpoint.py`: `POST /persona/chat` (46–58, calls `episodic_memory.retrieve` then `chat_as_persona`), `POST /tts` (77–107, default `rate="-8%"`), `POST /remember` (61–74), `POST /evaluate` (34–43), `GET /voices`. Base path is `/api/v1` (frontend `API_BASE`).
- `app/services/episodic_memory.py` → `episodic_memory.retrieve(user, query, limit=4)` and `add_memories(user, facts)`. **Reuse the shared Qdrant client + MiniLM encoder — never construct a second.**

**Avatar visuals:** `frontend/src/components/PhotoAvatar.jsx` and `Avatar3D.jsx` currently get only a boolean `isSpeaking` and glow/breathe/bob — the mouth never matches the audio.

---

## 2. Goal

Deliver a conversation that feels like a real person on a phone call:
- **Exactly one voice ever** — no overlap, no double-engine, no cross-component collision.
- **No robotic self-talk** — proactive check-ins are rare, varied, contextual (or off by default), never two near-identical canned lines in 40s.
- **Natural naming** — derive and use the **first name**, used sparingly, never in every line.
- **Interruptible (barge-in)** — the user can talk over the avatar and it stops instantly to listen.
- **Low latency + lively** — streaming reply + sentence-chunked TTS, audio-driven lip-sync, mood-adaptive tone, memory-grounded companionship.

**Constraints (hard):** reuse existing services/endpoints (no new Qdrant client/model, no new LLM provider); preserve EN/Hindi(Devanagari)/Hinglish via `persona.language`; keep every existing endpoint working (add new ones alongside); match the inline-`<style>` dark theme; no hardcoded secrets; keep it dementia-friendly (calm, short, never quiz-like).

---

## 3. Implementation plan

### PART A — Bug fixes (do these first; they stand alone)

**A1. One central `speak()` that guarantees a single utterance.** Rewrite `speak()` in `AvatarPage.jsx` (112–149):
1. At the very top, **hard-stop everything currently playing** before starting:
   ```js
   try { audioRef.current?.pause(); } catch {}
   if (audioRef.current) { audioRef.current.onended = null; audioRef.current.onerror = null; }
   audioRef.current = null;
   try { window.speechSynthesis?.cancel(); } catch {}
   ```
   Detaching `onended`/`onerror` before nulling is required so the **stopped** clip's `afterSpeak` can't flip `isSpeaking`/`busyRef` for the **new** utterance.
2. Add a **request token** to defeat stale async TTS: `const myId = ++speakIdRef.current;` (a `useRef(0)`). After `await axios.post('/tts', …)` returns, **bail if `speakIdRef.current !== myId`** (a newer `speak`/interrupt happened) — do not start playback.
3. **Only fall back to speechSynthesis when the server returned no audio**, never on a `play()` race. Wrap `audio.play()` in its own `try/catch`; on reject, `audioRef.current = null` and fall through. On a successful `play()`, `return` (do **not** also synth). Structure:
   ```js
   try {
     const r = await axios.post(`${API_BASE}/tts`, { text, voice: persona.voiceId, clone_voice_id: persona.voiceCloneId }, { timeout: 30000 });
     if (speakIdRef.current !== myId) return;            // superseded
     if (r.data?.audio_base64) {
       const audio = new Audio(`data:audio/mpeg;base64,${r.data.audio_base64}`);
       audioRef.current = audio; setIsSpeaking(true);
       audio.onended = afterSpeak; audio.onerror = afterSpeak;
       try { await audio.play(); return; }              // success -> never synth
       catch { audioRef.current = null; }               // autoplay race -> fall through
     }
   } catch {}                                           // network/TTS down -> synth fallback
   // ... existing speechSynthesis fallback unchanged ...
   ```
4. Keep `afterSpeak` as-is (clears `isSpeaking`/`busyRef`, restarts mic after 700ms in call mode).

**A2. Serialize callers.** `runTurn` already sets `busyRef.current = true`. Make the proactive nudge set `busyRef.current = true` before it speaks too, so the nudge gate at line 95 (`if (callModeRef.current || busyRef.current || editing) return;`) blocks a second nudge while the first is still speaking. `afterSpeak()` clears it when the clip ends.

**A3. Tame proactive check-ins.** Replace the nudge `useEffect` (88–108) so it is **rare, gated on real engagement, single, and varied** — pick ONE of:
- **Preferred (LLM-authored, see B3):** route the nudge through `POST /persona/chat` with an internal directive so the existing anti-repetition + multilingual + memory rules generate a fresh line. Cap at **1** per idle stretch; require the user to have spoken at least once (`userSpokeRef`); idle threshold **≥ 45000ms**; never two nudges without an intervening user turn.
- **Minimum:** keep canned `linesFor` but (a) reset `lastActivityRef.current = Date.now()` and `nudgeCountRef.current = 0` in the **greeting** `useEffect`; (b) add `userSpokeRef` (set true in `runTurn`) and `if (!userSpokeRef.current) return;`; (c) raise idle to ≥45s and cap to **1**; (d) drop the name from one of the two lines so it isn't in every line.
- **Acceptable:** ship proactive nudges **off by default** behind a flag and rely on greeting + replies only.

**A4. First-name everywhere.**
- Frontend: near the top of the component, `const firstName = (profile?.name || 'dear').trim().split(/\s+/)[0] || 'dear';`. Use `firstName` in the greeting (68–74), nudge lines, and both `runTurn` fallbacks (177, 183). Send the short name to the backend: change `user: { name: profile?.name }` → `user: { name: firstName }` in `runTurn` (174) **and** `flushSession` (205) so the brain and client stay consistent.
- Backend (defense in depth): in `chat_as_persona` (line 194) replace `user_name = user.get("name") or "dear"` with:
  ```python
  raw_name = (user.get("name") or "").strip()
  user_name = raw_name.split()[0] if raw_name else "dear"
  ```
  And after line 219 add a sparing-use rule to the system prompt: `f"Address them as {user_name} (first name only), and use their name only occasionally — never in every sentence. "`

**A5. Cross-component voice.** In `App.jsx` reminder `speak()` (18–25), call `window.speechSynthesis.cancel()` before `speak(u)`. Gate firing so it doesn't talk over a live avatar (see B1's shared `isSpeaking()` flag): `if (!isSpeaking()) speak(line, ttsLang);` — the banner still shows, so nothing is lost.

### PART B — Upgrades (prioritized; each builds on A1's central gate)

**B1 — Single-speaker audio bus + barge-in (highest priority).**
- Centralize all speech in one module so only one utterance is ever audible app-wide. Reuse `frontend/src/lib/store.js` (no new dep): export `isSpeaking()`, `stopSpeech()`, and `speakOnce({ text, ttsLang, fetchMp3 })` that owns **both** channels (the `<audio>` element and `speechSynthesis`), calling `stopSpeech()` first so every new utterance pre-empts the previous on both channels.
- Route `AvatarPage.speak()` and `App.jsx` reminder speech through this bus.
- **Barge-in:** run `SpeechRecognition` with `continuous=true` + `interimResults=true` even while `isSpeaking`. When a **non-echo** interim transcript of real length arrives, immediately `stopSpeech()`, clear the 700ms `afterSpeak` restart timer, and route straight into `runTurn`. Reuse the `lastSpokenRef` echo guard (113, 249–250) so the avatar's own voice can't self-interrupt. Add a subtle "tap to interrupt" affordance on the `av-call` banner.
- All in `AvatarPage.jsx` + `store.js`; no backend change.

**B2 — Streaming brain + sentence-chunked TTS.**
- Backend `llm_service.py`: add a generator variant of `chat_as_persona` using the Groq SDK `stream=True` (reuse the exact same `system_prompt`, model fallback, memories block, multilingual rules). Buffer tokens to a sentence boundary (`.`, `?`, `!`, or Devanagari danda `।`) and yield each sentence.
- `tts_service.py`: reuse `synthesize` per sentence.
- `persona_endpoint.py`: add a new SSE/`StreamingResponse` endpoint **alongside** `/persona/chat` (keep the old one). Emit one event per completed sentence: `{ "text": "...", "audio_base64": "..." }`.
- `AvatarPage.jsx` `runTurn` (171–181): replace the single POST with a stream reader that appends each sentence to the chat bubble as it arrives and **enqueues its audio into B1's bus** so sentences play back-to-back. Pre-fetch the next sentence's TTS while the current plays. Composes with barge-in (interrupt clears the queue).

**B3 — LLM-authored, memory-grounded proactive companionship.** (Implements A3's preferred path.) In the nudge interval, when gates pass, set `busyRef.current = true`, then `await axios.post('/persona/chat', …)` with an **internal directive** that is **never** pushed to `messages`/history, e.g.:
```js
const directive = `[The user has gone quiet for a little while. As ${persona.name}, gently and briefly check in on them in a fresh, natural way — vary your wording, do not repeat earlier lines, and do not use their full name. One short sentence.]`;
```
Pass `history: messagesRef.current.slice(-8)`, `user: { name: firstName }`, the persona block. The endpoint already calls `episodic_memory.retrieve` so the check-in can reference a real shared memory. Re-check guards after the `await` (user may have spoken); fall back to canned `linesFor` only on network error. Keep a `recentBotLinesRef` and skip speaking a line too similar (normalized substring/Jaccard) to a recent one.

**B4 — Audio-driven lip-sync.** Route the playing `<audio>` element (in B1's bus) through a WebAudio `createMediaElementSource → AnalyserNode`; expose a per-frame normalized amplitude via a ref. Pass amplitude (alongside `isSpeaking`) into `PhotoAvatar` (drive a lower-face vertical scale / mouth highlight) and `Avatar3D` (map amplitude to a `jawOpen`/`mouthOpen` morph in the `useFrame` loop, lines 9–16, if the GLB exposes morph targets; else amplitude-scaled head bob). One bus → one analyser, no contention.

**B5 — Emotion/mood-adaptive tone.** Infer a coarse mood (`positive|neutral|low|anxious`) for the current user turn — cheapest path: a tiny `llama-3.1-8b-instant` classification (reuse the patterns in `evaluate_conversation`, 73–118) or a leading tag on the streamed reply. Feed it back two ways: (1) append a mood-conditioned style directive to the persona system prompt (anxious → slower, shorter, extra reassuring, no quiz-like questions); (2) pass a mood-derived `rate` to `/tts` (`tts_service.synthesize` already accepts `rate`; endpoint default `-8%`) — slower/softer for low/anxious. Optionally reflect mood in the `av-state` pill (322–324).

---

## 4. Data contracts

**New: `POST /api/v1/persona/chat/stream`** (B2) — keep `/persona/chat` unchanged.
- Request (same shape as `/persona/chat`):
  ```json
  { "text": "string", "persona": { "name": "", "relationship": "", "personality": "", "gender": "", "age": 0, "accent": "", "language": "", "style": "" }, "user": { "name": "firstNameOnly" }, "history": [ { "role": "user|bot", "text": "" } ], "mood": "positive|neutral|low|anxious" }
  ```
- Response: `text/event-stream`, one `data:` event per sentence, terminated by `[DONE]`:
  ```
  data: {"text":"First sentence.","audio_base64":"<mp3 b64>","mime":"audio/mpeg"}
  data: {"text":"Second sentence.","audio_base64":"<mp3 b64>","mime":"audio/mpeg"}
  data: [DONE]
  ```

**Optional new: `POST /api/v1/persona/nudge`** (if you prefer a dedicated endpoint over reusing `/persona/chat` for B3). Request = persona + user + `history`; Response `{ "status": "ok", "text": "one short check-in" }`. (Reusing `/persona/chat` with the directive is acceptable and avoids new surface.)

**`/tts`** — unchanged shape; `rate` now driven by mood when B5 lands: `{ "text": "", "voice": "", "clone_voice_id": "", "rate": "-8%" }`.

**Store additions (`store.js`):** `isSpeaking(): boolean`, `stopSpeech(): void`, `speakOnce({ text, ttsLang, fetchMp3? }): Promise<void>`. No new persisted fields required; if you add a "proactive nudges on/off" toggle, persist it under the existing `persona` object (e.g. `persona.proactive`), not a new top-level key.

---

## 5. Acceptance criteria (checkable)

- [ ] **One voice only.** Rapidly trigger a reply + a nudge (or two sends back-to-back): never two overlapping voices, and never the same line spoken by both the MP3 and `speechSynthesis`.
- [ ] **No self-talk spam.** Open Avatar and stay silent ~60s: at most **one** gentle, varied check-in (or none if off), and it only happens **after** the user has spoken at least once.
- [ ] **First name, used sparingly.** Greeting and replies say "Abhinav," not "Abhinav Panwar," and the name does **not** appear in every sentence.
- [ ] **Barge-in.** While the avatar is mid-sentence, speak over it: audio stops within ~300ms and the avatar processes your interruption.
- [ ] **Low latency (B2).** First spoken words begin in well under the previous full-reply wait; sentences play seamlessly back-to-back.
- [ ] **Memory recall.** After a session where the user mentions something durable (e.g. "Meera visited Sunday"), end the call (triggers `/remember`), reopen, and the companion naturally references it later — confirm via `episodic_memory.retrieve`.
- [ ] **Multilingual intact.** With `persona.language` = Hindi → Devanagari replies; Hinglish → Roman Hindi-English; STT/TTS langs still derive correctly (`sttLang`/`ttsLang`, 42–45).
- [ ] **No cross-component overlap.** A reminder firing during avatar speech does not layer over it.
- [ ] **Manual path:** open Avatar → only one voice, no canned double check-in, first-name used naturally, can interrupt mid-sentence, recalls a prior memory, dark theme unchanged.

---

## 6. Constraints / do not break / out of scope

**Do not break:** reuse `llm_service`, `tts_service`, `episodic_memory` (shared Qdrant client + MiniLM encoder — **never** a second), and the Groq client; keep `/persona/chat`, `/tts`, `/remember`, `/evaluate`, `/voices`, `/clone-voice` working (add new endpoints alongside); preserve EN/Hindi(Devanagari)/Hinglish via `persona.language`; match the inline-`<style>` dark theme (`.av`, `.av-call`, `.av-state`, gradients) — no new CSS framework; no hardcoded secrets (`GROQ_API_KEY`/`ELEVENLABS_API_KEY` stay in env); keep it dementia-friendly (calm, short, no quizzing). The fallback voice cloning path (`clone_voice_id` → `voice_clone_service`) must keep working through the new bus.

**Out of scope:** onboarding flow, Memories/Home/wellbeing pages, reminder scheduling logic (only its `speak()` cancel + gate), persona generation/3D model generation, auth/multi-user, swapping the LLM/TTS providers. Don't introduce new infra or a second vector DB.

**Working style:** prefer small, verifiable commits in order A → B1 → B2 → B3 → B4 → B5. After Part A, manually verify the "one voice / no self-talk / first name" criteria before moving on. Show diffs and the test path you used.

---

# Feature 7 — Reminiscence / life-story builder

# Claude Code Prompt — Reminiscence / Life-Story Builder

> Paste this whole file into Claude Code as a single task. It is grounded in the real Factech AI codebase (Factech AI). File paths, function signatures and patterns below were verified against the current tree.

---

## 1. Context (verified against the repo)

**Stack:** React (Vite) frontend + FastAPI backend. Routers mount under `settings.API_V1_STR` (= `/api/v1`) in `app/main.py` (e.g. `app.include_router(persona_endpoint.router, prefix=settings.API_V1_STR)`, lines 36–39).

**Persona / LLM brain** — `app/services/llm_service.py`, singleton `llm_service` (instantiated at module bottom, line 303):
- `chat_as_persona(user_text, persona=None, user=None, history=None, memories=None) -> str` (line 179) — role-plays in first person as the user's loved one. Already injects retrieved `memories` into the system prompt (lines 242–249) and is fully multilingual: `persona.language` of `"hindi"` forces Devanagari, `"hinglish"` forces Roman Hinglish (lines 261–275). **Reuse this for narration/voice; do not write a second persona prompt.**
- `summarize_session(transcript, persona, user) -> list[str]` (line 120) — distils durable third-person facts, language-preserving (lines 147–148). Returns `{"facts": [...]}` parsed to a list.
- `evaluate_conversation(...)` (line 73) and `generate_response(...)` (line 20) also exist.

**Episodic memory** — `app/services/episodic_memory.py`, singleton `episodic_memory` (line 122):
- Collection `"episodic_memory"`, `VECTOR_SIZE = 384` (all-MiniLM), cosine.
- `add_memories(user: dict, facts: list) -> int` (line 68) — embeds + upserts; payload `{text, user_key, created_at}`.
- `retrieve(user: dict, query: str, limit=4) -> list[str]` (line 100) — top-K per-user, filtered on `user_key`.
- `_user_key(user)` (line 26) — stable sha1 of `user["name"]` (script-safe), `"default"` when empty. **Use this same per-user scoping for stories.**
- Reuses the **shared** `qdrant_client` (`app/core/db.py`, line 19) and the **already-loaded** encoder `semantic_memory.encoder` (line 20). Never construct a second client or model.

**Shared infra:**
- `app/core/db.py` — the ONE `qdrant_client` (line 25). Embedded Qdrant locks its folder per client; a second instance crashes.
- `app/services/semantic_memory.py` — loads `SentenceTransformer('all-MiniLM-L6-v2')` once as `semantic_memory.encoder` (line 13). 384-dim.

**Persona endpoints** — `app/api/persona_endpoint.py` (router with no internal prefix; mounted at `/api/v1`):
- `POST /persona/chat` (line 46) — retrieves memories then calls `chat_as_persona`. Request `{text, persona, user, history}` → `{status, text}`.
- `POST /remember` (line 61) — `summarize_session` → `add_memories`. Request `{transcript, persona, user}` → `{status, stored, facts}`.
- `POST /tts` (line 77) — `{text, voice, clone_voice_id, rate}` → `{status, audio_base64, mime, cloned}`.

**Frontend:**
- State is **localStorage-only** via `frontend/src/lib/store.js`, key `factech_state_v1`. `defaultState` (line 7) = `{profile, persona, memories, transcript, reminders, insightsHistory}`. Mutate only through the exported helpers (`set(...)` persists + emits). `useAppState()` is the React hook (line 85).
- API base: `const API_BASE = import.meta.env.VITE_API_BASE || '/api/v1';` (see `AvatarPage.jsx` line 9).
- Views are switched by string state in `frontend/src/App.jsx` (`view` state, lines 61–64) — **no React Router**. Nav tabs live in `frontend/src/components/SideNav.jsx` `TABS` array (lines 4–8).
- `AvatarPage.jsx` shows the persona, `speak(text)` (line 122) does TTS-with-fallback, `runTurn(text)` (line 188) does one chat turn. `firstName` derived at line 50.
- `MemoriesPage.jsx` is the visual reference for card grids + dark inline `<style>` + modal pattern.

**Theme:** dark, dementia-friendly. Inline `<style>{...}` blocks per page. Palette: bg `#0f172a` / `#1e1b4b`, cards `rgba(30,41,59,0.6)`, accent gradient `linear-gradient(135deg,#7c3aed,#2563eb)`, accent text `#a78bfa`/`#c4b5fd`, body text `#e2e8f0`, muted `#94a3b8`.

**Secrets:** Groq key via `settings.GROQ_API_KEY` / env (`llm_service.py` line 7). Never hardcode keys.

---

## 2. Goal

Add a **Reminiscence / Life-Story Builder**: the companion asks gentle, one-at-a-time life-story questions (proactively and on demand), saves each answer as a durable `"story"` memory tagged to a life chapter, and renders a browsable, narrated **Life Timeline** the patient and family can revisit — reusing `chat_as_persona`, the episodic-memory plumbing, and the existing TTS.

---

## 3. Implementation plan

### 3.1 Backend — new service `app/services/lifestory_service.py` (CREATE)

A thin wrapper that stores/reads life-story memories in their own collection, mirroring `EpisodicMemoryService` exactly (shared client + shared encoder, non-destructive `_ensure_collection`, `user_key` keyword index). **Import `_user_key` from `episodic_memory` — do not re-implement the hashing.**

```python
COLLECTION = "lifestory_memory"
VECTOR_SIZE = 384  # all-MiniLM-L6-v2

class LifeStoryService:
    def __init__(self):
        self.client = qdrant_client                 # shared, from app.core.db
        self.encoder = semantic_memory.encoder       # shared, already loaded
        self._ensure_collection()                    # create only if missing; index user_key + chapter

    def add_story(self, user: dict, text: str, *, prompt: str = "",
                  chapter: str = "life", era: str | None = None) -> dict | None:
        """Embed one life-story answer and upsert. Returns the stored record
        (id, text, prompt, chapter, era, created_at) or None if text is empty."""

    def list_stories(self, user: dict, limit: int = 200) -> list[dict]:
        """All stories for this user, newest-first, scrolled (NOT vector-searched)."""

    def retrieve(self, user: dict, query: str, limit: int = 4) -> list[str]:
        """Top-K relevant story texts (for weaving into chat_as_persona memories)."""

lifestory_service = LifeStoryService()  # singleton — import, never reconstruct
```

Implementation notes:
- `add_story`: `id = str(uuid.uuid4())`, vector = `self.encoder.encode(text).tolist()`, payload `{text, prompt, chapter, era, user_key, created_at: datetime.utcnow().isoformat()}`. Wrap encode/upsert in try/except and fail-soft like episodic (`return None` on failure).
- `list_stories`: use `self.client.scroll(collection_name=COLLECTION, scroll_filter=Filter(must=[FieldCondition(key="user_key", match=MatchValue(value=_user_key(user)))]), limit=limit, with_payload=True)`. Map points → dicts incl. their `id`. Sort by `created_at` descending in Python.
- `_ensure_collection`: copy episodic's non-destructive guard (`collection_exists` then `create_collection`); add keyword payload indexes for both `user_key` and `chapter` (idempotent, swallow errors).

### 3.2 Backend — new prompt-bank + endpoints in `app/api/persona_endpoint.py` (MODIFY)

Add `from app.services.lifestory_service import lifestory_service` next to the existing service imports (line 10 area).

**Reminiscence question bank** — module-level constant (place near `NEURAL_VOICES`). Keyed by chapter, each question localized for `en` / `hindi` (Devanagari) / `hinglish`:

```python
REMINISCENCE_PROMPTS = {
  "childhood": [
    {"en": "What was your childhood home like?",
     "hindi": "आपका बचपन का घर कैसा था?",
     "hinglish": "Aapka bachpan ka ghar kaisa tha?"},
    {"en": "Who was your best friend when you were young?",
     "hindi": "बचपन में आपका सबसे अच्छा दोस्त कौन था?",
     "hinglish": "Bachpan mein aapka sabse accha dost kaun tha?"},
    {"en": "What games did you love to play as a child?",
     "hindi": "बचपन में आपको कौन से खेल पसंद थे?",
     "hinglish": "Bachpan mein aapko kaunse khel pasand the?"},
  ],
  "family": [
    {"en": "Tell me about your parents.",
     "hindi": "अपने माता-पिता के बारे में बताइए।",
     "hinglish": "Apne maa-baap ke baare mein bataiye."},
    {"en": "What is your favourite memory of your brothers or sisters?",
     "hindi": "अपने भाई-बहनों की सबसे प्यारी याद कौन सी है?",
     "hinglish": "Apne bhai-behno ki sabse pyaari yaad kaunsi hai?"},
  ],
  "love": [
    {"en": "Tell me about your wedding day.",
     "hindi": "अपनी शादी के दिन के बारे में बताइए।",
     "hinglish": "Apni shaadi ke din ke baare mein bataiye."},
    {"en": "How did you first meet your partner?",
     "hindi": "आप अपने जीवनसाथी से पहली बार कैसे मिले?",
     "hinglish": "Aap apne life-partner se pehli baar kaise mile?"},
  ],
  "work": [
    {"en": "What did you do for work?",
     "hindi": "आप क्या काम करते थे?",
     "hinglish": "Aap kya kaam karte the?"},
    {"en": "What were you most proud of in your career?",
     "hindi": "अपने काम में आपको किस बात पर सबसे ज़्यादा गर्व है?",
     "hinglish": "Apne kaam mein aapko kis baat par sabse zyada garv hai?"},
  ],
  "places": [
    {"en": "Where is the most beautiful place you have ever travelled to?",
     "hindi": "आपने अब तक की सबसे सुंदर जगह कौन सी देखी है?",
     "hinglish": "Aapne ab tak ki sabse sundar jagah kaunsi dekhi hai?"},
  ],
  "joys": [
    {"en": "What food reminds you of home?",
     "hindi": "कौन सा खाना आपको घर की याद दिलाता है?",
     "hinglish": "Kaunsa khaana aapko ghar ki yaad dilata hai?"},
    {"en": "What is a song you have always loved?",
     "hindi": "कौन सा गाना आपको हमेशा से पसंद है?",
     "hinglish": "Kaunsa gaana aapko hamesha se pasand hai?"},
  ],
}
CHAPTER_ORDER = ["childhood", "family", "love", "work", "places", "joys"]
```

Add a helper `def _pick_lang(persona): return (persona or {}).get("language","").strip().lower() or "en"` and resolve each prompt to the right language string (fall back to `"en"`).

**Endpoint A — get a prompt:**
- `POST /lifestory/prompt`
- Request: `{ "persona": {...}, "user": {...}, "chapter": "auto", "answered_prompts": ["...already asked english keys..."] }`
- Behaviour: choose a chapter (explicit `chapter`, or walk `CHAPTER_ORDER` when `"auto"`), pick the first question in that chapter whose `en` text is **not** in `answered_prompts`; if all answered, advance chapters; if everything answered, return `{"status":"done"}`.
- Response: `{ "status":"ok", "chapter":"love", "prompt_en":"Tell me about your wedding day.", "prompt":"<localized text>" }`

**Endpoint B — save an answer as a story:**
- `POST /lifestory/answer`
- Request: `{ "persona":{...}, "user":{...}, "chapter":"love", "prompt_en":"Tell me about your wedding day.", "answer":"<patient's words>" }`
- Behaviour: if `answer.strip()` is empty → `{"status":"empty"}`. Otherwise call `llm_service.summarize_session([...])` style is overkill for one line — instead store the raw answer **plus** optionally a one-line tidy. Keep it simple: store the raw answer verbatim via `lifestory_service.add_story(user, answer, prompt=prompt_en, chapter=chapter)` **and** also push it into episodic memory so chat recall benefits: `episodic_memory.add_memories(user, [answer])`. Preserve the user's language — do **not** translate.
- Response: `{ "status":"ok", "story": { id, text, prompt, chapter, created_at } }`

**Endpoint C — list the timeline:**
- `GET /lifestory/list?name=<profile.name>`  (name in query so it scopes per user; empty → `"default"`)
- Behaviour: `lifestory_service.list_stories({"name": name})`.
- Response: `{ "status":"ok", "stories":[ {id, text, prompt, chapter, era, created_at}, ... ] }`  (newest-first)

**Endpoint D — narrate the life story (optional, reuse persona voice):**
- `POST /lifestory/narrate`
- Request: `{ "persona":{...}, "user":{...}, "stories":[ "...text...", ... ] }`
- Behaviour: build a short warm narration by calling `llm_service.chat_as_persona(user_text, persona=persona, user=user, memories=stories[:8])` where `user_text` is a gentle instruction like `"Tell me my life story so far, warmly, in a few sentences."` This automatically respects the persona's language. Return `{ "status":"ok", "text": narration }`. (Frontend then plays it through the existing `/tts`.)

### 3.3 Frontend — store keys in `frontend/src/lib/store.js` (MODIFY)

- Extend `defaultState` (line 7) with `lifeStories: []` and `lifeStoryProgress: { answered: [] }`.  (Spread-merge in `load()` already backfills old saved state.)
- Add helpers (mirror `addMemory`/`addTurn` style — go through `set(...)`):
  - `addLifeStory(story)` → unshift into `state.lifeStories` (newest-first), de-dupe by `id`.
  - `setLifeStories(list)` → replace wholesale (used after a `/lifestory/list` sync).
  - `removeLifeStory(id)` → filter out.
  - `markPromptAnswered(promptEn)` → append to `state.lifeStoryProgress.answered` if absent.

### 3.4 Frontend — new page `frontend/src/pages/LifeStoryPage.jsx` (CREATE)

Two zones, dark inline-`<style>` matching `MemoriesPage.jsx`:

1. **Ask zone** ("Reminiscence"): a big card showing the current question. Buttons: "Ask me this" (calls `speak(prompt)` — copy the TTS pattern from `AvatarPage.speak`, lines 122–177, or factor a tiny shared `speakText` helper), a **mic** capture (reuse `window.SpeechRecognition` / `webkitSpeechRecognition` with `sttLang` derived from `persona.language` exactly like `AvatarPage` lines 42–47), and a text `<textarea>` fallback. On submit → `POST /lifestory/answer`, then `addLifeStory(resp.story)` + `markPromptAnswered(prompt_en)`, then fetch the next via `POST /lifestory/prompt` (passing `lifeStoryProgress.answered`).
2. **Timeline zone**: on mount, `GET /lifestory/list?name=<profile.name>` → `setLifeStories`. Render stories grouped by `chapter` in `CHAPTER_ORDER`, each as a card with the chapter label, the question (small, muted) and the answer (body). A "Play my story" button calls `POST /lifestory/narrate` then `/tts` to read it aloud. Empty state mirrors `MemoriesPage` `.mem-empty`.

Use `const API_BASE = import.meta.env.VITE_API_BASE || '/api/v1';` and `axios`. `firstName` from `profile?.name` like `AvatarPage` line 50.

### 3.5 Frontend — wire navigation (MODIFY)

- `frontend/src/components/SideNav.jsx`: add `{ id: 'lifestory', label: 'Life Story', icon: BookOpen }` to `TABS` (import `BookOpen` from `lucide-react`).
- `frontend/src/App.jsx`: import `LifeStoryPage`; add `else if (view === 'lifestory') content = <LifeStoryPage />;` in the view switch (lines 61–64).

### 3.6 (Optional) AvatarPage proactive nudge (MODIFY, keep minimal)

In `AvatarPage.jsx`, after the user has engaged, occasionally surface ONE reminiscence question via the existing chat flow (reuse the proactive interval scaffolding at lines 97–118; do not add a new timer system). Gate it behind the existing `userSpokeRef`/`nudgeCountRef` guards so it never talks unsolicited. This is a nice-to-have — ship 3.1–3.5 first.

---

## 4. Data contract

### Qdrant collection `lifestory_memory` (new)
- size 384, distance COSINE, payload-indexed on `user_key` and `chapter` (keyword).
- Point payload:
```json
{
  "text": "We married in 1968 in Lucknow, it rained all evening.",
  "prompt": "Tell me about your wedding day.",
  "chapter": "love",
  "era": null,
  "user_key": "<sha1(name)[:16] | 'default'>",
  "created_at": "2026-06-14T10:22:03.119Z"
}
```

### Endpoint JSON (summary)
| Method | Path | Request | Response |
|---|---|---|---|
| POST | `/api/v1/lifestory/prompt` | `{persona,user,chapter,answered_prompts[]}` | `{status:"ok",chapter,prompt_en,prompt}` or `{status:"done"}` |
| POST | `/api/v1/lifestory/answer` | `{persona,user,chapter,prompt_en,answer}` | `{status:"ok",story:{id,text,prompt,chapter,created_at}}` or `{status:"empty"}` |
| GET | `/api/v1/lifestory/list?name=` | – | `{status:"ok",stories:[{id,text,prompt,chapter,era,created_at}]}` |
| POST | `/api/v1/lifestory/narrate` | `{persona,user,stories[]}` | `{status:"ok",text}` |

### `store.js` keys (new)
- `lifeStories: [{ id, text, prompt, chapter, era, created_at }]`  (newest-first)
- `lifeStoryProgress: { answered: ["<english prompt text>", ...] }`

Persona object sent from the frontend matches what `AvatarPage` already sends (`AvatarPage.jsx` lines 202, 233): `{name, relationship, personality, gender, age, accent, language, style}`. `user` = `{ name: firstName }`.

---

## 5. Acceptance criteria + manual test path

**Criteria**
1. New collection `lifestory_memory` is created lazily on first use and survives a backend restart (non-destructive — no `recreate_collection`).
2. `POST /lifestory/prompt` returns a question localized to `persona.language` (Devanagari for `hindi`, Roman Hinglish for `hinglish`, English otherwise) and never repeats a prompt already in `answered_prompts`; returns `{"status":"done"}` once exhausted.
3. `POST /lifestory/answer` persists the answer (verbatim, language preserved) to `lifestory_memory` **and** episodic memory; the answer afterwards influences `chat_as_persona` recall.
4. `GET /lifestory/list` returns the user's stories newest-first, scoped by name.
5. The new **Life Story** tab renders the ask-zone + a timeline grouped by chapter, themed to match `MemoriesPage` (dark, accent gradient). "Ask me this" and "Play my story" speak through the existing `/tts` (with browser-speech fallback).
6. No second `QdrantClient` and no second `SentenceTransformer` anywhere. Grep the new service for `QdrantClient(` / `SentenceTransformer(` → must be **zero** matches.

**Manual test**
```bash
# Backend
uvicorn app.main:app --reload
# Frontend
cd frontend && npm run dev
```
1. Open the app → **Life Story** tab.
2. Set the companion's language to Hindi (Avatar → Edit) and confirm the prompt comes back in Devanagari.
3. Tap "Ask me this" → hear the question. Speak or type an answer → Save.
4. Confirm the answer appears in the timeline under the right chapter and that calling it again gives a *new* question.
5. Go to **Avatar**, ask about that topic → the companion recalls it (episodic recall path).
6. Back on Life Story, "Play my story" → hear a warm narration in the persona's language.
7. Restart the backend, reload → timeline still populated (`GET /lifestory/list`).
8. `curl -s -X POST localhost:8000/api/v1/lifestory/prompt -H 'Content-Type: application/json' -d '{"persona":{"language":"hinglish"},"user":{"name":"Asha"},"chapter":"auto","answered_prompts":[]}'` → Hinglish prompt JSON.

---

## 6. Constraints / do-not-break

- **One Qdrant client only** — import `qdrant_client` from `app/core/db.py`. **One encoder only** — use `semantic_memory.encoder`. Never instantiate `QdrantClient(...)` or `SentenceTransformer(...)` in the new service.
- **Reuse `_user_key` from `episodic_memory`** for per-user scoping — do not re-hash names yourself.
- **Reuse `llm_service`** (`chat_as_persona`) for narration so multilingual behaviour (Devanagari / Hinglish / English) is preserved automatically; do not write a parallel persona prompt.
- **Preserve language end-to-end:** store answers verbatim, never translate; prompts localized via the bank.
- **Non-destructive collection creation** — copy episodic's `collection_exists` guard; never `recreate_collection` (it would wipe durable stories on a boot blip).
- **Frontend state only through `store.js` helpers** (they `persist()` + `emit()`); never write `localStorage` directly. Backfill-safe via the spread in `load()`.
- **Theme:** dark dementia-friendly, inline `<style>`, palette from §1. Large tap targets, calm copy, one question at a time.
- **No hardcoded secrets** — Groq key stays in `settings`/env.
- **No new deps, no React Router** — keep the `view`-string navigation in `App.jsx`.
- Endpoints mount with **no internal prefix** (the router is already mounted at `/api/v1`), matching the other `persona_endpoint` routes.

---

## 7. Out of scope

- Photo/audio attachments on life-story entries (timeline is text + narration for now; the separate Memories page already handles media).
- Editing a saved story's text (delete-and-re-add only, if anything).
- Auth / multi-tenant accounts (single-user kiosk; `user_key` already upgrades cleanly when a real `profile.name` exists).
- Family-sharing / export to PDF.
- Server-side persistence of `lifeStoryProgress` (kept in localStorage; the Qdrant store is the durable record).
- Voice cloning changes (the existing `/tts` `clone_voice_id` path is reused as-is, untouched).

---

# Feature 8 — Family portal — shared updates feed

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

---

# Feature 9 — Music & nostalgia therapy

# Claude Code Prompt — Music & Nostalgia Therapy

> Paste this whole file into Claude Code from the repo root. It is grounded in the real Factech AI codebase — file paths and patterns below were verified against the current source.

---

## 1. Context (verified against the repo)

Factech AI is a React (Vite) + FastAPI dementia memory companion. The relevant, **already-existing** pieces you will build on:

- **Client store** — `frontend/src/lib/store.js`. A single `localStorage`-backed store under key `factech_state_v1`, shape `{ profile, persona, memories[], transcript[], reminders[], insightsHistory[] }`. State is read via the `useAppState()` hook (`useSyncExternalStore`). Mutations go through helpers that call the private `set(...)` (e.g. `setProfile`, `addMemory`, `addReminder`/`removeReminder`). Note the existing comment in `persist()`: writes are wrapped in `try/catch` and silently drop on `localStorage` quota overflow — **respect this; do not bloat the store**.
- **Navigation** — `frontend/src/App.jsx` is a plain view switcher: `const [view, setView] = useState('home')`; it renders `'avatar' → <AvatarPage/>`, `'memories' → <MemoriesPage/>`, else `<HomeView onNavigate={setView}/>`. The top nav `frontend/src/components/SideNav.jsx` maps a `TABS` array (`home`, `avatar`, `memories`) to `onViewChange(id)`. **There is no React Router.** A new screen = (a) a new `view` string handled in `App.jsx`, optionally (b) a `TABS` entry in `SideNav.jsx`, and (c) an `onNavigate('...')` call from a HomeView tile.
- **HomeView tiles** — `frontend/src/pages/HomeView.jsx`. Quick-action tiles live in `.hv-tiles` (a `<button className="hv-tile" onClick={() => onNavigate('...')}>` with a `lucide-react` icon, `.hv-tile-t` title, `.hv-tile-d` description). `Reminders` and `WellbeingInsights` are rendered inline below the tiles.
- **Add-item UI pattern** — `frontend/src/components/Reminders.jsx`. This is the canonical pattern to copy: a self-contained component with `useAppState()`, a local `adding` toggle, a small inline form (`.rm-form`), a list, per-item delete, and a single inline `<style>{...}` block. Mirror this structure and its dark theme.
- **Persona config + editor** — the one editable `persona` object (name, relationship, gender, age, accent, `language`, style, personality, `voiceId`, `voiceSample`, `voiceCloneId`, `faceImage`, `modelUrl`) is edited in `frontend/src/components/PersonaEditor.jsx`. Note its `blobToDataUrl(blob)` helper and the file-upload pattern (`<input type="file" accept="audio/*" hidden>` + a ref + `e.target.value = ''` to allow re-selecting the same file).
- **Companion / TTS** — `frontend/src/pages/AvatarPage.jsx` drives the chat + voice. `API_BASE = import.meta.env.VITE_API_BASE || '/api/v1'`. It has a `speak(text)` function (backend TTS at `${API_BASE}/tts`, falling back to `window.speechSynthesis`), localized greeting/nudge lines keyed off `persona.language` (`'hindi'` / `'hinglish'` / default English), and a proactive "gentle check-in" interval that already respects browser audio constraints (it only speaks after the user has interacted — `userSpokeRef`).
- **Multilingual** — labels and spoken lines branch on `(persona?.language || '').toLowerCase()` being `'hindi'`, `'hinglish'`, or default. Follow this exact convention.
- **Theme** — every component ships a dark inline `<style>{...}` block (slate `#0f172a` / `#1e293b` surfaces, violet `#7c3aed`/`#a78bfa` + blue `#2563eb`/`#60a5fa` accents, `rgba(255,255,255,0.09)` borders, ~18–22px radii). No external CSS, no Tailwind.

There is **no** music/audio-player concept in the codebase today. `persona.voiceSample` is an unrelated short voice clip.

---

## 2. Goal

Add a **calm, large-button music player** for nostalgia therapy: the caregiver curates the patient's favorite songs / era playlist, and the patient (or the companion) can play "our song" with one big tap. Music is a proven, deeply-reaching channel for people with dementia. Keep it simple, robust, offline-friendly, multilingual, and dementia-friendly (large controls, minimal choices). Optionally let the companion **offer** music during calm/evening moments.

---

## 3. Implementation plan (numbered)

### Storage decision (read first — justify in a code comment)
Songs are caregiver-provided. **Default to a URL list, with optional small local-file uploads stored as Object URLs (NOT base64 in the store).**

- **Why not base64 in `store.js`:** audio files are megabytes; `localStorage` is ~5 MB total and the store already warns it silently drops writes on quota overflow (`persist()` catch). A single 4-minute MP3 would blow the budget and could corrupt the whole app state silently. **Do not store audio bytes in `localStorage`.**
- **Recommended (simplest robust):** store only **metadata** in the store — a `url` (a streamable/CDN link the caregiver pastes, e.g. a public MP3/OGG URL or an internet-radio/era-playlist stream) **or** a `localName` for a file the caregiver picks at play time. For the player, play `url` directly via an `<audio>` element / `new Audio(url)`.
- **Local uploads (optional, second iteration):** if you want uploaded local files to persist across reloads without bloating `localStorage`, use **IndexedDB** (store the `Blob` keyed by song `id`, create an Object URL at play time with `URL.createObjectURL`, and `URL.revokeObjectURL` on cleanup). If you do NOT want to add IndexedDB now, support local files as **session-only** (Object URL held in component state, not persisted) and clearly label them "available this session" — the URL entries are the durable ones. Pick one and note the choice in a comment. **Do not** put raw audio in the persisted store either way.

### 3a. New `MusicPlayer` component — `frontend/src/components/MusicPlayer.jsx`
A self-contained player + playlist manager, modeled on `Reminders.jsx` structure and theme.
1. Read the playlist with `useAppState()` (see 3c). Keep a single hidden `<audio ref>` (or `new Audio()` in a ref) — never stack two.
2. **Now-playing card:** large album art (`song.art` if present, else a gradient circle with a `lucide-react` `Music`/`Disc3` icon), `song.title`, and `song.artist`/era subtitle.
3. **Large transport controls** (dementia-friendly, big hit targets ≥ 56px): Play/Pause toggle (primary, biggest), Previous, Next. Optionally a large progress bar/seek. Keep it to these few controls — no shuffle/volume clutter.
4. **Playlist list:** each row = art thumb + title + a big "Play" affordance + a delete button (mirror `.rm-item` / `.rm-del`). Tapping a row plays that song.
5. **Add-song form** (mirror `.rm-form`): a title input, optional artist/era input, and a **URL** input *or* a "Choose file" button (`<input type="file" accept="audio/*" hidden>` + ref + `e.target.value=''`, like `PersonaEditor.handleUpload`). On save, call `addSong(...)` from the store. Validate that either a URL or a file is provided.
6. **Playback wiring:** `play(index)` sets current index and plays; `togglePlay`, `next`/`prev` wrap modulo length. On `audio.onended`, auto-advance to next (gentle, no jarring stop). Handle `audio.play()` rejection (autoplay policy) gracefully — see Constraints.
7. Empty state copy (mirror `.rm-empty`): invite the caregiver to add the patient's favorite songs / era. Localize the visible labels via `persona.language` (see Constraints).

### 3b. "Music" tile on HomeView — `frontend/src/pages/HomeView.jsx`
Add a fourth `.hv-tile` button in `.hv-tiles`, using a `lucide-react` `Music` icon (import it), title "Music" (localized), description like "Play your favorite songs" → `onClick={() => onNavigate('music')}`. The grid is already `auto-fit minmax(190px,1fr)` so it reflows. (Alternatively, if you prefer no new screen, render `<MusicPlayer/>` inline below `<Reminders/>` like `WellbeingInsights` — but a dedicated tile + view matches "large-button player" best. Implement the tile + view.)

### 3c. Store additions — `frontend/src/lib/store.js`
Add a `playlist` array. Put it on `profile` per the brief (`profile.playlist[]`), exposed through helpers that mirror the reminder helpers:
- Extend `defaultState` so reads are safe: ensure `profile?.playlist` defaults to `[]` (do **not** assume `profile` already has the key — old saved states won't). Read via `(state.profile?.playlist) || []`.
- `addSong(song)` → assigns `id` (same `String(Date.now()) + Math.random().toString(36).slice(2,7)` idiom used by `addMemory`/`addReminder`), merges, persists via `setProfile({ ...profile, playlist: [...prev, song] })`.
- `removeSong(id)` → filters by id and persists.
- (Optional) `reorderSong` / `setFavorite` if trivial; otherwise skip.
- Keep these helpers tiny and consistent with the existing exports. **Never store audio bytes here** — only the metadata object in §4.

### 3d. App wiring — `frontend/src/App.jsx` (+ optionally `SideNav.jsx`)
- Import `MusicPlayer` (or a thin `MusicPage` wrapper) and add `else if (view === 'music') content = <MusicPlayer onNavigate={setView} />;` alongside the existing branches.
- Optionally add `{ id: 'music', label: 'Music', icon: Music }` to `TABS` in `SideNav.jsx` so it's reachable from the top nav too (consistent with other tabs). The HomeView tile is the primary entry point.

### 3e. Optional companion hook — `frontend/src/pages/AvatarPage.jsx`
Lightweight, non-breaking, opt-in:
- Add a suggestion chip alongside the existing `.av-suggestions` (`['Tell me about us', 'I miss you', ...]`) such as "Play our song" (localized) that navigates to the Music view / triggers playback. Since `AvatarPage` has no `onNavigate` prop today, the simplest non-invasive option is: a small "♪ Play music" `.av-tool` button in `.av-tools` that calls a passed-in navigate callback **only if you thread one through** — otherwise emit a `window.dispatchEvent(new CustomEvent('factech:open-music'))` that `App.jsx` listens for and does `setView('music')`. Choose the smaller diff.
- (Optional, evening warmth) In the existing proactive check-in lines, when it's evening (`new Date().getHours() >= 18`) and a playlist exists, occasionally use a line like "Would you like to hear your favorite song?" (localized, Hindi/Hinglish/English). **Reuse** the existing nudge guards (`userSpokeRef`, the once-per-session cap) — do not add new autoplay. The companion only *offers*; the patient taps to start.

Keep all existing chat/voice/memory flows untouched.

---

## 4. Data contract

**Song object** (stored in `profile.playlist[]`, metadata only):
```js
{
  id: "1718350000000abcd",   // String(Date.now()) + Math.random().toString(36).slice(2,7)
  title: "Lag Jaa Gale",      // required
  artist: "Lata Mangeshkar",  // optional — artist or era label, e.g. "1960s"
  url: "https://.../song.mp3",// streamable audio URL (mp3/ogg/m4a) — primary source
  art: "https://.../cover.jpg",// optional album-art URL (small) — gradient fallback if absent
  source: "url",              // "url" | "local"  (how it plays)
  localKey: null,             // if source==="local": IndexedDB key OR null for session-only
  favorite: false,            // optional — flag the patient's special "our song"
  addedAt: "2026-06-14T...Z"  // ISO timestamp
}
```
Rules:
- Exactly one playable source: a non-empty `url` (source `"url"`) **or** a local file (source `"local"`).
- **No base64 audio and no `Blob` in the persisted store.** Local file bytes live in IndexedDB (durable) or only in component state (session) — never in `localStorage`.
- `art` is a small image URL or omitted (component renders a gradient + icon).

**Store keys:** unchanged top-level key `factech_state_v1`; new nested array `profile.playlist[]`. New exports: `addSong`, `removeSong` (+ optional `setFavorite`). No backend changes required (player streams `url` client-side; no new FastAPI route).

---

## 5. Acceptance criteria + manual test

**Acceptance**
- [ ] A "Music" tile appears in HomeView and opens a Music screen (and/or a "Music" tab in the top nav).
- [ ] Caregiver can add a song by **URL** (title + url), and it appears in the playlist; it persists across reload (metadata in `profile.playlist`).
- [ ] Large Play/Pause, Next, Previous controls work; tapping a playlist row plays that song; track auto-advances on end.
- [ ] Now-playing shows title, artist/era, and album art (or gradient fallback).
- [ ] Delete removes a song from the playlist and stops it if currently playing.
- [ ] No audio bytes are written to `localStorage` (inspect `factech_state_v1` — only metadata).
- [ ] Visible labels localize for `persona.language` = hindi / hinglish / English.
- [ ] First tap reliably starts audio (a user gesture) — no console autoplay-policy error on the initial play.
- [ ] All existing flows (chat, voice, reminders, memories) still work.

**Manual test**
1. `cd frontend && npm install && npm run dev`; open the app (onboard a profile + persona if prompted).
2. HomeView → tap **Music**. Confirm the screen renders in the dark theme with large controls.
3. Add a song with a public MP3 URL (e.g. any direct `.mp3` link) + title; Save. It shows in the list.
4. Tap **Play** → audio starts on this user gesture. Tap **Pause**, **Next**, **Previous** — verify behavior. Let a track end → auto-advance.
5. Reload the page → playlist (URL entries) is still there.
6. Delete the playing song → playback stops, row disappears.
7. Switch `persona.language` to Hindi/Hinglish in the editor → re-open Music → labels localize.
8. (If companion hook built) In the avatar, trigger the "Play music" chip/button → lands on Music. In an evening session after the user speaks, confirm the optional spoken offer appears at most once and never auto-plays audio.
9. Open DevTools → Application → Local Storage → `factech_state_v1`: confirm `profile.playlist` holds only metadata (no base64).

---

## 6. Constraints / do-not-break

- **Browser autoplay policy:** audio must start from a **user gesture** (tap Play / tap a row). Do **not** auto-play on screen load or from the companion timer. The companion may only *offer* ("Would you like to hear your favorite song?"); the patient taps to start. Catch `audio.play()` promise rejection and show a calm "Tap play to start" hint instead of throwing.
- **Single audio element:** never let two clips play at once. Reuse one `<audio>`/`Audio` ref; stop/cleanup on unmount and on delete (mirror the `audioRef` teardown discipline in `AvatarPage`). Don't fight the companion's TTS — pause music if the companion speaks, if both can be active.
- **Keep existing flows intact:** `store.js` shape stays backward-compatible (old saved states without `playlist` must not crash — default to `[]`). Don't alter persona/reminders/memories behavior. `AvatarPage` chat/voice/memory-flush logic must remain unchanged except for the small additive hook.
- **Multilingual labels:** branch visible text and any spoken line on `(persona?.language||'').toLowerCase()` ∈ {`hindi`, `hinglish`, _default English_}, exactly like the existing greeting/nudge code.
- **Dementia-friendly UI:** few, large controls; high contrast; generous tap targets; minimal decisions on screen.
- **Theme:** one inline `<style>{...}` block per component, matching the existing dark slate/violet palette and radii. No external CSS, Tailwind, or new UI deps. Use `lucide-react` icons (already a dependency).
- **No hardcoded secrets / API keys.** No new env vars beyond the existing `VITE_API_BASE`. No tokens in source.
- **Storage budget:** never write audio bytes/base64 to `localStorage` (it silently drops on quota and can corrupt app state). Metadata only; large/local blobs go to IndexedDB or stay session-only.

---

## 7. Out of scope

- No Spotify / Apple Music / YouTube Music or any licensed-catalog SDK or OAuth integration.
- No server-side music storage, transcoding, or a new FastAPI route (player streams client-side).
- No music recommendation engine, lyrics, equalizer, or visualizer.
- No DRM or download-of-copyrighted-media features. Caregiver supplies their own legitimately-accessible URLs/files.
- No changes to the backend `tts_service` / `llm_service` for this feature.

---

# Feature 10 — Medication pill verification by camera

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

---

# Feature 11 — Live "Who is this?" with a warm greeting

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

---

# Feature 12 — Voice journaling / daily check-in

# Claude Code Prompt — Feature 12: Voice Journaling / Daily Check-in

> Paste this whole file into Claude Code at the repo root (`Factech AI`). It is grounded in the real code — file paths and function names below were verified.

---

## 1. Context (verified against the codebase)

**Backend**
- `app/main.py` — FastAPI app. Routers are mounted with `app.include_router(<module>.router, prefix=settings.API_V1_STR)` where `settings.API_V1_STR == "/api/v1"`. New routers MUST be imported and included here the same way as `persona_endpoint`, `chat_endpoint`, `mesh_endpoint`.
- `app/services/llm_service.py` — singleton `llm_service`. Holds the **Groq client** at `self.client = Groq(api_key=self.api_key)` (key from `settings.GROQ_API_KEY or os.getenv("GROQ_API_KEY")`). `self.client` is `None` when no key (must stay fail-soft).
  - `evaluate_conversation(transcript, persona, user) -> dict | None` — returns `{ mood, engagement, topics, concerns, summary, suggestions }`. `mood ∈ {positive, neutral, low, anxious}`, `engagement ∈ {high, medium, low}`. Uses `response_format={"type":"json_object"}`.
  - `summarize_session(transcript, persona, user) -> list[str]` — distills up to 6 durable third-person memory facts; **keeps the user's language** (does not translate Hindi/Hinglish).
- `app/services/voice_service.py` — **IMPORTANT: this does NOT use Groq.** It loads the heavy local **`openai-whisper`** model (`whisper.load_model("base")`) and exposes `transcribe(audio_path: str) -> str`. It is **not imported anywhere** in the app (dead code / standalone). **Do NOT reuse it** — it would load a multi-hundred-MB model and only accepts a file path. Instead add Groq Whisper transcription on the **existing `llm_service.client`** (Groq exposes `audio.transcriptions.create(...)` with model `whisper-large-v3`). No new provider, no new key.
- `app/services/episodic_memory.py` — singleton `episodic_memory`. `add_memories(user: dict, facts: list) -> int` embeds + upserts facts into Qdrant, scoped per user via a name hash. Reuses the **shared `qdrant_client`** (`app/core/db.py`) and the **already-loaded MiniLM encoder** (`semantic_memory.encoder`) — never construct a second client/model. `retrieve(user, query, limit)` also exists.
- `app/api/persona_endpoint.py` — the pattern to copy for new endpoints: `router = APIRouter()`, handlers are `@router.post("/...")` `async def f(payload: dict = Body(...))`. See `/remember` (calls `summarize_session` then `episodic_memory.add_memories`) and `/evaluate` (calls `evaluate_conversation`) for exact shapes.
- `app/core/config.py` — `settings.GROQ_API_KEY` (Optional). Secrets come from `.env`. **Never hardcode keys.**

**Frontend**
- `frontend/src/components/AudioRecorder.jsx` — `<AudioRecorder onRecordingComplete={fn} />`. Records mic audio and calls `onRecordingComplete(blob)` with a `Blob` of type `audio/webm` (or `null` on reset). Reuse as-is.
- `frontend/src/lib/store.js` — `useAppState()` hook + plain functions. Relevant: `memories[]`, `insightsHistory[]`, `transcript[]`, `addMemory(mem)` (auto-stamps `id` + ISO `date`, prepends), `removeMemory(id)`, `addInsight(ev)` (pushes `{date, mood, engagement}`, capped 30 — this is the **wellbeing trend** the caregiver sees). State persists to `localStorage` key `factech_state_v1`.
- API base + call style (used everywhere, e.g. `WellbeingInsights.jsx`, `AvatarPage.jsx`):
  ```js
  import axios from 'axios';
  const API_BASE = import.meta.env.VITE_API_BASE || '/api/v1';
  // axios.post(`${API_BASE}/...`, body, { timeout: 30000 })
  ```
- `frontend/src/pages/MemoriesPage.jsx` — existing memories grid. Memory cards render `m.image`, `m.caption`, `m.voice` (data URL), `m.date`. Dark inline-`<style>` theme (`#0f172a` bg, purple/blue gradients). Copy this visual language for the Journal view.
- `frontend/src/pages/HomeView.jsx` — `HomeView({ onNavigate })`. Quick tiles call `onNavigate('avatar' | 'memories')`. Add the daily prompt here.
- Multilingual: persona language lives at `persona.language` (`hindi` / `hinglish` / etc.); summaries already preserve language server-side.

---

## 2. Goal

Add a once-a-day **voice journal / check-in**: the companion invites the patient to record "How was your day?". The clip is transcribed (Groq Whisper on the existing Groq client), saved as a **dated journal memory** (`type: 'journal'`) in `store.memories` **and** into `episodic_memory`, gently **summarised**, and its **mood logged into the wellbeing trend** (`addInsight`) for the caregiver. Patient + family can **browse past journal entries**.

---

## 3. Implementation plan (numbered)

1. **Backend — transcription helper on the Groq client.** In `app/services/llm_service.py`, add a method on `LLMService`:
   - `transcribe_audio(self, audio_bytes: bytes, filename: str = "audio.webm", language: str | None = None) -> str`
   - If `not self.client`: return `""` (fail-soft). Otherwise call `self.client.audio.transcriptions.create(file=(filename, audio_bytes), model="whisper-large-v3", response_format="text")`. Pass `language=language` only when provided (let Whisper auto-detect otherwise — supports Hindi/Hinglish). Wrap in try/except, log, return `""` on failure. Do **not** import or touch `voice_service.py`.

2. **Backend — journal endpoint.** Create `app/api/journal_endpoint.py` with `router = APIRouter()`, copying the `persona_endpoint.py` style.
   - `POST /journal/transcribe` — accepts an uploaded audio file via `UploadFile` (multipart). Read bytes, call `llm_service.transcribe_audio(...)`, return `{ "status": "ok", "text": "<transcript>" }` (or `{ "status": "empty", "text": "" }` when transcription is blank). Accept an optional `language` form field.
   - `POST /journal/log` (`payload: dict = Body(...)`) — body `{ text, user, persona }`. Server-side: build a single-turn transcript `[{role:"user", text}]`, call `llm_service.summarize_session(...)` → store facts via `episodic_memory.add_memories(user, facts)`, and call `llm_service.evaluate_conversation(...)` for `{mood, engagement, summary}`. Return `{ status, summary, mood, engagement, stored }`. All steps fail-soft (missing client / empty text → return `{status:"empty", ...}` with safe defaults, never 500).
   - Wire it in `app/main.py`: `from app.api import journal_endpoint` and `app.include_router(journal_endpoint.router, prefix=settings.API_V1_STR)`.

3. **Frontend — Journal record flow.** Create `frontend/src/pages/JournalPage.jsx`.
   - Use `<AudioRecorder onRecordingComplete={blob => ...}>` to capture the clip.
   - On submit: `POST {API_BASE}/journal/transcribe` as `multipart/form-data` (append the blob as `file`, plus `language` from `persona?.language`). Show the returned `text` so the patient can confirm/edit.
   - Then `POST {API_BASE}/journal/log` with `{ text, user:{name: profile?.name}, persona:{...} }`.
   - On success, save locally: `addMemory({ type: 'journal', caption: text, summary, mood, voice: <dataUrl|null>, dayKey })`. If `mood`/`engagement` returned, call `addInsight({ mood, engagement })` so it lands in the wellbeing trend.
   - Keep it fail-soft: if transcription returns empty, let the patient type their entry manually and still log it.

4. **Frontend — Journal browse view.** In `JournalPage.jsx`, below the recorder, render entries from `useAppState().memories.filter(m => m.type === 'journal')` newest-first, each showing the date (`m.date`), the entry text (`m.caption`), the gentle `m.summary`, a mood dot (reuse the `MOOD` colour map idea from `WellbeingInsights.jsx`), and a play button if `m.voice` exists. Reuse the dark inline-`<style>` look from `MemoriesPage.jsx`. Add a `'journal'` route/tab wherever the app's page switch lives (mirror how `memories` is registered) so `onNavigate('journal')` works.

5. **Frontend — optional daily prompt on Home.** In `HomeView.jsx`, compute today's `dayKey` (`new Date().toISOString().slice(0,10)`). If no `memories` entry with `type==='journal'` has that `dayKey`, show a gentle card ("How was your day, {name}? Take a moment to record it.") with a button calling `onNavigate('journal')`. Once today's entry exists, hide it. Match the existing `.hv-tile` / persona-card styling.

---

## 4. Data contract

**Journal entry (in `store.memories`)** — created via existing `addMemory` (it adds `id` + ISO `date`):
```jsonc
{
  "id": "<auto>",
  "date": "<auto ISO>",
  "type": "journal",          // distinguishes from photo/voice memories
  "dayKey": "2026-06-14",     // YYYY-MM-DD, for once-a-day gating
  "caption": "<transcribed/edited entry text>",
  "summary": "<gentle 1-2 sentence summary>",
  "mood": "positive",         // positive|neutral|low|anxious (optional)
  "voice": "data:audio/webm;base64,..."  // optional playback, may be null
}
```

**`POST /api/v1/journal/transcribe`** — `multipart/form-data`: `file` (audio blob), optional `language`.
→ `{ "status": "ok"|"empty", "text": "<transcript>" }`

**`POST /api/v1/journal/log`** — JSON:
```jsonc
// request
{ "text": "...", "user": { "name": "Asha" },
  "persona": { "name": "...", "relationship": "...", "language": "hindi" } }
// response
{ "status": "ok"|"empty", "summary": "...", "mood": "neutral",
  "engagement": "medium", "stored": 2 }
```

**Wellbeing trend** — reuse existing `addInsight({ mood, engagement })` → pushes `{date, mood, engagement}` into `insightsHistory` (the chart the caregiver already sees).

**Store keys touched:** `memories` (add `type:'journal'` entries), `insightsHistory` (via `addInsight`). No new top-level store keys required.

---

## 5. Acceptance criteria + manual test path

- [ ] `POST /api/v1/journal/transcribe` returns transcribed text for a `webm`/`wav` clip using Groq `whisper-large-v3` on the **existing** Groq client; Hindi/Hinglish audio transcribes in-language.
- [ ] `POST /api/v1/journal/log` returns a gentle `summary` + `mood`, stores facts in `episodic_memory`, and never 500s when text is empty or `GROQ_API_KEY` is unset.
- [ ] Recording a check-in on the Journal page creates a `type:'journal'` memory with `dayKey`, and its mood appears in the caregiver wellbeing trend.
- [ ] Past journal entries are browsable newest-first with date, text, summary, mood dot, and optional audio playback.
- [ ] Home shows the daily prompt only until today's journal entry exists.

**Manual test:**
1. Ensure `GROQ_API_KEY` is in `.env`; start backend (`uvicorn app.main:app --reload`) and `cd frontend && npm run dev`.
2. Home → daily prompt visible → click it → Journal page.
3. Record "Today I felt happy, my daughter visited" → confirm transcript appears → Save.
4. Verify a journal entry shows with summary + mood; check Home prompt is now hidden; check the wellbeing trend on Home updated.
5. Reload the page → entry persists (localStorage). Set `GROQ_API_KEY` empty → confirm record→type-manually still saves (fail-soft).

---

## 6. Constraints / do-not-break

- **Reuse the existing Groq client** (`llm_service.client`) for Whisper. No new provider, no SDK, no key beyond `GROQ_API_KEY`. Do **not** wire in `voice_service.py` / local `openai-whisper`.
- **Reuse `episodic_memory.add_memories`** — it already uses the shared `qdrant_client` + MiniLM encoder. Do not create a second Qdrant client or encoder.
- **Multilingual:** pass/forward `persona.language` to transcription; rely on `summarize_session` keeping the entry's language. Never force-translate.
- **Dark inline-`<style>`** theme consistent with `MemoriesPage.jsx` / `HomeView.jsx`. No external CSS frameworks.
- **No hardcoded secrets.** Keys only via `settings` / `.env`.
- **Fail-soft audio:** mic denial, empty transcript, or LLM/Groq down must degrade gracefully (allow manual typing, return empty-status JSON) — never crash a page or a request.
- Wire any new router into `app/main.py` exactly like the existing routers (with `settings.API_V1_STR`).

---

## 7. Out of scope

- Speaker diarization / voice identification (the comment in `voice_service.py` is a non-goal here).
- Push/scheduled reminders or server-side cron for the daily prompt (use client-side `dayKey` gating only).
- Editing/deleting episodic-memory facts from the UI.
- Sentiment charts beyond the existing `insightsHistory` trend.
- Cloud audio storage — audio stays as a localStorage data URL on the entry (same as current voice notes).

---

# Feature 13 — Sundowning / evening calm mode

# 13 — Sundowning / Evening Calm Mode

## 1. Context (verified by reading the repo)

Project: **Factech AI** — a React (Vite) + FastAPI AI memory companion for dementia patients. I read the relevant files; current behavior:

- **`app/services/llm_service.py` → `chat_as_persona(self, user_text, persona=None, user=None, history=None, memories=None)`** (line 179) builds the in-character system prompt. Style/length is driven by `style_rules` (lines 203–209: `brief` → "1-2 short, gentle sentences", 110 tokens; `balanced` → 200; `chatty` → 360; `dosti` → 220), unpacked into `(length_rule, max_tokens)` at line 209. The prompt already tells the model to "never make them feel tested or quizzed" (line 225) and "most replies should end with a gentle, caring question" (line 227). Multilingual blocks live at lines 261–275 (`language == "hindi"` → Devanagari; `"hinglish"` → Roman Hinglish). The `memories` block is appended at lines 242–249, `dosti` tone at 252–259. A model-fallback loop (`llama-3.3-70b-versatile` → `llama-3.1-8b-instant`) runs at lines 288–301. **All of this must be preserved.**
- **`app/services/llm_service.py` → `evaluate_conversation(...)`** (line 73) returns JSON with `mood` ∈ `'positive' | 'neutral' | 'low' | 'anxious'`, plus `engagement`, `topics`, `concerns`, `summary`, `suggestions` (keys at lines 95–100). This is the existing signal we reuse for a mood trigger — **no new model call is needed.**
- **`app/services/tts_service.py` → `synthesize(self, text, voice=None, rate=None)`** (line 56) passes `rate` straight to `edge_tts.Communicate(..., rate=rate)` (lines 75–76). The docstring confirms `rate` like `"-8%"` slows delivery for a "calmer, clearer" flow. A bigger negative (e.g. `"-15%"`) → slower/softer.
- **`app/api/persona_endpoint.py` → `POST /tts`** (line 77) reads `rate = payload.get("rate") or "-8%"` (line 103) and calls `tts_service.synthesize(text, voice, rate=rate)`. So a custom rate is **already accepted** from the client — we just need to send it. `POST /persona/chat` (line 46) reads `text, persona, user, history`, calls `chat_as_persona(...)`, returns `{ "status": "ok", "text": reply }`.
- **`frontend/src/App.jsx`** already has a global `setInterval` clock — the reminder checker (lines 17–54) runs `check()` every 30 s using `new Date()`, `now.getHours()`, and the `factech_state_v1` store. This is the natural home for an evening-window detector. It also renders a fixed banner (`.reminder-banner`, lines 70–87) and wraps everything in a dark root `div` (`background: '#0f172a'`, line 67).
- **`frontend/src/lib/store.js`** — client-only store persisted to localStorage key `factech_state_v1`. Shape `{ profile, persona, memories[], transcript[], reminders[], insightsHistory[] }` (line 7). `useSyncExternalStore` hook `useAppState()` (line 85); mutate via `set({...})` (line 24); typed setters like `setPersona` / `markReminderFired` are the pattern to follow.
- **`frontend/src/pages/AvatarPage.jsx`** — `speak(text)` (line 122) posts `${API_BASE}/tts` with `{ text, voice, clone_voice_id }` (line 144) — **it does NOT send `rate`**, so it currently inherits the endpoint default `-8%`. `runTurn(text)` (line 188) posts `${API_BASE}/persona/chat` with `{ text, persona:{...style}, user, history }` (lines 200–205). `API_BASE = import.meta.env.VITE_API_BASE || '/api/v1'` (line 9). Whole page is themed via a dark inline `<style>` block (lines 414–463), root `.av` gradient `#0f172a → #1e1b4b` (line 415).
- **`frontend/src/pages/HomeView.jsx`** — `greeting()` (lines 8–13) already returns "Good evening" when `new Date().getHours() >= 18`. Dark inline `<style>` (lines 93–126), root `.hv` background `#0f172a`. Renders `<Reminders />` and `<WellbeingInsights />`.
- **`frontend/src/components/WellbeingInsights.jsx`** — calls `POST /evaluate` and stores results via `addInsight(ev)` → pushes `{ date, mood, engagement }` into `insightsHistory` (store.js lines 76–80). So the **latest evaluated mood is already in the store** at `insightsHistory[insightsHistory.length - 1].mood`.

## 2. Goal

Add a **Sundowning / Evening Calm Mode**: a non-clinical comfort mode that **auto-engages** when it's late afternoon/evening (time-based) and/or the last evaluated mood is `anxious`/`low`, and is **easy to exit / manually toggle**. When active it:
- dims and warms the UI (softer, larger, calmer layout) — gated on a `calmMode` flag,
- sends a **calmer TTS rate** (`"-15%"`) so the companion speaks slower and softer,
- appends a **calm style directive** to the persona system prompt (shorter, extra-reassuring, no quiz-like questions, gentle orientation) — composed *with* the existing `style_rules` + multilingual blocks,
- optionally plays soft **calming music**.

Multilingual (EN / Hindi-Devanagari / Hinglish) must keep working unchanged.

## 3. Implementation Plan (numbered)

### 3.1 Backend — `app/services/llm_service.py` (calm style directive)
- Add an optional arg to `chat_as_persona`:
  `def chat_as_persona(self, user_text, persona=None, user=None, history=None, memories=None, calm=False):`
- Keep the existing `style_rules` / `(length_rule, max_tokens)` logic intact. When `calm` is truthy, **after** the base `length_rule` is chosen, gently cap verbosity so calm replies are always short — e.g. `if calm: max_tokens = min(max_tokens, 120)`. Do **not** rewrite the style table.
- Append a `calm_block` to `system_prompt` **after** the persona/personality + memories blocks but **before** the `language == "hindi" / "hinglish"` blocks (lines 261–275), so the language instruction still wins and the calm wording is naturally translated. Use this shape (compact):

  ```
  IT IS EVENING / A CALMER MOMENT. The user may feel a little confused, restless or anxious right now
  (this is common in the late afternoon and evening). Speak in a softer, slower, extra-reassuring way:
  - Keep replies SHORT — one or two warm, simple sentences.
  - Be calming and grounding. Gently reassure them they are safe and you are right here with them.
  - Do NOT quiz, test, or ask difficult questions. At most ONE soft, optional question — it's fine to ask none.
  - If they seem disoriented, gently and warmly orient them (it's evening, they're at home, you're with them)
    without correcting them harshly or making them feel wrong.
  - Avoid anything exciting, alarming, or mentally demanding. Keep your tone slow, gentle and loving.
  ```
- This must **compose** with `dosti` tone and all multilingual blocks (they run after and still apply). If `calm` is falsy, behavior is byte-for-byte unchanged (no regression).
- Do **not** add a new model, service, or endpoint. The existing fallback loop is unchanged.

### 3.2 Backend — `app/api/persona_endpoint.py` (thread the flag)
- In `persona_chat` (line 46), read `calm = bool(payload.get("calm"))` and pass it through:
  `reply = llm_service.chat_as_persona(text, persona=persona, user=user, history=history, memories=mems, calm=calm)`.
- Response shape stays identical: `{ "status": "ok", "text": reply }`. Endpoint must keep working when `calm` is absent (defaults `False`).
- `/tts` needs **no change** — it already honors `payload.get("rate")` (line 103). The client just sends `"-15%"` when calm.

### 3.3 Frontend store — `frontend/src/lib/store.js` (calmMode flag + detection)
- Add `calmMode` to `defaultState` (line 7): `calmMode: false`. (It persists like everything else — that's fine; the App-level detector below keeps it correct on load.)
- Add typed setters next to `setPersona`:
  ```js
  export function setCalmMode(on) { if (state.calmMode !== !!on) set({ calmMode: !!on }); }
  ```
- Add a pure helper that decides whether calm SHOULD be on, from time + last evaluated mood (single source of truth, reused by the detector):
  ```js
  // Evening window (>= 17:00 local) OR last evaluated mood is anxious/low.
  // Non-clinical heuristic only — never a medical signal.
  export function shouldBeCalm() {
    const s = state;
    const eveningStart = s.profile?.calmHour ?? 17;        // configurable, defaults 17:00
    const evening = new Date().getHours() >= eveningStart;
    const hist = s.insightsHistory || [];
    const lastMood = hist.length ? hist[hist.length - 1].mood : null;
    const anxious = lastMood === 'anxious' || lastMood === 'low';
    return evening || anxious;
  }
  ```
- Add a manual-override concept so a user/caregiver can force on/off and the auto-detector won't fight them: store `calmManual` (`'on' | 'off' | null`). `null` = follow auto. Add:
  ```js
  export function setCalmManual(v) { set({ calmManual: v }); } // 'on' | 'off' | null
  ```
  Include `calmManual: null` in `defaultState`.

### 3.4 Frontend — `frontend/src/App.jsx` (auto-engage on the existing clock)
- Reuse the existing 30 s interval (do NOT add a second timer). Inside the existing `useEffect` (or a small sibling `useEffect` with its own interval is acceptable), add an `applyCalm()` step that runs alongside the reminder `check()`:
  ```js
  const applyCalm = () => {
    const s = getState();
    const auto = shouldBeCalm();
    const next = s.calmManual === 'on' ? true : s.calmManual === 'off' ? false : auto;
    setCalmMode(next);
  };
  ```
  Call `applyCalm()` immediately on mount and re-run it inside the existing interval tick. Import `shouldBeCalm, setCalmMode` from the store.
- When `calmMode` is true, apply a **dimmer, warmer** root theme. The root `div` background is an inline style (line 67) — switch it conditionally, e.g.
  `background: calmMode ? 'linear-gradient(160deg,#1a1414,#2a1d1d)' : '#0f172a'` (warm, dim) and read `calmMode` from `useAppState()`.
- Add a small, always-reachable **calm toggle / exit** control (a floating pill, dark inline `<style>` like `.reminder-banner`). When calm is on, show e.g. "Calm mode on · Exit" → `setCalmManual('off')`. When off, a subtle "Calm" button → `setCalmManual('on')`. (Caregiver can also clear the override back to auto, but exit-to-off is the must-have.)

### 3.5 Frontend — `frontend/src/pages/AvatarPage.jsx` (calmer voice + shorter replies)
- Read calm from the store: `const { persona, profile, calmMode } = useAppState();` (currently destructures only `persona, profile`, line 12).
- In `speak(text)` (line 122), send a calmer rate when calm. Change the TTS POST (line 144) to include `rate`:
  ```js
  const r = await axios.post(`${API_BASE}/tts`, {
    text, voice: persona.voiceId, clone_voice_id: persona.voiceCloneId,
    rate: calmMode ? '-15%' : undefined,   // omit → endpoint default '-8%'
  }, { timeout: 30000 });
  ```
  Use a `calmModeRef` mirror (like the existing `callModeRef`, line 25) if you need the freshest value inside async/voice callbacks; keep it in sync via a `useEffect`.
- In `runTurn(text)` (line 188), add `calm: calmMode` to the `/persona/chat` body (lines 200–205) so the backend applies the calm directive:
  ```js
  const r = await axios.post(`${API_BASE}/persona/chat`, {
    text: q, persona: {...}, user: { name: firstName }, history,
    calm: calmModeRef.current,
  }, ...);
  ```
- Gate a **calmer visual treatment** on `calmMode` in the existing inline `<style>` (lines 414–463): when on, add a class on `.av` (e.g. `<div className={\`av \${calmMode ? 'calm' : ''}\`}>`) and define `.av.calm { background: linear-gradient(160deg,#1a1414,#2a1d1d); }`, slightly larger bubble font, softer accents. Keep it inside the dark inline-`<style>` — no external CSS.

### 3.6 Optional — calming music hook
- Add a small calming-audio toggle that, when calm mode is on, can loop a soft track. Keep it **optional and off by default** (a button). Use an `<audio loop>` element or `new Audio(src)` with low volume. Source the track from a configurable URL (`persona.calmMusicUrl` or `import.meta.env.VITE_CALM_MUSIC_URL`) — **do not bundle copyrighted audio or hardcode a secret/URL with a key.** If no source is set, hide the control. Pause it on calm-mode exit / page unmount (mirror the existing teardown `useEffect`, line 59).

## 4. Data Contract

- **Store (`factech_state_v1`)** gains:
  - `calmMode: boolean` — derived/applied flag the UI reads.
  - `calmManual: 'on' | 'off' | null` — user/caregiver override; `null` = follow auto.
  - (optional) `profile.calmHour: number` — evening start hour, defaults `17`.
- **`POST /persona/chat`** request body gains one optional field:
  `{ text, persona, user, history, calm?: boolean }`. Default `false`. Response unchanged: `{ status, text }`.
- **`POST /tts`** request body: client now sends existing-but-previously-unused field `rate` when calm: `{ text, voice, clone_voice_id, rate?: "-15%" }`. When omitted, endpoint default `"-8%"` applies (line 103). Response unchanged.
- **`chat_as_persona`** signature gains `calm: bool = False` (last param; non-breaking).

## 5. Acceptance Criteria + Manual Test

**Acceptance criteria**
1. After 17:00 local (or when the last evaluated mood is `anxious`/`low`), `calmMode` flips to `true` within one 30 s tick; UI dims/warms; an "Exit" control is visible.
2. While calm: `/tts` requests carry `rate: "-15%"` (slower/softer voice); `/persona/chat` requests carry `calm: true`, and replies are noticeably shorter + reassuring with no quiz-like questions — in the persona's language (EN / Hindi-Devanagari / Hinglish).
3. Manual **Exit** sets `calmManual='off'` and turns calm off even during the evening window; a manual **on** forces calm during the day. Auto resumes when override is cleared to `null`.
4. With `calm` absent/false, persona replies, TTS, and UI are **identical to before** (no regression).

**Manual test**
- *Simulate evening:* temporarily set `eveningStart`/`calmHour` to a value `<=` current hour (e.g. `0`) in `shouldBeCalm`, or change the system clock past 17:00 → confirm calm auto-engages within ~30 s, theme warms, voice in the Avatar is slower, replies are short and gentle.
- *Simulate anxious mood:* run **Wellbeing insights → Evaluate** on a worried-sounding transcript (or hand-insert `{ mood: 'anxious' }` as the last `insightsHistory` entry via store) → confirm calm engages even before 17:00.
- *Exit:* click **Exit** → calm turns off and stays off through the evening; verify `/tts` reverts to default rate and `/persona/chat` sends `calm:false`.
- *Multilingual:* set `persona.language` to `hindi` then `hinglish` → calm replies stay in Devanagari / Roman-Hinglish respectively and remain short + reassuring.
- *No-regression:* with calm off in daytime, confirm replies/voice/theme match `main`.

## 6. Constraints / Do-Not-Break

- **Reuse only existing services.** No new backend services, models, or endpoints — extend `chat_as_persona` (calm directive) and reuse the existing `synthesize` `rate` param + `/tts` and `/persona/chat`. No second model call for detection (mood comes from `insightsHistory`).
- **Preserve multilingual EN / Hindi (Devanagari) / Hinglish** — the calm block goes **before** the language blocks (lines 261–275) so language still wins. Do not touch the `dosti` block or memory block behavior.
- **Preserve `style_rules`** — only `min()`-cap `max_tokens` when calm; never rewrite the style table or the fallback loop.
- **Keep existing endpoint response shapes** identical; all new fields optional with safe defaults (`calm=False`, `rate` falls back to `-8%`).
- **Dark inline-`<style>` only** — no external CSS files, no CSS frameworks. Calm theme is a warmer/dimmer variant of the existing dark palette, gated on `calmMode`.
- **Reuse the existing `App.jsx` interval** — do not spawn a second always-on timer for detection.
- **No hardcoded secrets** — any calming-music URL/config comes from `persona`/env, never committed keys; do not bundle copyrighted audio.
- **No localStorage key change** — keep `factech_state_v1`; only add fields.

## 7. Out of Scope

- **No clinical claims or diagnosis.** This is a comfort/UX heuristic ("evening / low mood → calmer"), explicitly **not** sundowning detection or any medical assessment. Keep all copy non-clinical (consistent with `evaluate_conversation`'s "Be supportive and non-clinical. Never diagnose.").
- No caregiver alerting, logging of "sundowning episodes", or analytics dashboards.
- No new ML/sensor-based agitation detection.
- No changes to onboarding, voice cloning, reminders, or memory pipelines beyond reading `insightsHistory`.

---

# Feature 14 — Gentle cognitive games with their own photos

# Feature: Gentle cognitive games built from the patient's own photos

## 1. Context (verified by reading the repo)
- **Project:** Factech AI — an AI memory companion for dementia/Alzheimer's patients. Backend = FastAPI (entry `app/main.py`, routers mounted under `settings.API_V1_STR` = `/api/v1`). Frontend = React 19 + Vite 7 in `frontend/`.
- **Enrolled people live in Qdrant.** `app/services/memory_service.py` defines `MemoryService` which reuses the ONE shared client `qdrant_client` from `app/core/db.py` (`self.client = qdrant_client`). It ensures three collections in `_ensure_collections()`: `faces` (512-dim), `objects` (1280-dim), and `patients` (512-dim). People are enrolled into **`faces`** via `store_face_memory(...)` (`/remember/person` in `app/api/endpoints.py`) and into **`patients`** via `store_patient_memory(...)` (`/remember/patient`, caregiver flow).
- **Payload fields per enrolled person** (set in `endpoints.py` `remember_person` / `remember_patient`): `name`, `relation`, `age`, `type`, `notes`, `image_base64` (a `data:image/jpeg;base64,...` thumbnail, max 300px, from `encode_image_base64`), `avatar_url`, optional `audio_base64`, `person_id`, `timestamp`. **`image_base64` can be `None`** — handle it.
- **The scroll pattern to copy** is `/debug/names` in `app/api/endpoints.py` (lines ~391–404):
  ```python
  res = memory_service.client.scroll(collection_name="faces", limit=100, with_payload=True)
  points = res[0]
  names = [p.payload.get("name") for p in points]
  ```
  `scroll` returns a tuple `(points, next_page_offset)`. Reuse `memory_service.client` — **never construct a second QdrantClient** (embedded Qdrant locks its folder per-client; see `app/core/db.py` docstring).
- **Frontend store** = `frontend/src/lib/store.js`. `useSyncExternalStore`-based, persisted to `localStorage` key `factech_state_v1`. Default shape (line 7): `{ profile, persona, memories[], transcript[], reminders[], insightsHistory[] }`. `memories[]` items (from `MemoriesPage.jsx` `addMemory`) are `{ id, date, caption, image (dataURL|null), voice (dataURL|null) }`. There is **no games state today**.
- **Navigation is view-string based, NOT react-router.** `frontend/src/App.jsx` holds `const [view, setView] = useState('home')` and renders by `if (view === 'avatar') ... else if (view === 'memories') ... else HomeView`. `HomeView` receives `onNavigate={setView}`. `frontend/src/components/SideNav.jsx` has a `TABS` array `[{id,label,icon}]` and calls `onViewChange(id)`.
- **HomeView tiles** (`frontend/src/pages/HomeView.jsx`, lines ~49–65): `.hv-tiles` grid of `.hv-tile` buttons, each `onClick={() => onNavigate('...')}` with a lucide icon, `.hv-tile-t` title, `.hv-tile-d` description. Reads `{ profile, persona, memories }` from `useAppState()`. There's already a "Who is this?" tile (line 60) that opens the live camera face scanner — **the games "Who is this?" is a DIFFERENT, photo-based, no-camera mode; do not collide with it.**
- **TTS endpoint** = `POST /api/v1/tts` in `app/api/persona_endpoint.py` (lines ~77–107). Body `{ text, voice?, clone_voice_id?, rate? }`; returns `{ status, audio_base64, mime, cloned }`. Default `rate` `-8%` (calmer for elders). Frontend plays it like `AvatarPage.jsx` (line ~144): `new Audio(\`data:audio/mpeg;base64,${r.data.audio_base64}\`).play()`.
- **API base & client:** every frontend file uses `const API_BASE = import.meta.env.VITE_API_BASE || '/api/v1'` and `axios`. Dev proxy `/api` → backend (see existing pages).
- **Multilingual:** `persona.language` ∈ English / Hindi / Hinglish. `App.jsx` (lines ~38–43) maps `hindi|hinglish` → `hi-IN`, else `en-US`. Match that for any spoken/written game copy.
- **Theme:** dark, inline `<style>{\`...\`}</style>` per page. Palette: bg `#0f172a`, cards `rgba(30,41,59,0.55)`, accent gradient `#7c3aed→#2563eb`, violet `#a78bfa`, muted text `#94a3b8`. System UI font.

## 2. Goal
Add a **Games** page offering 2–3 light, encouraging, NON-test engagement activities ("Who is this?" face recall, simple photo matching, "Tell me about this memory") built from the patient's own enrolled people (Qdrant `faces`+`patients`) and their saved `store.memories`. Always kind: gentle reveals, no scores, no timers, no harsh "wrong". Reachable from a new HomeView tile and SideNav tab.

---

## 3. Implementation plan

### Part A — Backend endpoint: list enrolled people for games
1. In `app/api/endpoints.py`, add `GET /games/people`. Scroll **both** `faces` and `patients` using the shared client (mirror the `/debug/names` pattern), merge, and return a clean list:
   ```python
   @router.get("/games/people")
   async def games_people():
       people = []
       seen = set()
       for col in ("faces", "patients"):
           try:
               points = memory_service.client.scroll(collection_name=col, limit=200, with_payload=True)[0]
           except Exception:
               continue
           for p in points:
               pl = p.payload or {}
               name = pl.get("name")
               img = pl.get("image_base64")
               if not name or not img:        # need a name + a photo for a face game
                   continue
               key = name.strip().lower()
               if key in seen:
                   continue
               seen.add(key)
               people.append({
                   "name": name,
                   "relation": pl.get("relation") or "",
                   "image_base64": img,
                   "notes": pl.get("notes") or "",
               })
       return {"count": len(people), "people": people}
   ```
   - Skip entries with no `image_base64` (can't show a face) and de-dupe by name.
   - **No camera, no embeddings, no scoring** — this is a read-only payload list.
   - Wrap each collection scroll in try/except so a missing collection never 500s; return `{"count": 0, "people": []}` gracefully when empty.

### Part B — Games page (frontend)
2. Create `frontend/src/pages/GamesPage.jsx`. On mount, `axios.get(\`${API_BASE}/games/people\`)` → `people[]`; also read `memories` from `useAppState()`. Keep an inline dark `<style>` block matching the theme.
3. **Empty-data state:** if `people.length === 0` AND `memories.length === 0`, show a warm card (e.g. "We'll have gentle games here once you've added some photos and people. There's no rush.") with a button that `onNavigate('memories')`. Never show a broken/blank game. If only one source has data, only offer the games that source can fill (e.g. a face game needs ≥1 person; matching needs ≥2 people OR ≥2 image memories).
4. **Game modes (build the ones the data supports; aim for 2–3):**
   - **a) "Who is this?" (face recall, photo-based):** show one person's `image_base64`. Offer 3–4 large name choices (the right name + a few other enrolled names as distractors; if fewer than 2 people exist, skip this mode). **No timer, no score.** On any tap: reveal warmly — correct → "Yes! That's {name}, your {relation}. 💜"; otherwise a GENTLE reveal, never "Wrong" → "This is {name}, your {relation}. They love you." Always include a "Show me" / reveal button so the patient can never be stuck or made to feel they failed. "Next" advances; reshuffle people.
   - **b) Photo match (pairs):** pick 3–4 image cards (from people photos and/or `memories[].image`) and present a simple, low-stress matching/recall ("Find the two that go together" or "Tap the photo of {name}"). Keep the grid small; celebrate any progress; no fail timer.
   - **c) "Tell me about this memory":** show one `memories[]` item (image + caption) or one person, with a warm open prompt ("Who is in this photo? Take your time — there's no wrong answer."). This is reminiscence, not a quiz: no right/wrong, just a kind prompt and an optional "Read it to me" reveal of the caption/notes.
5. **Encouraging feedback only:** centralize copy in a small helper so EVERY message is kind and supportive. No numeric score, no streak, no timer, no "incorrect/failed/try again harder". Add gentle praise on engagement ("Lovely.", "It's wonderful spending this time with you.").
6. **Optional voice prompts (graceful):** when a prompt or reveal is shown, optionally speak it via `POST ${API_BASE}/tts` (body `{ text, rate: '-8%' }`) and play `new Audio(\`data:audio/mpeg;base64,${audio_base64}\`)`, exactly like `AvatarPage.jsx`. Put it behind a small speaker toggle (default off is fine) and wrap in try/catch — if TTS is down, the game still works silently. Pick prompt language from `persona.language` (hindi/hinglish → Hindi copy + `hi-IN`, else English) consistent with `App.jsx`.

### Part C — Wire up navigation
7. `frontend/src/App.jsx`: add `else if (view === 'games') content = <GamesPage onNavigate={setView} />;` and import `GamesPage`. Pass `persona`/`memories` via the store (the page reads `useAppState()` itself), but keep `onNavigate` for the empty-state CTA.
8. `frontend/src/pages/HomeView.jsx`: add a new `.hv-tile` button in `.hv-tiles` → `onClick={() => onNavigate('games')}`, a lucide icon (e.g. `Puzzle`, `Gamepad2`, or `Sparkles` — import from `lucide-react`), title "Games" (or localized), description like "Gentle, friendly activities with your own photos." Match existing tile markup/classes exactly.
9. `frontend/src/components/SideNav.jsx`: add `{ id: 'games', label: 'Games', icon: <lucide icon> }` to `TABS` so the tab highlights via `currentView === 'games'`.

---

## 4. Data contract
- **`GET /api/v1/games/people`** → `{ "count": number, "people": [{ "name": string, "relation": string, "image_base64": string (dataURL), "notes": string }] }`. Only entries with a name AND a photo; de-duped by name; merged from `faces` + `patients`.
- **Store:** prefer NO new persistent store keys (games are ephemeral). If a "speak prompts" toggle should persist, store it under a single new key e.g. `settings: { gamesVoice: false }` added to `defaultState` in `store.js` with a setter — but localStorage-only, no backend. Do NOT add any score/streak/result persistence.
- **`memories[]`** items consumed read-only: `{ id, date, caption, image, voice }`.

## 5. Acceptance criteria + manual test path
- [ ] `GET /api/v1/games/people` returns 200 with the documented shape; returns `{count:0, people:[]}` (not 500) when collections are empty/missing.
- [ ] A "Games" tile appears on Home and a "Games" tab in the top nav; both navigate to the Games page and highlight correctly.
- [ ] With ≥2 enrolled people, "Who is this?" shows a real enrolled photo + name choices; tapping any choice produces a KIND message (never "Wrong"); a reveal button always exists; "Next" advances.
- [ ] No score, no streak, no timer, no countdown anywhere in the UI.
- [ ] With photos/memories present, at least 2 game modes are offered; with no people and no memories, a gentle empty-state with a "Add memories" CTA shows instead.
- [ ] Voice toggle (if added) speaks the prompt via `/tts` and degrades silently when TTS fails; prompt language follows `persona.language`.
- [ ] Styling matches the dark inline-`<style>` theme.
- **Manual test:** start backend (`uvicorn app.main:app --reload --port 8010`) + frontend (`npm run dev` in `frontend/`). Enroll 2–3 people via the caregiver/Who-is-this flow (or `/remember/person`). Open the app → Home → Games tile. Play each mode; tap correct + incorrect choices and confirm both feel encouraging. `curl http://localhost:8010/api/v1/games/people` to verify payload. Clear Qdrant data (or use a fresh DB) and confirm the empty-state renders without errors.

## 6. Constraints / do-not-break
- **Reuse `memory_service.client` (the ONE shared `qdrant_client`)** and the existing `faces`/`patients` collections — never construct a second QdrantClient, never create new collections.
- **NEVER make it feel like a test, quiz, exam, or assessment.** No scores, no streaks, no timers, no "correct/incorrect/wrong/failed", no red error states. Always kind; always a gentle reveal; the patient can never be "stuck" or made to feel they failed.
- **Multilingual:** honor `persona.language` for all user-facing copy and TTS language (match `App.jsx` mapping).
- **Theme:** dark inline-`<style>`, existing palette/classes; no external CSS framework.
- **No hardcoded secrets / no API keys.** TTS goes through the existing `/tts` endpoint only.
- **Handle empty data gracefully:** zero enrolled people and zero memories → warm empty-state, not a crash or blank screen. Photos may be missing (`image_base64 = None`) — filter those out.
- Don't break the existing camera-based "Who is this?" tile on Home, the Memories page, or the reminder/persona flows.

## 7. Out of scope
- **No cognitive assessment, scoring, diagnosis, progress-tracking, or clinical claims** of any kind — this is gentle engagement/reminiscence, NOT a screening or memory test. Do not log or report "performance".
- No new Qdrant collections, no face-embedding/recognition in the games (photo-based only), no camera capture in the games.
- No leaderboard, achievements, difficulty levels, or competitive mechanics.
- No multiplayer, no backend persistence of game sessions/results.

---

# Feature 15 — Care plan & caregiver notes that steer the persona

# 15 — Care plan & caregiver notes that steer the persona

## 1. Context (verified by reading the repo)

Project: **Factech AI** — React/Vite frontend + FastAPI backend; AI memory companion for dementia/Alzheimer's care. Client-only state (localStorage), no backend persistence of the persona.

Verified facts (real files / functions / lines):

- **`app/services/llm_service.py` → `chat_as_persona(self, user_text, persona=None, user=None, history=None, memories=None)` (line 179).** It assembles a first-person system prompt from `persona` fields: `name`, `relationship`, `personality`, `gender`, `age`, `accent`, `language`, `style` (lines 187–209). It already has:
  - a **style block** (`style_rules` dict, lines 203–209) that also sets `max_tokens`;
  - a **personality block** appended at lines 232–238;
  - an **episodic-memory block** ("Things you remember from your past conversations…") at lines 242–249;
  - a **"dosti" tone block** (lines 252–259);
  - **multilingual blocks** for `language == "hindi"` (Devanagari, lines 261–269) and `language == "hinglish"` (Roman script, lines 270–275).
  - History is appended as `messages` after the system prompt (lines 278–284), then it calls Groq with model fallback `("llama-3.3-70b-versatile", "llama-3.1-8b-instant")` (lines 288–301).
  - **This is the single injection point.** There is no other place the persona's behavior is shaped.
- **`app/api/persona_endpoint.py` → `POST /persona/chat` (line 46).** Reads `text`, `persona`, `user`, `history` from the JSON body; retrieves episodic `mems = episodic_memory.retrieve(user, text, limit=4)`; calls `llm_service.chat_as_persona(text, persona=persona, user=user, history=history, memories=mems)`; returns `{"status":"ok","text": reply}` (lines 49–58). `persona` is passed straight through as a dict — **whatever extra keys the frontend sends arrive here untouched.**
- **`frontend/src/components/PersonaEditor.jsx`** holds all persona-config UI and the `save()` builder (lines 159–176) that emits the persona object: `name, relationship, gender, age, accent, language, style, personality, voiceId, voiceSample, voiceCloneId, faceImage, modelUrl`. Dark theme via one inline `<style>` block (lines 335–408), class prefix `pe-*`. Fields use `.pe-field` (label + input/select/textarea).
- **`frontend/src/components/Onboarding.jsx`** renders `<PersonaEditor initial={{ userName: name }} onSave={finish} … />` (line 65); `finish(persona)` calls `setPersona(persona)` (line 18). So the SAME editor builder is used for create + edit — fields added to `PersonaEditor.save()` flow into both paths automatically.
- **`frontend/src/pages/AvatarPage.jsx` → `runTurn()` (line 188)** POSTs to `${API_BASE}/persona/chat` with an **explicit allow-list** of persona fields (line 202): `{ name, relationship, personality, gender, age, accent, language, style }`. **It does NOT spread `...persona`**, so a new `carePlan` field will NOT be sent unless explicitly added here. The same explicit allow-list is repeated in `flushSession()` (line 233) for `/remember`.
- **`frontend/src/lib/store.js`** persists `{ profile, persona, memories, transcript, reminders, insightsHistory }` to `localStorage["factech_state_v1"]` (lines 6–7). `setPersona(persona)` (line 33) replaces the whole persona object; `set()` shallow-merges top-level state and persists. **No migration needed** — extra persona keys round-trip through `JSON.parse`/`stringify` for free.
- API base everywhere: `const API_BASE = import.meta.env.VITE_API_BASE || '/api/v1';`.

## 2. Goal

Let a caregiver enter **care guidance** for the person — daily routine, do's & don'ts, **topics to avoid** (e.g. "don't mention that her husband passed away"), comfort topics, triggers, and reassurance strategies — and inject it as a **high-priority CARE GUIDANCE block** into the companion's chat system prompt so it behaves consistently with real care advice: never raises distressing facts, redirects gently when asked, and leans on comfort topics. This is a **safety / consistency** feature. The guidance must take **priority over chattiness** and compose cleanly with the existing style, personality, memory, and multilingual blocks.

## 3. Implementation plan

### 1) Add a `carePlan` object to the persona (data shape)
`carePlan` is an **optional** sub-object on the persona:
```
carePlan: {
  routine:       string,    // free text: daily routine / rhythm
  dosAndDonts:   string,    // free text: do's & don'ts
  avoidTopics:   string[],  // topics to NEVER raise (the safety core)
  comfortTopics: string[],  // topics that soothe / bring joy
  triggers:      string,    // free text: what upsets/agitates them
  strategies:    string,    // free text: reassurance / redirection strategies
}
```
Backward-compat rule: every field optional; a persona with **no `carePlan`** must behave exactly as today.

### 2) Caregiver "Care plan" editor UI (`frontend/src/components/PersonaEditor.jsx`)
- Add state seeded from `initial`:
  ```js
  const [carePlan, setCarePlan] = useState(initial?.carePlan || {
    routine: '', dosAndDonts: '', avoidTopics: [], comfortTopics: [], triggers: '', strategies: ''
  });
  ```
- Add a **dedicated "Care plan (for caregivers)" section** below the personality textarea (after line ~240, before the face section). Wrap it in a labeled block with a short helper line: *"Private guidance for the companion — it will follow this and never bring up topics you mark to avoid."*
- Fields:
  - **Daily routine** — `<textarea>` → `carePlan.routine`.
  - **Do's & don'ts** — `<textarea>` → `carePlan.dosAndDonts`.
  - **Topics to avoid** — chip/tag input writing `carePlan.avoidTopics` (string[]). Simplest correct version: a text input where Enter adds a chip, each chip has an X to remove. Helper text example: *"e.g. her late husband, the house sale"*.
  - **Comfort topics** — same chip input → `carePlan.comfortTopics`. Helper: *"e.g. gardening, her grandchildren"*.
  - **Triggers** — `<textarea>` → `carePlan.triggers`.
  - **Reassurance strategies** — `<textarea>` → `carePlan.strategies`.
- Reuse existing `.pe-field` / `.pe-grid` classes. Add only the few new classes you need for chips (e.g. `.pe-chips`, `.pe-chip`, `.pe-chip-x`) **inside the existing inline `<style>` block**, matching the dark palette (slate bg `rgba(15,23,42,0.8)`, border `rgba(255,255,255,0.12)`, accent `#a78bfa`/`#c4b5fd`). No new stylesheet, no new theme.
- In `save()` (line 161), **add `carePlan` to the emitted object**. Normalize first: trim string fields; for the two arrays, drop empty/whitespace entries and de-dupe. Always emit the object (even if all-empty) — harmless and keeps the shape stable.

### 3) Thread `carePlan` through to the backend (`frontend/src/pages/AvatarPage.jsx`)
- In `runTurn()` (line ~202) **add `carePlan: persona.carePlan` to the `persona` object sent to `/persona/chat`.** It is currently an explicit allow-list, so this MUST be added by hand — do not rely on a spread.
- Optionally add the same to `flushSession()`'s persona (line 233) for consistency, but it is **not** required for this feature (memory summarization doesn't need it).
- No other AvatarPage logic changes (greeting, proactive nudge, TTS, call loop all untouched).

### 4) Inject the CARE GUIDANCE block (`app/services/llm_service.py` → `chat_as_persona`)
- Read `carePlan = persona.get("carePlan") or {}` near the top with the other field reads (around line 193).
- **After** the multilingual blocks (after line 275) and **before** building `messages` (line 278), append a single high-priority block IF any care-plan field is non-empty. Build it defensively (skip empty parts). Suggested phrasing (keep it directive and unambiguous):
  ```
  CARE GUIDANCE (most important — follow this above everything else, including being chatty):
  - You are caring for someone who may be confused or fragile. Be gentle and protective.
  - NEVER bring up, mention, hint at, or confirm these topics — if they come up, do not engage; gently change the subject to something comforting instead: <avoidTopics joined>.
  - If they ask directly about an avoided topic, do NOT lie harshly or argue — softly redirect with warmth and steer toward a comfort topic. Never say a topic is "off limits".
  - Lean toward these comforting topics when you can: <comfortTopics joined>.
  - Things that upset them — avoid and de-escalate: <triggers>.
  - When they seem anxious or upset, reassure them like this: <strategies>.
  - Their daily routine: <routine>.
  - Do's and don'ts: <dosAndDonts>.
  ```
  Only include the bullets whose source field is non-empty. `avoidTopics`/`comfortTopics` join with `", "`.
- **Priority wording matters:** this block must explicitly say it **overrides chattiness/style**, because `style == "chatty"`/`"dosti"` otherwise pushes the model to volunteer stories. Put the "follow this above everything else" clause first.
- It must **compose** with what's already there — append, don't replace. It coexists with the personality/memory/multilingual/style text; the language blocks still dictate output language, so the guidance is followed **in Hindi/Hinglish/English** automatically.
- Do **not** touch the model list, temperature, history handling, or `max_tokens` logic.

### 5) Endpoint — no change required (`app/api/persona_endpoint.py`)
`POST /persona/chat` already passes the whole `persona` dict through to `chat_as_persona`, so `carePlan` arrives automatically once the frontend sends it. **No edit needed**, but verify nothing strips unknown keys (it doesn't — `persona = payload.get("persona") or {}`).

## 4. Data contract

- **`carePlan` shape** (all optional):
  `{ routine: string, dosAndDonts: string, avoidTopics: string[], comfortTopics: string[], triggers: string, strategies: string }`
- **`/persona/chat` request addition** (inside the existing `persona` object):
  ```json
  { "text": "...", "persona": { "...existing fields...", "carePlan": { "routine":"", "dosAndDonts":"", "avoidTopics":[], "comfortTopics":[], "triggers":"", "strategies":"" } }, "user": {...}, "history": [...] }
  ```
  Response unchanged: `{ "status":"ok", "text": "..." }`.
- **`chat_as_persona`**: reads `persona.get("carePlan")`; **signature unchanged** (carePlan rides inside the existing `persona` dict — do NOT add a new positional param).
- **Store / localStorage**: unchanged key `factech_state_v1`; `persona` gains an optional `carePlan` key. `setPersona` already round-trips it. No migration.

## 5. Acceptance criteria + manual test

- [ ] PersonaEditor shows a "Care plan (for caregivers)" section in both **Onboarding** (create) and the **AvatarPage Edit modal** (edit), styled to match the dark theme.
- [ ] Adding/removing chips in **Topics to avoid** / **Comfort topics** works and persists across reload (localStorage).
- [ ] Saving emits `persona.carePlan`; `runTurn()` sends it in the `/persona/chat` body (verify in DevTools Network tab).
- [ ] When `carePlan` is **absent/empty**, `/persona/chat` behaves byte-for-byte as before (no CARE GUIDANCE block in the prompt).
- [ ] **Safety test:** Set Topics to avoid = `["her late husband"]` for a persona named e.g. "Margaret". Then:
  - Ask an open question ("How are you?") → companion does **not** volunteer the avoided topic.
  - Ask directly ("Where is my husband / has Dad died?") → companion does **not** confirm/raise the death; it **gently redirects** toward a comfort topic and reassures — never says "that's off limits".
- [ ] Comfort test: with `comfortTopics = ["gardening"]`, the companion steers toward gardening when redirecting.
- [ ] Multilingual test: with `language: "hindi"`, the redirect/guidance is followed and the reply is still in Devanagari Hindi; repeat for `"hinglish"` (Roman) and English.
- [ ] Priority test: with `style: "chatty"` + an avoid-topic, the companion stays chatty in tone but **still never raises** the avoided topic.

Manual test script: `npm run dev` (frontend) + run the FastAPI backend with `GROQ_API_KEY` set → onboard → fill the care plan → chat as above, watching the Network request body and the replies.

## 6. Constraints / do-not-break

- **Reuse `llm_service.chat_as_persona`** — no new service, no new endpoint. The guidance is one appended block in the existing system-prompt assembly.
- `/persona/chat` MUST keep working when `carePlan` is **absent** (treat missing/empty as "no guidance").
- Preserve the existing **multilingual** behavior (English / Hindi-Devanagari / Hinglish) — the care block must be followed in whatever language the language block selects. Keep all existing blocks (style, personality, episodic memory, dosti) intact and composing.
- Keep the **dark inline `<style>`** approach; reuse `pe-*` classes, add only minimal new chip classes inline. No new CSS files, no UI framework.
- **No hardcoded secrets**; no new API keys; no new env vars.
- The CARE GUIDANCE must take **priority over chattiness/style** — phrase it as overriding, and place it last so it's the most recent, strongest instruction before the conversation.
- Don't change the model list, temperature, token caps, history window, greeting, proactive nudge, TTS, or live-call loop.
- `AvatarPage` sends an **explicit allow-list** to `/persona/chat`; add `carePlan` by hand (a spread would also pull voice/face blobs into the chat payload — avoid that).

## 7. Out of scope

- No clinical / medical care-plan **templates**, no medication-dosing logic, no diagnoses, no medical advice. (Reminders/medication already live in a separate feature — see `03-reminders-medication.md`.)
- No backend persistence of the care plan beyond the existing localStorage persona (no DB table, no Qdrant).
- No caregiver auth / multi-user separation, no audit log, no PHI handling guarantees — this is product guidance text, not a clinical record.
- No automatic extraction of avoid-topics from chat; the caregiver enters them by hand.

---

# Feature 16 — Health & vitals tracker

# Feature: Health & vitals tracker (BP / sugar / weight / temp / mood)

> Paste this whole file to Claude Code as the task. It is grounded in the real repo — file paths, function names, and line numbers below were verified.

---

## 1. Context (verified by reading the repo)

- **Project:** Factech AI — FastAPI + React 19 (Vite 7) AI memory companion for dementia/Alzheimer's patients. Frontend in `frontend/`, backend `app/main.py` with routers under `settings.API_V1_STR` = `/api/v1`.
- **All patient state is client-only.** `frontend/src/lib/store.js` is a `useSyncExternalStore` store persisted to `localStorage` under key `factech_state_v1`. Default shape (line 7): `{ profile, persona, memories[], transcript[], reminders[], insightsHistory[] }`. Mutations go through `set(next)` (line 24) → `persist()` (line 20, capacity-safe, swallows quota errors) → `emit()`. The React hook is `useAppState()` (line 85).
- **Existing store helpers to mirror:**
  - `addReminder(r)` (lines 60–67) creates `{ id, title, time, type, lastFired }`, sorts by `time`. ID pattern: `String(Date.now()) + Math.random().toString(36).slice(2, 7)`.
  - `removeReminder(id)` (lines 68–70). `markReminderFired(id, dayKey)` (lines 71–73).
  - `addInsight(ev)` (lines 76–80) pushes `{ date, mood, engagement }` and **caps the array at 30** via `.slice(-30)` — copy this capping discipline for `vitals`.
  - `addMemory` (lines 35–43) shows the ISO-date + spread pattern.
- **Reminders UI to reuse:** `frontend/src/components/Reminders.jsx`. Has a `TYPES` icon/color/label map (lines 5–10), an inline add-form toggled by `adding` state (lines 41–52: text input + `<select>` type picker + `Save`), a list render with a colored icon chip (`.rm-ic`, lines 63–70), and a self-contained dark inline `<style>` block (lines 75–96). **Match these `.rm-*` conventions** (card `rgba(30,41,59,0.55)`, violet accents `#a78bfa`/`#7c3aed`, gradient save button).
- **Trend chart to reuse:** `frontend/src/components/WellbeingInsights.jsx`. The bar chart is lines 72–86 (`.wi-trend` flex row of `.wi-bar-wrap` → `.wi-bar` with `height: (score/max)*100%` and per-point `background`), with `MOOD`/`ENGAGE` color maps (lines 8–14) and CSS at lines 133–135. **Reuse this exact bar-chart pattern** — do NOT add a charting library.
- **Reminder firing (the "time to measure" hook):** `frontend/src/App.jsx` lines 17–54 poll `getState()` every 30s; when a reminder is due (`nowMin >= tMin && nowMin - tMin <= 60 && r.lastFired !== today`) it calls `markReminderFired`, shows a banner, and speaks via `window.speechSynthesis`. The localized line is built per `r.type` at lines 41–44 (`medication` / `meal` / `appointment` / else). **Add a `vitals` branch here** rather than building a new scheduler.
- **Home screen:** `frontend/src/pages/HomeView.jsx`. Quick-tile grid `.hv-tiles` (lines 49–65) renders `.hv-tile` buttons (lucide icon + `.hv-tile-t` + `.hv-tile-d`) that call `onNavigate(view)`. `<Reminders />` and `<WellbeingInsights />` are mounted at lines 68–71. **Add a "Health" tile + the new Vitals section here.**
- **Multilingual:** `persona.language` ∈ `English | Hindi | Hinglish`. `App.jsx` lines 39–40 map `hindi`/`hinglish` → `hi-IN`, else `en-US`, and build localized lines. `AvatarPage.jsx` (lines 42–46, 74) follows the same convention. **Preserve this** — vitals labels and the measure-reminder spoken line must be language-aware.
- **API base / backend conventions (for the future sync hook only):** frontend base = `import.meta.env.VITE_API_BASE || '/api/v1'` (see `WellbeingInsights.jsx` line 6). Backend routers use `APIRouter()` + `payload: dict = Body(...)` and return `{"status": "ok"|"error", ...}` (see `app/api/persona_endpoint.py`). ONE shared `qdrant_client` in `app/core/db.py` — never construct a second.
- **Future caregiver sync (do NOT build now):** `docs/claude-prompts/02-caregiver-dashboard.md` specs a SQLite + pairing-code backend where the patient device pushes a syncable slice via `PUT /patient/{id}/state` and `POST /patient/{id}/insight`, gated on `state.auth?.patientId`. Vitals are intended to be viewable there later. For now build **standalone (localStorage)** and leave a clearly-commented, no-op-until-paired sync seam.

---

## 2. Goal

Let the patient (or a caregiver helping them) log everyday vitals — **blood pressure, blood sugar, weight, temperature, mood** — through big, easy inputs; optionally schedule a gentle "time to measure" reminder reusing the existing reminders system; and show **trend charts** in the WellbeingInsights bar-chart style so a caregiver can see direction over time. Out-of-range readings raise a **gentle, non-clinical** caregiver note. Everything is informational only — **no diagnosis, no medical claims**.

---

## 3. Implementation plan (numbered)

### 3.1 — `frontend/src/lib/store.js`: data + helpers
1. Add `vitals: []` to `defaultState` (line 7). Because `load()` spreads `{ ...defaultState, ...JSON.parse(raw) }` (line 12), existing saved states upgrade automatically — confirm no other code assumes the old shape.
2. Add a shared **vital-type config** (export it so the UI imports one source of truth):
   ```js
   export const VITAL_TYPES = {
     bp:     { label: 'Blood pressure', unit: 'mmHg', compound: true,  // systolic/diastolic
               normal: { sys: [90, 140], dia: [60, 90] }, color: '#f472b6' },
     sugar:  { label: 'Blood sugar',    unit: 'mg/dL', normal: [70, 180], color: '#fbbf24' },
     weight: { label: 'Weight',         unit: 'kg',    normal: null,       color: '#60a5fa' },
     temp:   { label: 'Temperature',    unit: '°C',    normal: [36.1, 37.8], color: '#f87171' },
     mood:   { label: 'Mood',           unit: '',      normal: null,       color: '#4ade80',
               // reuse WellbeingInsights mood vocabulary so trends line up
               options: ['positive', 'neutral', 'low', 'anxious'] },
   };
   ```
   Ranges are **simple, configurable defaults — NOT clinical thresholds**. Keep them in this one config object so they can be tuned later.
3. Add helpers (mirror `addReminder`/`addInsight` exactly — same ID scheme, ISO timestamp, and **cap the array, e.g. `.slice(-200)`** to stay localStorage-size aware):
   ```js
   export function addVital(v) {
     const rec = {
       id: String(Date.now()) + Math.random().toString(36).slice(2, 7),
       type: v.type, value: v.value, unit: v.unit ?? '', ts: new Date().toISOString(),
       note: v.note || '',
     };
     set({ vitals: [...state.vitals, rec].slice(-200) });
     maybeSyncVital(rec);  // see 3.7 — no-op until paired
     return rec;
   }
   export function removeVital(id) { set({ vitals: state.vitals.filter((x) => x.id !== id) }); }
   ```
4. Add a pure **out-of-range checker** (no side effects, easy to unit-reason about):
   ```js
   export function vitalFlag(rec) {
     const cfg = VITAL_TYPES[rec.type]; if (!cfg) return null;
     if (cfg.compound && rec.type === 'bp') {
       const { sys, dia } = rec.value || {};
       const outSys = sys != null && (sys < cfg.normal.sys[0] || sys > cfg.normal.sys[1]);
       const outDia = dia != null && (dia < cfg.normal.dia[0] || dia > cfg.normal.dia[1]);
       return (outSys || outDia) ? { type: rec.type, ...rec.value } : null;
     }
     if (!cfg.normal) return null; // weight/mood: no range
     const n = Number(rec.value);
     return (n < cfg.normal[0] || n > cfg.normal[1]) ? { type: rec.type, value: n } : null;
   }
   ```
   It returns `null` when in range or when the type has no range; the UI turns a non-null result into a **gentle worded note**, never a diagnosis.
5. Make `resetAll()` (line 82) still work — since it spreads `defaultState`, the new `vitals: []` is covered automatically.

### 3.2 — Vitals logging UI: `frontend/src/components/VitalsTracker.jsx` (new)
6. Build it as a near-twin of `Reminders.jsx`: a card with a header (`Activity`/`HeartPulse` lucide icon + title), an `Add` / `Close` toggle (`adding` state), and an inline add-form. Reuse the `.rm-*` class conventions and dark style block (copy and rename to `.vt-*`, or reuse identical CSS values).
7. **Type picker** = a `<select>` over `Object.entries(VITAL_TYPES)` (same shape as `Reminders.jsx` lines 45–47).
8. **Big number inputs** (dementia-friendly): render the value field(s) per selected type:
   - `bp` → two large `inputmode="numeric"` fields **Systolic** / **Diastolic**, store `value: { sys, dia }`.
   - `sugar` / `weight` / `temp` → one large `inputmode="decimal"` numeric field; show the unit beside it from `VITAL_TYPES[type].unit`.
   - `mood` → a row of big tappable buttons from `VITAL_TYPES.mood.options` (reuse WellbeingInsights `MOOD` colors), store the chosen string.
   - Optional `note` text input.
   Inputs must be visibly large (≥18px font, generous padding) — match the kiosk's dementia-friendly sizing.
9. On Save: call `addVital({ type, value, unit: VITAL_TYPES[type].unit })`, then immediately run `vitalFlag(rec)`; if non-null, set a small in-card **gentle flag** (see 3.5). Reset the form like `Reminders.save()` (lines 26–30).
10. Render a recent-readings list (last ~8) with the type's colored icon chip (mirror `.rm-item`), the formatted value + unit, a relative/short timestamp, and a delete button calling `removeVital(id)`.
11. **Multilingual labels:** add a tiny `labelsFor(lang)` map (English / Hindi / Hinglish) for the section title, field labels, and the flag/empty-copy, keyed off `(persona?.language || '').toLowerCase()` from `useAppState()` — same approach as `App.jsx`/`AvatarPage.jsx`. Fall back to English.

### 3.3 — Vitals trend view (reuse the WellbeingInsights chart)
12. **Extract the bar chart into a shared component** to avoid duplicating the logic that currently lives only in `WellbeingInsights.jsx` (lines 72–86): create `frontend/src/components/TrendBars.jsx` taking props `{ points: [{ value, color, title }], max }` and rendering the `.wi-trend` / `.wi-bar-wrap` / `.wi-bar` structure (height = `(value/max)*100%`). Move the chart CSS (lines 133–135) into this component.
13. Refactor `WellbeingInsights.jsx` to render `<TrendBars />` with its mood points (`MOOD[h.mood].score`, max 4) so behavior is **identical** — verify the mood trend still renders the same.
14. In `VitalsTracker.jsx` (or a sibling `VitalsTrends.jsx` it renders), show a small per-type trend: a type switcher (default to the type with the most readings), then `<TrendBars points={...} max={...} />` over `state.vitals.filter(v => v.type === sel).slice(-12)`.
    - Numeric types: `max` = a sensible per-type ceiling (e.g. derive from observed max or the normal-range upper bound × 1.5); color = `VITAL_TYPES[type].color`; per-bar `title` = value + unit + localized date.
    - `bp`: chart systolic (primary line) — keep it simple, one series.
    - `mood`: reuse the 1–4 `MOOD` scoring so it matches the wellbeing chart visually.
    - Show the trend only when there are **≥2** readings (same gate as WellbeingInsights line 72).

### 3.4 — Optional "time to measure" reminder type (reuse reminders)
15. Add a `vitals` entry to the `TYPES` map in `frontend/src/components/Reminders.jsx` (lines 5–10), e.g. `vitals: { icon: Activity, color: '#34d399', label: 'Measure vitals' }`, so a user can schedule "Check blood pressure" at a time like any other reminder. No new data model — it's just another `reminder.type`.
16. In `frontend/src/App.jsx`, add a `vitals` branch to the localized line builder (lines 41–44), e.g. `${uname}, gentle reminder — time to check your ${r.title}.`, with a Hindi/Hinglish variant matching the `ttsLang` logic on lines 39–40. **Do not change** the existing firing condition or other branches.

### 3.5 — Out-of-range gentle flag
17. When `vitalFlag(rec)` is non-null, surface a soft, supportive note inside the Vitals card — reuse the WellbeingInsights "Worth noticing" warn styling (`.wi-label.wi-warn`, amber `#fbbf24`, lines 99–101/127). Wording must be **informational and gentle**, e.g. *"This reading is outside the usual range you set — it may be worth mentioning to a caregiver."* **Never** output a diagnosis, severity, or medical instruction.
18. (Optional, low-risk) also write a wellbeing-style breadcrumb so the caregiver view picks it up later — but do **not** call the LLM and do **not** alter `insightsHistory`'s shape; if unsure, skip and rely on the synced `vitals` slice.

### 3.6 — "Health" tile on HomeView
19. In `frontend/src/pages/HomeView.jsx`, add a `.hv-tile` to the `.hv-tiles` grid (lines 49–65): lucide `Activity` (or `HeartPulse`) icon, title "Health", description like "Log blood pressure, sugar, weight & mood." Either navigate to a section or scroll to the mounted tracker.
20. Mount `<VitalsTracker />` in the page (a natural spot is just after `<Reminders />`, line 68, before `<WellbeingInsights />`). Keep imports tidy at the top with the other component imports (lines 4–6).

### 3.7 — Future caregiver-dashboard sync hook (seam only, no backend now)
21. Add a `maybeSyncVital(rec)` function in `store.js` that is a **no-op unless paired**, matching the seam described in `docs/claude-prompts/02-caregiver-dashboard.md`:
    ```js
    // Future: when the caregiver-dashboard backend (doc 02) lands, the patient
    // device will be "paired" (state.auth?.patientId set). Until then this is a
    // silent no-op so the standalone localStorage flow is unaffected.
    function maybeSyncVital(rec) {
      const pid = state.auth?.patientId;
      if (!pid) return;                 // not paired → local only
      const base = import.meta.env.VITE_API_BASE || '/api/v1';
      // fire-and-forget; swallow errors so offline still works
      try { axios.put(`${base}/patient/${pid}/vitals`, rec).catch(() => {}); } catch {}
    }
    ```
    `axios` is already a dependency. **Do not** add an `auth` field or any backend endpoint as part of this task — just leave this guarded seam and a comment pointing at doc 02. The `state.auth?.patientId` check is forward-compatible (it's simply `undefined` today).

---

## 4. Data contract (precise)

- **Vital record** (in `state.vitals`, capped to last 200):
  ```jsonc
  { "id": "1718…x7a2c", "type": "bp|sugar|weight|temp|mood",
    "value": 128 | { "sys": 128, "dia": 82 } | "neutral",
    "unit": "mmHg|mg/dL|kg|°C|''", "ts": "2026-06-14T09:00:00.000Z", "note": "" }
  ```
- **Normal-range config** = `VITAL_TYPES` in `store.js` (section 3.1 #2). Defaults: BP sys `[90,140]` / dia `[60,90]`, sugar `[70,180]` mg/dL, temp `[36.1,37.8]°C`; weight & mood have **no** range (`normal: null`). These are **configurable, non-clinical** placeholders.
- **localStorage keys:** `factech_state_v1` only — same key, additive `vitals: []` field (no shape break). No new top-level keys.
- **Trend points** passed to `TrendBars`: `{ value: number, color: string, title: string }[]` + `max: number`.
- **Sync payload (future only):** the single vital record, `PUT /api/v1/patient/{patientId}/vitals` — guarded by `state.auth?.patientId`, no-op today.

---

## 5. Acceptance criteria + manual test path

**Acceptance criteria**
- [ ] `npm run dev` in `frontend/` builds with no new errors; no new dependency added.
- [ ] HomeView shows a "Health" tile; a Vitals tracker card renders on Home.
- [ ] Logging each type works: BP (two fields → `{sys,dia}`), sugar/weight/temp (one numeric field + unit), mood (button row). Each appears in the recent list and **survives a page reload** (localStorage).
- [ ] A reading outside the configured range shows a **gentle, non-diagnostic** flag; an in-range reading shows none; weight/mood never flag.
- [ ] With ≥2 readings of a type, a trend chart renders in the **WellbeingInsights bar-chart style** (shared `TrendBars`), and the existing Wellbeing mood trend still looks identical after the refactor.
- [ ] Adding a `Measure vitals` reminder and letting it fall due triggers the banner + spoken line with the new `vitals` wording; existing medication/meal/appointment/general reminders are unchanged.
- [ ] Hindi/Hinglish persona shows localized vitals labels and a localized measure-reminder line.
- [ ] Removing the last reading and `resetAll()` both leave a valid empty state.

**Manual test path**
1. `uvicorn app.main:app --reload` (optional for this feature) and `npm run dev` in `frontend/`.
2. Home → click **Health** → log a BP of `150/95` → confirm it lists and shows the gentle out-of-range note.
3. Log `120/78` → confirm no flag. Log a weight → confirm never flags.
4. Log 2–3 sugar readings → confirm the trend chart appears and matches the wellbeing bar style.
5. Reload the page → all readings persist.
6. Reminders → add a **Measure vitals** reminder for the current minute → wait ≤30s → confirm banner + spoken "time to check" line.
7. Switch persona language to Hindi → confirm labels + measure line localize.
8. Run Wellbeing "Evaluate" twice → confirm the mood trend chart still renders correctly (shared component regression check).

---

## 6. Constraints / DO NOT BREAK
- **No medical diagnosis or claims.** Vitals and flags are **informational only**; wording stays gentle and defers to a caregiver/clinician. No severity scores, no "you have…" statements.
- Keep the existing **reminders** and **wellbeing insights** working: only **add** a `TYPES`/`App.jsx` branch and **extract** (not rewrite) the bar chart. The refactored `WellbeingInsights` must behave identically.
- **Reuse the existing chart style** (`.wi-trend`/`.wi-bar`) — do **not** add a chart library (no recharts/chart.js/d3).
- **Multilingual** via `persona.language` (English/Hindi/Hinglish), same mapping as `App.jsx`/`AvatarPage.jsx`.
- **Dark inline `<style>`** blocks in JSX (card `rgba(30,41,59,0.55)`, violet `#a78bfa`/`#7c3aed` accents) — match `Reminders.jsx`/`WellbeingInsights.jsx`. Large, dementia-friendly inputs.
- **No hardcoded secrets**; the future sync hook reads `import.meta.env.VITE_API_BASE` only and is a no-op until paired.
- **localStorage-size aware:** cap `vitals` (e.g. last 200) like `addInsight`/`addTurn` do; rely on the existing quota-safe `persist()`.
- Do not construct a second Qdrant client; this feature touches no Qdrant code.

## 7. Out of scope
- No device / Bluetooth / wearable integration — manual entry only.
- No clinical thresholds, alarms, or escalation beyond the simple **configurable** ranges in `VITAL_TYPES`.
- No backend persistence in this task — only the guarded, no-op sync seam pointing at `docs/claude-prompts/02-caregiver-dashboard.md`.
- No charting library; no new top-level localStorage keys; no changes to `insightsHistory` shape.
- No LLM call for vitals interpretation.
