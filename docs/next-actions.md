# Code Forge — remaining task plan

Baseline: branch `thviet`, latest pushed code commit `31cb306`; last fully passing hosted revision is `7e0aa27` (run `40138087574`). Run `40142070744` failed at backend E2E step 12 after backend unit passed, and downstream gates were skipped. Newest run `40142665347` concluded failure, but its job step is unknown because GitHub API rate limit is exhausted. This is a task register, not a completion claim. P0–P8 acceptance remains governed by `implementation-status.md` and `deployment/cloud-smoke-checklist.md`.

## Tasks for the owner

These are the few items that require your machine, account, or product decision. Do not paste credentials or secret values into chat.

| ID | Priority | Owner | Action | Done when |
| --- | --- | --- | --- | --- |
| U1 | Required for local image smoke | You | Docker Desktop is open, but Docker Engine commands do not return promptly and PostgreSQL is not listening at `localhost:5433`. When ready, start/recover the engine yourself, then from PowerShell run `docker info` and `docker ps`. Do not reset containers or volumes. | Both commands return promptly and show the expected engine. Then ask Codex to resume local image smoke. Hosted CI has its own disposable PostgreSQL and can proceed independently. |
| U2 | Required for cloud | You | Confirm which GitHub/Vercel/Render/Neon accounts and project should host the demo. Create or select the three cloud resources, but keep secrets in provider dashboards/Codex secret storage. | We have the project/resource identifiers and authorized account sessions, not secret values in chat. |
| U3 | Required for cloud | You + Codex | Agree the public demo hostname and who may access it. The agreed demo uses ephemeral Git storage: source may disappear on service restart/redeploy/sleep, while metadata persists. | Hostname/access decision recorded; the source-loss warning is visible and accepted before public release. |
| U4 | Release review | You | Review the final smoke checklist and recovery instructions before sharing the demo URL. | Checklist and reset/recovery behavior are understood. |
| U5 | Required for exact CI diagnosis and issue updates | You | If Chrome shows “Allow remote debugging?”, approve that prompt yourself and tell Codex. Do not paste tokens or secrets into chat. Issue comment drafts are ready; posting requires your action-time choice. | Read the failed Actions step logs and, if you choose, post updates to existing issues #3/#4. |

## Tasks Codex and agents will execute

| ID | Priority | Owner | Work | Acceptance |
| --- | --- | --- | --- | --- |
| C1 | P0/P1/P6 | Codex + backend agent | Hosted CI runs isolated PostgreSQL migrations, admin bootstrap CLI, auth/repository/invitation integration, and admin audit/restore tests. Fixture refuses non-loopback or non-`*_test` URLs. | Run `40136064222` passes migrations, CLI stdin secrecy, bootstrap create/promote audit, selected HTTP integration, and the concurrent refresh-reuse E2E. Upgrade-from-production snapshot remains release-specific. |
| C2 | P3/P4/P7 | Codex + backend test agent | Obtain authenticated logs for run `40142665347` (or `40142070744`) or reproduce safely. Source comparison makes the post-ref-update merge-reconciliation E2E the first focused reproducer, not a proven cause. Then verify actor attribution, one reconciliation audit, two Git parents and idempotent retry. Continue only with uncovered conflict/stale/quota/lifecycle cases. | The exact failing test is named and corrected with evidence; `backend test:e2e` passes in isolated PostgreSQL/Git CI on the exact fix commit. New recovery case shows no second ref movement/audit on retry. |
| C3 | P5/P7 | Codex + UI reviewer | PR empty-state form focus and branch-list failure feedback are implemented; admin role/status/dialog coverage was added on `141f749`. | Local frontend lint/typecheck and Playwright 49/49 pass on current checkout. Hosted browser gate is pending because backend E2E fails first; screen-reader and broader manual viewport checks remain. |
| C4 | P0/P8 | Infra agent + Codex | Audit/fix Docker runtime and migration images, run image smoke, and verify the hosted GitHub Actions workflow. | Hosted image/content checks, migration deploy, and Compose backend-config validation pass on `d2577fb` (run `40137272731`). `compose.yaml` binds DB/API ports to loopback and supplies required local-only settings. Local container startup/image smoke remains unverified because Docker Engine commands do not respond. |
| C5 | P2/P8 | Codex + you | Configure Vercel/Render/Neon, run direct Render Git HTTPS tests and release smoke. | Clone/fetch/push (including >4.5 MB payload), auth, proxy-aware rate limits from distinct clients, spoofed-header rejection, cold start, restart/reset, PR, admin, and recovery checklist have evidence. |
| C6 | P7/P8 | Codex | Resolve the latest E2E failure, verify the production `COOKIE_SECURE` guard, rerun the full regression suite, update the acceptance ledger and release docs, and push each verified task batch to `thviet`. Prepare issue updates for #3/#4; post only after explicit action-time approval and live-state verification. | New hosted run passes backend E2E, unit, lint, typecheck, build, browser/full-stack, Docker image/migration smoke and diff whitespace for the exact commit. Current local backend unit (14 suites/86 tests), lint, typecheck and build pass; isolated E2E is still pending. |
| C7 | Before release | Security reviewer + Codex | Re-audit auth, repo permissions, Git protocol, PR merge/reconciliation, admin/audit controls and proxy-aware rate limits. Enforce and test `COOKIE_SECURE=true` in production config. | Read-only reviews found no confirmed exploitable auth/IDOR/RCE/admin/secret-logging issue. The conditional secure-cookie guard now passes its focused 8/8 environment suite; full CI remains pending. Cloud proxy-IP and direct Render Git behavior remain unverified. See `security-review-2026-10-25.md`. |

## Dependency order

```mermaid
flowchart TD
  C1[C1: hosted isolated PostgreSQL acceptance] --> C2[C2: PR and Git end-to-end]
  U1[U1: Docker engine ready] --> localSmoke[Local image smoke]
  C2 --> C6[C6: full regression and ledger]
  C4[C4: image + hosted CI] --> C6
  C3[C3: UI accessibility] --> C6
  C7[C7: security audit and cookie guard] --> C6
  U2[U2: select cloud resources] --> C5[C5: cloud smoke]
  U3[U3: hostname and source-loss approval] --> C5
  C6 --> C5
  C5 --> U4[U4: release review]
```

## Current stop condition

The latest fully passing hosted revision is `40138087574` on `7e0aa27`; run `40142070744` on `141f749` passed unit but failed at backend E2E. Newest `40142665347` on `31cb306` also concluded failure, but the step is unknown until authenticated details are available or rate limit resets. PR/admin browser tests pass locally 49/49; current-head hosted confirmation is pending. Remaining release blockers include identifying/fixing the E2E failure, verifying merge reconciliation, selecting authorized cloud resources and hostname/access policy, and testing direct Render Git and reset/recovery. Production secure-cookie validation and backend unit/lint/typecheck/build pass locally. Docker Desktop is open but its engine/PostgreSQL on port 5433 remain unavailable. See `docs/remaining-work-breakdown.md` and `docs/issue-update-drafts.md` for task decomposition and prepared GitHub follow-up text.
