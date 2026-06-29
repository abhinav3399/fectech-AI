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
