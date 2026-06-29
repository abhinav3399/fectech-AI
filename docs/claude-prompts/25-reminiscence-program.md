# Feature: Reminiscence program — scheduled themed sessions that CAPTURE the patient's stories

## Context (verified by reading the repo)
- **Reminiscence today is one-shot & lossy.** `frontend/src/pages/AvatarPage.jsx` has a "Remember when…" overlay that shows a random `store.memories` photo and calls `POST /api/v1/persona/reminisce` (`persona_endpoint.py` → `llm_service`) for a warm line. The patient's *response* is never captured.
- **Capture machinery exists:** `llm_service.summarize_session` already distills `transcript` turns into facts (Groq JSON) → `episodic_memory` (Qdrant). The Memories gallery (`MemoriesPage.jsx`) holds photos/captions/voice. Scheduling via reminders (`store.js`/`App.jsx`).
- Pairs with feature 22 (life-story graph) for structured storage — but must degrade gracefully without it.

## Goal
A guided reminiscence **program**: themed sessions over weeks ("your wedding", "the house you grew up in", "your work"), anchored to real photos, where the persona asks open, invitational (never testing) prompts and **captures the patient's own anecdotes back** into memory (and the life-story graph if present) — so the shared history deepens over time.

## Implementation plan
### Part A — Program + capture (backend)
1. `app/services/reminisce_program.py` — a set of weekly themes + invitational prompts (per language). 
2. Extend `persona_endpoint.py`: `POST /persona/reminisce` already returns a line; add `POST /reminisce/capture` `{persona, user, theme, transcript}` → `summarize_session`-style extraction of the patient's anecdotes → `episodic_memory.store(...)` (+ `life_story.add(...)` if feature 22 exists). Returns the captured facts.
### Part B — Frontend
1. Turn the AvatarPage "Remember when…" overlay into a short guided flow: pick/auto-pick a theme + an anchor photo, the persona gives an open prompt, the patient replies (voice/typed), the persona responds warmly and asks the next, ~3–5 turns. On close, call `/reminisce/capture` with the session turns.
2. Schedule sessions via a reminder (`type:"activity"`); log completion to `insightsHistory`.

## Data contract
- `POST /reminisce/capture` body: `{ persona, user, theme:"str", transcript:[{role,text}] }` → `{status:"ok", facts:[...]}`.

## Acceptance criteria
- [ ] A themed session runs ~3–5 invitational turns anchored to a memory photo, in the persona's voice/language; never quiz-like.
- [ ] On close, the patient's anecdotes are extracted and stored (verify new `episodic_memory` entries; and life-story entities if feature 22 is present); they resurface in later normal chats.
- [ ] Existing `/persona/reminisce` and the Memories gallery still work.

## Constraints / do not break
- Invitational, never testing ("tell me about…", not "do you remember who…"). Reuse `summarize_session` + `episodic_memory` (shared Qdrant client, non-destructive). Multilingual preserved.

## Out of scope
- The structured life-story graph itself (feature 22) — integrate if present, else just store episodic facts.
- Auto-tagging photos by content.
