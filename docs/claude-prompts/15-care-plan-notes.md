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
