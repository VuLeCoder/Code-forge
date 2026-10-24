# MVP implementation ledger

Baseline: `c484c42` (M1–M5). Working branch: `thviet`. User-approved scope: P0–P8 completion plan.

This ledger separates implemented work from verified acceptance. It records local evidence only; it does not imply CI or cloud acceptance.

| Package | State | Acceptance evidence |
| --- | --- | --- |
| P0 baseline/CI | In progress | `corepack pnpm install --frozen-lockfile` with pnpm 12.3.4, lint, typecheck, full build, backend unit (13 suites / 71 tests), and browser suite (42 tests) pass locally. PostgreSQL 17 HTTP integration previously passed (2 suites / 19 tests) in an isolated disposable container. CI workflow includes PostgreSQL, browser/full-stack, backend and migration-image checks; hosted CI and image builds have not run. |
| P1 auth/invitation/contracts | Implemented; local integration pass | Session guard, invitation lifecycle, error envelope and OpenAPI changes. Covered by backend unit and HTTP integration results above. |
| P2 direct cloud Git | Not started | No Render/Vercel/Neon deployment has been inspected or tested. |
| P3 repository write coordination | Implemented; partial acceptance | PostgreSQL advisory lock and Git lifecycle changes; unit and HTTP integration pass. Full concurrent Git race matrix and crash recovery remain unverified. |
| P4 PR/compare/merge | Implemented; partial acceptance | Backend service/controller, migration, reconciliation and unit tests. PR browser journeys cover creation/compare, stale prevention, owner confirmation, and reconciliation lockout. PostgreSQL/API merge, conflict, retry, crash and quota journey is not yet verified end-to-end. |
| P5 PR UI | Implemented; browser acceptance pass | List/detail/create/update/close/reopen/merge screens; browser suite passes 42/42 including create/compare, stale, conflict and reconciliation cases, plus admin journeys. Full-stack API-backed acceptance remains pending. |
| P6 admin/audit/jobs | Implemented; partial acceptance | Admin backend/dashboard, allowlisted audit, maintenance jobs, security headers, and admin browser journey pass. Backend unit covers admin services. Bootstrap CLI + isolated PostgreSQL test is added but blocked by unavailable local database; job concurrency remains unverified. |
| P7 regression | In progress | Backend unit passes (13 suites / 71 tests); browser suite passes 42/42. PostgreSQL 17 HTTP integration previously passed (2 suites / 19 tests) on isolated disposable data. PR/admin full-stack journey and concurrency matrix remain. |
| P8 release/handoff | Pending | Deployment instructions and smoke checklist are updated. Docker image build, hosted CI, cloud smoke, URL and recovery exercise remain. |

Security review: a browser-header gap found in the read-only audit is fixed in `frontend/next.config.ts`; `GET /login` was verified to return CSP `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, and `Permissions-Policy`. HSTS remains a TLS-edge responsibility. AGY model catalog lists the four Medium models shown by the user; one direct probe succeeded on each. The first broad AGY review timed out with partial output; a narrower follow-up is pending. A separate reviewer found no additional confirmed auth bypass, IDOR, injection or RCE in the scoped backend paths.

GitHub review: repository `VuLeCoder/Code-forge` has one issue, #1 “Khởi tạo”; it is closed, has no comments, and records the initial technology/structure decision.

The four untracked Vietnamese overview documents at the repository root remain untouched. Do not reset or migrate an existing development/cloud database. Tests use isolated PostgreSQL schemas and temporary Git directories. The current PostgreSQL test container is disposable and has no mounted data volume.
