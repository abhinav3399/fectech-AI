# Feature: Adaptive Cognitive Stimulation Therapy (CST) led by the loved one

## Context (verified by reading the repo)
- **No cognitive-engagement structure exists** — only freeform chat (`persona_endpoint.py::/persona/chat` → `llm_service.chat_as_persona`) and a random Memories popup. CST (NICE-recommended for mild–moderate dementia, RCT-backed) is a clear, novel addition.
- **The facilitator is already there:** `chat_as_persona` role-plays the loved one with a `style` length rule + care plan. We can run CST *through* it with a session directive. `evaluate_conversation`/`summarize_session` show the Groq-JSON pattern for a cheap "turn judge".
- **Scheduling + logging hooks exist:** reminders (`store.js`, `App.jsx` checker, `RemindersPage.jsx`) and `store.insightsHistory` (`addInsight`).

## Goal
A structured, themed CST module the persona delivers conversationally (10–15 min): warm-up → a themed activity (childhood, food, sounds, famous faces, "use your senses", word association) → orientation cool-down. Difficulty **adapts live** — quick answers raise the challenge; hesitation/confusion instantly drops to **errorless** mode (offer the answer warmly, never mark anything wrong). Sessions can be scheduled; engagement is logged.

## Implementation plan
### Part A — Backend
1. `app/services/cst_library.py` — themes, each a sequence of graded prompts (easy→harder) + errorless fallbacks, in the persona's language.
2. New `app/api/cst_endpoint.py`: `POST /cst/turn` `{persona, user, session:{theme, step, difficulty, score}, patientReply?}` → wrap `chat_as_persona` with a **CST facilitator directive** (stay in character; one prompt at a time; errorless; never quiz-like) + a lightweight Groq "turn judge" classifying the last reply as `engaged|hesitant|confused` to pick the next step/difficulty. Returns `{say, nextSession, done}`.
3. Reuse the persona model fallback chain; keep replies short and warm.

### Part B — Frontend
1. A **CST mode** entered from AvatarPage (or a small launcher): drives `/cst/turn`, shows the persona speaking (reuse `speak()` + avatar), large friendly UI, "end anytime". The patient answers by voice (Web Speech, callMode) or typing.
2. Schedule CST via the existing Reminders (a `type:"activity"` reminder that opens CST). Log start/finish + an engagement score to `insightsHistory` (feeds the Wellbeing Sentinel / dashboard).

## Data contract
- `POST /cst/turn` ⇄ `{ session:{theme,step,difficulty,score}, say:"str", nextSession:{...}, done:bool }`.

## Acceptance criteria
- [ ] Starting a theme runs a multi-turn session in the persona's voice; quick correct answers escalate difficulty, a hesitant/confused answer **backs off and offers the answer warmly** (never "that's wrong").
- [ ] The session never feels like a test; it stays in character and in the selected language.
- [ ] A finished session logs an engagement entry; CST can be scheduled via a reminder.
- [ ] Normal chat/voice/avatar flows are unchanged.

## Constraints / do not break
- **Errorless learning is mandatory** — no scoring shown to the patient, instant back-off on hesitation (harmful otherwise in dementia). Reuse `chat_as_persona` (don't fork the brain) and the existing voice/avatar. Multilingual preserved.

## Out of scope
- Clinically validated CST scoring/reporting.
- New ML models — the turn judge is a cheap Groq call (e.g. llama-3.1-8b).
