# Factech AI — Production ("Big-Level") Roadmap

How we take Factech AI from a strong prototype to a production-grade clinical product.
Items are ordered by priority. ✅ = done in the current hardening batch.

## ✅ Done now (safe hardening batch)
- **CORS locked down** — replaced wildcard `allow_origins=["*"]` (invalid with credentials + unsafe)
  with a config-driven allowlist (`ALLOWED_ORIGINS`, defaults to localhost dev origins). — `app/main.py`, `app/core/config.py`
- **Path-traversal fixed** — the SPA file server now resolves requests and refuses anything outside
  `frontend/dist` (was `FileResponse(f"frontend/dist/{user_path}")`). — `app/main.py`
- **CI added** — GitHub Actions builds+lints the frontend and runs light backend unit tests. — `.github/workflows/ci.yml`
- **First real unit tests** — CORS parsing + voice language/prefix routing (fast, no ML stack). — `tests/test_config.py`, `tests/test_voice_routing.py`

## 🔴 Critical (do next)
1. **Real persistence + user accounts.** Today persona/memories/reminders/contacts live ONLY in the
   browser's `localStorage` (`frontend/src/lib/store.js`) — clearing the cache or switching devices
   **loses everything**, and there are no accounts. Add a backend datastore (Postgres/SQLite + SQLModel)
   with auth (carer login), and sync the store to it. This is the #1 gap to being a "real" product.
2. **Health-data privacy/compliance.** Encrypt data at rest, explicit consent capture (esp. for voice
   cloning a real/deceased person), and data export/delete. Document the data-flow & retention.
3. **Server-side input validation & limits** on every endpoint (sizes, types, rate limiting) — currently
   partial (persona endpoint clamps text; others less so).

## 🟠 High
4. **Observability** — structured logging (replace `print`), error tracking (Sentry), and a readiness
   probe that reports all 5 services. Currently `/health` only covers the main backend.
5. **Resilience/ops** — a supervisor for the 5 processes (the `scripts/dev_start.ps1` is dev-only;
   prod needs a process manager / containers per service), plus a request queue for the voice workers
   (single `_infer_lock` serializes — fine for one user, not many).
6. **Secrets management** — move `GROQ_API_KEY` etc. out of a working-tree `.env` into a secrets manager
   for deploys; rotate the current key (it has been on disk).
7. **Test coverage** — add API tests (TestClient) for `/persona/chat`, `/tts`, `/clone-voice`, reminders,
   and a frontend test runner (Vitest) for the store + critical components.

## 🟡 Medium
8. **Code quality** — split the oversized `AvatarPage.jsx`; retire/merge the older
   `endpoints.py`/`chat_endpoint.py` face-recog flows if superseded; de-duplicate the two voice workers
   (`voice_service` / `voice_service_ov` share ~80% — extract a shared base); fix the red eslint baseline.
9. **Accessibility audit** — full WCAG pass (keyboard nav, ARIA on icon buttons, focus traps in modals,
   verified contrast) beyond the existing text-size/contrast/motion controls.
10. **Performance/scale** — Qdrant `server` mode for multi-process, optional GPU path for instant cloned
    voice (`VOICE_DEVICE=cuda`), and CDN/caching for the built frontend.

## Suggested sequencing
**Sprint 1 (foundation):** #1 persistence+auth + #6 secrets + #7 tests.
**Sprint 2 (trust):** #2 privacy/compliance + #4 observability + #3 validation.
**Sprint 3 (scale & polish):** #5 ops + #10 performance + #8 code quality + #9 a11y.
