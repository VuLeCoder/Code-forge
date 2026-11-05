# Frontend redesign implementation plan

## Scope

Update the presentation layer for Code Forge pages while retaining Next.js App Router, React, TypeScript, CSS Modules, existing endpoints, backend contracts, auth, permissions, and Git behavior. Avoid new dependencies and avoid displaying invented repository activity as real data.

## Phases

| Phase | Scope | Status |
| --- | --- | --- |
| 0 — Audit | Inspect workspace/routes/data sources/tests and record unavailable data | Implemented in `ARCHITECTURE_AUDIT.md`; final test evidence pending |
| 1 — Foundation | Shared visual tokens, light shell, typography, focus, reduced motion | Implemented in this candidate; lint/build verification pending |
| 2 — App shell | Header, account dropdown, global navigation, repository navigation | Implemented; active state and current routes retained |
| 3 — Home | Concise hero, interactive Git Engine Lab, truthful API-backed discovery | Implemented; lab fixtures are labeled examples and browser checks pending |
| 4 — Repository | Repository overview, actual tree/branch/commit/blob/README data, clone and quick setup | Presentation refreshed; file-type icons and full-text copy/download added; checks pending |
| 5 — Collaboration | PR list/detail/forms/diff/merge state presentation | Presentation refreshed; backend rules and API unchanged; checks pending |
| 6 — Profile and account | Profile, auth, create repository, invitations, PAT, admin | Presentation refreshed; checks pending |
| 7 — Quality | E2E, lint, typecheck, build, diff review, responsive and keyboard checks | Pre-integration candidate passed frontend lint/typecheck and 70/70 Playwright tests; rerun after latest `origin/main` is integrated |
| 8 — Release | Commit, push feature branch, integrate to main under branch protection, confirm remote SHA | Open until quality gates and remote checks pass |

## Release guardrails

1. Run checks on the exact candidate SHA; report local, CI, and cloud separately.
2. Preserve user-owned and untracked files; stage only the redesign files.
3. Fetch the remote before integration. Do not force-push or bypass required checks/branch protection.
4. If `main` moved, integrate the latest remote main and rerun required checks on the resulting candidate.
5. If GitHub requires a pull request or approval, leave the change in the required workflow and report the outstanding step rather than bypassing protection.

## Known intentional omissions

- No live commit graph, real conflict file list, or real merge state is fabricated on the landing page. The lab is a clearly labeled UI demo.
- No contribution heatmap, language chart, stars, performance timings, or file-level commit metadata are shown unless a future API actually provides them.
- No backend, database, auth, Git storage, routing contract, or data mutation behavior is changed.
- Download is disabled when a blob preview is truncated, because the UI does not possess the complete file contents.
