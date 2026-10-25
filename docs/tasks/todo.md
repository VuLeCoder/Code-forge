# Code Forge completion checklist

Original plan snapshot: 2026-10-25 14:02 Asia/Saigon. See [plan](plan.md) for estimates, owner roles, skills, risks, and acceptance criteria.

## Current execution snapshot (2026-10-25)

- `thviet` / `origin/thviet`: `25487b5`. Hosted run #77 (`40178590940`) passed all workflow gates on exact SHA `25487b5c99603e09254c2b5a6e30d358193dad01`.
- Squash commit `e2b5a1a` is on `origin/main`; run `40180253512` failed at the narrow admin focus-return test (55 passed, 1 failed). Backend, lint, typecheck, and build jobs passed; main CI is not green.
- Local workspace lint, typecheck, and build pass; backend unit tests pass 18 suites / 120 tests.
- Backend E2E reported 9 suites / 38 passed / 2 skipped, but Jest stayed alive after an open-handle warning and was interrupted. Do not count this invocation as a clean command exit; rerun or diagnose before closing the gate.
- Local demo is running. Render remains unresolved at Prisma `P1001`; Vercel GitHub App access remains dependent on the personal repository owner. Local success does not imply cloud deployment success.
- Estimates and calendar targets below remain forecasts from the original planning snapshot, not deadlines or measured remaining time.

- [x] T0: Inspect historical hosted CI #70 (`40170763221`) on `41c23ec`: 53/55 frontend tests passed; both admin Escape focus-return viewport tests failed.
- [x] T0a: Fix focus restoration without weakening tests; the fix is included in `25487b5` and validated by the later frontend/hosted gates.
- [x] T0b on `thviet`: frontend suite and workspace lint/typecheck/build verified; hosted run #77 passed on exact SHA `25487b5c99603e09254c2b5a6e30d358193dad01`.
- [ ] Fix and verify the focus-return regression reported by run `40180253512`; the main CI gate remains open until a new integrated SHA passes.
- [ ] T1: Close only remaining P3/P4 real PostgreSQL/Git acceptance gaps.
- [ ] T2: Close P6 acceptance; wait for owner U4 before implementing ambiguous-journal authority.
- [ ] Checkpoint A: focused suites and independent code/security review green.
- [ ] T3: Full local regression and Docker image smoke on integrated candidate. Backend E2E is not a clean pass yet: 9 suites / 38 passed / 2 skipped, then Jest remained alive after an open-handle warning and was interrupted.
- [x] T4 on `thviet`: hosted CI green on exact `25487b5` candidate SHA (run #77).
- [ ] T5: Cloud P2/P8 smoke, backup/rollback/recovery; Render P1001 remains unresolved and Vercel Git access is owner-dependent.
- [ ] T6: Reconcile docs and hand off runbooks/evidence.
- [ ] Final checkpoint: all P0–P8 acceptance evidence present; no cloud/source-durability claims beyond tests performed.
