# Factech AI — Handoff / Resume Notes

_Last session: rename to Factech AI, full UI redesign, and a major voice-speed overhaul._

## ▶️ Start everything tomorrow (one command)
From the repo root, in PowerShell:
```powershell
powershell -ExecutionPolicy Bypass -File scripts\dev_start.ps1
```
Launches all 5 services in their own windows. Wait ~40–60s (models load), then open
**http://localhost:5173** and hard-refresh (Ctrl+Shift+R).

Manual equivalent (if you prefer):
```
venv\Scripts\python -m uvicorn app.main:app --port 8010                              # backend
venv\Scripts\python -m uvicorn model_service.app:app --port 8800                     # photo→3D
voice_service_ov\.venv\Scripts\python -m uvicorn voice_service_ov.app:app --port 8811 # OpenVoice (fast EN)
voice_service\.venv\Scripts\python -m uvicorn voice_service.app:app --port 8810       # XTTS (Hindi/fidelity)
cd frontend && npm run dev                                                            # web app
```
Sanity: `curl localhost:8010/health` `:8800/health` `:8810/health` `:8811/health` → all ok.

## ✅ Done this session
- **Renamed** project Masthishq → **Factech AI** everywhere (code clean; docs updated).
- **Full UI redesign** to the design spec — Plus Jakarta Sans, deep-navy, 32/24/16 radii; polished
  Home, Avatar, Memories; new standalone **Reminders** and **Family** pages + nav.
- **Voice speed overhaul (the big one):**
  - New **OpenVoice v2** engine — fast cloned **English** (~4s/full reply) → `voice_service_ov/` on **8811**.
  - **XTTS** optimized — cached conditioning latents + P-core pin → **~16s → ~8.4s/sentence** (Hindi/fidelity, 8810).
  - Provider seam now routes by language: **English → OpenVoice, Hindi → XTTS**; clone runs on both
    (`voice_id` = `ov:…|local:…`). Replies **stream sentence-by-sentence**; "Real voice" toggle; pitch slider on the fast neural voice.
  - Verified end-to-end: clone 2.1s · English reply 4.7s · Hindi → XTTS.
- Wrote **docs/PROJECT_OVERVIEW.md** (shareable team summary).

## 🔜 Next up (open items)
1. **Pick 5 of the top-10 next features** — recommended set: Distress-Watch + Viseme lip-sync +
   Streaming voice + Medication adherence + SOS ladder. (Full ranked list was generated last session.)
2. Optional voice polish I offered: **auto-estimate the pitch** from the recorded sample; and/or make
   **"Real voice" ON by default**.
3. Possible: clean re-confirm XTTS optimization under no load; tune OpenVoice base accent per persona.
4. Nice-to-have: a shareable **demo script / 1-slide pitch** for the team.

## ⚠️ Notes / gotchas
- Chat needs `GROQ_API_KEY` (set). Voice cloning, 3D, memory are all **local** — no keys.
- Voice workers each have their **own venv** (XTTS needs torch<2.9; OpenVoice needs
  `pyopenjtalk-plus`+`jamo`+MeloTTS-via-git`--no-deps`+nltk data — see `voice_service_ov/requirements.txt`).
- On CPU, faithful clone can't be sub-second; OpenVoice (~4s) is the floor without a GPU.
