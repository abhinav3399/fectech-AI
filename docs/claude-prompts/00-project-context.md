# PROJECT CONTEXT — Factech AI

> Optional preamble. Each feature prompt is already self-contained (it has its own
> verified context block), so you can paste a feature file on its own — or prepend
> this for extra grounding.

**Mission:** An AI memory companion that helps dementia/Alzheimer's patients reconnect with loved ones through an in-character persona chat.

## Stack
- **Backend:** FastAPI (`app/main.py`). Routers mounted under `settings.API_V1_STR` (e.g. `/api/v1`). Services in `app/services/`, endpoints in `app/api/`, core in `app/core/`.
- **Vector DB:** Qdrant. **ONE shared `qdrant_client` lives in `app/core/db.py` — every service MUST import it; never construct a second client** (embedded mode locks the storage folder).
- **LLM:** Groq (Llama 3.1-8b-instant / 3.3-70b-versatile) in `app/services/llm_service.py` (singleton `llm_service`). Methods: `generate_response` (memory Q&A), `chat_as_persona` (in-character loved-one chat — the heart of the app), `evaluate_conversation` (returns JSON: mood/engagement/topics/concerns/summary/suggestions).
- **TTS:** edge-tts in `tts_service.py`; optional ElevenLabs voice cloning in `voice_clone_service.py`.
- **Frontend:** React + Vite. State is **localStorage-only** (`frontend/src/lib/store.js`, key `factech_state_v1`): `{ profile, persona, memories[], transcript[], reminders[], insightsHistory[] }`. **No backend persistence, no real auth yet** (`LoginPage.jsx` is a stub). API base: `import.meta.env.VITE_API_BASE || '/api/v1'`.

## Files you'll most often touch
- `app/services/llm_service.py` — Groq prompts/methods
- `app/api/persona_endpoint.py` — voices, chat, tts, clone, evaluate
- `frontend/src/lib/store.js` — client state + actions
- `frontend/src/pages/AvatarPage.jsx` — voice/text persona chat
- `frontend/src/pages/HomeView.jsx` — greeting, reminders, insights
- `frontend/src/components/PersonaEditor.jsx` — persona config

## Constraints
- Reuse the shared `qdrant_client` and existing service singletons — no duplicate clients/models.
- Preserve multilingual support: English / Hindi (Devanagari) / Hinglish via `persona.language`.
- Match UX: inline `<style>` blocks, dark theme (`#0f172a` / violet-blue), warm dementia-friendly copy, large tap targets.
- No hardcoded secrets — read keys from `settings` / env.
