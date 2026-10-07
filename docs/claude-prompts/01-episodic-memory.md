## Context (verified by reading the repo)

Project: **Factech AI** — an AI memory companion for dementia/Alzheimer's patients. FastAPI backend + React/Vite frontend; client-only state, no backend persistence yet.

Current behavior I verified:
- `app/services/llm_service.py` → `chat_as_persona(self, user_text, persona, user, history)` builds a system prompt and only feeds `(history or [])[-12:]` (line ~214). It has **no access to anything before the current session**.
- `frontend/src/pages/AvatarPage.jsx` → `runTurn()` (line ~151) sends `history = messagesRef.current.slice(-8)` to `POST {API_BASE}/persona/chat`. The whole chat lives in component `messages` state and is wiped on reload; the persona forgets everything between visits.
- `app/api/persona_endpoint.py` → `POST /persona/chat` (line ~45) reads `text/persona/user/history` and calls `chat_as_persona`. `POST /evaluate` (line ~33) already takes a `transcript` + `persona` + `user` and calls `llm_service.evaluate_conversation(...)` (which returns JSON via Groq with `response_format={"type":"json_object"}`).
- `app/services/semantic_memory.py` already loads `SentenceTransformer('all-MiniLM-L6-v2')` (384-dim) and **reuses the shared `qdrant_client`** from `app/core/db.py`. Collection pattern: `get_collection` in try/except, else `recreate_collection(VectorParams(size=384, distance=Distance.COSINE))`, plus a keyword payload index. Search uses `self.client.query_points(...).points` and returns `match.payload`.
- `app/core/db.py` exposes the **single shared `qdrant_client`** — services MUST reuse it (embedded mode locks the folder per-client).
- `frontend/src/lib/store.js` persists `{ profile, persona, memories, transcript, reminders, insightsHistory }` to `localStorage["factech_state_v1"]`. `profile.name` is set during onboarding (`frontend/src/components/Onboarding.jsx`, `setProfile({ name, age })`). `addTurn(role, text)` appends to `transcript` (capped 300).
- `app/services/conversation_service.py` holds one global context dict (single-user "kiosk" assumption).

## Goal

Give the companion **durable long-term episodic memory**: after each chat session, summarize it into a few embedded "memory facts" stored in Qdrant keyed by user, and at chat time retrieve the top-K relevant facts and inject them into `chat_as_persona`'s system prompt so it can naturally recall prior visits ("yesterday you told me…").

## Implementation plan

### 1. New service: `app/services/episodic_memory.py`
Create `EpisodicMemoryService`, modeled on `semantic_memory.py`:
- **Reuse the existing encoder, do NOT load a second SentenceTransformer.** Import the singleton and reuse its model: `from app.services.semantic_memory import semantic_memory` and use `semantic_memory.encoder`. (Loading all-MiniLM twice wastes RAM/startup.) Also reuse `from app.core.db import qdrant_client` — never construct a new client.
- Collection name: `"episodic_memory"`, `VectorParams(size=384, distance=Distance.COSINE)`. Create it with the same `get_collection`/`recreate_collection` try/except pattern. Create a **keyword payload index on `user_key`** (mirror the `name` index in `semantic_memory.py`).
- Helper `_user_key(user: dict) -> str`: slugify `(user.get("name") or "default").strip().lower()` (spaces→`_`, keep alnum/`_`), fallback `"default"`. This is the per-user scope given today's single-user assumption; it upgrades cleanly the moment `profile.name` exists.
- `def add_memories(self, user: dict, facts: list[str]) -> int`: for each non-empty fact, embed with `semantic_memory.encoder.encode(fact).tolist()`, upsert a `PointStruct(id=str(uuid4()), vector=..., payload={"text": fact, "user_key": _user_key(user), "created_at": datetime.utcnow().isoformat()})`. Return count stored.
- `def retrieve(self, user: dict, query: str, limit: int = 4) -> list[str]`: embed `query`, `query_points(collection_name="episodic_memory", query=emb, query_filter=Filter(must=[FieldCondition(key="user_key", match=MatchValue(value=_user_key(user)))]), limit=limit)`, return `[p.payload["text"] for p in res.points if p.payload.get("text")]`. Guard against empty query (return `[]`).
- Export a module-level singleton `episodic_memory = EpisodicMemoryService()`.
- Wrap Qdrant calls defensively (try/except, log + return safe default) so a memory hiccup never breaks chat.

### 2. New summarizer method on `LLMService` (`app/services/llm_service.py`)
Add `def summarize_session(self, transcript: list, persona: dict = None, user: dict = None) -> list[str]`:
- If `not self.client` or fewer than ~2 non-empty turns → return `[]`.
- Build a transcript string exactly like `evaluate_conversation` does (reuse that `user_name`/`persona_name` + `transcript[-40:]` line-formatting logic).
- Groq call with `response_format={"type":"json_object"}`, model `"llama-3.1-8b-instant"`, low temperature (~0.3). System prompt: *"Extract durable, factual long-term memories about the person from this conversation — things worth remembering for future chats (people/pets they mentioned, events, feelings, preferences, plans, worries). Write each as a short third-person sentence about the person (e.g. 'They visited their daughter Meera on Sunday and felt happy.'). Ignore small talk and greetings. Respond ONLY with JSON: {"facts": [ ...up to 6 strings... ]}. Empty array if nothing durable."*
- Preserve multilingual content: tell the model to **keep facts in the same language the person used** (do not translate Hindi/Hinglish to English).
- Parse JSON, return `result.get("facts", [])[:6]` (strings only, stripped, non-empty). On any error return `[]`.

### 3. Retrieval injection into the chat path (`app/services/llm_service.py`)
- Add an **optional** param to `chat_as_persona`: `memories: list = None` (default `None`) — keep the existing signature backward-compatible (append the param at the end).
- After the persona system prompt is assembled and before appending history, if `memories`: add a block to `system_prompt`, e.g.:
  `"\nThings you remember from your past conversations together (use them naturally, never list them mechanically, and only if relevant): " + " ".join(f"- {m}" for m in memories[:5])`.
- The endpoint (step 4) does the retrieval and passes `memories=` in — do NOT call Qdrant from inside `llm_service` (keep it provider-only; services depending on services stays in the endpoint/service layer like today).

### 4. Endpoints (`app/api/persona_endpoint.py`)
- **Modify `POST /persona/chat`** to retrieve before generating:
  ```python
  from app.services.episodic_memory import episodic_memory
  ...
  mems = episodic_memory.retrieve(user, text, limit=4)  # safe [] on failure
  reply = llm_service.chat_as_persona(text, persona=persona, user=user, history=history, memories=mems)
  ```
  Response stays `{"status":"ok","text": reply}` (unchanged contract).
- **Add `POST /remember`** (end-of-session summarization, kept separate so it can be called on session end without blocking chat):
  - Request JSON: `{ "transcript": [ {"role":"user"|"bot","text":"..."} ... ], "persona": {...}, "user": {"name": "..."} }`
  - Body: `facts = llm_service.summarize_session(transcript, persona, user)`; if `facts`, `stored = episodic_memory.add_memories(user, facts)`.
  - Response: `{ "status":"ok", "stored": <int>, "facts": [...] }`; if nothing to store, `{ "status":"empty", "stored":0, "facts":[] }`.
  - Mirror the `/evaluate` guard: if fewer than 2 non-empty turns, return `{"status":"empty","stored":0,"facts":[]}`.
- No `main.py` change needed — `persona_endpoint.router` is already mounted under `settings.API_V1_STR` (`app/main.py` line ~38).

### 5. Frontend wiring (`frontend/src/pages/AvatarPage.jsx` + `frontend/src/lib/store.js`)
- **`store.js`**: add a small helper `sessionTurns()` that returns the in-session turns to summarize. Simplest correct approach: reuse the existing persisted `transcript` (already populated by `addTurn` in `runTurn`). `export function clearTranscript()` already exists — keep it. No new localStorage key strictly required; if you prefer a marker, add `lastRememberedAt` to the store, but the transcript-based approach is sufficient.
- **`AvatarPage.jsx`**: add `flushSession()` that, when there are ≥2 turns this session, POSTs to `{API_BASE}/remember` with `{ transcript: <current session turns mapped to {role,text}>, persona: {…same fields already sent in runTurn…}, user: { name: profile?.name } }`. Map `role: 'bot'` exactly as the backend expects (it already treats non-`user` as assistant). Fire-and-forget (`.catch(()=>{})`); never block UI.
  - Call `flushSession()` from: (a) the existing page-unmount cleanup `useEffect` (line ~51, the same one that stops mic/speech), and (b) `endCall()` (line ~245) when a live call ends. Debounce so two triggers don't double-summarize the same turns (e.g. track a `rememberedCountRef` of how many transcript turns were already summarized, only send the new tail).
  - Use `navigator.sendBeacon` as a best-effort on unmount if available (page close), else `axios.post`. Keep it resilient.
- Do not change the greeting, proactive-nudge, TTS, or call logic beyond adding the flush hooks.

## Data contract

- **Qdrant collection**: `episodic_memory`, vector size **384**, distance **COSINE**, keyword payload index on `user_key`.
- **Point payload**: `{ "text": string, "user_key": string, "created_at": ISO-8601 string }`.
- **`/remember` request**: `{ "transcript": [{"role":"user"|"bot","text":string}], "persona": object, "user": {"name": string} }`
- **`/remember` response**: `{ "status":"ok"|"empty"|"error", "stored": int, "facts": string[] }`
- **`summarize_session` LLM JSON**: `{ "facts": string[] }` (≤6).
- **`chat_as_persona` new param**: `memories: list[str] | None` (appended to signature; defaults `None`).
- **localStorage**: unchanged key `factech_state_v1`; no shape break. (Optional additive `lastRememberedAt`.)
- **user_key**: slug of `user.name` lowercased; `"default"` when absent.

## Acceptance criteria

- [ ] Starting the backend does **not** load a second SentenceTransformer model (grep: only `semantic_memory.py` calls `SentenceTransformer(...)`); only the shared `qdrant_client` is used (no new `QdrantClient(...)`).
- [ ] On first boot the `episodic_memory` collection auto-creates (384-dim, COSINE) without crashing an existing DB.
- [ ] Manual path: with the app running, open Avatar, tell the persona something memorable across several turns (e.g. "Yesterday my granddaughter Anaya visited and we baked cookies"). Leave the page (or End the call) → a `POST /api/v1/remember` fires and returns `stored ≥ 1` with sensible `facts`.
- [ ] Reload the page / start a new session as the same `profile.name`, ask "do you remember Anaya?" → the reply references the prior memory (because `/persona/chat` injected the retrieved fact). Verify by logging the `mems` passed into `chat_as_persona`.
- [ ] `POST /persona/chat` still returns `{"status":"ok","text":...}` even when the `episodic_memory` collection is empty or Qdrant errors (retrieval failure → `[]`, chat unaffected).
- [ ] Hindi/Hinglish session produces facts in the same language and the recalled memory surfaces in the persona's localized reply (multilingual preserved).
- [ ] `/evaluate`, `/tts`, `/voices`, `/clone-voice`, and existing memory/face endpoints are unchanged and still work.

## Constraints / do not break

- **Reuse the shared `qdrant_client`** (`app/core/db.py`) and the **existing `all-MiniLM-L6-v2` encoder** from `semantic_memory.py`. Do not instantiate a second client or model.
- Keep `chat_as_persona`'s existing behavior identical when `memories` is `None`/empty (backward compatible — frontend old payloads must still work).
- Keep all existing endpoints and response shapes working (`/persona/chat`, `/evaluate`, `/tts`, etc.).
- **Preserve multilingual support** (`persona.language`: english/hindi/hinglish) — never translate stored facts.
- Match existing style: defensive try/except with `print(...)` debug logs (as elsewhere), inline `<style>` blocks + dark theme in JSX, single global service singletons.
- No secrets hardcoded — reuse `settings`/`GROQ_API_KEY` already wired in `LLMService`.
- Memory work must be **fire-and-forget on the frontend**; never block or delay the chat/voice loop. Retrieval must be fast (top-4) and fail-soft.

## Out of scope

- Real multi-user auth / backend session management (still single-user kiosk; `user_key` is the seam for later).
- Memory editing/deletion UI, decay/forgetting, dedup of near-identical facts, or a caregiver "what it remembers" viewer.
- Migrating existing `text_knowledge`, `faces`, `objects`, `patients` collections.
- Switching Qdrant from embedded/local to server, or any infra change.
- Changing the wellbeing `/evaluate` flow or `insightsHistory`.
