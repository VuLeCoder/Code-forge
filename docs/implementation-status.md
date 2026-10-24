# MVP implementation ledger

Baseline: `c484c42` (M1–M5). Working branch: `thviet`. User-approved scope: P0–P8 completion plan.

This ledger separates implemented work from verified acceptance. It records local evidence only; it does not imply CI or cloud acceptance.

| Package | State | Acceptance evidence |
| --- | --- | --- |
| P0 baseline/CI | Acceptance pass on current commit | Local frozen install, lint, typecheck, build, backend unit (13 suites / 72 tests), and browser suite (43 tests) pass. Hosted run `40129005632` on `4a88d41` passed backend unit, PostgreSQL E2E, lint, typecheck, build, browser, full-stack, both Docker image builds/content checks, migration deploy, and whitespace check. |
| P1 auth/invitation/contracts | Implemented; integration pass | Session guard, invitation lifecycle, error envelope and OpenAPI changes. Backend unit and hosted PostgreSQL HTTP E2E pass on `fc3422c`. |
| P2 direct cloud Git | Not started | No Render/Vercel/Neon deployment has been inspected or tested. |
| P3 repository write coordination | Implemented; partial acceptance | PostgreSQL advisory lock and Git lifecycle changes; unit and HTTP integration pass. Full concurrent Git race matrix and crash recovery remain unverified. |
| P4 PR/compare/merge | Implemented; primary journey passes | Backend service/controller, migration, reconciliation and unit tests. Hosted PostgreSQL E2E passes for create/compare/owner merge, two-parent history and idempotent replay on `fc3422c`; the force-push test now targets an existing ref. Conflict, process-crash, push/merge race and quota API matrix remain unverified end-to-end. |
| P5 PR UI | Implemented; browser acceptance pass | List/detail/create/update/close/reopen/merge screens include visible keyboard focus, focus entry/return, focused error feedback and narrow viewport checks. Full browser suite passes 43/43, including create/compare, stale, conflict, reconciliation, 375px overflow, and admin journeys. Full-stack API-backed acceptance remains pending. |
| P6 admin/audit/jobs | Implemented; partial acceptance | Admin backend/dashboard, allowlisted audit, maintenance jobs, security headers, and admin browser journey pass. Hosted PostgreSQL E2E verifies CLI create/promote, secret-safe output and transactional system audit events on `4a88d41`; migration is additive and CI deploy passed. Job concurrency remains unverified. |
| P7 regression | In progress | Hosted backend unit, PostgreSQL E2E, browser, and full-stack suites pass on `4a88d41`; local lint/typecheck/build also pass. Concurrent Git lifecycle and crash/reconciliation matrices remain. |
| P8 release/handoff | Pending | Deployment instructions and smoke checklist are updated; hosted CI and image/migration smoke pass. Cloud resource selection, direct Render Git tests, public URL, restart/reset, and recovery exercise remain. |

Security review: a browser-header gap found in the read-only audit is fixed in `frontend/next.config.ts`; `GET /login` was verified to return CSP `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, and `Permissions-Policy`. HSTS remains a TLS-edge responsibility. AGY model catalog lists the four Medium models shown by the user; one direct probe succeeded on each. Two AGY review attempts timed out without usable audit output; AGY review remains unverified. A separate scoped reviewer found no confirmed secret exposure or auth/session bypass; the low-severity bootstrap-audit gap is fixed and passed CI. Proxy-aware rate limiting is also a deployment verification item.

GitHub follow-up: issues #1 “Khởi tạo” and #2 isolated PostgreSQL/admin bootstrap are closed. Issues #3 PR/Git race and recovery acceptance and #4 Docker/CI/cloud release checks remain open. Latest evidence is commented on each issue. See `docs/next-actions.md` for the owner/Codex task split and dependency order.

The four untracked Vietnamese overview documents at the repository root remain untouched. Do not reset or migrate an existing development/cloud database. Tests use isolated PostgreSQL schemas and temporary Git directories. The current PostgreSQL test container is disposable and has no mounted data volume.
