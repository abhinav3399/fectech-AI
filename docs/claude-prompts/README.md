# Factech AI — Feature Implementation Prompts

Paste-ready prompts for Claude Code (or any agentic coding tool) to implement the
top 5 features, each grounded in the real codebase (verified file paths, function
names, data shapes).

> **Want everything in one file?** See [ALL-PROMPTS.md](ALL-PROMPTS.md) — the shared context
> plus all 5 feature prompts concatenated into a single document.

## How to use
1. Open a fresh Claude Code session **in this repo**.
2. Copy the contents of one feature file below (or the matching section of
   [ALL-PROMPTS.md](ALL-PROMPTS.md)) and paste it as your prompt.
3. (Optional) Prepend [`00-project-context.md`](00-project-context.md) for extra grounding —
   though each feature file already contains its own verified context block, so this is not required.
4. Implement one feature at a time, in roughly the order below (later features lean on earlier ones).

## Core features (1–5)

| # | Feature | File | Effort | Depends on |
|---|---------|------|--------|------------|
| 1 | Long-term episodic memory for the companion ⭐ (DONE — implemented & reviewed) | [01-episodic-memory.md](01-episodic-memory.md) | M | — |
| 2 | Remote caregiver dashboard + cloud sync + light auth | [02-caregiver-dashboard.md](02-caregiver-dashboard.md) | L | — |
| 3 | Reliable reminders + medication adherence (PWA + Web Push) | [03-reminders-medication.md](03-reminders-medication.md) | L | #2 (graceful degrade) |
| 4 | Daily orientation / "Today" grounding | [04-daily-orientation.md](04-daily-orientation.md) | M | — |
| 5 | One-tap SOS / emergency + distress auto-alert | [05-sos-emergency.md](05-sos-emergency.md) | M | #2 (optional) |

## Conversation quality (6)

| # | Feature | File | Effort | Depends on |
|---|---------|------|--------|------------|
| 6 | Avatar conversation overhaul — one voice, interruptible, non-repetitive (Part A DONE; Part B = barge-in, streaming, lip-sync, mood) | [06-conversation-overhaul.md](06-conversation-overhaul.md) | M–L | #1 |

## Companion & care features (7–16)

| # | Feature | File | Effort | Depends on |
|---|---------|------|--------|------------|
| 7 | Reminiscence / life-story builder | [07-reminiscence-lifestory.md](07-reminiscence-lifestory.md) | M | #1 |
| 8 | Family portal — shared updates feed | [08-family-portal.md](08-family-portal.md) | L | #2 (falls back to JSON store) |
| 9 | Music & nostalgia therapy | [09-music-therapy.md](09-music-therapy.md) | S–M | — |
| 10 | Medication pill verification by camera | [10-medication-pill-verification.md](10-medication-pill-verification.md) | M | — |
| 11 | Live "Who is this?" with a warm greeting | [11-live-face-greeting.md](11-live-face-greeting.md) | M | — |
| 12 | Voice journaling / daily check-in | [12-voice-journaling.md](12-voice-journaling.md) | M | #1 |
| 13 | Sundowning / evening calm mode | [13-sundowning-calm-mode.md](13-sundowning-calm-mode.md) | M | #6 (composes well) |
| 14 | Gentle cognitive games with their own photos | [14-cognitive-games.md](14-cognitive-games.md) | M | — |
| 15 | Care plan & caregiver notes that steer the persona | [15-care-plan-notes.md](15-care-plan-notes.md) | S–M | — |
| 16 | Health & vitals tracker | [16-health-vitals.md](16-health-vitals.md) | M | #2 (sync hook) |

## Voice cloning (17–21)

| # | Feature | File | Status |
|---|---------|------|--------|
| 17 | Cloned-voice preview + re-clone loop | [17-cloned-voice-preview.md](17-cloned-voice-preview.md) | prompt (needs ElevenLabs key) |
| 18 | Local / free voice cloning (Coqui XTTS / OpenVoice) | [18-local-free-voice-clone.md](18-local-free-voice-clone.md) | prompt (needs local model) |
| 19 | Graceful "cloning unavailable" UX | [19-clone-graceful-ux.md](19-clone-graceful-ux.md) | DONE |
| 20 | Voice-clone sample-quality guard | [20-clone-sample-quality.md](20-clone-sample-quality.md) | DONE |
| 21 | Voice-clone consent gate (+ delete/settings follow-ups) | [21-clone-consent.md](21-clone-consent.md) | DONE (consent) |

**Recommended starting point:** #1 (episodic memory, already done) → then the cheap high-value wins
#4 (orientation), #15 (care plan), #9 (music). #2 (caregiver backend) unlocks #8 and #16.
For free voice cloning with no paid API, see #18 (local XTTS engine via the provider seam).

## Notes
- Effort: **S** = hours, **M** = a day or so, **L** = multi-day.
- Each feature file contains its own verified context block, so it's self-contained.
- #2 is the foundation for a real product (cloud sync + remote caregiver); #3, #5, #8, #16
  become much more useful once #2 exists, but each is written to work standalone first.
- Safety-critical prompts (#10 pill verification, #15 care plan) bake in "never falsely confirm /
  never raise distressing topics" constraints — keep those when implementing.
