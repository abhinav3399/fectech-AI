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
