# Code Forge completion checklist

## Historical open release gates (2026-10-26; superseded)

For current acceptance and remaining tasks, see [the acceptance board](../operations/acceptance-task-board-2026-10-25.md) and [next actions](../next-actions.md). The checklist below predates the latest Render Git/PR smoke and is retained as history.

- Current source tip: `thviet` = `origin/thviet` = `23cb1c7`. Code commit `b6411ad` passed full hosted CI #118 (`40262580445`); docs-only run #119 on `23cb1c7` was in progress at this snapshot.
- [x] Deterministic P3/P4 merge→delete ordering E2E, backend typecheck/lint, full PR E2E file, and hosted code workflow #118.
- [ ] Complete remaining P3/P4 failure/recovery acceptance cases and reconcile handoff evidence.
- [ ] Complete P2/P8 cloud release: verify Git storage backup/restore before deploy/restart, then migration, direct Render Git transport, auth/PR/admin smoke, and recovery rehearsal. Current Render readiness 200 is not full smoke; historical P1001 root cause is unknown.
- [ ] Keep ambiguous journal issue #6 fail-closed until owner authority/approval policy is decided. Vercel remains deferred/out of scope.
- [ ] P0–P8 completion checkpoint: not achieved.

Older checklist blocks below are retained as dated history; their SHAs, test totals, and provider state are not current.

Original plan snapshot: 2026-10-25 14:02 Asia/Saigon. See [plan](plan.md) for estimates, owner roles, skills, risks, and acceptance criteria.

## Historical execution snapshot (2026-10-25)

- `thviet` / `origin/thviet`: `25487b5`. Hosted run #77 (`40178590940`) passed all workflow gates on exact SHA `25487b5c99603e09254c2b5a6e30d358193dad01`.
- Squash commit `e2b5a1a` is on `origin/main`; run `40180253512` failed at the narrow admin focus-return test (55 passed, 1 failed). Backend, lint, typecheck, and build jobs passed; main CI is not green.
- Local workspace lint, typecheck, and build pass; backend unit tests pass 18 suites / 120 tests.
- Backend E2E reported 9 suites / 38 passed / 2 skipped, but Jest stayed alive after an open-handle warning and was interrupted. Do not count this invocation as a clean command exit; rerun or diagnose before closing the gate.
- Local demo is running. Neon connection pooler is enabled (`pooler_enabled: true`) and verified via MCP. Render cold start / deploy pending cloud migration. Local success does not imply cloud deployment success.
- Estimates and calendar targets below remain forecasts from the original planning snapshot, not deadlines or measured remaining time.

- [x] T0: Inspect historical hosted CI #70 (`40170763221`) on `41c23ec`: 53/55 frontend tests passed; both admin Escape focus-return viewport tests failed.
- [x] T0a: Fix focus restoration without weakening tests; the fix is included in `25487b5` and validated by the later frontend/hosted gates.
- [x] T0b on `thviet`: frontend suite and workspace lint/typecheck/build verified; hosted run #77 passed on exact SHA `25487b5c99603e09254c2b5a6e30d358193dad01`.
- [ ] Fix and verify the focus-return regression reported by run `40180253512`; the main CI gate remains open until a new integrated SHA passes.
- [x] T1: P3/P4 real PostgreSQL/Git acceptance expanded: commit `027751b` verified purge retains expired storage while merge journal needs reconciliation (3/3 passed on loopback test DB).
- [ ] T2: Issue #6 ambiguous-journal admin/operator resolution deferred per owner choice; keep current fail-closed behavior and runbook. Commit `1e8736c` was reverted as `4b7eaed` after review identified unverified mark-failed/retry paths, non-atomic resolution audit, and free-text reason risk. Revisit only after the authorization/approval policy and security contract are approved.
- [ ] Checkpoint A: focused suites and independent code/security review green.
- [x] T3: Open-handle root cause diagnosed and resolved in commit `1b0901b` (`git-http` streaming process timer unref and stop-cleanup). Backend E2E clean pass: 9 suites / 39 passed / 2 skipped with 0 open handles and clean command exit.
- [x] T4 on `thviet`: hosted CI green on exact `25487b5` candidate SHA (run #77).
- [ ] T5: Cloud P2/P8 smoke, backup/rollback/recovery; Render P1001 remains unresolved. Vercel Git access is deferred/out of scope, not completed.
- [ ] T6: Reconcile docs and hand off runbooks/evidence.
- [ ] Final checkpoint: all P0–P8 acceptance evidence present; no cloud/source-durability claims beyond tests performed.

## Historical continuation tasks (verified 2026-10-25)

These bounded items refine existing T1–T6 tasks; they do not replace unchecked plan items.

- [x] **T1-AUTH-RACE:** Production logout/refresh family-revocation fix remains in `6d8c827`/`da020f9`. The deterministic two-client concurrency test and both auth-suite loopback `*_test` guards are integrated as `b1c2c2a`. Root serial reruns on the dedicated PostgreSQL test DB passed concurrency 1/1 and HTTP auth 8/8; backend typecheck/lint also passed. No production changes were made in this test-hardening slice.
- [x] **T1-STORAGE-RESET:** Commit `71a0c48` adds `defaultBranch: main` API/DB assertions. Leader reran `repositories.e2e-spec.ts -t "serializes completed push before missing-storage recovery"` on the dedicated loopback `code_forge_test` DB: 1 passed, 14 intentionally skipped, exit 0. The test checks recovery waits behind push, push journal/audit/ref durability, generation 0→1, repository/API default branch `main`, and recreated Git HEAD `refs/heads/main`.
- [x] **T1-PR-SNAPSHOT:** Integrated as `c380bac` plus explicit 60-second timeout `52face3`. Root focused real-PostgreSQL/Git rerun passed the snapshot consistency/stale-subrequest test (10 other cases intentionally skipped).
- [x] **T1-NO-MERGE-BASE:** Integrated as `22d94a5` with orphan fixture correction `6c3a6c3`. Root focused real-PostgreSQL/Git rerun passed the unrelated-history `409 NO_MERGE_BASE` contract; the test verifies no refs, PR, merge operation, audit, or push-operation mutation (10 other cases intentionally skipped).
- [x] **T2-BOOTSTRAP-SECURITY:** Static review found no secret/privilege defect. Commits `19a908c` and `4b43f71` redact bootstrap test failures and cover repeat-bootstrap idempotence; leader reran the dedicated PostgreSQL E2E 4/4. This closes only bootstrap secret/idempotence acceptance, not the entire P6 admin matrix.
- [ ] **T5-RENDER-NEON:** Read-only audit confirms runtime/migration image contract but no tracked Render blueprint; root cause of Prisma `P1001` remains unknown. After backend acceptance, use the sanitized bounded connectivity probe on the exact deployed release, verify dashboard values without exposing them, then smoke deploy. No secrets in chat/repo; Vercel is out of scope.
- [x] **T5-ADMIN-A11Y:** AGY's corrected three-file change was reviewed and integrated as `af80826`. Mobile keeps semantic table headers in the accessibility tree and uses `data-label` for visual cards. Root reran frontend lint, typecheck, Playwright 4/4 (`admin.spec.ts` + `admin-accessibility.spec.ts`) at 1280×800 and 375×812, and `git diff --check`. One earlier combined invocation flaked at the existing narrow dialog focus step; isolated narrow and subsequent full suite both passed. No API, permission, or mutation behavior changed.

- [x] **T2-ADMIN-STATUS-GUARD:** Agent added a unit regression proving deleted repositories cannot be reactivated through the generic status route, with no update/audit and lock released; integrated as `4d0f6a3`, focused spec 6/6 passed.
- [x] **T2-ADMIN-ROUTE-GUARDS:** Agent added metadata tests for class-level access-token/admin guards and same-origin protection on all mutations; integrated as `7bbe25f`, focused spec 4/4 passed.
- [x] **T3-BACKEND-REGRESSION:** On the dedicated loopback `code_forge_test` DB, lock E2E passed 2 with 1 POSIX-only Windows skip; repository E2E passed 15/15; complete backend E2E passed 10/10 suites, 49 passed / 2 skipped, exit 0; backend unit passed 20/20 suites / 161 tests. Backend lint/typecheck/build and `git diff --check` passed. Both API and migration Docker images built and passed contents/tooling smoke. Hosted CI and cloud smoke are still separate open gates.
- [x] **T1-PR-PRIVATE-READ:** Added and independently reviewed E2E assertions requiring anonymous and authenticated non-members to receive 404 with no private markers on PR list/detail/compare/commits/files/diff. Included in the passing full backend E2E run.
- [ ] **T3-REGRESSION-PUSH:** Review the local database diagnostic source/tests and pending intended backend tests; commit only approved code/test paths, preserve unrelated dirty documentation/config files, push only to `thviet`, and inspect hosted CI on the exact resulting SHA. Never push `main`.
- [ ] **T5-RENDER-NEON:** Root cause of Render Prisma `P1001` remains unknown. Local opt-in probe now tests a PostgreSQL handshake after DNS/TCP, but has not been deployed. Deploy the reviewed/pushed candidate, inspect only sanitized outcomes, verify endpoint/branch/database mapping without exposing values, and require a successful DB readiness/SQL check before migration or cloud smoke.
