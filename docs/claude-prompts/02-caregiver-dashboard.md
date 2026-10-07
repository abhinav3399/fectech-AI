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
