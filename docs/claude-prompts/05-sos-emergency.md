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
