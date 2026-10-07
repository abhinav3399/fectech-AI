# Feature: SOS escalation ladder — tiered, acknowledged caregiver alerting

## Context (verified by reading the repo)
- **Project:** Factech AI — FastAPI (`app/main.py`, routers under `/api/v1`) + React/Vite. SQLite DB via SQLModel
  (`app/db.py` engine + `init_db()` on startup + `get_session()`; models in `app/db_models.py` = `User`, `UserState`, `AdherenceLog`).
  Accounts exist (`app/api/auth_endpoint.py` → `register/login/me`, `GET/PUT /state`, `get_current_user`, tokens in `app/core/security.py`).
- **Safety signals are produced but go NOWHERE.** The Distress Watch logs `store.distressLog` (`frontend/src/lib/store.js::addDistressEpisode`) and a missed medication logs an `AdherenceLog` row `status:"missed"` (`app/api/reminders_endpoint.py`), but **nothing alerts a human**.
- **"Call family" is one-way.** `frontend/src/components/EmergencyButton.jsx` + `store.emergencyContacts` (`{id,name,relationship,phone,primary}`) are `tel:` links the PATIENT must press — there is no outbound notification, no acknowledgement, no auto-advance.
- Backend route style: `APIRouter()`, `payload: dict = Body(...)`, `{"status":...}`; optional-auth helper pattern already in `reminders_endpoint.py::_owner` (Bearer → user_id, else `kiosk_id`).

## Goal
A backend escalation engine that turns any safety trigger (distress, missed critical dose, manual SOS) into a **tiered, acknowledged** alert: Tier 1 the persona reassures the patient in-character; Tier 2 notify the **primary** contact and wait for an ack; Tier 3 auto-advance to the next contacts if unacked within a window. Every alert carries type, time, and the triggering context; the patient never sees an alarm.

## Implementation plan
### Part A — Data + engine (backend)
1. `app/db_models.py` — add `Incident { id, user_id?, kiosk_id?, type (distress|missed_med|fall|manual), severity (int), detail (str), status (open|acked|resolved), contact_idx (int, who we're on), created_at, updated_at }` and `IncidentEvent { id, incident_id, kind (raised|notified|acked|advanced|resolved), contact, ts }`. Auto-create via `init_db()`.
2. New `app/api/sos_endpoint.py` (reuse `_owner` + `get_session`):
   - `POST /incident` `{type, severity?, detail?, contacts?, kiosk_id?}` → create `open` incident, kick the ladder, return `{status:"ok", id}`.
   - `GET /incidents?days=7` → list + current tier for the dashboard.
   - `POST /incident/{id}/ack` `{by?}` → mark `acked`, stop advancing.
   - `POST /incident/{id}/resolve`.
3. **Notify seam** `app/services/notify_service.py` — pluggable like `mesh_service`/`voice_clone_service`: `send(contact, message)` over providers chosen by `settings.NOTIFY_PROVIDER` (`console|webpush|twilio|off`, default `console` = log only, so it runs with NO keys). Web Push (`pywebpush` + VAPID) and SMS (Twilio) are optional, config-gated.
4. **Ladder** — an `AsyncIOScheduler`/async task (started in `app/main.py` startup alongside `init_db`): on an `open` incident, notify `contacts[contact_idx]`; if still `open` after `settings.SOS_ACK_MINUTES` (default 5), `advance` to the next contact; log every step as an `IncidentEvent`. Quiet-hours via `settings.TIMEZONE`.
5. `app/main.py` — include the router; start/stop the scheduler. Don't touch the SPA block or other routers.

### Part B — Wire the triggers (frontend)
1. `frontend/src/lib/store.js` — in `addDistressEpisode` (sustained) and on a `missed` `logAdherence`, also `POST {API_BASE}/incident` (fire-and-forget; `type` + `detail` + ordered `emergencyContacts`). Add `raiseIncident(type, detail)`.
2. `frontend/src/components/EmergencyButton.jsx` — a manual "I need help" also raises a `manual` incident (in addition to the `tel:` link). Tier-1 patient experience stays calm (the persona reassures); no scary modal.

## Data contract
- `POST /incident` body: `{ "type":"distress|missed_med|fall|manual", "severity":1-3, "detail":"str", "contacts":[{name,phone,relationship}], "kiosk_id":"str?" }`
- `Incident` adds `status` + `contact_idx`; `IncidentEvent` is the audit timeline.

## Acceptance criteria
- [ ] `POST /api/v1/incident` creates an `open` incident; with `NOTIFY_PROVIDER=console` the notification is logged and the ladder advances to the next contact after `SOS_ACK_MINUTES` (use a short value to test); `IncidentEvent` rows record `raised/notified/advanced`.
- [ ] `POST /incident/{id}/ack` stops advancement; `GET /incidents` shows status + tier.
- [ ] A sustained Distress episode and a `missed` dose each auto-raise an incident (verify rows) — the **patient sees nothing alarming**.
- [ ] Backend boots with NO notify keys (provider defaults to `console`); existing endpoints unchanged; `init_db()` creates the new tables.

## Constraints / do not break
- Reuse the existing DB engine/session + `_owner` optional-auth; do NOT add a second store. Config-gate all notify providers; no hardcoded keys.
- Patient-facing tier stays warm and non-alarming. Wrap every outbound send so a failure never crashes the ladder.

## Out of scope
- Real SMS/Web-Push provider setup (ship `console` provider; others are opt-in stubs).
- The caregiver dashboard UI (separate feature — this only writes the incidents it will read).
