# Feature: Daily Wellbeing Sentinel — passive decline / delirium early-warning

## Context (verified by reading the repo)
- **Wellbeing is snapshot-only today:** `POST /api/v1/evaluate` (`llm_service.evaluate_conversation`) runs ONE Groq JSON pass over the recent `transcript` on a button press (`WellbeingInsights.jsx`); results append to `store.insightsHistory` (`addInsight`). No continuous baseline, no deviation detection.
- **Signals now exist to fuse:** `store.transcript` (timestamped turns), `store.distressLog` (Distress Watch episodes), `AdherenceLog` (medication outcomes via `/adherence`), and per-turn timing in `AvatarPage.jsx`. DB = `app/db.py`/`app/db_models.py`; scheduler can start in `app/main.py` startup (where `init_db()` runs).
- Qdrant is used for long-term memory via `app/services/episodic_memory.py` (reuse its shared client if vectors are needed — never build a second `QdrantClient`).

## Goal
Turn everyday signals into a **per-patient daily fingerprint**, learn that patient's **own baseline**, and quietly flag **sustained downward trends or sudden breaks** (a common sign of treatable delirium — UTI, infection, dehydration) to the caregiver — never shown to or quizzing the patient.

## Implementation plan
### Part A — Daily fingerprint (backend)
1. `app/db_models.py` — add `WellbeingDay { id, user_id?, kiosk_id?, date (YYYY-MM-DD), chat_count, distress_count, adherence_rate, mood_score, engagement_score, speech_brevity, created_at }` (auto-create).
2. New `app/services/wellbeing_sentinel.py` — a daily rollup (APScheduler job, or `POST /wellbeing/rollup` callable on app open) that, per patient, computes the day's features from: `AdherenceLog` (taken/total), distress episode count, transcript volume + average reply latency/word-count (brevity), and a sentiment from a lightweight `/evaluate`. Persist one `WellbeingDay` row.
3. **Deviation logic** (pure stats, no ML model): rolling EWMA / z-score of each feature vs the patient's own trailing baseline (≥14 days). On a sustained drop or sudden break, `raise an incident` (reuse the SOS feature's `POST /incident`, type `decline`) + a caregiver note.
4. New `app/api/wellbeing_endpoint.py`: `GET /wellbeing/trend?days=30` → the fingerprints for the dashboard.

### Part B — Surface (frontend)
1. Show the trend line in the Caregiver Dashboard / `WellbeingInsights.jsx`; a calm banner there when a deviation is flagged. **Nothing patient-facing.**

## Data contract
- `WellbeingDay` row as above; `GET /wellbeing/trend` → `{status:"ok", days:[WellbeingDay...]}`.

## Acceptance criteria
- [ ] A rollup creates one `WellbeingDay` per patient per day from real signals (verify a row after some chats/adherence).
- [ ] With a seeded declining series, the deviation logic flags it and raises a `decline` incident exactly once (no daily re-spam).
- [ ] `GET /api/v1/wellbeing/trend` returns the series; the dashboard renders it.
- [ ] Patient experience is completely unchanged; baseline needs ≥14 days before it flags (documented).

## Constraints / do not break
- **Per-patient baseline only** — never population norms; avoid false-alarm spam (hysteresis + cooldown). Reuse `/evaluate`, `/adherence`, distressLog, the shared Qdrant client, and the SOS `/incident`. No clinical-diagnosis claims in copy ("consider checking…", not "has an infection").

## Out of scope
- New audio/face features for richer signals (depends on the Distress Watch's prosody/affect — use what exists).
- Real-time alerting (this is a daily/asynchronous sentinel; acute episodes are the Distress Watch's job).
