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
