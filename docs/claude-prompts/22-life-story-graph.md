# Feature: Structured life-story graph (truthful biography the persona retrieves)

## Context (verified by reading the repo)
- **Identity is one freeform blob.** `persona.personality` (a text field in `frontend/src/components/PersonaEditor.jsx`) is fed into `app/services/llm_service.py::chat_as_persona`. With no structured facts the persona can **hallucinate or contradict itself across sessions** — distressing for someone who can't argue back.
- **Episodic memory is loose & retrieval already exists.** `app/services/episodic_memory.py` stores distilled third-person sentences in Qdrant and `retrieve(user, text, limit)` feeds them into `chat_as_persona` (called from `persona_endpoint.py::/persona/chat`). `llm_service.summarize_session` already extracts facts via Groq JSON. **Reuse the shared Qdrant client — never build a second one.**
- **Reminiscence is shallow:** `/persona/reminisce` + a random Memories photo, with no capture of what the patient says back.

## Goal
Replace the freeform blob with a **typed, queryable biography** (people, places, life events, jobs, pets, milestones) entered by the carer AND captured from reminiscence — retrieved at chat time so the persona is **consistent and truthful**, and can do gentle reality-orientation grounded in real facts.

## Implementation plan
### Part A — Storage + retrieval (backend)
1. New `app/services/life_story.py`: a typed store of entities `{kind: person|place|event|job|pet|milestone, label, detail, date?, relation?}`. Persist as a dedicated Qdrant collection (reuse `episodic_memory`'s encoder + shared client) keyed by the user; expose `add(user, entity)`, `retrieve(user, text, limit)`.
2. `chat_as_persona` — pull the most relevant life-story facts (like memories today) and inject them into the system prompt as **TRUE facts to stay consistent with** (placed before the care-plan block so the care plan still wins on tone). Add a line: never invent facts beyond these.
3. New `app/api/lifestory_endpoint.py`: `POST /lifestory` (add/update), `GET /lifestory`, `POST /lifestory/forget`.

### Part B — Capture + edit (frontend)
1. `PersonaEditor.jsx` — a new **"Life story"** tab: add people/places/events with simple forms (reuse the chip/anchor UI patterns already there). Save via `/lifestory`.
2. Reminiscence sessions (see feature 25) capture the patient's anecdotes → `summarize_session`-style extraction → `life_story.add` + `episodic_memory`.

## Data contract
- Entity: `{ "kind":"person|place|event|job|pet|milestone", "label":"str", "detail":"str", "date":"str?", "relation":"str?" }`
- `GET /lifestory` → `{status:"ok", entities:[...]}`.

## Acceptance criteria
- [ ] Adding "daughter: Sarah, lives in Pune" makes the persona answer "who is Sarah?" consistently and never contradict it across turns/sessions.
- [ ] Asking the same biographical question twice yields the SAME true answer (no hallucinated variants).
- [ ] `/lifestory` add/list/forget work; entities retrieved into chat like memories.
- [ ] Existing chat, memories, and reminiscence still work; empty life-story changes nothing.

## Constraints / do not break
- Reuse the shared Qdrant client + `episodic_memory` encoder; additive collection (non-destructive — never `recreate_collection`). Keep `chat_as_persona`'s care-plan-last ordering. Truthful only — the persona must never fabricate facts not in the graph.

## Out of scope
- A visual graph/timeline UI (simple typed lists are enough first).
- Auto-importing from external sources; entry is carer + reminiscence capture.
