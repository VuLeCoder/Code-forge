# Antigravity Task: Code Forge Admin Mobile UX

Status: READY_FOR_AGY

## Objective

Improve the existing Code Forge admin page on narrow screens (375 CSS px) so user, repository, and audit records remain easy to scan and their existing actions remain reachable. Preserve the current desktop visual language and behavior.

## Context and contract

- Base revision: `f8bc673` on `thviet`.
- Frontend: Next.js/React with CSS Modules and the existing admin page implementation.
- Keep all API paths, request/response shapes, backend authorization, and mutation behavior unchanged.
- Permission decisions remain backend-authoritative. Do not introduce UI-only privileges.
- Use the local Antigravity skill `codeforge-admin-responsive` at `C:\Users\ADmin\.gemini\config\skills\codeforge-admin-responsive\SKILL.md`.
- Follow existing project tokens, typography, spacing, colors, and component patterns. Avoid a broader redesign.

## Owned paths (only these may be edited)

- `frontend/src/app/admin/page.tsx`
- `frontend/src/app/admin/admin.module.css`
- `frontend/test/admin-accessibility.spec.ts`

## Forbidden paths and actions

- Do not edit backend, API/proxy routes, auth, database schema/migrations, shared styles, package manifests/lockfiles, CI, or unrelated docs.
- Do not edit `frontend/test/admin.spec.ts`; it is read-only regression coverage.
- Do not read, print, or add secrets; do not use real user or private repository content as fixtures.
- Do not commit, push, merge, or change branches. Return the isolated worktree diff for Codex review.

## Acceptance criteria

1. At 375px, admin user, repository, and audit records have a clear responsive presentation; no document-level horizontal overflow is introduced.
2. Every existing field and action remains available. If a table becomes cards, use visible field labels and preserve record grouping and reading order.
3. Desktop layout at 1280px remains consistent with the current design; do not change business behavior.
4. Headings, table/list naming, form labels, keyboard operation, visible focus, dialogs/focus restoration, and loading/error/success announcements remain accessible.
5. Add or update focused accessibility/browser assertions for the narrow layout and actionable controls. Keep regressions in existing `admin.spec.ts` passing.
6. `git diff --check` passes and the diff contains only the three owned paths.

## Verification

Run from the assigned worktree:

```powershell
corepack pnpm --filter frontend lint
corepack pnpm --filter frontend typecheck
corepack pnpm --filter frontend exec playwright test test/admin.spec.ts test/admin-accessibility.spec.ts
git diff --check
```

Also inspect the admin page at 375px and 1280px using the available browser workflow. Record the viewport and what was verified. If the required app/runtime or test fixture is unavailable, mark that check `BLOCKED`; do not claim it passed.

## Execution and reporting

- Work only in the assigned isolated worktree.
- Use the named local skill before editing.
- Before implementation, briefly inspect the current page, CSS, and accessibility test; state any assumption that affects presentation.
- Keep the change minimal and do not add dependencies.
- Report: task status (`SUCCEEDED`, `FAILED`, `BLOCKED`, or `UNKNOWN`); changed paths; concise behavior summary; each verification command and exact result; browser viewports checked; remaining limitations; and any uncommitted changes.
- Stop on a hard timeout or uncertain tool result. Do not silently retry or report success without evidence.

## Authorization and permissions

The user explicitly requested that Antigravity be assigned frontend work and managed for progress. Use the default permission mode (`dangerously_skip_permissions=false`). No blanket permission bypass is authorized.
