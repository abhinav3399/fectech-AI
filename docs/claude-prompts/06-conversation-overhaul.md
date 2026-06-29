# Overhaul the Avatar conversation: one voice, interruptible, non-repetitive, alive

You are working in the **Factech AI** repo: a React (Vite) + FastAPI "AI memory companion" for dementia patients. The **Avatar** page is a voice + text chat that role-plays a persona of the user's loved one. Your job is to fix the broken conversation experience and then layer in high-impact upgrades. Work directly in the existing repo; reuse existing services and endpoints.

---

## 1. Context — current broken behavior (verified against the code)

The companion currently feels like a rough prototype. Re-read these files before editing; the line numbers below are accurate as of now.

**`frontend/src/pages/AvatarPage.jsx`** (the whole experience lives here):
- **Greeting** `useEffect` (lines 65–78): builds a localized greeting from `profile?.name` (the **full** name) and calls `setMessages([...])`. It does **not** speak, and it does **not** reset `lastActivityRef`.
- **Proactive nudge** `useEffect` (lines 88–108): a `setInterval(…, 5000)` that fires when `Date.now() - lastActivityRef.current >= 22000` and `nudgeCountRef.current < 2`. Lines come from a hardcoded `linesFor(lang, name)` (lines 89–93) using `profile?.name`, then calls `speak(line)` (line 105). It never sets `busyRef`, so two nudges (and a nudge + a reply) can run concurrently. On an idle open it emits **both** canned check-ins (`"Are you still there, Abhinav Panwar? I'm right here with you."` / `"How are you feeling right now, Abhinav Panwar?"`) within ~40s.
- **`speak(text)`** (lines 112–149): creates `new Audio(data:…base64)`, assigns `audioRef.current`, `await audio.play()`. It **does NOT** `pause()` the prior `audioRef.current` or `window.speechSynthesis.cancel()` before starting → **overlapping voices**. On any `catch` (including a rejected `audio.play()`) it falls through to `window.speechSynthesis.speak(u)` (lines 135–145) **even if the MP3 is still buffering/playing** → the **same line spoken by two engines**. `afterSpeak()` (lines 116–120) flips `isSpeaking`/`busyRef` and restarts the mic after 700ms in call mode.
- **`runTurn`** (160–188): sends `user: { name: profile?.name }` (full name, line 174) to `/persona/chat`; fallbacks (177, 183) also embed the full name.
- **Auto-talk voice loop** (`startListening` 233–271, `endCall` 285–295): non-continuous `SpeechRecognition`, echo guard via `lastSpokenRef` (lines 113, 249–250). `endCall` already pauses `audioRef` + cancels speechSynthesis — your new central stop should match this.

**`frontend/src/App.jsx`** (separate concern, real third voice): a global reminder `useEffect` (17–53) calls `window.speechSynthesis.speak(u)` (line 23/45) with **no** `cancel()` first and no awareness of the avatar — it can talk over the avatar's MP3.

**Backend (re-use, do not duplicate):**
- `app/services/llm_service.py` → `chat_as_persona(user_text, persona, user, history, memories)` (179–298): builds the persona system prompt; `user_name = user.get("name") or "dear"` (line 194, **full name**); already has anti-repetition (226–227), multilingual EN/Hindi-Devanagari/Hinglish (258–272), style rules (201–207), a memories block (239–246), and model fallback `llama-3.3-70b-versatile → llama-3.1-8b-instant` (285) at `temperature=0.85`. There is **no** instruction to shorten the name or use it sparingly.
- `app/services/tts_service.py` → `async synthesize(text, voice=None, rate=None) -> base64 MP3` (56–92) via edge-tts; supports a `rate` like `"-8%"`.
- `app/api/persona_endpoint.py`: `POST /persona/chat` (46–58, calls `episodic_memory.retrieve` then `chat_as_persona`), `POST /tts` (77–107, default `rate="-8%"`), `POST /remember` (61–74), `POST /evaluate` (34–43), `GET /voices`. Base path is `/api/v1` (frontend `API_BASE`).
- `app/services/episodic_memory.py` → `episodic_memory.retrieve(user, query, limit=4)` and `add_memories(user, facts)`. **Reuse the shared Qdrant client + MiniLM encoder — never construct a second.**

**Avatar visuals:** `frontend/src/components/PhotoAvatar.jsx` and `Avatar3D.jsx` currently get only a boolean `isSpeaking` and glow/breathe/bob — the mouth never matches the audio.

---

## 2. Goal

Deliver a conversation that feels like a real person on a phone call:
- **Exactly one voice ever** — no overlap, no double-engine, no cross-component collision.
- **No robotic self-talk** — proactive check-ins are rare, varied, contextual (or off by default), never two near-identical canned lines in 40s.
- **Natural naming** — derive and use the **first name**, used sparingly, never in every line.
- **Interruptible (barge-in)** — the user can talk over the avatar and it stops instantly to listen.
- **Low latency + lively** — streaming reply + sentence-chunked TTS, audio-driven lip-sync, mood-adaptive tone, memory-grounded companionship.

**Constraints (hard):** reuse existing services/endpoints (no new Qdrant client/model, no new LLM provider); preserve EN/Hindi(Devanagari)/Hinglish via `persona.language`; keep every existing endpoint working (add new ones alongside); match the inline-`<style>` dark theme; no hardcoded secrets; keep it dementia-friendly (calm, short, never quiz-like).

---

## 3. Implementation plan

### PART A — Bug fixes (do these first; they stand alone)

**A1. One central `speak()` that guarantees a single utterance.** Rewrite `speak()` in `AvatarPage.jsx` (112–149):
1. At the very top, **hard-stop everything currently playing** before starting:
   ```js
   try { audioRef.current?.pause(); } catch {}
   if (audioRef.current) { audioRef.current.onended = null; audioRef.current.onerror = null; }
   audioRef.current = null;
   try { window.speechSynthesis?.cancel(); } catch {}
   ```
   Detaching `onended`/`onerror` before nulling is required so the **stopped** clip's `afterSpeak` can't flip `isSpeaking`/`busyRef` for the **new** utterance.
2. Add a **request token** to defeat stale async TTS: `const myId = ++speakIdRef.current;` (a `useRef(0)`). After `await axios.post('/tts', …)` returns, **bail if `speakIdRef.current !== myId`** (a newer `speak`/interrupt happened) — do not start playback.
3. **Only fall back to speechSynthesis when the server returned no audio**, never on a `play()` race. Wrap `audio.play()` in its own `try/catch`; on reject, `audioRef.current = null` and fall through. On a successful `play()`, `return` (do **not** also synth). Structure:
   ```js
   try {
     const r = await axios.post(`${API_BASE}/tts`, { text, voice: persona.voiceId, clone_voice_id: persona.voiceCloneId }, { timeout: 30000 });
     if (speakIdRef.current !== myId) return;            // superseded
     if (r.data?.audio_base64) {
       const audio = new Audio(`data:audio/mpeg;base64,${r.data.audio_base64}`);
       audioRef.current = audio; setIsSpeaking(true);
       audio.onended = afterSpeak; audio.onerror = afterSpeak;
       try { await audio.play(); return; }              // success -> never synth
       catch { audioRef.current = null; }               // autoplay race -> fall through
     }
   } catch {}                                           // network/TTS down -> synth fallback
   // ... existing speechSynthesis fallback unchanged ...
   ```
4. Keep `afterSpeak` as-is (clears `isSpeaking`/`busyRef`, restarts mic after 700ms in call mode).

**A2. Serialize callers.** `runTurn` already sets `busyRef.current = true`. Make the proactive nudge set `busyRef.current = true` before it speaks too, so the nudge gate at line 95 (`if (callModeRef.current || busyRef.current || editing) return;`) blocks a second nudge while the first is still speaking. `afterSpeak()` clears it when the clip ends.

**A3. Tame proactive check-ins.** Replace the nudge `useEffect` (88–108) so it is **rare, gated on real engagement, single, and varied** — pick ONE of:
- **Preferred (LLM-authored, see B3):** route the nudge through `POST /persona/chat` with an internal directive so the existing anti-repetition + multilingual + memory rules generate a fresh line. Cap at **1** per idle stretch; require the user to have spoken at least once (`userSpokeRef`); idle threshold **≥ 45000ms**; never two nudges without an intervening user turn.
- **Minimum:** keep canned `linesFor` but (a) reset `lastActivityRef.current = Date.now()` and `nudgeCountRef.current = 0` in the **greeting** `useEffect`; (b) add `userSpokeRef` (set true in `runTurn`) and `if (!userSpokeRef.current) return;`; (c) raise idle to ≥45s and cap to **1**; (d) drop the name from one of the two lines so it isn't in every line.
- **Acceptable:** ship proactive nudges **off by default** behind a flag and rely on greeting + replies only.

**A4. First-name everywhere.**
- Frontend: near the top of the component, `const firstName = (profile?.name || 'dear').trim().split(/\s+/)[0] || 'dear';`. Use `firstName` in the greeting (68–74), nudge lines, and both `runTurn` fallbacks (177, 183). Send the short name to the backend: change `user: { name: profile?.name }` → `user: { name: firstName }` in `runTurn` (174) **and** `flushSession` (205) so the brain and client stay consistent.
- Backend (defense in depth): in `chat_as_persona` (line 194) replace `user_name = user.get("name") or "dear"` with:
  ```python
  raw_name = (user.get("name") or "").strip()
  user_name = raw_name.split()[0] if raw_name else "dear"
  ```
  And after line 219 add a sparing-use rule to the system prompt: `f"Address them as {user_name} (first name only), and use their name only occasionally — never in every sentence. "`

**A5. Cross-component voice.** In `App.jsx` reminder `speak()` (18–25), call `window.speechSynthesis.cancel()` before `speak(u)`. Gate firing so it doesn't talk over a live avatar (see B1's shared `isSpeaking()` flag): `if (!isSpeaking()) speak(line, ttsLang);` — the banner still shows, so nothing is lost.

### PART B — Upgrades (prioritized; each builds on A1's central gate)

**B1 — Single-speaker audio bus + barge-in (highest priority).**
- Centralize all speech in one module so only one utterance is ever audible app-wide. Reuse `frontend/src/lib/store.js` (no new dep): export `isSpeaking()`, `stopSpeech()`, and `speakOnce({ text, ttsLang, fetchMp3 })` that owns **both** channels (the `<audio>` element and `speechSynthesis`), calling `stopSpeech()` first so every new utterance pre-empts the previous on both channels.
- Route `AvatarPage.speak()` and `App.jsx` reminder speech through this bus.
- **Barge-in:** run `SpeechRecognition` with `continuous=true` + `interimResults=true` even while `isSpeaking`. When a **non-echo** interim transcript of real length arrives, immediately `stopSpeech()`, clear the 700ms `afterSpeak` restart timer, and route straight into `runTurn`. Reuse the `lastSpokenRef` echo guard (113, 249–250) so the avatar's own voice can't self-interrupt. Add a subtle "tap to interrupt" affordance on the `av-call` banner.
- All in `AvatarPage.jsx` + `store.js`; no backend change.

**B2 — Streaming brain + sentence-chunked TTS.**
- Backend `llm_service.py`: add a generator variant of `chat_as_persona` using the Groq SDK `stream=True` (reuse the exact same `system_prompt`, model fallback, memories block, multilingual rules). Buffer tokens to a sentence boundary (`.`, `?`, `!`, or Devanagari danda `।`) and yield each sentence.
- `tts_service.py`: reuse `synthesize` per sentence.
- `persona_endpoint.py`: add a new SSE/`StreamingResponse` endpoint **alongside** `/persona/chat` (keep the old one). Emit one event per completed sentence: `{ "text": "...", "audio_base64": "..." }`.
- `AvatarPage.jsx` `runTurn` (171–181): replace the single POST with a stream reader that appends each sentence to the chat bubble as it arrives and **enqueues its audio into B1's bus** so sentences play back-to-back. Pre-fetch the next sentence's TTS while the current plays. Composes with barge-in (interrupt clears the queue).

**B3 — LLM-authored, memory-grounded proactive companionship.** (Implements A3's preferred path.) In the nudge interval, when gates pass, set `busyRef.current = true`, then `await axios.post('/persona/chat', …)` with an **internal directive** that is **never** pushed to `messages`/history, e.g.:
```js
const directive = `[The user has gone quiet for a little while. As ${persona.name}, gently and briefly check in on them in a fresh, natural way — vary your wording, do not repeat earlier lines, and do not use their full name. One short sentence.]`;
```
Pass `history: messagesRef.current.slice(-8)`, `user: { name: firstName }`, the persona block. The endpoint already calls `episodic_memory.retrieve` so the check-in can reference a real shared memory. Re-check guards after the `await` (user may have spoken); fall back to canned `linesFor` only on network error. Keep a `recentBotLinesRef` and skip speaking a line too similar (normalized substring/Jaccard) to a recent one.

**B4 — Audio-driven lip-sync.** Route the playing `<audio>` element (in B1's bus) through a WebAudio `createMediaElementSource → AnalyserNode`; expose a per-frame normalized amplitude via a ref. Pass amplitude (alongside `isSpeaking`) into `PhotoAvatar` (drive a lower-face vertical scale / mouth highlight) and `Avatar3D` (map amplitude to a `jawOpen`/`mouthOpen` morph in the `useFrame` loop, lines 9–16, if the GLB exposes morph targets; else amplitude-scaled head bob). One bus → one analyser, no contention.

**B5 — Emotion/mood-adaptive tone.** Infer a coarse mood (`positive|neutral|low|anxious`) for the current user turn — cheapest path: a tiny `llama-3.1-8b-instant` classification (reuse the patterns in `evaluate_conversation`, 73–118) or a leading tag on the streamed reply. Feed it back two ways: (1) append a mood-conditioned style directive to the persona system prompt (anxious → slower, shorter, extra reassuring, no quiz-like questions); (2) pass a mood-derived `rate` to `/tts` (`tts_service.synthesize` already accepts `rate`; endpoint default `-8%`) — slower/softer for low/anxious. Optionally reflect mood in the `av-state` pill (322–324).

---

## 4. Data contracts

**New: `POST /api/v1/persona/chat/stream`** (B2) — keep `/persona/chat` unchanged.
- Request (same shape as `/persona/chat`):
  ```json
  { "text": "string", "persona": { "name": "", "relationship": "", "personality": "", "gender": "", "age": 0, "accent": "", "language": "", "style": "" }, "user": { "name": "firstNameOnly" }, "history": [ { "role": "user|bot", "text": "" } ], "mood": "positive|neutral|low|anxious" }
  ```
- Response: `text/event-stream`, one `data:` event per sentence, terminated by `[DONE]`:
  ```
  data: {"text":"First sentence.","audio_base64":"<mp3 b64>","mime":"audio/mpeg"}
  data: {"text":"Second sentence.","audio_base64":"<mp3 b64>","mime":"audio/mpeg"}
  data: [DONE]
  ```

**Optional new: `POST /api/v1/persona/nudge`** (if you prefer a dedicated endpoint over reusing `/persona/chat` for B3). Request = persona + user + `history`; Response `{ "status": "ok", "text": "one short check-in" }`. (Reusing `/persona/chat` with the directive is acceptable and avoids new surface.)

**`/tts`** — unchanged shape; `rate` now driven by mood when B5 lands: `{ "text": "", "voice": "", "clone_voice_id": "", "rate": "-8%" }`.

**Store additions (`store.js`):** `isSpeaking(): boolean`, `stopSpeech(): void`, `speakOnce({ text, ttsLang, fetchMp3? }): Promise<void>`. No new persisted fields required; if you add a "proactive nudges on/off" toggle, persist it under the existing `persona` object (e.g. `persona.proactive`), not a new top-level key.

---

## 5. Acceptance criteria (checkable)

- [ ] **One voice only.** Rapidly trigger a reply + a nudge (or two sends back-to-back): never two overlapping voices, and never the same line spoken by both the MP3 and `speechSynthesis`.
- [ ] **No self-talk spam.** Open Avatar and stay silent ~60s: at most **one** gentle, varied check-in (or none if off), and it only happens **after** the user has spoken at least once.
- [ ] **First name, used sparingly.** Greeting and replies say "Abhinav," not "Abhinav Panwar," and the name does **not** appear in every sentence.
- [ ] **Barge-in.** While the avatar is mid-sentence, speak over it: audio stops within ~300ms and the avatar processes your interruption.
- [ ] **Low latency (B2).** First spoken words begin in well under the previous full-reply wait; sentences play seamlessly back-to-back.
- [ ] **Memory recall.** After a session where the user mentions something durable (e.g. "Meera visited Sunday"), end the call (triggers `/remember`), reopen, and the companion naturally references it later — confirm via `episodic_memory.retrieve`.
- [ ] **Multilingual intact.** With `persona.language` = Hindi → Devanagari replies; Hinglish → Roman Hindi-English; STT/TTS langs still derive correctly (`sttLang`/`ttsLang`, 42–45).
- [ ] **No cross-component overlap.** A reminder firing during avatar speech does not layer over it.
- [ ] **Manual path:** open Avatar → only one voice, no canned double check-in, first-name used naturally, can interrupt mid-sentence, recalls a prior memory, dark theme unchanged.

---

## 6. Constraints / do not break / out of scope

**Do not break:** reuse `llm_service`, `tts_service`, `episodic_memory` (shared Qdrant client + MiniLM encoder — **never** a second), and the Groq client; keep `/persona/chat`, `/tts`, `/remember`, `/evaluate`, `/voices`, `/clone-voice` working (add new endpoints alongside); preserve EN/Hindi(Devanagari)/Hinglish via `persona.language`; match the inline-`<style>` dark theme (`.av`, `.av-call`, `.av-state`, gradients) — no new CSS framework; no hardcoded secrets (`GROQ_API_KEY`/`ELEVENLABS_API_KEY` stay in env); keep it dementia-friendly (calm, short, no quizzing). The fallback voice cloning path (`clone_voice_id` → `voice_clone_service`) must keep working through the new bus.

**Out of scope:** onboarding flow, Memories/Home/wellbeing pages, reminder scheduling logic (only its `speak()` cancel + gate), persona generation/3D model generation, auth/multi-user, swapping the LLM/TTS providers. Don't introduce new infra or a second vector DB.

**Working style:** prefer small, verifiable commits in order A → B1 → B2 → B3 → B4 → B5. After Part A, manually verify the "one voice / no self-talk / first name" criteria before moving on. Show diffs and the test path you used.
