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
