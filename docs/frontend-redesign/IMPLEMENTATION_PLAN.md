# Frontend redesign implementation plan

## Scope

Update the presentation layer for Code Forge pages while retaining Next.js App Router, React, TypeScript, CSS Modules, existing endpoints, backend contracts, auth, permissions, and Git behavior. Avoid new dependencies and avoid displaying invented repository activity as real data.

## Phases

| Phase | Scope | Status |
| --- | --- | --- |
| 0 — Audit | Inspect workspace/routes/data sources/tests and record unavailable data | Completed in `ARCHITECTURE_AUDIT.md` |
| 1 — Foundation | Shared visual tokens, light shell, typography, focus, reduced motion | Implemented; workspace lint/typecheck/build passed locally |
| 2 — App shell | Header, account dropdown, global navigation, repository navigation | Implemented; active state and current routes retained |
| 3 — Home | Concise hero, interactive Git Engine Lab, truthful API-backed discovery | Implemented; local browser E2E covers demo-only interactions, responsive layout, empty/error/timeout/retry |
| 4 — Repository | Repository overview, actual tree/branch/commit/blob/README data, clone and quick setup | Implemented; local browser suite passed |
| 5 — Collaboration | PR list/detail/forms/diff/merge state presentation | Implemented; full-stack invitation/push/merge journey passed |
| 6 — Profile and account | Profile, auth, create repository, invitations, PAT, admin | Implemented; local browser and backend test suites passed |
| 7 — Quality | E2E, lint, typecheck, build, diff review, responsive and keyboard checks | Local lint/typecheck/build passed; backend unit 26 suites/229 tests; backend E2E 10 suites/69 passed/5 skipped; frontend E2E 70/70; full-stack 3/3 |
| 8 — Release | Commit, push feature branch, integrate to main under branch protection, confirm remote SHA | Open: push, GitHub CI, PR/merge, and cloud confirmation pending |

## Release guardrails

1. Local checks above ran after integrating current `origin/main` (`45c91ac`); report local, CI, and cloud separately.
2. Preserve user-owned and untracked files; stage only the redesign files.
3. Fetch the remote before integration. Do not force-push or bypass required checks/branch protection.
4. If `main` moved, integrate the latest remote main and rerun required checks on the resulting candidate.
5. If GitHub requires a pull request or approval, leave the change in the required workflow and report the outstanding step rather than bypassing protection.

## Known intentional omissions

- No live commit graph, real conflict file list, or real merge state is fabricated on the landing page. The lab is a clearly labeled UI demo.
- No contribution heatmap, language chart, stars, performance timings, or file-level commit metadata are shown unless a future API actually provides them.
- No backend, database, auth, Git storage, routing contract, or data mutation behavior is changed.
- Download is disabled when a blob preview is truncated, because the UI does not possess the complete file contents.
