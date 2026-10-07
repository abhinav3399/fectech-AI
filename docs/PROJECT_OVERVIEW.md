# 🧠 Factech AI — AI Memory Companion for Dementia Care

> **A dementia/Alzheimer's patient can talk with a lifelike digital version of a loved one —
> one that _looks like_ them, _sounds like_ them (in their own cloned voice), and _remembers_
> their shared life — running privately on local hardware.**

---

## The problem we're solving
Dementia and Alzheimer's bring memory loss, confusion, loneliness, agitation, and "sundowning."
Patients forget faces and routines; families are stretched thin and can't always be present.
Generic chatbots feel cold and clinical — the opposite of what a frightened, confused elder needs.

**Factech AI** turns a real loved one into a warm, always-available companion: a carer builds a
mimic of that person (name, relationship, personality, shared memories, a photo, a voice sample),
and the app then talks **as** that person — comforting, familiar, and safe.

**Users:** Primary → patients aged 60+. Secondary → family carers and clinicians.
**Guiding principle:** comfort, warmth, dignity, dementia-safety, and privacy first.

---

## The experience — two pillars

| Pillar | What it means |
|---|---|
| 👁️ **Looks like them** | Their photo becomes an animated **talking photo** or a **3D face** that lip-syncs while speaking — with blinking, voice-waves, and a living presence. |
| 🔊 **Sounds like them** | Their voice is **cloned locally** and speaks every reply — the deepest comfort, since auditory memory outlasts visual recognition in dementia. |

Around those: it **remembers** shared life, gently **reminds** about medication in that familiar
voice, relives memories together, and quietly keeps the patient **safe**.

---

## What it does (feature highlights)

**🗣️ The Companion (the "brain")**
- In-character conversation as the loved one — warm, patient, never frustrated by repetition.
- Speaks **English, Hindi, and Hinglish**; time-aware ("Good morning… it's getting late").
- **Long-term memory** of past chats (recalled into future conversations).
- A private **care plan** carers set (topics to comfort with / avoid) that steers every reply.
- **Proactive check-ins** so the patient never faces a blank screen.

**🎙️ Voice — a multi-engine cloning system (fully local, no API key)**
- **OpenVoice v2** — fast cloned **English** voice (~4s for a full reply) for live conversation.
- **XTTS-v2** — higher-fidelity clone that also speaks **Hindi**.
- **Fast neural preset** — instant (~1.5s), **pitch-tunable** toward the loved one.
- Auto-routing: English → fast engine, Hindi → fidelity engine; replies **stream sentence-by-sentence** so the voice starts in seconds.

**🧑 Face & Avatar**
- Real photo, animated **talking photo**, or a **3D head generated from the photo** — all lip-synced.
- Live presence cues: voice-wave animation, "private connection" reassurance.

**📸 Memories**
- A gallery of photos / notes / voice notes, grouped by **Today / This month / Older**, with filters.
- **Reminiscence mode** — the companion warmly relives a saved memory with the patient.

**🛡️ Care & safety**
- **Reminders & medication** announced aloud at the right time (category, time, frequency, "[name] will say…" preview).
- **Family contacts** — one-tap quick-dial cards, a gold-ring "primary" contact, always-visible **Call family** button.
- **Caregiver wellbeing insights** distilled from conversations.

**♿ Accessibility & dementia-safety**
- Large readable text (scalable), high-contrast & reduce-motion modes, large captions of what's said,
  60px+ touch targets, calm non-jarring animations, and a warm, consistent, predictable layout.

---

## Technology & architecture

| Layer | Stack |
|---|---|
| **Frontend** | React 19 + Vite; custom design system (Plus Jakarta Sans, glassmorphism, dark-navy theme); three.js for the 3D avatar |
| **Backend** | FastAPI (Python); **Groq Llama-3** for the persona's conversation |
| **Memory** | Embedded **Qdrant** vector database (on-disk, local) |
| **Voice** | 3 swappable engines behind one seam — **OpenVoice v2**, **XTTS-v2**, ElevenLabs (optional) |
| **3D face** | **MediaPipe** face-mesh → textured GLB with baked lip-sync, rendered in three.js |

**Architectural strengths**
- **Local-first & private by default** — voice cloning, 3D generation, face recognition, and memory
  all run **on-device** with no cloud dependency (chat uses Groq). Patient data stays local.
- **Pluggable "provider seams"** — voice and 3D engines can be swapped without touching the app
  (the same seam already supports 3 voice engines and 3 photo→3D providers).
- **Resilient & graceful** — every heavy feature degrades softly (a fast voice if the clone is busy,
  a neural voice if no clone, a generic head if no model) so the app never breaks in front of a patient.

---

## What makes it stand out
- 🏠 **Genuinely private, runs locally** — a real differentiator for a clinical/elderly-care product.
- 🎭 **It's _their_ loved one**, not a generic assistant — face + voice + shared memories combined.
- ⚡ **Engineered for real hardware** — the cloned voice was tuned to run on an ordinary CPU laptop
  (no GPU), streaming sentence-by-sentence so it feels responsive.
- 🩺 **Grounded in real dementia care** — reminiscence, reality-orientation, calm de-escalation,
  medication routines, and a caregiver safety net.

---

## Status
The full app runs locally as a small set of services (web app, product API, photo→3D worker,
two voice-cloning workers). All core journeys work end-to-end: onboarding → build the loved one →
talk (text or hands-free voice) → hear their cloned voice → manage memories, reminders, and family
contacts. Recent work delivered a **2–4× faster cloned voice**, a refreshed **6-page UI**, and the
new fast voice engine.

*Factech AI — bringing a familiar face and voice back to those who need it most.*
