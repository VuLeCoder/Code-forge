# MVP implementation ledger

Baseline: `c484c42` (M1–M5). Working branch: `thviet`. User-approved scope: P0–P8 completion plan.

This ledger separates implemented work from verified acceptance. It records local evidence only; it does not imply CI or cloud acceptance.

| Package | State | Acceptance evidence |
| --- | --- | --- |
| P0 baseline/CI | Hosted acceptance pass on `a22f0c8` | Hosted run `40133968613` passed backend unit, isolated PostgreSQL/Git E2E, lint, typecheck, build, browser E2E, full-stack PR journey, both Docker image builds/content checks, migration-image deploy, and whitespace check. Local lint, typecheck, build, and backend unit (14 suites / 81 tests) also pass. The four user-owned root documents remain untracked and untouched. |
| P1 auth/invitation/contracts | Implemented; integration pass | Session guard, invitation lifecycle, error envelope and OpenAPI changes. Backend unit and hosted PostgreSQL HTTP E2E pass on `fc3422c`. |
| P2 direct cloud Git | Not started | No Render/Vercel/Neon deployment has been inspected or tested. |
| P3 repository write coordination | Implemented; partial acceptance | PostgreSQL advisory lock and Git lifecycle changes; unit and HTTP integration pass. Hosted E2E now verifies an unresolved merge operation blocks a new merge with `409`, without moving the target ref or adding merge audit. Push/push, push/merge, merge/delete/reset races and crash recovery remain unverified. |
| P4 PR/compare/merge | Implemented; primary journeys pass | Hosted PostgreSQL E2E and full-stack browser test pass on `a22f0c8` for WRITE invite/accept, PAT push, PR create/compare, owner merge, fetched two-parent commit, idempotent replay, and unresolved-operation blocking. Conflict, process-crash, push/merge race and quota API matrix remain unverified end-to-end. |
| P5 PR UI | Implemented; browser and API-backed acceptance pass | List/detail/create/update/close/reopen/merge screens include keyboard focus and narrow-layout checks. Browser suite and the full-stack owner/collaborator PR flow pass on `a22f0c8`. |
| P6 admin/audit/jobs | Implemented; partial acceptance | Admin backend/dashboard, allowlisted audit, maintenance jobs, security headers, and admin browser journey pass. Hosted PostgreSQL E2E on `a22f0c8` verifies isolated CLI create/promote, password non-echo, and system audit events. Job concurrency remains unverified. |
| P7 regression | In progress | Hosted run `40133968613` on `a22f0c8` passes backend unit, PostgreSQL E2E, lint, typecheck, build, browser, full-stack, Docker image checks, migration deploy, and whitespace check. Concurrent Git lifecycle, crash/reconciliation matrices, and cloud smoke remain. |
| P8 release/handoff | Pending | Hosted CI and image/migration smoke pass. Cloud resource selection, direct Render Git tests, public URL, restart/reset, and recovery exercise remain. |

Security review: a browser-header gap found in the read-only audit is fixed in `frontend/next.config.ts`; `GET /login` was verified to return CSP `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, and `Permissions-Policy`. HSTS remains a TLS-edge responsibility. Two AGY review attempts timed out without usable audit output; AGY review remains unverified. Scoped reviewers found no confirmed secret exposure, auth/session bypass, or flaw in the PR proxy's method/path, Origin, cookie, and header handling. Proxy-aware rate limiting still needs cloud verification.

GitHub follow-up: issues #1 “Khởi tạo” and #2 isolated PostgreSQL/admin bootstrap are closed. Issues #3 PR/Git race and recovery acceptance and #4 Docker/CI/cloud release checks remain open. Current passing CI evidence is run `40133968613` on `a22f0c8`; additional concurrency and cloud-release criteria remain. See `docs/next-actions.md` for the owner/Codex task split and dependency order.

The four untracked Vietnamese overview documents at the repository root remain untouched. Do not reset or migrate an existing development/cloud database. Tests use isolated PostgreSQL schemas and temporary Git directories. The current PostgreSQL test container is disposable and has no mounted data volume.
