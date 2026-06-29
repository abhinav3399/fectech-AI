# Feature: "Today" orientation board + live "Who is this?" visitor greeting

## Context (verified by reading the repo)
- **Temporal grounding exists in chat only.** `app/services/llm_service.py` uses `settings.TIMEZONE` for "good morning"/evening awareness inside `chat_as_persona`, but there's no always-visible orientation surface for the patient.
- **Face recognition already exists** (older flow): `app/services/face_service.py` + `app/api/endpoints.py` `POST /recognize/person` (and `/remember/person`), with `frontend/src/components/FaceRecognition.jsx` + `FaceCaptureModal.jsx` (webcam capture) and Qdrant `faces`/`patients` collections. Reuse it — don't rebuild recognition.
- Reminders (`store.js`, `App.jsx`) know the next scheduled item. `HomeView.jsx` is the calm landing surface.

## Goal
Two gentle orientation aids: (1) a **"Today" board** — a large, calm, always-there panel showing the day/date, part of day, where they are ("You're at home"), and what's next; and (2) a **"Who is this?"** mode where the camera recognizes a visitor and the persona warmly cues the patient ("That's your daughter, Sarah").

## Implementation plan
### Part A — Today board (frontend, no backend)
1. New `frontend/src/components/TodayBoard.jsx` on `HomeView.jsx`: big date + greeting (reuse the time logic / `persona.language` for localization), a reassuring location line (carer-set in profile, default "You're safe at home"), and the **next reminder** (from `store.reminders`). Large text, high contrast, no clock anxiety — calm copy only.
### Part B — Who is this? (frontend, reuse recognition)
1. A "Who is this?" tool (Home action card or AvatarPage tool) opens the existing `FaceCaptureModal`/webcam, sends a frame to `POST /api/v1/recognize/person` (existing), and on a confident match has the **persona announce it warmly** via `speak()` ("That's your daughter Sarah — she loves you very much"), pulling the relation from the recognized record (or the life-story graph, feature 22). On no/low match: a kind fallback ("a friendly visitor — would you like to say hello?"), never a cold "unknown".
2. Carer enrollment reuses `/remember/person` (already exists).

## Acceptance criteria
- [ ] The Today board shows date/part-of-day/location/next-reminder in large calm text, localized to the persona language; updates as the day/reminders change.
- [ ] "Who is this?" captures a frame, calls the existing `/recognize/person`, and the persona speaks a warm, relation-aware greeting on a match; a gentle non-alarming fallback otherwise.
- [ ] Raw confidence scores are never shown to the patient; existing recognition/enrollment flows still work.

## Constraints / do not break
- Reuse the existing `face_service` + `/recognize/person` + `FaceCaptureModal` — do not add a second recognition stack or new heavy deps. Camera is **on-demand/opt-in** (privacy), not always-on. Calm, large, dementia-safe copy; reuse the design system.

## Out of scope
- Continuous always-on visitor detection (privacy + battery) — on-demand only.
- New recognition models; this composes the existing one with the persona voice + reminders + orientation copy.
