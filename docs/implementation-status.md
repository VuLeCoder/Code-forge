# MVP implementation ledger

Baseline: `c484c42` (M1–M5). Working branch: `thviet`. User-approved scope: P0–P8 completion plan.

This ledger separates implemented work from verified acceptance. It records local evidence only; it does not imply CI or cloud acceptance.

| Package | State | Acceptance evidence |
| --- | --- | --- |
| P0 baseline/CI | In progress | On the current working tree, frozen install, lint, typecheck, full build, backend unit (13 suites / 72 tests), and browser suite (43 tests) pass. PostgreSQL 17 HTTP integration previously passed (2 suites / 19 tests) in an isolated disposable container. CI config now caches pnpm, checks both images, and runs migration-image deploy against disposable PostgreSQL. Hosted run `40127724401` on `62b2900` failed four E2E assertions; this working tree fixes the PR test import, force-push fixture, and admin CLI pipe handling. A rerun is required before acceptance. |
| P1 auth/invitation/contracts | Implemented; local integration pass | Session guard, invitation lifecycle, error envelope and OpenAPI changes. Covered by backend unit and HTTP integration results above. |
| P2 direct cloud Git | Not started | No Render/Vercel/Neon deployment has been inspected or tested. |
| P3 repository write coordination | Implemented; partial acceptance | PostgreSQL advisory lock and Git lifecycle changes; unit and HTTP integration pass. Full concurrent Git race matrix and crash recovery remain unverified. |
| P4 PR/compare/merge | Implemented; partial acceptance | Backend service/controller, migration, reconciliation and unit tests. Added an isolated-schema HTTP/Git e2e journey for create/compare/owner merge, two-parent history and idempotent replay, plus a second same-operation lookup under the repository lock. Unit tests pass; hosted run `40127724401` exposed a cookie-parser test import error, fixed in the current working tree. The local DB at `localhost:5433` is unavailable. Conflict, crash and quota API matrix remains unverified end-to-end. |
| P5 PR UI | Implemented; browser acceptance pass | List/detail/create/update/close/reopen/merge screens include visible keyboard focus, focus entry/return, focused error feedback and narrow viewport checks. Full browser suite passes 43/43, including create/compare, stale, conflict, reconciliation, 375px overflow, and admin journeys. Full-stack API-backed acceptance remains pending. |
| P6 admin/audit/jobs | Implemented; partial acceptance | Admin backend/dashboard, allowlisted audit, maintenance jobs, security headers, and admin browser journey pass. Backend unit covers admin services. Hosted run `40127724401` exposed a piped-stdin bootstrap race that falsely returned success before DB work; fixed in the current working tree with explicit CLI output assertions. Isolated PostgreSQL create/promote cases await CI rerun; job concurrency remains unverified. |
| P7 regression | In progress | Backend unit passes (13 suites / 72 tests); browser suite passes 43/43. PostgreSQL 17 HTTP integration previously passed (2 suites / 19 tests) on isolated disposable data. PR/admin full-stack journey, concurrency matrix, and rerun of the corrected E2E suite remain. |
| P8 release/handoff | Pending | Deployment instructions and smoke checklist are updated. Docker image build, hosted CI, cloud smoke, URL and recovery exercise remain. |

Security review: a browser-header gap found in the read-only audit is fixed in `frontend/next.config.ts`; `GET /login` was verified to return CSP `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, and `Permissions-Policy`. HSTS remains a TLS-edge responsibility. AGY model catalog lists the four Medium models shown by the user; one direct probe succeeded on each. Two AGY review attempts timed out without usable audit output; AGY review remains unverified. A separate reviewer found no additional confirmed auth bypass, IDOR, injection or RCE in the scoped backend paths.

GitHub follow-up: issue #1 “Khởi tạo” is closed. Issues #2–#4 are open for isolated PostgreSQL/admin bootstrap, PR/Git race and recovery acceptance, and Docker/CI/cloud release checks. See `docs/next-actions.md` for the owner/Codex task split and dependency order.

The four untracked Vietnamese overview documents at the repository root remain untouched. Do not reset or migrate an existing development/cloud database. Tests use isolated PostgreSQL schemas and temporary Git directories. The current PostgreSQL test container is disposable and has no mounted data volume.
