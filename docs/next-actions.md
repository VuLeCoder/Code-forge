# Code Forge — remaining task plan

Baseline: branch `thviet`, latest verified commit `93b79aa` (run `40133214107`). This is a task register, not a completion claim. P0–P8 acceptance remains governed by `implementation-status.md` and `deployment/cloud-smoke-checklist.md`.

## Tasks for the owner

These are the few items that require your machine, account, or product decision. Do not paste credentials or secret values into chat.

| ID | Priority | Owner | Action | Done when |
| --- | --- | --- | --- | --- |
| U1 | Required for local image smoke | You | Docker Desktop is installed; its current dashboard says the engine is `stopping`, and PostgreSQL is not listening at `localhost:5433`. When ready, start the engine yourself, then from PowerShell run `docker info` and `docker ps`. Do not reset containers or volumes. | Both commands return promptly and show the expected engine. Then ask Codex to resume local image smoke. Hosted CI has its own disposable PostgreSQL and can proceed independently. |
| U2 | Required for cloud | You | Confirm which GitHub/Vercel/Render/Neon accounts and project should host the demo. Create or select the three cloud resources, but keep secrets in provider dashboards/Codex secret storage. | We have the project/resource identifiers and authorized account sessions, not secret values in chat. |
| U3 | Required for cloud | You + Codex | Agree the public demo hostname and who may access it. The agreed demo uses ephemeral Git storage: source may disappear on service restart/redeploy/sleep, while metadata persists. | Hostname/access decision recorded; the source-loss warning is visible and accepted before public release. |
| U4 | Release review | You | Review the final smoke checklist and recovery instructions before sharing the demo URL. | Checklist and reset/recovery behavior are understood. |

## Tasks Codex and agents will execute

| ID | Priority | Owner | Work | Acceptance |
| --- | --- | --- | --- | --- |
| C1 | P0/P1/P6 | Codex + backend agent | Hosted CI runs isolated PostgreSQL migrations, admin bootstrap CLI, auth/repository/invitation integration, and admin audit/restore tests. Fixture refuses non-loopback or non-`*_test` URLs. | Run `40133214107` on `93b79aa` passes migrations, CLI stdin secrecy, bootstrap create/promote audit, and selected HTTP integration. Upgrade-from-production snapshot remains release-specific. |
| C2 | P3/P4/P7 | Codex + PR test agent | Continue API-backed PR creation, compare, conflict/stale, merge, quota, default-branch, retry and reconciliation coverage. | Hosted PostgreSQL E2E and browser full-stack journey pass on `93b79aa`; full push/merge races, crash recovery, quota API matrix and reconciliation chaos remain. |
| C3 | P5/P7 | UI agent | Audit and improve PR UI keyboard, screen-reader, error, and narrow-screen behavior. Keep the current CSS token system. | Focused accessibility/browser tests pass; PR list/detail are checked at 375px and keyboard-only. |
| C4 | P0/P8 | Infra agent + Codex | Audit/fix Docker runtime and migration images, run image smoke, and verify the hosted GitHub Actions workflow. | CI image/content checks and migration deploy pass on `93b79aa` (run `40133214107`); local Docker Desktop image smoke remains unavailable while the engine is stopping. |
| C5 | P2/P8 | Codex + you | Configure Vercel/Render/Neon, run direct Render Git HTTPS tests and release smoke. | Clone/fetch/push (including >4.5 MB payload), auth, proxy-aware rate limits from distinct clients, spoofed-header rejection, cold start, restart/reset, PR, admin, and recovery checklist have evidence. |
| C6 | P7/P8 | Codex | Run the complete regression suite, update acceptance ledger and deployment docs, then push each verified task batch to `thviet` and create follow-up issues for any remaining blockers. | Test evidence identifies commit/environment; no blocker is represented as passed; working tree and remote are reconciled. |
| C7 | Before release | Security reviewer + Codex | Re-audit auth, repo permissions, Git protocol, PR merge/reconciliation, admin/audit controls and proxy-aware rate limits after fixes. | Findings include severity, exact location, patch/action, and retest evidence; signed client IP cannot be forged; no unresolved release-blocking finding. |

## Dependency order

```mermaid
flowchart TD
  C1[C1: hosted isolated PostgreSQL acceptance] --> C2[C2: PR and Git end-to-end]
  U1[U1: Docker engine ready] --> localSmoke[Local image smoke]
  C2 --> C6[C6: full regression and ledger]
  C4[C4: image + hosted CI] --> C6
  C3[C3: UI accessibility] --> C6
  C7[C7: security re-audit] --> C6
  U2[U2: select cloud resources] --> C5[C5: cloud smoke]
  U3[U3: hostname and source-loss approval] --> C5
  C6 --> C5
  C5 --> U4[U4: release review]
```

## Current stop condition

The latest CI verification is green on `93b79aa` (run `40133214107`), including PostgreSQL E2E, browser/full-stack tests, both Docker images, migration deploy, and whitespace check. The full-stack test exposed and verified the same-origin PR API proxy and owner merge journey. The four root-level overview documents remain user-owned, untracked, and untouched. Remaining release blockers include selecting authorized Vercel/Render/Neon resources and recording the public demo hostname/access decision (U2/U3), followed by direct Render Git and cloud smoke. Local PostgreSQL at `localhost:5433` and local image smoke remain unavailable while Docker Desktop shows `Engine stopping`; Codex leaves that state untouched and does not delete containers/volumes.
