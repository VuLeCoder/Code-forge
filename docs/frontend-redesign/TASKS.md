# Frontend redesign task board

Updated: 2026-11-06. Status describes the current worktree candidate, not a release.

| ID | Task | Acceptance evidence | Status |
| --- | --- | --- | --- |
| F-01 | Audit routes, stack, data and risk boundaries | `ARCHITECTURE_AUDIT.md` reflects actual source and API limits | Done |
| F-02 | Add shared Code Forge Aurora tokens and responsive shell | Existing layout works at target viewports; active navigation and focus are correct | Local browser suite passed; homepage overflow checked at 320/375/768/1024/1440px |
| F-03 | Build interactive homepage Git Engine Lab | DAG selection, local conflict choice, split diff, demo-only notice, keyboard tabs | Local browser suite passed; controls are explicitly labeled examples and do not mutate repositories |
| F-04 | Keep repository discovery API-backed | Existing tests confirm API-only results and distinct empty/error states | Local browser suite passed: empty, 503, timeout and retry cases |
| F-05 | Improve repository file and blob presentation | Actual tree entries get type accents; copy preview is labeled; truncated file cannot be downloaded as complete | Local browser suite passed |
| F-06 | Refresh PR, profile, auth, create-repo, settings, invitations, PAT, and admin visuals | Existing actions/permissions remain connected to their APIs | Local browser and full-stack journeys passed; backend contracts unchanged |
| F-07 | Run quality and accessibility checks | Lint, typecheck, production build and full frontend browser suite on candidate; report exact results | Local: lint/typecheck/build passed; backend unit 26 suites/229 tests passed; backend E2E 10 suites/69 passed/5 skipped; frontend E2E 70/70; full-stack 3/3 |
| F-08 | Review diff and release | Read-only review, clean scoped commit, feature push and normal main integration after required checks | Open |

These results are local evidence for the current candidate. GitHub CI, review/merge, and cloud deployment remain separate release evidence and are still open.
