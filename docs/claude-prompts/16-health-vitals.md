# Feature: Health & vitals tracker (BP / sugar / weight / temp / mood)

> Paste this whole file to Claude Code as the task. It is grounded in the real repo — file paths, function names, and line numbers below were verified.

---

## 1. Context (verified by reading the repo)

- **Project:** Factech AI — FastAPI + React 19 (Vite 7) AI memory companion for dementia/Alzheimer's patients. Frontend in `frontend/`, backend `app/main.py` with routers under `settings.API_V1_STR` = `/api/v1`.
- **All patient state is client-only.** `frontend/src/lib/store.js` is a `useSyncExternalStore` store persisted to `localStorage` under key `factech_state_v1`. Default shape (line 7): `{ profile, persona, memories[], transcript[], reminders[], insightsHistory[] }`. Mutations go through `set(next)` (line 24) → `persist()` (line 20, capacity-safe, swallows quota errors) → `emit()`. The React hook is `useAppState()` (line 85).
- **Existing store helpers to mirror:**
  - `addReminder(r)` (lines 60–67) creates `{ id, title, time, type, lastFired }`, sorts by `time`. ID pattern: `String(Date.now()) + Math.random().toString(36).slice(2, 7)`.
  - `removeReminder(id)` (lines 68–70). `markReminderFired(id, dayKey)` (lines 71–73).
  - `addInsight(ev)` (lines 76–80) pushes `{ date, mood, engagement }` and **caps the array at 30** via `.slice(-30)` — copy this capping discipline for `vitals`.
  - `addMemory` (lines 35–43) shows the ISO-date + spread pattern.
- **Reminders UI to reuse:** `frontend/src/components/Reminders.jsx`. Has a `TYPES` icon/color/label map (lines 5–10), an inline add-form toggled by `adding` state (lines 41–52: text input + `<select>` type picker + `Save`), a list render with a colored icon chip (`.rm-ic`, lines 63–70), and a self-contained dark inline `<style>` block (lines 75–96). **Match these `.rm-*` conventions** (card `rgba(30,41,59,0.55)`, violet accents `#a78bfa`/`#7c3aed`, gradient save button).
- **Trend chart to reuse:** `frontend/src/components/WellbeingInsights.jsx`. The bar chart is lines 72–86 (`.wi-trend` flex row of `.wi-bar-wrap` → `.wi-bar` with `height: (score/max)*100%` and per-point `background`), with `MOOD`/`ENGAGE` color maps (lines 8–14) and CSS at lines 133–135. **Reuse this exact bar-chart pattern** — do NOT add a charting library.
- **Reminder firing (the "time to measure" hook):** `frontend/src/App.jsx` lines 17–54 poll `getState()` every 30s; when a reminder is due (`nowMin >= tMin && nowMin - tMin <= 60 && r.lastFired !== today`) it calls `markReminderFired`, shows a banner, and speaks via `window.speechSynthesis`. The localized line is built per `r.type` at lines 41–44 (`medication` / `meal` / `appointment` / else). **Add a `vitals` branch here** rather than building a new scheduler.
- **Home screen:** `frontend/src/pages/HomeView.jsx`. Quick-tile grid `.hv-tiles` (lines 49–65) renders `.hv-tile` buttons (lucide icon + `.hv-tile-t` + `.hv-tile-d`) that call `onNavigate(view)`. `<Reminders />` and `<WellbeingInsights />` are mounted at lines 68–71. **Add a "Health" tile + the new Vitals section here.**
- **Multilingual:** `persona.language` ∈ `English | Hindi | Hinglish`. `App.jsx` lines 39–40 map `hindi`/`hinglish` → `hi-IN`, else `en-US`, and build localized lines. `AvatarPage.jsx` (lines 42–46, 74) follows the same convention. **Preserve this** — vitals labels and the measure-reminder spoken line must be language-aware.
- **API base / backend conventions (for the future sync hook only):** frontend base = `import.meta.env.VITE_API_BASE || '/api/v1'` (see `WellbeingInsights.jsx` line 6). Backend routers use `APIRouter()` + `payload: dict = Body(...)` and return `{"status": "ok"|"error", ...}` (see `app/api/persona_endpoint.py`). ONE shared `qdrant_client` in `app/core/db.py` — never construct a second.
- **Future caregiver sync (do NOT build now):** `docs/claude-prompts/02-caregiver-dashboard.md` specs a SQLite + pairing-code backend where the patient device pushes a syncable slice via `PUT /patient/{id}/state` and `POST /patient/{id}/insight`, gated on `state.auth?.patientId`. Vitals are intended to be viewable there later. For now build **standalone (localStorage)** and leave a clearly-commented, no-op-until-paired sync seam.

---

## 2. Goal

Let the patient (or a caregiver helping them) log everyday vitals — **blood pressure, blood sugar, weight, temperature, mood** — through big, easy inputs; optionally schedule a gentle "time to measure" reminder reusing the existing reminders system; and show **trend charts** in the WellbeingInsights bar-chart style so a caregiver can see direction over time. Out-of-range readings raise a **gentle, non-clinical** caregiver note. Everything is informational only — **no diagnosis, no medical claims**.

---

## 3. Implementation plan (numbered)

### 3.1 — `frontend/src/lib/store.js`: data + helpers
1. Add `vitals: []` to `defaultState` (line 7). Because `load()` spreads `{ ...defaultState, ...JSON.parse(raw) }` (line 12), existing saved states upgrade automatically — confirm no other code assumes the old shape.
2. Add a shared **vital-type config** (export it so the UI imports one source of truth):
   ```js
   export const VITAL_TYPES = {
     bp:     { label: 'Blood pressure', unit: 'mmHg', compound: true,  // systolic/diastolic
               normal: { sys: [90, 140], dia: [60, 90] }, color: '#f472b6' },
     sugar:  { label: 'Blood sugar',    unit: 'mg/dL', normal: [70, 180], color: '#fbbf24' },
     weight: { label: 'Weight',         unit: 'kg',    normal: null,       color: '#60a5fa' },
     temp:   { label: 'Temperature',    unit: '°C',    normal: [36.1, 37.8], color: '#f87171' },
     mood:   { label: 'Mood',           unit: '',      normal: null,       color: '#4ade80',
               // reuse WellbeingInsights mood vocabulary so trends line up
               options: ['positive', 'neutral', 'low', 'anxious'] },
   };
   ```
   Ranges are **simple, configurable defaults — NOT clinical thresholds**. Keep them in this one config object so they can be tuned later.
3. Add helpers (mirror `addReminder`/`addInsight` exactly — same ID scheme, ISO timestamp, and **cap the array, e.g. `.slice(-200)`** to stay localStorage-size aware):
   ```js
   export function addVital(v) {
     const rec = {
       id: String(Date.now()) + Math.random().toString(36).slice(2, 7),
       type: v.type, value: v.value, unit: v.unit ?? '', ts: new Date().toISOString(),
       note: v.note || '',
     };
     set({ vitals: [...state.vitals, rec].slice(-200) });
     maybeSyncVital(rec);  // see 3.7 — no-op until paired
     return rec;
   }
   export function removeVital(id) { set({ vitals: state.vitals.filter((x) => x.id !== id) }); }
   ```
4. Add a pure **out-of-range checker** (no side effects, easy to unit-reason about):
   ```js
   export function vitalFlag(rec) {
     const cfg = VITAL_TYPES[rec.type]; if (!cfg) return null;
     if (cfg.compound && rec.type === 'bp') {
       const { sys, dia } = rec.value || {};
       const outSys = sys != null && (sys < cfg.normal.sys[0] || sys > cfg.normal.sys[1]);
       const outDia = dia != null && (dia < cfg.normal.dia[0] || dia > cfg.normal.dia[1]);
       return (outSys || outDia) ? { type: rec.type, ...rec.value } : null;
     }
     if (!cfg.normal) return null; // weight/mood: no range
     const n = Number(rec.value);
     return (n < cfg.normal[0] || n > cfg.normal[1]) ? { type: rec.type, value: n } : null;
   }
   ```
   It returns `null` when in range or when the type has no range; the UI turns a non-null result into a **gentle worded note**, never a diagnosis.
5. Make `resetAll()` (line 82) still work — since it spreads `defaultState`, the new `vitals: []` is covered automatically.

### 3.2 — Vitals logging UI: `frontend/src/components/VitalsTracker.jsx` (new)
6. Build it as a near-twin of `Reminders.jsx`: a card with a header (`Activity`/`HeartPulse` lucide icon + title), an `Add` / `Close` toggle (`adding` state), and an inline add-form. Reuse the `.rm-*` class conventions and dark style block (copy and rename to `.vt-*`, or reuse identical CSS values).
7. **Type picker** = a `<select>` over `Object.entries(VITAL_TYPES)` (same shape as `Reminders.jsx` lines 45–47).
8. **Big number inputs** (dementia-friendly): render the value field(s) per selected type:
   - `bp` → two large `inputmode="numeric"` fields **Systolic** / **Diastolic**, store `value: { sys, dia }`.
   - `sugar` / `weight` / `temp` → one large `inputmode="decimal"` numeric field; show the unit beside it from `VITAL_TYPES[type].unit`.
   - `mood` → a row of big tappable buttons from `VITAL_TYPES.mood.options` (reuse WellbeingInsights `MOOD` colors), store the chosen string.
   - Optional `note` text input.
   Inputs must be visibly large (≥18px font, generous padding) — match the kiosk's dementia-friendly sizing.
9. On Save: call `addVital({ type, value, unit: VITAL_TYPES[type].unit })`, then immediately run `vitalFlag(rec)`; if non-null, set a small in-card **gentle flag** (see 3.5). Reset the form like `Reminders.save()` (lines 26–30).
10. Render a recent-readings list (last ~8) with the type's colored icon chip (mirror `.rm-item`), the formatted value + unit, a relative/short timestamp, and a delete button calling `removeVital(id)`.
11. **Multilingual labels:** add a tiny `labelsFor(lang)` map (English / Hindi / Hinglish) for the section title, field labels, and the flag/empty-copy, keyed off `(persona?.language || '').toLowerCase()` from `useAppState()` — same approach as `App.jsx`/`AvatarPage.jsx`. Fall back to English.

### 3.3 — Vitals trend view (reuse the WellbeingInsights chart)
12. **Extract the bar chart into a shared component** to avoid duplicating the logic that currently lives only in `WellbeingInsights.jsx` (lines 72–86): create `frontend/src/components/TrendBars.jsx` taking props `{ points: [{ value, color, title }], max }` and rendering the `.wi-trend` / `.wi-bar-wrap` / `.wi-bar` structure (height = `(value/max)*100%`). Move the chart CSS (lines 133–135) into this component.
13. Refactor `WellbeingInsights.jsx` to render `<TrendBars />` with its mood points (`MOOD[h.mood].score`, max 4) so behavior is **identical** — verify the mood trend still renders the same.
14. In `VitalsTracker.jsx` (or a sibling `VitalsTrends.jsx` it renders), show a small per-type trend: a type switcher (default to the type with the most readings), then `<TrendBars points={...} max={...} />` over `state.vitals.filter(v => v.type === sel).slice(-12)`.
    - Numeric types: `max` = a sensible per-type ceiling (e.g. derive from observed max or the normal-range upper bound × 1.5); color = `VITAL_TYPES[type].color`; per-bar `title` = value + unit + localized date.
    - `bp`: chart systolic (primary line) — keep it simple, one series.
    - `mood`: reuse the 1–4 `MOOD` scoring so it matches the wellbeing chart visually.
    - Show the trend only when there are **≥2** readings (same gate as WellbeingInsights line 72).

### 3.4 — Optional "time to measure" reminder type (reuse reminders)
15. Add a `vitals` entry to the `TYPES` map in `frontend/src/components/Reminders.jsx` (lines 5–10), e.g. `vitals: { icon: Activity, color: '#34d399', label: 'Measure vitals' }`, so a user can schedule "Check blood pressure" at a time like any other reminder. No new data model — it's just another `reminder.type`.
16. In `frontend/src/App.jsx`, add a `vitals` branch to the localized line builder (lines 41–44), e.g. `${uname}, gentle reminder — time to check your ${r.title}.`, with a Hindi/Hinglish variant matching the `ttsLang` logic on lines 39–40. **Do not change** the existing firing condition or other branches.

### 3.5 — Out-of-range gentle flag
17. When `vitalFlag(rec)` is non-null, surface a soft, supportive note inside the Vitals card — reuse the WellbeingInsights "Worth noticing" warn styling (`.wi-label.wi-warn`, amber `#fbbf24`, lines 99–101/127). Wording must be **informational and gentle**, e.g. *"This reading is outside the usual range you set — it may be worth mentioning to a caregiver."* **Never** output a diagnosis, severity, or medical instruction.
18. (Optional, low-risk) also write a wellbeing-style breadcrumb so the caregiver view picks it up later — but do **not** call the LLM and do **not** alter `insightsHistory`'s shape; if unsure, skip and rely on the synced `vitals` slice.

### 3.6 — "Health" tile on HomeView
19. In `frontend/src/pages/HomeView.jsx`, add a `.hv-tile` to the `.hv-tiles` grid (lines 49–65): lucide `Activity` (or `HeartPulse`) icon, title "Health", description like "Log blood pressure, sugar, weight & mood." Either navigate to a section or scroll to the mounted tracker.
20. Mount `<VitalsTracker />` in the page (a natural spot is just after `<Reminders />`, line 68, before `<WellbeingInsights />`). Keep imports tidy at the top with the other component imports (lines 4–6).

### 3.7 — Future caregiver-dashboard sync hook (seam only, no backend now)
21. Add a `maybeSyncVital(rec)` function in `store.js` that is a **no-op unless paired**, matching the seam described in `docs/claude-prompts/02-caregiver-dashboard.md`:
    ```js
    // Future: when the caregiver-dashboard backend (doc 02) lands, the patient
    // device will be "paired" (state.auth?.patientId set). Until then this is a
    // silent no-op so the standalone localStorage flow is unaffected.
    function maybeSyncVital(rec) {
      const pid = state.auth?.patientId;
      if (!pid) return;                 // not paired → local only
      const base = import.meta.env.VITE_API_BASE || '/api/v1';
      // fire-and-forget; swallow errors so offline still works
      try { axios.put(`${base}/patient/${pid}/vitals`, rec).catch(() => {}); } catch {}
    }
    ```
    `axios` is already a dependency. **Do not** add an `auth` field or any backend endpoint as part of this task — just leave this guarded seam and a comment pointing at doc 02. The `state.auth?.patientId` check is forward-compatible (it's simply `undefined` today).

---

## 4. Data contract (precise)

- **Vital record** (in `state.vitals`, capped to last 200):
  ```jsonc
  { "id": "1718…x7a2c", "type": "bp|sugar|weight|temp|mood",
    "value": 128 | { "sys": 128, "dia": 82 } | "neutral",
    "unit": "mmHg|mg/dL|kg|°C|''", "ts": "2026-06-14T09:00:00.000Z", "note": "" }
  ```
- **Normal-range config** = `VITAL_TYPES` in `store.js` (section 3.1 #2). Defaults: BP sys `[90,140]` / dia `[60,90]`, sugar `[70,180]` mg/dL, temp `[36.1,37.8]°C`; weight & mood have **no** range (`normal: null`). These are **configurable, non-clinical** placeholders.
- **localStorage keys:** `factech_state_v1` only — same key, additive `vitals: []` field (no shape break). No new top-level keys.
- **Trend points** passed to `TrendBars`: `{ value: number, color: string, title: string }[]` + `max: number`.
- **Sync payload (future only):** the single vital record, `PUT /api/v1/patient/{patientId}/vitals` — guarded by `state.auth?.patientId`, no-op today.

---

## 5. Acceptance criteria + manual test path

**Acceptance criteria**
- [ ] `npm run dev` in `frontend/` builds with no new errors; no new dependency added.
- [ ] HomeView shows a "Health" tile; a Vitals tracker card renders on Home.
- [ ] Logging each type works: BP (two fields → `{sys,dia}`), sugar/weight/temp (one numeric field + unit), mood (button row). Each appears in the recent list and **survives a page reload** (localStorage).
- [ ] A reading outside the configured range shows a **gentle, non-diagnostic** flag; an in-range reading shows none; weight/mood never flag.
- [ ] With ≥2 readings of a type, a trend chart renders in the **WellbeingInsights bar-chart style** (shared `TrendBars`), and the existing Wellbeing mood trend still looks identical after the refactor.
- [ ] Adding a `Measure vitals` reminder and letting it fall due triggers the banner + spoken line with the new `vitals` wording; existing medication/meal/appointment/general reminders are unchanged.
- [ ] Hindi/Hinglish persona shows localized vitals labels and a localized measure-reminder line.
- [ ] Removing the last reading and `resetAll()` both leave a valid empty state.

**Manual test path**
1. `uvicorn app.main:app --reload` (optional for this feature) and `npm run dev` in `frontend/`.
2. Home → click **Health** → log a BP of `150/95` → confirm it lists and shows the gentle out-of-range note.
3. Log `120/78` → confirm no flag. Log a weight → confirm never flags.
4. Log 2–3 sugar readings → confirm the trend chart appears and matches the wellbeing bar style.
5. Reload the page → all readings persist.
6. Reminders → add a **Measure vitals** reminder for the current minute → wait ≤30s → confirm banner + spoken "time to check" line.
7. Switch persona language to Hindi → confirm labels + measure line localize.
8. Run Wellbeing "Evaluate" twice → confirm the mood trend chart still renders correctly (shared component regression check).

---

## 6. Constraints / DO NOT BREAK
- **No medical diagnosis or claims.** Vitals and flags are **informational only**; wording stays gentle and defers to a caregiver/clinician. No severity scores, no "you have…" statements.
- Keep the existing **reminders** and **wellbeing insights** working: only **add** a `TYPES`/`App.jsx` branch and **extract** (not rewrite) the bar chart. The refactored `WellbeingInsights` must behave identically.
- **Reuse the existing chart style** (`.wi-trend`/`.wi-bar`) — do **not** add a chart library (no recharts/chart.js/d3).
- **Multilingual** via `persona.language` (English/Hindi/Hinglish), same mapping as `App.jsx`/`AvatarPage.jsx`.
- **Dark inline `<style>`** blocks in JSX (card `rgba(30,41,59,0.55)`, violet `#a78bfa`/`#7c3aed` accents) — match `Reminders.jsx`/`WellbeingInsights.jsx`. Large, dementia-friendly inputs.
- **No hardcoded secrets**; the future sync hook reads `import.meta.env.VITE_API_BASE` only and is a no-op until paired.
- **localStorage-size aware:** cap `vitals` (e.g. last 200) like `addInsight`/`addTurn` do; rely on the existing quota-safe `persist()`.
- Do not construct a second Qdrant client; this feature touches no Qdrant code.

## 7. Out of scope
- No device / Bluetooth / wearable integration — manual entry only.
- No clinical thresholds, alarms, or escalation beyond the simple **configurable** ranges in `VITAL_TYPES`.
- No backend persistence in this task — only the guarded, no-op sync seam pointing at `docs/claude-prompts/02-caregiver-dashboard.md`.
- No charting library; no new top-level localStorage keys; no changes to `insightsHistory` shape.
- No LLM call for vitals interpretation.
