# Feature: Gentle cognitive games built from the patient's own photos

## 1. Context (verified by reading the repo)
- **Project:** Factech AI — an AI memory companion for dementia/Alzheimer's patients. Backend = FastAPI (entry `app/main.py`, routers mounted under `settings.API_V1_STR` = `/api/v1`). Frontend = React 19 + Vite 7 in `frontend/`.
- **Enrolled people live in Qdrant.** `app/services/memory_service.py` defines `MemoryService` which reuses the ONE shared client `qdrant_client` from `app/core/db.py` (`self.client = qdrant_client`). It ensures three collections in `_ensure_collections()`: `faces` (512-dim), `objects` (1280-dim), and `patients` (512-dim). People are enrolled into **`faces`** via `store_face_memory(...)` (`/remember/person` in `app/api/endpoints.py`) and into **`patients`** via `store_patient_memory(...)` (`/remember/patient`, caregiver flow).
- **Payload fields per enrolled person** (set in `endpoints.py` `remember_person` / `remember_patient`): `name`, `relation`, `age`, `type`, `notes`, `image_base64` (a `data:image/jpeg;base64,...` thumbnail, max 300px, from `encode_image_base64`), `avatar_url`, optional `audio_base64`, `person_id`, `timestamp`. **`image_base64` can be `None`** — handle it.
- **The scroll pattern to copy** is `/debug/names` in `app/api/endpoints.py` (lines ~391–404):
  ```python
  res = memory_service.client.scroll(collection_name="faces", limit=100, with_payload=True)
  points = res[0]
  names = [p.payload.get("name") for p in points]
  ```
  `scroll` returns a tuple `(points, next_page_offset)`. Reuse `memory_service.client` — **never construct a second QdrantClient** (embedded Qdrant locks its folder per-client; see `app/core/db.py` docstring).
- **Frontend store** = `frontend/src/lib/store.js`. `useSyncExternalStore`-based, persisted to `localStorage` key `factech_state_v1`. Default shape (line 7): `{ profile, persona, memories[], transcript[], reminders[], insightsHistory[] }`. `memories[]` items (from `MemoriesPage.jsx` `addMemory`) are `{ id, date, caption, image (dataURL|null), voice (dataURL|null) }`. There is **no games state today**.
- **Navigation is view-string based, NOT react-router.** `frontend/src/App.jsx` holds `const [view, setView] = useState('home')` and renders by `if (view === 'avatar') ... else if (view === 'memories') ... else HomeView`. `HomeView` receives `onNavigate={setView}`. `frontend/src/components/SideNav.jsx` has a `TABS` array `[{id,label,icon}]` and calls `onViewChange(id)`.
- **HomeView tiles** (`frontend/src/pages/HomeView.jsx`, lines ~49–65): `.hv-tiles` grid of `.hv-tile` buttons, each `onClick={() => onNavigate('...')}` with a lucide icon, `.hv-tile-t` title, `.hv-tile-d` description. Reads `{ profile, persona, memories }` from `useAppState()`. There's already a "Who is this?" tile (line 60) that opens the live camera face scanner — **the games "Who is this?" is a DIFFERENT, photo-based, no-camera mode; do not collide with it.**
- **TTS endpoint** = `POST /api/v1/tts` in `app/api/persona_endpoint.py` (lines ~77–107). Body `{ text, voice?, clone_voice_id?, rate? }`; returns `{ status, audio_base64, mime, cloned }`. Default `rate` `-8%` (calmer for elders). Frontend plays it like `AvatarPage.jsx` (line ~144): `new Audio(\`data:audio/mpeg;base64,${r.data.audio_base64}\`).play()`.
- **API base & client:** every frontend file uses `const API_BASE = import.meta.env.VITE_API_BASE || '/api/v1'` and `axios`. Dev proxy `/api` → backend (see existing pages).
- **Multilingual:** `persona.language` ∈ English / Hindi / Hinglish. `App.jsx` (lines ~38–43) maps `hindi|hinglish` → `hi-IN`, else `en-US`. Match that for any spoken/written game copy.
- **Theme:** dark, inline `<style>{\`...\`}</style>` per page. Palette: bg `#0f172a`, cards `rgba(30,41,59,0.55)`, accent gradient `#7c3aed→#2563eb`, violet `#a78bfa`, muted text `#94a3b8`. System UI font.

## 2. Goal
Add a **Games** page offering 2–3 light, encouraging, NON-test engagement activities ("Who is this?" face recall, simple photo matching, "Tell me about this memory") built from the patient's own enrolled people (Qdrant `faces`+`patients`) and their saved `store.memories`. Always kind: gentle reveals, no scores, no timers, no harsh "wrong". Reachable from a new HomeView tile and SideNav tab.

---

## 3. Implementation plan

### Part A — Backend endpoint: list enrolled people for games
1. In `app/api/endpoints.py`, add `GET /games/people`. Scroll **both** `faces` and `patients` using the shared client (mirror the `/debug/names` pattern), merge, and return a clean list:
   ```python
   @router.get("/games/people")
   async def games_people():
       people = []
       seen = set()
       for col in ("faces", "patients"):
           try:
               points = memory_service.client.scroll(collection_name=col, limit=200, with_payload=True)[0]
           except Exception:
               continue
           for p in points:
               pl = p.payload or {}
               name = pl.get("name")
               img = pl.get("image_base64")
               if not name or not img:        # need a name + a photo for a face game
                   continue
               key = name.strip().lower()
               if key in seen:
                   continue
               seen.add(key)
               people.append({
                   "name": name,
                   "relation": pl.get("relation") or "",
                   "image_base64": img,
                   "notes": pl.get("notes") or "",
               })
       return {"count": len(people), "people": people}
   ```
   - Skip entries with no `image_base64` (can't show a face) and de-dupe by name.
   - **No camera, no embeddings, no scoring** — this is a read-only payload list.
   - Wrap each collection scroll in try/except so a missing collection never 500s; return `{"count": 0, "people": []}` gracefully when empty.

### Part B — Games page (frontend)
2. Create `frontend/src/pages/GamesPage.jsx`. On mount, `axios.get(\`${API_BASE}/games/people\`)` → `people[]`; also read `memories` from `useAppState()`. Keep an inline dark `<style>` block matching the theme.
3. **Empty-data state:** if `people.length === 0` AND `memories.length === 0`, show a warm card (e.g. "We'll have gentle games here once you've added some photos and people. There's no rush.") with a button that `onNavigate('memories')`. Never show a broken/blank game. If only one source has data, only offer the games that source can fill (e.g. a face game needs ≥1 person; matching needs ≥2 people OR ≥2 image memories).
4. **Game modes (build the ones the data supports; aim for 2–3):**
   - **a) "Who is this?" (face recall, photo-based):** show one person's `image_base64`. Offer 3–4 large name choices (the right name + a few other enrolled names as distractors; if fewer than 2 people exist, skip this mode). **No timer, no score.** On any tap: reveal warmly — correct → "Yes! That's {name}, your {relation}. 💜"; otherwise a GENTLE reveal, never "Wrong" → "This is {name}, your {relation}. They love you." Always include a "Show me" / reveal button so the patient can never be stuck or made to feel they failed. "Next" advances; reshuffle people.
   - **b) Photo match (pairs):** pick 3–4 image cards (from people photos and/or `memories[].image`) and present a simple, low-stress matching/recall ("Find the two that go together" or "Tap the photo of {name}"). Keep the grid small; celebrate any progress; no fail timer.
   - **c) "Tell me about this memory":** show one `memories[]` item (image + caption) or one person, with a warm open prompt ("Who is in this photo? Take your time — there's no wrong answer."). This is reminiscence, not a quiz: no right/wrong, just a kind prompt and an optional "Read it to me" reveal of the caption/notes.
5. **Encouraging feedback only:** centralize copy in a small helper so EVERY message is kind and supportive. No numeric score, no streak, no timer, no "incorrect/failed/try again harder". Add gentle praise on engagement ("Lovely.", "It's wonderful spending this time with you.").
6. **Optional voice prompts (graceful):** when a prompt or reveal is shown, optionally speak it via `POST ${API_BASE}/tts` (body `{ text, rate: '-8%' }`) and play `new Audio(\`data:audio/mpeg;base64,${audio_base64}\`)`, exactly like `AvatarPage.jsx`. Put it behind a small speaker toggle (default off is fine) and wrap in try/catch — if TTS is down, the game still works silently. Pick prompt language from `persona.language` (hindi/hinglish → Hindi copy + `hi-IN`, else English) consistent with `App.jsx`.

### Part C — Wire up navigation
7. `frontend/src/App.jsx`: add `else if (view === 'games') content = <GamesPage onNavigate={setView} />;` and import `GamesPage`. Pass `persona`/`memories` via the store (the page reads `useAppState()` itself), but keep `onNavigate` for the empty-state CTA.
8. `frontend/src/pages/HomeView.jsx`: add a new `.hv-tile` button in `.hv-tiles` → `onClick={() => onNavigate('games')}`, a lucide icon (e.g. `Puzzle`, `Gamepad2`, or `Sparkles` — import from `lucide-react`), title "Games" (or localized), description like "Gentle, friendly activities with your own photos." Match existing tile markup/classes exactly.
9. `frontend/src/components/SideNav.jsx`: add `{ id: 'games', label: 'Games', icon: <lucide icon> }` to `TABS` so the tab highlights via `currentView === 'games'`.

---

## 4. Data contract
- **`GET /api/v1/games/people`** → `{ "count": number, "people": [{ "name": string, "relation": string, "image_base64": string (dataURL), "notes": string }] }`. Only entries with a name AND a photo; de-duped by name; merged from `faces` + `patients`.
- **Store:** prefer NO new persistent store keys (games are ephemeral). If a "speak prompts" toggle should persist, store it under a single new key e.g. `settings: { gamesVoice: false }` added to `defaultState` in `store.js` with a setter — but localStorage-only, no backend. Do NOT add any score/streak/result persistence.
- **`memories[]`** items consumed read-only: `{ id, date, caption, image, voice }`.

## 5. Acceptance criteria + manual test path
- [ ] `GET /api/v1/games/people` returns 200 with the documented shape; returns `{count:0, people:[]}` (not 500) when collections are empty/missing.
- [ ] A "Games" tile appears on Home and a "Games" tab in the top nav; both navigate to the Games page and highlight correctly.
- [ ] With ≥2 enrolled people, "Who is this?" shows a real enrolled photo + name choices; tapping any choice produces a KIND message (never "Wrong"); a reveal button always exists; "Next" advances.
- [ ] No score, no streak, no timer, no countdown anywhere in the UI.
- [ ] With photos/memories present, at least 2 game modes are offered; with no people and no memories, a gentle empty-state with a "Add memories" CTA shows instead.
- [ ] Voice toggle (if added) speaks the prompt via `/tts` and degrades silently when TTS fails; prompt language follows `persona.language`.
- [ ] Styling matches the dark inline-`<style>` theme.
- **Manual test:** start backend (`uvicorn app.main:app --reload --port 8010`) + frontend (`npm run dev` in `frontend/`). Enroll 2–3 people via the caregiver/Who-is-this flow (or `/remember/person`). Open the app → Home → Games tile. Play each mode; tap correct + incorrect choices and confirm both feel encouraging. `curl http://localhost:8010/api/v1/games/people` to verify payload. Clear Qdrant data (or use a fresh DB) and confirm the empty-state renders without errors.

## 6. Constraints / do-not-break
- **Reuse `memory_service.client` (the ONE shared `qdrant_client`)** and the existing `faces`/`patients` collections — never construct a second QdrantClient, never create new collections.
- **NEVER make it feel like a test, quiz, exam, or assessment.** No scores, no streaks, no timers, no "correct/incorrect/wrong/failed", no red error states. Always kind; always a gentle reveal; the patient can never be "stuck" or made to feel they failed.
- **Multilingual:** honor `persona.language` for all user-facing copy and TTS language (match `App.jsx` mapping).
- **Theme:** dark inline-`<style>`, existing palette/classes; no external CSS framework.
- **No hardcoded secrets / no API keys.** TTS goes through the existing `/tts` endpoint only.
- **Handle empty data gracefully:** zero enrolled people and zero memories → warm empty-state, not a crash or blank screen. Photos may be missing (`image_base64 = None`) — filter those out.
- Don't break the existing camera-based "Who is this?" tile on Home, the Memories page, or the reminder/persona flows.

## 7. Out of scope
- **No cognitive assessment, scoring, diagnosis, progress-tracking, or clinical claims** of any kind — this is gentle engagement/reminiscence, NOT a screening or memory test. Do not log or report "performance".
- No new Qdrant collections, no face-embedding/recognition in the games (photo-based only), no camera capture in the games.
- No leaderboard, achievements, difficulty levels, or competitive mechanics.
- No multiplayer, no backend persistence of game sessions/results.
