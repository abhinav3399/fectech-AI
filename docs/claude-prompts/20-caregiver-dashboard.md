# Feature: Caregiver dashboard — mood, adherence, distress & alerts in one place

## Context (verified by reading the repo)
- **Accounts + DB exist:** `app/api/auth_endpoint.py` (`/auth/*`, `GET/PUT /state`, `get_current_user`), `app/db.py`, `app/db_models.py` (`User`, `UserState`, `AdherenceLog`). The frontend is **not yet logged in** (localStorage store), so dashboard reads must also accept a `kiosk_id` fallback (see `reminders_endpoint.py::_owner`).
- **Data already collected:** medication outcomes (`AdherenceLog` + `GET /api/v1/adherence?days=7` with a per-reminder `summary`), distress episodes (`store.distressLog` via `addDistressEpisode`), wellbeing snapshots (`store.insightsHistory` via `addInsight`, populated by `POST /api/v1/evaluate` → `llm_service.evaluate_conversation`), and the conversation `transcript`.
- **Existing carer UI:** `frontend/src/components/WellbeingInsights.jsx` already renders a mood/engagement view from a manual `/evaluate` call (a good style/pattern to match). Nav is the simple `view` switch in `App.jsx` + `frontend/src/components/SideNav.jsx`.

## Goal
A caregiver view that, at a glance, shows the patient's **7/30-day adherence**, a **distress timeline**, the **mood/engagement trend**, and **open alerts** (incidents from the SOS feature) — read-only, carer-facing, calm.

## Implementation plan
### Part A — Rollup endpoint (backend)
1. New `app/api/dashboard_endpoint.py` (`APIRouter()`, `_owner` optional-auth): `GET /dashboard?days=30[&kiosk_id=]` → aggregate and return `{ adherence: <reuse reminders summary>, distress:[{ts,peak}], wellbeing:[{date,mood,engagement}], incidents:[...] }`. Pull adherence from `AdherenceLog`; distress/wellbeing can come from the synced `UserState.data` (distressLog/insightsHistory) when signed in, else accept them in the query/kiosk store. Reuse existing query helpers; do not duplicate logic.
2. `app/main.py` — include the router.

### Part B — Caregiver page (frontend)
1. New `frontend/src/pages/CaregiverPage.jsx` (carer-facing). Gate it behind a lightweight **carer PIN** stored in `store` (or the auth login once wired) so the patient doesn't wander in. Add a nav entry (or a Settings → "Caregiver view" link).
2. Cards (reuse `.rp-*`/`WellbeingInsights` styles, dark theme): **Adherence** (Taken/Skipped/Missed last 7 & 30d per med, from `/adherence`), **Distress timeline** (sparkline of `distressLog` peaks/day), **Mood trend** (reuse the `insightsHistory` chart from WellbeingInsights), **Alerts** (open incidents + ack buttons → `POST /incident/{id}/ack`).
3. A "Generate this week's summary" button calling `/evaluate` (or a new `/caregiver/summary`) for a plain-language paragraph.

## Acceptance criteria
- [ ] `GET /api/v1/dashboard?days=30&kiosk_id=...` returns adherence summary + distress + wellbeing + incidents without error (empty arrays when no data).
- [ ] CaregiverPage shows the four cards; adherence numbers match `/adherence`; mood trend matches `insightsHistory`.
- [ ] Patient cannot reach it without the carer PIN; the patient-facing app is unchanged.
- [ ] Works with `kiosk_id` (not logged in) and, when auth is wired, with a Bearer token scoping to the account.

## Constraints / do not break
- Carer-facing, read-mostly; never expose raw clinical confidence or alarming language. Reuse existing endpoints (`/adherence`, `/evaluate`) — don't re-implement aggregation that already exists.
- Optional-auth + `kiosk_id` fallback; reuse the DB/session; match the existing design system.

## Out of scope
- Multi-patient / clinic mode (one patient per account for now).
- Real auth-gated multi-device sync (separate "frontend login" task) — dashboard works with the kiosk fallback today.
- Editing patient data from the dashboard (read-only + ack only).
