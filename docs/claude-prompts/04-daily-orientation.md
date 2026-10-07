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
