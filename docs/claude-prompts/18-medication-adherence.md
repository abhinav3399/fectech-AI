# Feature: Closed-loop medication adherence (confirm → log → escalate) on the new DB

> Supersedes the JSON-file approach in `03-reminders-medication.md`: the project NOW has a real
> SQLite database + accounts, so adherence is logged there, tied to the carer's account.

## Context (verified by reading the repo)
- **Project:** Factech AI — FastAPI backend (`app/main.py`, routers under `/api/v1`) + React 19/Vite frontend. API base `import.meta.env.VITE_API_BASE || '/api/v1'`.
- **Reminders fire only in-tab, with NO proof of intake.** `frontend/src/App.jsx` runs a 30s `setInterval` over `getState().reminders`; when due (`nowMin>=tMin && nowMin-tMin<=60 && r.lastFired!==today` and `r.enabled!==false`) it calls `markReminderFired(id, today)`, shows a banner, and speaks (multilingual `hi-IN`/`en-US`). No Taken/Skip, no missed-dose tracking.
- **Reminder model** (`frontend/src/lib/store.js`): `addReminder/updateReminder/toggleReminder/removeReminder`; shape `{ id, title, time, type, description, frequency, enabled, lastFired }`, `type ∈ medication|meal|event`, `frequency ∈ once|daily|weekly`. UI: standalone `frontend/src/pages/RemindersPage.jsx` (two-column create + active list with on/off toggles, edit, delete) and the Home card `frontend/src/components/Reminders.jsx`.
- **A real database + accounts now exist** (built recently):
  - `app/db.py` — SQLModel engine over `settings.DATABASE_URL` (default `sqlite:///./factech.db`), `init_db()` called in `app/main.py` startup, `get_session()` dependency.
  - `app/db_models.py` — `User` and `UserState` SQLModel tables.
  - `app/api/auth_endpoint.py` — `register/login/me`, `GET/PUT /state`, and a `get_current_user` dependency (Bearer token, `app/core/security.py`).
  - **Note:** the FRONTEND is not yet wired to auth/login (still localStorage-only). So adherence must work with an OPTIONAL account: if a Bearer token is present use that user; else fall back to a stable `user_id` from the request (e.g. the profile name) / a `"kiosk"` default.
- **Backend route style:** `APIRouter()`, `payload: dict = Body(...)`, return `{"status": ...}`. Caregiver alerting does NOT exist (EmergencyButton = tel: links only).

## Goal
Turn medication reminders into a confirmed, **server-tracked** loop: when a med is due the persona asks *"Did you take your blue pill?"*, the patient confirms via **voice ("yes") or a big TAKEN / SNOOZE / SKIP button**, every outcome is **logged in the database with a timestamp**, a missed/unconfirmed dose gets ONE gentle re-prompt then a caregiver flag, and a weekly **adherence summary** shows per medication.

---

## Implementation plan

### Part A — DB + endpoints (backend, reuse the new SQLite layer)
1. `app/db_models.py` — add an `AdherenceLog` SQLModel table: `{ id (PK), user_id (int|null, FK→user.id when signed in), kiosk_id (str|null, when not), reminder_id (str), title (str), type (str), status (str: taken|snoozed|skipped|missed), ts (float) }`. (Tables auto-create via existing `init_db()`.)
2. New `app/api/reminders_endpoint.py` (`APIRouter()`), mirroring `auth_endpoint.py` style; reuse `get_session` and an OPTIONAL-auth helper (try `get_current_user`, else read `user_id`/`kiosk_id` from the body):
   - `POST /adherence/log` — body `{ reminder_id, title, type, status, kiosk_id? }` → insert a row → `{"status":"ok","id":...}`.
   - `GET /adherence?days=7` (+ optional `kiosk_id`) → `{"status":"ok","items":[...], "summary": {<reminder_id>: {taken, skipped, missed, total}}}`.
3. `app/main.py` — `from app.api import reminders_endpoint` and `app.include_router(reminders_endpoint.router, prefix=settings.API_V1_STR)` alongside the existing includes. **Do not touch the frontend-serving block or other routers.**

### Part B — Adherence loop (frontend)
1. `frontend/src/lib/store.js` — add `adherence: []` to `defaultState` (additive migration via `{...defaultState, ...parsed}`). Helpers: `logAdherence({reminderId,title,type,status})` → push `{id,reminderId,title,type,status,ts:ISO}` (cap ~500), `set(...)`, AND best-effort `POST {API_BASE}/adherence/log` (fire-and-forget, never block UI; include the auth Bearer header if a token exists, else `kiosk_id = profile.name || "kiosk"`).
2. `frontend/src/App.jsx` — when a **medication** reminder fires, replace the passive banner with an **Adherence prompt**: three large dementia-friendly buttons **✓ Taken / Snooze 10 min / Skip** (reuse `lucide-react` `Pill`, large tap targets, existing banner styles). Wire each to `logAdherence`. **Snooze** sets `snoozeUntil` (add to the reminder; re-prompt in 10 min). **Skip** logs `skipped`. Keep `speechSynthesis` + multilingual lines. Non-med reminders keep the current gentle banner.
3. **Missed-dose detection:** in the same interval, if a medication reminder went past its window for `today` with no `taken/skipped/snoozed` outcome, log `status:"missed"` once and surface a calm caregiver note (via `toast()`), wiring toward the future SOS feature. Never alarm the patient.
4. **Voice confirm (optional, callMode):** if `AvatarPage` is in a live call when a med is due, accept a spoken "yes/haan" as **Taken** (reuse the Web Speech transcript).

### Part C — Visibility
1. `frontend/src/pages/RemindersPage.jsx` — under each medication's Active-Reminder card, show a small **"Taken 5/7 this week"** strip read from `GET /adherence` (or `store.adherence` offline). Match the existing `.rp-*` styles.
2. (Optional) a compact "Medication adherence — last 7 days" summary block for carers on `HomeView.jsx` or the WellbeingInsights panel.

## Data contract
- `AdherenceLog` row / `POST /adherence/log` body:
  ```json
  { "reminder_id": "str", "title": "str", "type": "medication", "status": "taken|snoozed|skipped|missed", "kiosk_id": "str?" }
  ```
- `GET /adherence?days=7` → `{ "status":"ok", "items":[...], "summary": { "<reminder_id>": { "taken":N,"skipped":N,"missed":N,"total":N } } }`
- Reminder gains `snoozeUntil: ISO|null` (additive; default null in `addReminder`).

## Acceptance criteria
- [ ] Adding a medication reminder ~1 min ahead shows the **Taken / Snooze / Skip** prompt at the due time (tab open).
- [ ] **Taken** logs `status:"taken"` to `store.adherence` AND inserts a row in SQLite (verify via `GET /api/v1/adherence` and `sqlite3 factech.db "select * from adherencelog"`). **Skip** → `skipped`. **Snooze** → re-prompts ~10 min later.
- [ ] A med whose window passes with no response logs exactly one `missed` row and a calm caregiver toast — patient sees nothing alarming.
- [ ] `GET /api/v1/adherence?days=7` returns items + a per-reminder summary; RemindersPage shows "Taken X/7".
- [ ] Works **without** the frontend being logged in (uses `kiosk_id`); if/when auth is wired, a Bearer token attributes logs to that `user_id`.
- [ ] Backend still boots, `init_db()` creates `adherencelog`, and existing endpoints (`/persona/chat`, `/tts`, `/clone-voice`, `/auth/*`, `/state`) are unchanged.
- [ ] Multilingual reminder copy preserved (`hi-IN`/`en-US`).

## Constraints / do not break
- Reuse the EXISTING DB layer (`app/db.py` engine + `get_session`, `init_db()` in startup) and the `auth_endpoint.py` patterns — do NOT spin up a second engine or a parallel JSON store.
- Keep the single localStorage key and store API; only ADD `adherence` + the `snoozeUntil` field.
- Keep `App.jsx`'s existing reminder interval + multilingual speech as the base; extend, don't replace.
- Match the dark theme + large dementia-friendly tap targets; reuse `lucide-react` icons and existing `.rm-*`/`.rp-*` styles.
- Never block the UI on a network call (adherence logging is fire-and-forget with offline fallback in the store).

## Out of scope
- The full tiered SOS escalation ladder (missed dose here only logs + a local caster toast).
- Wiring the frontend login/onboarding to accounts (separate task) — adherence must work with the optional `kiosk_id` fallback.
- Background/closed-tab delivery (Web Push / PWA) — that's `03-reminders-medication.md`; this feature is the confirm-and-track loop on the new DB.
- Camera "pill ingestion" verification (fragile; explicitly deferred).
