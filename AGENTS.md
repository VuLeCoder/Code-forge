# Code Forge — agent entry point

Read this first, then load only the relevant source and acceptance slice.

## Project map

- Stack: pnpm workspace, Node 24, Next.js frontend, NestJS backend, PostgreSQL/Prisma, Git CLI.
- Current acceptance source: `docs/operations/acceptance-task-board-2026-10-25.md`.
- Historical evidence: `docs/operations/task-execution-log-2026-10-25.md`; do not treat old snapshots as current status.
- Git recovery contract: `docs/operations/git-operation-recovery.md`.
- CI is the full verification source of truth: `.github/workflows/ci.yml`.
- Read `CONSTRAINTS.md` before editing; never weaken it to make a check pass.

## Commands

- Install: `corepack pnpm install --frozen-lockfile`
- Fast focused checks: run the touched package's test, lint, and typecheck scripts.
- Full local checks: `corepack pnpm lint`, `corepack pnpm typecheck`, `corepack pnpm build`, then the relevant package tests.
- Full release gate: the `MVP verification` workflow in `.github/workflows/ci.yml`.

## Boundaries

- Inspect `git status` first and preserve untracked/user-owned files.
- Keep changes small and task-scoped; do not add dependencies without a demonstrated need.
- Do not push to `main`. Do not reset databases, Git storage, or Docker volumes.
- Do not run cloud migrations or deploys without confirming target, readiness, and backup/recovery evidence.
- Report local, CI, and cloud verification separately; a green CI run is not a cloud deployment.
