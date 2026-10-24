# Code Forge — remaining task plan

Baseline: branch `thviet`, latest verified commit `d2577fb` (run `40137272731`). This is a task register, not a completion claim. P0–P8 acceptance remains governed by `implementation-status.md` and `deployment/cloud-smoke-checklist.md`.

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
| C1 | P0/P1/P6 | Codex + backend agent | Hosted CI runs isolated PostgreSQL migrations, admin bootstrap CLI, auth/repository/invitation integration, and admin audit/restore tests. Fixture refuses non-loopback or non-`*_test` URLs. | Run `40136064222` passes migrations, CLI stdin secrecy, bootstrap create/promote audit, selected HTTP integration, and the concurrent refresh-reuse E2E. Upgrade-from-production snapshot remains release-specific. |
| C2 | P3/P4/P7 | Codex + PR test agent | Continue API-backed PR creation, compare, conflict/stale, merge, quota, default-branch, retry and reconciliation coverage. | Hosted run `40137272731` passes real Git push–push, push–merge, merge–delete, and reset-read recovery tests. Remaining: broader lifecycle combinations, crash recovery, quota API matrix, conflict matrix and reconciliation chaos. |
| C3 | P5/P7 | UI agent | Audit and improve PR UI keyboard, screen-reader, error, and narrow-screen behavior. Keep the current CSS token system. | Hosted browser suite passes 48/48 on `db2041d`, including 375px long labels/diff, keyboard focus, and 503/retry recovery. Broader screen-reader and manual viewport checks remain. |
| C4 | P0/P8 | Infra agent + Codex | Audit/fix Docker runtime and migration images, run image smoke, and verify the hosted GitHub Actions workflow. | Hosted image/content checks, migration deploy, and Compose backend-config validation pass on `d2577fb` (run `40137272731`). `compose.yaml` binds DB/API ports to loopback and supplies required local-only settings. Local container startup/image smoke remains unverified because Docker Engine commands do not respond. |
| C5 | P2/P8 | Codex + you | Configure Vercel/Render/Neon, run direct Render Git HTTPS tests and release smoke. | Clone/fetch/push (including >4.5 MB payload), auth, proxy-aware rate limits from distinct clients, spoofed-header rejection, cold start, restart/reset, PR, admin, and recovery checklist have evidence. |
| C6 | P7/P8 | Codex | Run the complete regression suite, update acceptance ledger and deployment docs, then push each verified task batch to `thviet` and create follow-up issues for any remaining blockers. | Hosted run `40137272731` passes standard gates on `d2577fb`, including isolated PostgreSQL/Git, 48 browser tests, full-stack journey, image/migration checks, Compose config validation and diff whitespace. Local PostgreSQL E2E was not run because port 5433 has no listener. Continue with remaining failure/recovery matrix and release-specific cloud smoke. |
| C7 | Before release | Security reviewer + Codex | Re-audit auth, repo permissions, Git protocol, PR merge/reconciliation, admin/audit controls and proxy-aware rate limits after fixes. | Read-only review found no confirmed exploitable auth/IDOR/RCE/admin/secret-logging issue. The PR proxy now enforces a tested 32 KiB body cap; the local Compose exposure was fixed. Cloud proxy-IP and direct Render Git behavior remain unverified. See `security-review-2026-10-25.md`. |

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

The latest fully verified hosted code run is `40137272731` on `d2577fb`; it passes workspace gates, isolated PostgreSQL/Git E2E, browser/full-stack tests, Docker image checks, migration-image deployment, Compose config validation, and whitespace. The four root-level overview documents remain user-owned, untracked, and untouched. Remaining release blockers include selecting authorized Vercel/Render/Neon resources and recording the public demo hostname/access decision (U2/U3), followed by direct Render Git and cloud smoke. Local PostgreSQL at `localhost:5433` is not listening and Docker Engine commands do not respond; Compose syntax/config validation passes but local image startup remains unverified. No containers or volumes were altered.
