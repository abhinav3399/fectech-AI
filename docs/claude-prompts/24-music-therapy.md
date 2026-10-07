# Feature: Personalized music therapy (calming songs + auto-soothe on distress)

## Context (verified by reading the repo)
- **No music exists today.** Audio in the app is only TTS: `frontend/src/lib/audiolevel.js` (shared `AudioContext`/`AnalyserNode` tapped off the TTS `<audio>`) and the voice seam. There's no music player and no music data on the persona.
- **A distress trigger now exists:** `frontend/src/lib/distress.js` + `AvatarPage.jsx` maintain a `calmRef`/distress score and a `store.distressLog`. We can react to it.
- **Memories + store:** `store.memories` already holds photos/voice notes; `store.js` persists to localStorage; carer can add content via `MemoriesPage.jsx`/`PersonaEditor.jsx`.

## Goal
Let the carer add the patient's meaningful songs (their reminiscence-bump era). The persona can introduce a song and reminisce about it; and when the **Distress Watch** trips, a gentle calming track fades in automatically with a soft persona line — music therapy is strongly evidenced for easing agitation.

## Implementation plan
### Part A — Music library (frontend)
1. `frontend/src/lib/store.js` — add `music: []` to `defaultState` (additive) with helpers `addSong({title, url|dataUrl, calming})` / `removeSong(id)`. Songs are **carer-provided files/links only** (no bundled copyrighted audio). Cap data-URL size; prefer URLs.
2. A "Music" section in `PersonaEditor.jsx` (or a small `MusicPage`) to add/label songs and mark some as **calming**.

### Part B — Player + auto-soothe
1. A lightweight `frontend/src/lib/music.js` player (HTMLAudioElement) with `play(song)`, `fadeOutStop()`, volume ramp. Keep it separate from the TTS audio; duck/pause TTS while music plays.
2. In `AvatarPage.jsx`: a "Play a song" tool (persona says a warm intro via `speak()`, then plays). And when `calmRef` flips on (Distress Watch), if a **calming** song exists, fade it in low and have the persona say one soothing line — never abrupt, never loud.
3. Respect reduce-motion/quiet hours; a clear stop control.

## Data contract
- `store.music[]` item: `{ id, title, url|dataUrl, calming:bool }`.

## Acceptance criteria
- [ ] A carer can add a song (URL or file) and mark it calming; it persists.
- [ ] "Play a song" plays it with a warm persona intro; TTS doesn't talk over it.
- [ ] When distress trips and a calming song exists, it fades in softly + one gentle line; stopping/ending the call stops it cleanly.
- [ ] No bundled copyrighted media; nothing crashes if no songs are configured.

## Constraints / do not break
- **Licensing:** user-provided files/links only. Calm, low starting volume, smooth fades; never jarring. Don't entangle with the TTS analyser graph in a way that breaks lip-sync (separate audio element). Additive store change only.

## Out of scope
- Streaming-service integration (Spotify/YouTube APIs).
- Auto-curating an era playlist from metadata (carer picks the songs).
