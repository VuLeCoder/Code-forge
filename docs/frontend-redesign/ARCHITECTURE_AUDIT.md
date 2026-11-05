# Code Forge frontend architecture audit

Reviewed: 2026-11-06
Working branch: `codex/ui-refresh-v3`
Observed base: `7efff1d` (`feat(frontend): clarify repository and settings states`)

## Stack and boundaries

- pnpm workspace, Node 24; frontend uses Next.js 16 App Router, React 19, TypeScript, CSS Modules, and app-wide CSS. No component or utility CSS framework is installed.
- App Router pages render server components by default. Interactive areas use client components, including auth/session state, repository navigation, source tree, pull requests, tokens, invitations, and admin controls.
- NestJS owns the REST API, authentication, authorization, repository policy, pull request workflow, and Git operations. Prisma/PostgreSQL store metadata. Git CLI owns repository objects and refs.
- Next route handlers under `frontend/src/app/api/v1` proxy the backend. The `/git/...` route supports local Git HTTP proxying. UI changes must preserve these routes and their request/response semantics.

## Current route and feature map

| Route | Current responsibility | Data boundary |
| --- | --- | --- |
| `/` | Intro, Git Engine Lab demo, public repository discovery/search/pagination | `GET /api/v1/repositories` |
| `/login`, `/register` | Account forms and session establishment | `/api/v1/auth/*` |
| `/new` | Create repository | `POST /api/v1/repositories` |
| `/:username` | Public profile and repository list | `GET /api/v1/users/:username` |
| `/:username/:repo` | Repository header, clone/setup, branch and source browser | Repository, branch, tree, blob, image, and commit endpoints |
| `/:username/:repo/pulls` | Filter, list, and create pull requests | Pull request and branch endpoints |
| `/:username/:repo/pulls/:number` | Review metadata, commits/files/diff, edit/close/reopen/merge | Existing PR endpoints and backend permissions/snapshots |
| `/:username/:repo/settings` | Visibility, members, invitations, deletion | Existing repository settings endpoints |
| `/invitations` | Accept/decline invitations | Existing invitation endpoints |
| `/settings/tokens` | Personal access token creation/revocation | Existing token endpoints; plaintext only at creation |
| `/admin` | Admin statistics, user/repository controls, audit and restore | Existing admin endpoints and server permissions |

## Existing data limits

- Public repository summaries provide owner, name, description, visibility, `updatedAt`, and permissions. The UI must not invent stars, language, last commit, traffic, or counts.
- Profile data does not include contribution events or a heatmap source. Do not render synthetic contribution totals.
- A repository tree returns paths and entry types, not last commit per file. File-level commit messages and timestamps must not be fabricated.
- Blob reads can be binary, large, or truncated. A download action is only safe when the full text preview is present; truncated previews must be labeled and must not masquerade as full files.
- Pull request APIs provide status, branch names, snapshots, commits/files/diff, permissions, and merge outcomes. Conflict file details are shown only if returned by the API. The homepage lab uses clearly labeled local examples and performs no Git operation.
- Git source on the free demo host may reset independently of PostgreSQL metadata. UI copy should distinguish repository metadata from source availability.

## Regression risks and guardrails

1. Keep all auth, permission checks, session handling, mutation requests, API routes, and merge snapshot/version behavior unchanged.
2. Keep errors, empty results, unauthorized states, and loading states visually distinct; never turn an API failure into an empty repository/member list.
3. Keep code and diff content escaped by React and scrollable inside their own regions.
4. Verify header and repository navigation at 320, 375, 768, 1024, and 1440 px; only code/diff regions may require horizontal scrolling.
5. Respect reduced motion and visible keyboard focus. Do not add dependency or high-cost visualization runtime.
6. Preserve untracked user files such as `frontend/AGENTS.md` and `frontend/CLAUDE.md`; they are not part of this change.

## Verification status

The current pre-integration candidate passed `corepack pnpm --filter frontend lint`, `corepack pnpm --filter frontend typecheck`, and `corepack pnpm --filter frontend test:e2e` (70 passed, 0 failed, Chromium). The browser command also ran the frontend production build before starting the server. Remote `main` advanced to `45c91ac` during this worktree session, so the final integrated candidate still needs its verification run. No CI or cloud result is claimed here.
