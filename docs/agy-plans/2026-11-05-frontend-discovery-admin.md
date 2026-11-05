# Frontend refresh: Discovery/profile and admin

Status: READY_FOR_AGY

## Shared design contract

- Use the existing CSS Modules and global semantic tokens only. Do not add a
  dependency or change API calls, routes, permissions, authentication, or
  mutation behavior.
- Code Forge is a compact, light Git hosting interface: neutral canvas,
  white surfaces, blue links/focus, green primary action, and restrained
  6--8px corners. Use system UI for interface text and preserve monospace for
  code.
- At 320, 375, 768, 1024, and 1440px the document must not overflow
  horizontally. Long names wrap or truncate with a visible safe fallback.
- Preserve keyboard access, visible focus, loading/error/empty/unauthorized
  states, and `prefers-reduced-motion`. Do not introduce marketing gradients,
  copy GitHub branding, or create functionality without backend support.

## T4 — discovery and profile

- Worktree: `C:\\Users\\ADmin\\.codex\\worktrees\\agy-frontend-discovery\\Prj1`
- Baseline: `c1fbfae1a3d52b06b83f31d38a826ce22f01c5f0`
- Own only: `frontend/src/app/page.tsx`, `frontend/src/app/page.module.css`,
  `frontend/src/app/[username]/page.tsx`,
  `frontend/src/app/[username]/profile.module.css`,
  `frontend/src/app/[username]/repository-list.tsx`, and tests directly for
  these pages if required.
- Do not edit: globals/layout/header, repository routes, pulls, settings,
  admin, auth/new, proxy/API/backend, configuration, or package manifests.
- Outcome: discovery starts with search/repositories rather than a decorative
  hero; no fake clone host; profile has one clear identity and repository
  descriptions/updated metadata without changing response contracts.
- Verify: focused lint for owned files, frontend typecheck, and visual/manual
  checks at 375 and 1440px. Report changed files, commands/results, viewport
  evidence, and open limits. Do not commit, push, deploy, or use permission
  bypass.

## T7 — admin after T4 is reviewed

- Own only: `frontend/src/app/admin/page.tsx`,
  `frontend/src/app/admin/admin.module.css`, and `frontend/test/admin*.spec.ts`.
- Same shared design contract and exclusions as T4.
- Outcome: compact information hierarchy; tables stay readable on desktop and
  become labeled, non-overflowing records on small screens; filters, dialog,
  focus return, pending/error/unauthorized states preserve existing behavior.
- Verify the focused admin Playwright tests plus 320/375/1440px inspection.
  Do not commit, push, deploy, or use permission bypass.
