# Frontend redesign task board

Updated: 2026-11-06. Status describes the current worktree candidate, not a release.

| ID | Task | Acceptance evidence | Status |
| --- | --- | --- | --- |
| F-01 | Audit routes, stack, data and risk boundaries | `ARCHITECTURE_AUDIT.md` reflects actual source and API limits | Done |
| F-02 | Add shared Code Forge Aurora tokens and responsive shell | Existing layout works at target viewports; active navigation and focus are correct | Implemented; verification pending |
| F-03 | Build interactive homepage Git Engine Lab | DAG selection, local conflict choice, split diff, demo-only notice, keyboard tabs | Implemented; E2E added; verification pending |
| F-04 | Keep repository discovery API-backed | Existing tests confirm API-only results and distinct empty/error states | Existing implementation retained; verification pending |
| F-05 | Improve repository file and blob presentation | Actual tree entries get type accents; copy preview is labeled; truncated file cannot be downloaded as complete | Implemented; verification pending |
| F-06 | Refresh PR, profile, auth, create-repo, settings, invitations, PAT, and admin visuals | Existing actions/permissions remain connected to their APIs | Implemented in candidate; verification pending |
| F-07 | Run quality and accessibility checks | Lint, typecheck, production build and full frontend browser suite on candidate; report exact results | Frontend lint/typecheck passed; Playwright 70/70 passed before latest `origin/main` integration; final gate pending |
| F-08 | Review diff and release | Read-only review, clean scoped commit, feature push and normal main integration after required checks | Open |

No task is marked released until its evidence is available for the final candidate SHA.
