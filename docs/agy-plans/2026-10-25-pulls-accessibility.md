# AGY handoff — pull request accessibility and responsive pass

Status: READY_FOR_AGY

## Goal

Inspect and improve the existing pull-request list/detail UI for keyboard access,
accessible state feedback, and narrow-screen layout. Preserve the current
visual language and API behavior. This is a focused P5/P7 acceptance task, not
a redesign or a new feature.

## Baseline and ownership

- Base commit: `edb0ced` on branch `thviet` (the coordinator must verify the
  committed handoff before dispatch).
- AGY owns only:
  - `frontend/src/app/[username]/[repo]/pulls/page.tsx`
  - `frontend/src/app/[username]/[repo]/pulls/[number]/page.tsx`
  - `frontend/src/app/[username]/[repo]/pulls/pulls.module.css`
  - `frontend/test/pulls.spec.ts`
- Codex owns integration, all backend and shared-contract changes, release
  documentation, and review/merge decisions.
- Do not edit any other paths. In particular, do not edit backend files, API
  proxy routes, shared/global styles, app layout/auth, package manifests, or
  migrations.

## Shared contract

- Keep existing API paths, request/response shapes, authorization semantics,
  and mutation behavior unchanged.
- Permission and state remain backend-authoritative; the UI may only render the
  permissions already returned by the current API.
- Do not include raw repository file content as HTML. Keep rendered diff text
  escaped through the existing React rendering path.
- Preserve existing CSS variables and module styling conventions.

## Acceptance

1. All interactive controls have visible keyboard focus and usable names.
2. Opening/closing dialogs and failed/successful merge or reconciliation
   feedback do not strand keyboard focus; status changes are announced with
   appropriate semantic live/status regions.
3. The list and detail pages remain usable at 375px and desktop widths, without
   horizontal page overflow; diff-level horizontal scrolling is acceptable.
4. Existing loading, empty, unauthorized, stale/conflict, and backend-error
   states remain distinct and understandable.
5. Focused Playwright coverage verifies the changes without recording secrets
   or raw PAT values.
6. `corepack pnpm --filter frontend lint`,
   `corepack pnpm --filter frontend typecheck`, and
   `corepack pnpm --filter frontend exec playwright test test/pulls.spec.ts`
   pass in the assigned worktree.
7. `git diff --check` passes and the diff contains only AGY-owned paths.

## Permission and safety

- Mode: `dangerously_skip_permissions=false`.
- Authorization: the user explicitly requested AGY participation and authorized
  MCP availability for AGY in this project conversation. No global permission
  bypass or persistent broad allow-rule is authorized.
- Use headless execution; visible terminal was not requested and is not needed.
- No cloud account access, secrets, deployment, destructive action, or existing
  database/storage access is in scope.
- If MCP permission is denied or the call times out, preserve the worktree and
  report the exact status; do not silently retry or widen scope.

## Report required

Return final status (`succeeded`, `failed`, `permission_blocked`,
`authentication_blocked`, `timed_out`, or `unknown`), changed files, concise
accessibility/responsive findings, exact test commands and results, remaining
manual checks, and any blocker. Do not claim screen-reader/manual viewport
coverage unless actually performed.
