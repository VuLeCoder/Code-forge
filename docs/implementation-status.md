# MVP implementation ledger

Baseline: `c484c42` (M1–M5). Working branch: `thviet`. User-approved scope: P0–P8 completion plan.

This ledger separates implemented work from verified acceptance. It records local evidence only; it does not imply CI or cloud acceptance.

| Package | State | Acceptance evidence |
| --- | --- | --- |
| P0 baseline/CI | In progress | Local frozen install, lint, typecheck, build, backend unit (13 suites / 72 tests), and browser suite (43 tests) pass. Hosted run `40128596583` on `fc3422c` passed backend unit and PostgreSQL E2E, lint, typecheck, build, browser, full-stack, both Docker image builds, and image contents checks; migration deploy failed. The GitHub job-log endpoint returned 403 for this account, so the exact database connection error is unknown. The working tree uses host networking for the migration container to reach the runner-published PostgreSQL port; rerun required. |
| P1 auth/invitation/contracts | Implemented; integration pass | Session guard, invitation lifecycle, error envelope and OpenAPI changes. Backend unit and hosted PostgreSQL HTTP E2E pass on `fc3422c`. |
| P2 direct cloud Git | Not started | No Render/Vercel/Neon deployment has been inspected or tested. |
| P3 repository write coordination | Implemented; partial acceptance | PostgreSQL advisory lock and Git lifecycle changes; unit and HTTP integration pass. Full concurrent Git race matrix and crash recovery remain unverified. |
| P4 PR/compare/merge | Implemented; primary journey passes | Backend service/controller, migration, reconciliation and unit tests. Hosted PostgreSQL E2E passes for create/compare/owner merge, two-parent history and idempotent replay on `fc3422c`; the force-push test now targets an existing ref. Conflict, process-crash, push/merge race and quota API matrix remain unverified end-to-end. |
| P5 PR UI | Implemented; browser acceptance pass | List/detail/create/update/close/reopen/merge screens include visible keyboard focus, focus entry/return, focused error feedback and narrow viewport checks. Full browser suite passes 43/43, including create/compare, stale, conflict, reconciliation, 375px overflow, and admin journeys. Full-stack API-backed acceptance remains pending. |
| P6 admin/audit/jobs | Implemented; partial acceptance | Admin backend/dashboard, allowlisted audit, maintenance jobs, security headers, and admin browser journey pass. Hosted PostgreSQL E2E verifies CLI create/promote and secret-safe output on `fc3422c`. Current working tree adds transactional system audit events for bootstrap create/promote with additive nullable-actor migration; next CI must verify it. Job concurrency remains unverified. |
| P7 regression | In progress | Hosted backend unit, PostgreSQL E2E, browser, and full-stack suites pass on `fc3422c`; local lint/typecheck/build also pass. Concurrent Git lifecycle and crash/reconciliation matrices remain. |
| P8 release/handoff | Pending | Deployment instructions and smoke checklist are updated. Docker image build, hosted CI, cloud smoke, URL and recovery exercise remain. |

Security review: a browser-header gap found in the read-only audit is fixed in `frontend/next.config.ts`; `GET /login` was verified to return CSP `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, and `Permissions-Policy`. HSTS remains a TLS-edge responsibility. AGY model catalog lists the four Medium models shown by the user; one direct probe succeeded on each. Two AGY review attempts timed out without usable audit output; AGY review remains unverified. A separate scoped reviewer found no confirmed secret exposure or auth/session bypass; the low-severity bootstrap-audit gap has a fix and tests in the current working tree, pending CI verification. Proxy-aware rate limiting is also a deployment verification item.

GitHub follow-up: issue #1 “Khởi tạo” is closed. Issues #2–#4 are open for isolated PostgreSQL/admin bootstrap, PR/Git race and recovery acceptance, and Docker/CI/cloud release checks. See `docs/next-actions.md` for the owner/Codex task split and dependency order.

The four untracked Vietnamese overview documents at the repository root remain untouched. Do not reset or migrate an existing development/cloud database. Tests use isolated PostgreSQL schemas and temporary Git directories. The current PostgreSQL test container is disposable and has no mounted data volume.
