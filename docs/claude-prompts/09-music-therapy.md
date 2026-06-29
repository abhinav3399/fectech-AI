# Claude Code Prompt — Music & Nostalgia Therapy

> Paste this whole file into Claude Code from the repo root. It is grounded in the real Factech AI codebase — file paths and patterns below were verified against the current source.

---

## 1. Context (verified against the repo)

Factech AI is a React (Vite) + FastAPI dementia memory companion. The relevant, **already-existing** pieces you will build on:

- **Client store** — `frontend/src/lib/store.js`. A single `localStorage`-backed store under key `factech_state_v1`, shape `{ profile, persona, memories[], transcript[], reminders[], insightsHistory[] }`. State is read via the `useAppState()` hook (`useSyncExternalStore`). Mutations go through helpers that call the private `set(...)` (e.g. `setProfile`, `addMemory`, `addReminder`/`removeReminder`). Note the existing comment in `persist()`: writes are wrapped in `try/catch` and silently drop on `localStorage` quota overflow — **respect this; do not bloat the store**.
- **Navigation** — `frontend/src/App.jsx` is a plain view switcher: `const [view, setView] = useState('home')`; it renders `'avatar' → <AvatarPage/>`, `'memories' → <MemoriesPage/>`, else `<HomeView onNavigate={setView}/>`. The top nav `frontend/src/components/SideNav.jsx` maps a `TABS` array (`home`, `avatar`, `memories`) to `onViewChange(id)`. **There is no React Router.** A new screen = (a) a new `view` string handled in `App.jsx`, optionally (b) a `TABS` entry in `SideNav.jsx`, and (c) an `onNavigate('...')` call from a HomeView tile.
- **HomeView tiles** — `frontend/src/pages/HomeView.jsx`. Quick-action tiles live in `.hv-tiles` (a `<button className="hv-tile" onClick={() => onNavigate('...')}>` with a `lucide-react` icon, `.hv-tile-t` title, `.hv-tile-d` description). `Reminders` and `WellbeingInsights` are rendered inline below the tiles.
- **Add-item UI pattern** — `frontend/src/components/Reminders.jsx`. This is the canonical pattern to copy: a self-contained component with `useAppState()`, a local `adding` toggle, a small inline form (`.rm-form`), a list, per-item delete, and a single inline `<style>{...}` block. Mirror this structure and its dark theme.
- **Persona config + editor** — the one editable `persona` object (name, relationship, gender, age, accent, `language`, style, personality, `voiceId`, `voiceSample`, `voiceCloneId`, `faceImage`, `modelUrl`) is edited in `frontend/src/components/PersonaEditor.jsx`. Note its `blobToDataUrl(blob)` helper and the file-upload pattern (`<input type="file" accept="audio/*" hidden>` + a ref + `e.target.value = ''` to allow re-selecting the same file).
- **Companion / TTS** — `frontend/src/pages/AvatarPage.jsx` drives the chat + voice. `API_BASE = import.meta.env.VITE_API_BASE || '/api/v1'`. It has a `speak(text)` function (backend TTS at `${API_BASE}/tts`, falling back to `window.speechSynthesis`), localized greeting/nudge lines keyed off `persona.language` (`'hindi'` / `'hinglish'` / default English), and a proactive "gentle check-in" interval that already respects browser audio constraints (it only speaks after the user has interacted — `userSpokeRef`).
- **Multilingual** — labels and spoken lines branch on `(persona?.language || '').toLowerCase()` being `'hindi'`, `'hinglish'`, or default. Follow this exact convention.
- **Theme** — every component ships a dark inline `<style>{...}` block (slate `#0f172a` / `#1e293b` surfaces, violet `#7c3aed`/`#a78bfa` + blue `#2563eb`/`#60a5fa` accents, `rgba(255,255,255,0.09)` borders, ~18–22px radii). No external CSS, no Tailwind.

There is **no** music/audio-player concept in the codebase today. `persona.voiceSample` is an unrelated short voice clip.

---

## 2. Goal

Add a **calm, large-button music player** for nostalgia therapy: the caregiver curates the patient's favorite songs / era playlist, and the patient (or the companion) can play "our song" with one big tap. Music is a proven, deeply-reaching channel for people with dementia. Keep it simple, robust, offline-friendly, multilingual, and dementia-friendly (large controls, minimal choices). Optionally let the companion **offer** music during calm/evening moments.

---

## 3. Implementation plan (numbered)

### Storage decision (read first — justify in a code comment)
Songs are caregiver-provided. **Default to a URL list, with optional small local-file uploads stored as Object URLs (NOT base64 in the store).**

- **Why not base64 in `store.js`:** audio files are megabytes; `localStorage` is ~5 MB total and the store already warns it silently drops writes on quota overflow (`persist()` catch). A single 4-minute MP3 would blow the budget and could corrupt the whole app state silently. **Do not store audio bytes in `localStorage`.**
- **Recommended (simplest robust):** store only **metadata** in the store — a `url` (a streamable/CDN link the caregiver pastes, e.g. a public MP3/OGG URL or an internet-radio/era-playlist stream) **or** a `localName` for a file the caregiver picks at play time. For the player, play `url` directly via an `<audio>` element / `new Audio(url)`.
- **Local uploads (optional, second iteration):** if you want uploaded local files to persist across reloads without bloating `localStorage`, use **IndexedDB** (store the `Blob` keyed by song `id`, create an Object URL at play time with `URL.createObjectURL`, and `URL.revokeObjectURL` on cleanup). If you do NOT want to add IndexedDB now, support local files as **session-only** (Object URL held in component state, not persisted) and clearly label them "available this session" — the URL entries are the durable ones. Pick one and note the choice in a comment. **Do not** put raw audio in the persisted store either way.

### 3a. New `MusicPlayer` component — `frontend/src/components/MusicPlayer.jsx`
A self-contained player + playlist manager, modeled on `Reminders.jsx` structure and theme.
1. Read the playlist with `useAppState()` (see 3c). Keep a single hidden `<audio ref>` (or `new Audio()` in a ref) — never stack two.
2. **Now-playing card:** large album art (`song.art` if present, else a gradient circle with a `lucide-react` `Music`/`Disc3` icon), `song.title`, and `song.artist`/era subtitle.
3. **Large transport controls** (dementia-friendly, big hit targets ≥ 56px): Play/Pause toggle (primary, biggest), Previous, Next. Optionally a large progress bar/seek. Keep it to these few controls — no shuffle/volume clutter.
4. **Playlist list:** each row = art thumb + title + a big "Play" affordance + a delete button (mirror `.rm-item` / `.rm-del`). Tapping a row plays that song.
5. **Add-song form** (mirror `.rm-form`): a title input, optional artist/era input, and a **URL** input *or* a "Choose file" button (`<input type="file" accept="audio/*" hidden>` + ref + `e.target.value=''`, like `PersonaEditor.handleUpload`). On save, call `addSong(...)` from the store. Validate that either a URL or a file is provided.
6. **Playback wiring:** `play(index)` sets current index and plays; `togglePlay`, `next`/`prev` wrap modulo length. On `audio.onended`, auto-advance to next (gentle, no jarring stop). Handle `audio.play()` rejection (autoplay policy) gracefully — see Constraints.
7. Empty state copy (mirror `.rm-empty`): invite the caregiver to add the patient's favorite songs / era. Localize the visible labels via `persona.language` (see Constraints).

### 3b. "Music" tile on HomeView — `frontend/src/pages/HomeView.jsx`
Add a fourth `.hv-tile` button in `.hv-tiles`, using a `lucide-react` `Music` icon (import it), title "Music" (localized), description like "Play your favorite songs" → `onClick={() => onNavigate('music')}`. The grid is already `auto-fit minmax(190px,1fr)` so it reflows. (Alternatively, if you prefer no new screen, render `<MusicPlayer/>` inline below `<Reminders/>` like `WellbeingInsights` — but a dedicated tile + view matches "large-button player" best. Implement the tile + view.)

### 3c. Store additions — `frontend/src/lib/store.js`
Add a `playlist` array. Put it on `profile` per the brief (`profile.playlist[]`), exposed through helpers that mirror the reminder helpers:
- Extend `defaultState` so reads are safe: ensure `profile?.playlist` defaults to `[]` (do **not** assume `profile` already has the key — old saved states won't). Read via `(state.profile?.playlist) || []`.
- `addSong(song)` → assigns `id` (same `String(Date.now()) + Math.random().toString(36).slice(2,7)` idiom used by `addMemory`/`addReminder`), merges, persists via `setProfile({ ...profile, playlist: [...prev, song] })`.
- `removeSong(id)` → filters by id and persists.
- (Optional) `reorderSong` / `setFavorite` if trivial; otherwise skip.
- Keep these helpers tiny and consistent with the existing exports. **Never store audio bytes here** — only the metadata object in §4.

### 3d. App wiring — `frontend/src/App.jsx` (+ optionally `SideNav.jsx`)
- Import `MusicPlayer` (or a thin `MusicPage` wrapper) and add `else if (view === 'music') content = <MusicPlayer onNavigate={setView} />;` alongside the existing branches.
- Optionally add `{ id: 'music', label: 'Music', icon: Music }` to `TABS` in `SideNav.jsx` so it's reachable from the top nav too (consistent with other tabs). The HomeView tile is the primary entry point.

### 3e. Optional companion hook — `frontend/src/pages/AvatarPage.jsx`
Lightweight, non-breaking, opt-in:
- Add a suggestion chip alongside the existing `.av-suggestions` (`['Tell me about us', 'I miss you', ...]`) such as "Play our song" (localized) that navigates to the Music view / triggers playback. Since `AvatarPage` has no `onNavigate` prop today, the simplest non-invasive option is: a small "♪ Play music" `.av-tool` button in `.av-tools` that calls a passed-in navigate callback **only if you thread one through** — otherwise emit a `window.dispatchEvent(new CustomEvent('factech:open-music'))` that `App.jsx` listens for and does `setView('music')`. Choose the smaller diff.
- (Optional, evening warmth) In the existing proactive check-in lines, when it's evening (`new Date().getHours() >= 18`) and a playlist exists, occasionally use a line like "Would you like to hear your favorite song?" (localized, Hindi/Hinglish/English). **Reuse** the existing nudge guards (`userSpokeRef`, the once-per-session cap) — do not add new autoplay. The companion only *offers*; the patient taps to start.

Keep all existing chat/voice/memory flows untouched.

---

## 4. Data contract

**Song object** (stored in `profile.playlist[]`, metadata only):
```js
{
  id: "1718350000000abcd",   // String(Date.now()) + Math.random().toString(36).slice(2,7)
  title: "Lag Jaa Gale",      // required
  artist: "Lata Mangeshkar",  // optional — artist or era label, e.g. "1960s"
  url: "https://.../song.mp3",// streamable audio URL (mp3/ogg/m4a) — primary source
  art: "https://.../cover.jpg",// optional album-art URL (small) — gradient fallback if absent
  source: "url",              // "url" | "local"  (how it plays)
  localKey: null,             // if source==="local": IndexedDB key OR null for session-only
  favorite: false,            // optional — flag the patient's special "our song"
  addedAt: "2026-06-14T...Z"  // ISO timestamp
}
```
Rules:
- Exactly one playable source: a non-empty `url` (source `"url"`) **or** a local file (source `"local"`).
- **No base64 audio and no `Blob` in the persisted store.** Local file bytes live in IndexedDB (durable) or only in component state (session) — never in `localStorage`.
- `art` is a small image URL or omitted (component renders a gradient + icon).

**Store keys:** unchanged top-level key `factech_state_v1`; new nested array `profile.playlist[]`. New exports: `addSong`, `removeSong` (+ optional `setFavorite`). No backend changes required (player streams `url` client-side; no new FastAPI route).

---

## 5. Acceptance criteria + manual test

**Acceptance**
- [ ] A "Music" tile appears in HomeView and opens a Music screen (and/or a "Music" tab in the top nav).
- [ ] Caregiver can add a song by **URL** (title + url), and it appears in the playlist; it persists across reload (metadata in `profile.playlist`).
- [ ] Large Play/Pause, Next, Previous controls work; tapping a playlist row plays that song; track auto-advances on end.
- [ ] Now-playing shows title, artist/era, and album art (or gradient fallback).
- [ ] Delete removes a song from the playlist and stops it if currently playing.
- [ ] No audio bytes are written to `localStorage` (inspect `factech_state_v1` — only metadata).
- [ ] Visible labels localize for `persona.language` = hindi / hinglish / English.
- [ ] First tap reliably starts audio (a user gesture) — no console autoplay-policy error on the initial play.
- [ ] All existing flows (chat, voice, reminders, memories) still work.

**Manual test**
1. `cd frontend && npm install && npm run dev`; open the app (onboard a profile + persona if prompted).
2. HomeView → tap **Music**. Confirm the screen renders in the dark theme with large controls.
3. Add a song with a public MP3 URL (e.g. any direct `.mp3` link) + title; Save. It shows in the list.
4. Tap **Play** → audio starts on this user gesture. Tap **Pause**, **Next**, **Previous** — verify behavior. Let a track end → auto-advance.
5. Reload the page → playlist (URL entries) is still there.
6. Delete the playing song → playback stops, row disappears.
7. Switch `persona.language` to Hindi/Hinglish in the editor → re-open Music → labels localize.
8. (If companion hook built) In the avatar, trigger the "Play music" chip/button → lands on Music. In an evening session after the user speaks, confirm the optional spoken offer appears at most once and never auto-plays audio.
9. Open DevTools → Application → Local Storage → `factech_state_v1`: confirm `profile.playlist` holds only metadata (no base64).

---

## 6. Constraints / do-not-break

- **Browser autoplay policy:** audio must start from a **user gesture** (tap Play / tap a row). Do **not** auto-play on screen load or from the companion timer. The companion may only *offer* ("Would you like to hear your favorite song?"); the patient taps to start. Catch `audio.play()` promise rejection and show a calm "Tap play to start" hint instead of throwing.
- **Single audio element:** never let two clips play at once. Reuse one `<audio>`/`Audio` ref; stop/cleanup on unmount and on delete (mirror the `audioRef` teardown discipline in `AvatarPage`). Don't fight the companion's TTS — pause music if the companion speaks, if both can be active.
- **Keep existing flows intact:** `store.js` shape stays backward-compatible (old saved states without `playlist` must not crash — default to `[]`). Don't alter persona/reminders/memories behavior. `AvatarPage` chat/voice/memory-flush logic must remain unchanged except for the small additive hook.
- **Multilingual labels:** branch visible text and any spoken line on `(persona?.language||'').toLowerCase()` ∈ {`hindi`, `hinglish`, _default English_}, exactly like the existing greeting/nudge code.
- **Dementia-friendly UI:** few, large controls; high contrast; generous tap targets; minimal decisions on screen.
- **Theme:** one inline `<style>{...}` block per component, matching the existing dark slate/violet palette and radii. No external CSS, Tailwind, or new UI deps. Use `lucide-react` icons (already a dependency).
- **No hardcoded secrets / API keys.** No new env vars beyond the existing `VITE_API_BASE`. No tokens in source.
- **Storage budget:** never write audio bytes/base64 to `localStorage` (it silently drops on quota and can corrupt app state). Metadata only; large/local blobs go to IndexedDB or stay session-only.

---

## 7. Out of scope

- No Spotify / Apple Music / YouTube Music or any licensed-catalog SDK or OAuth integration.
- No server-side music storage, transcoding, or a new FastAPI route (player streams client-side).
- No music recommendation engine, lyrics, equalizer, or visualizer.
- No DRM or download-of-copyrighted-media features. Caregiver supplies their own legitimately-accessible URLs/files.
- No changes to the backend `tts_service` / `llm_service` for this feature.
