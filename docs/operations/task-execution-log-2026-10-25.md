# Agent task execution log

Purpose: preserve evidence, errors, and exact next steps so another AI or a
future `/handoff` can continue without reconstructing undocumented state.
Never include credentials, tokens, cookies, database URLs, source code excerpts,
or private cloud values.
This is a chronological log: entries labeled **historical/superseded** are
snapshots, not current status. Current acceptance state is in the task board.

## T-BASE — historical baseline snapshot (superseded)

- Owner: Codex lead.
- Status: completed read-only audit at that earlier point; superseded by later
  run/status entries below.
- Branch/worktree: `thviet`, `E:\Prj1`, HEAD `9f1eb0b4d168227920465597caaf0ae846e699d0`.
- Changed paths: none in this task.
- Evidence: GitHub Actions run `40153297115` returned `completed/success` on the
  exact HEAD SHA. GitHub public API showed issues #3, #4, and #5 remain open.
- Findings: P0/P1 and core P3–P7 journeys are substantially implemented. No
  cloud release evidence; local Compose runtime, Render-direct Git including
  >4.5 MB, cloud source-loss/recovery, manual accessibility, actual advisory-lock
  connection loss during active Git work, true backend process-kill recovery,
  and supported ambiguous-journal resolution remain open.
- Security audit: an independent read-only Codex audit found no confirmed
  actionable vulnerability in reviewed auth/session, invitation, Git push/lock,
  PR merge/reconciliation, admin, or audit paths. Static review only; cloud
  boundaries remain untested.
- Tool error: AGY read-only security review timed out after 120 seconds without
  usable output. Permission bypass was false; no files were changed by AGY. Do
  not treat timeout as a clean AGY review or retry blindly.
- Research: Perplexity was asked a generic, public-source question without repo
  details. Its initial result agrees that Vercel Functions have a 4.5 MB body
  limit, Render free filesystems are ephemeral and cannot use persistent disks,
  and Neon distinguishes pooled runtime from direct Prisma CLI connections.
  These claims were independently verified against official docs: [Vercel
  Functions Limits](https://vercel.com/docs/functions/limitations), [Render
  Free](https://render.com/docs/free), [Render Persistent
  Disks](https://render.com/docs/disks), [Neon Prisma
  guide](https://neon.com/docs/guides/prisma), and [Neon connection
  pooling](https://neon.com/docs/connect/connection-pooling). The Perplexity
  answer was not used as sole evidence.
- DeepSeek delegate errors: Continue CLI returned a provider credit/token-budget
  error before a response; no repository content was sent. A follow-up attempt
  to use the existing DeepSeek browser tab failed twice with CDP
  `No target with given id found` even though the tab appeared in the target
  listing. Stop there; do not create duplicate tabs or change browser settings.
- Next: complete the isolated true child-process crash E2E task; then review and
  integrate only after focused verification. Keep cloud release blocked on
  owner-selected resources, hostname/audience, and acceptance of ephemeral Git
  storage.

## T-DOC — acceptance task board and status-ledger corrections

- Owner: Codex lead.
- Status: documentation reconciliation in progress; factual edits and task
  cards are in the worktree but not committed or pushed.
- Branch/worktree: root `E:\Prj1`, branch `thviet`, HEAD now
  `cdb2d1f` (pushed; GitHub run `40158529985` succeeded); this worktree still contains
  uncommitted maintenance tests and existing user/project docs.
- Changed paths by this task: `docs/operations/acceptance-task-board-2026-10-25.md`,
  `docs/operations/task-execution-log-2026-10-25.md`, and factual corrections
  to `docs/implementation-status.md`.
- Findings corrected: previous ledger incorrectly showed `6c921e5` and run
  `40149679404` as latest/in progress, said the 255-byte branch fix was still in
  progress, and understated the DB-backed maintenance cleanup tests. The board
  baseline and CI evidence require a final update after the local commit and new
  test results.
- Verification: content review completed; `git diff --check` passes for the
  root worktree. Not committed or pushed yet. Existing modified docs and
  untracked root `AGENTS.md` are preserved; only the new task-board/log files
  are owned by this turn.
- Next: update `docs/next-actions.md`, `docs/remaining-work-breakdown.md`,
  issue drafts, and recovery/security evidence to match the same baseline; do
  not publish issue comments without a separate current user selection.

## T-MERGE-GRACE — verify merge reconciliation timing contract

- Owner: Codex lead.
- Status: code and local verification complete; hosted run `40158089595` passed.
- Branch/commits: `c944f9a` introduced the grace and fresh-status coverage;
  `d9b728f` fixed immediate reconciliation after caught metadata transaction failure.
- Changed paths across those commits: maintenance implementation/unit/E2E plus
  `backend/src/repositories/pull-requests.service.ts`, its unit spec, and
  `backend/test/pull-requests.e2e-spec.ts`.
- Coverage: PENDING candidates require `createdAt <= now - 120s`; the unit test
  checks the approximate cutoff and asserts NEEDS_RECONCILIATION has no time
  filter. PostgreSQL E2E creates fresh records for both statuses, verifies the
  pending operation is deferred, the needs-reconciliation operation is picked
  up immediately, then verifies the pending operation is picked up after aging.
- Local evidence: backend unit suite 16/16 (110 tests); full backend PostgreSQL
  E2E 9/9 (33 tests) on a new isolated test DB; backend lint/typecheck/build
  passed. Jest warned about open handles after all E2Es, so the successful
  rerun used `--forceExit`. Hosted run `40156947283` exposed only a generic
  failure annotation; local rerun pinpointed the issue to the existing PR
  metadata-failure recovery test. Commit `d9b728f` marks the journal
  NEEDS_RECONCILIATION immediately where possible. Independent review found no
  actionable safety issue; exact-head CI `40158089595` passed.

## T-CRASH — historical crash/restart snapshot (superseded)

- Owner: `/root/merge_restart_test`; Codex lead reviews/integrates.
- Status at that earlier snapshot: test implementation was not accepted. The final cleanup-order fix
  passed backend typecheck and `git diff --check`; the focused PostgreSQL E2E
  could not be rerun because `DATABASE_URL` was unavailable in the agent shell.
  No commit or push.
- Worktree: `E:\Prj1-worktrees\merge-restart-acceptance`, branch
  `codex/merge-restart-acceptance`, baseline `9f1eb0b`.
- Owned file: only `backend/test/pull-requests.e2e-spec.ts`.
- Acceptance: a child backend process must actually be terminated after Git
  moves the target ref and before PR metadata commits; fresh reconciliation
  must finish metadata and audit once; retry must be idempotent and fetch must
  contain the same two-parent commit. Trigger failure or fresh service instance
  alone is not true process-kill coverage.
- Safety: only isolated E2E-created `*_test` schema/temp Git root; do not start,
  stop, remove, or modify existing containers/volumes.
- Last update: a focused run before final cleanup hardening reported 1 passed
  and 3 skipped. Review then found cleanup could release the advisory barrier
  before terminating child DB sessions. The latest patch stops the child API,
  terminates and waits for only sessions bearing the unique child
  `application_name`, then releases the barrier; remaining cleanup is nested in
  `finally`. Typecheck and diff-check pass.
- The latest E2E attempt stopped before tests because `DATABASE_URL` was
  missing; another earlier attempt hit `ENOSPC` writing Jest cache. Docker CLI
  inspection did not return, and port `127.0.0.1:49586` was unreachable. Do not
  claim post-fix crash acceptance until the isolated PostgreSQL run is green.
- The assigned worktree remains preserved and uncommitted at
  `E:\Prj1-worktrees\merge-restart-acceptance`.

## T-LOCK — advisory-lock connection-loss review

- Owner: `/root/lock_loss_review` (read-only review); Codex lead owns any fix.
- Status: 120-second PENDING grace and targeted tests committed as `c944f9a`
  and pushed; hosted run failed at the backend E2E step. The detailed GitHub
  job log is sign-in gated, so the exact failing spec is not yet known.
- Scope: `RepositoryLockService` and Git mutation lifecycle at HEAD
  `9f1eb0b`.
- Evidence: lock connection errors abort Git work, and normal follow-on
  mutators check durable push/merge journals created before their Git child.
  Repository lifecycle, delete/restore, purge, admin restore, and merge are
  fail-closed while unresolved operations exist. Exception: the merge
  maintenance reconciler selected fresh `PENDING` operations immediately and
  could mark one failed while the old Git command was still exiting. Push
  reconciliation already used a 120-second process-exit grace.
- Change: `MaintenanceJobsService` applies the 120-second grace only to
  `PENDING` merge operations; `NEEDS_RECONCILIATION` remains immediately
  retryable. Unit coverage checks the cutoff duration and absence of a time
  filter on the NEEDS branch. A PostgreSQL E2E case exercises both statuses.
  The historical RED run and mutation check were green evidence for the earlier
  single-PENDING behavior, not proof of the new two-status E2E case.
- Independent review verdict: query logic is correct; only PENDING is delayed,
  NEEDS remains eligible, and the cross-type unresolved-push fence is intact.
  The new E2E fixture's missing bare Git repo was reviewed and is unlikely to
  explain its assertion because `branchSha()` returns null for Git exit 1/128.
  Exact E2E failure is still unknown: hosted run `40156947283` returned only a
  generic exit-code annotation, and local isolated PostgreSQL was unavailable.
- AGY read-only review: `agy_ask` timed out at 120 seconds with no usable output;
  no files were changed by AGY. Do not count as a review pass or retry blindly.
- Current verification: focused maintenance unit suite 15/15; backend typecheck,
  lint, build, and `git diff --check` passed. Hosted run `40156788179` on parent
  `a49656d` succeeded; exact-head run `40156947283` on `c944f9a` failed at
  `backend test:e2e`. The process-crash E2E and advisory-lock-loss E2E are
  separate worktree tasks and are not evidence for one another.

## T-LOCK-LOSS — advisory-lock connection loss during Git (historical snapshot)

> Superseded status note: the later valid-pack regression is accepted and hosted
> in `9c2eb81`; this section records the earlier narrower test and its then-
> pending CI state only.

- Owner: `/root/lock_loss_e2e`; Codex lead reviews/integrates.
- Status: scoped behavior verified and fix pushed as `b538c65`; hosted CI pending.
- Worktree: `E:\Prj1-worktrees\lock-loss-acceptance`, branch
  `codex/lock-loss-acceptance`, baseline `9f1eb0b`; implementation integrated to `thviet`.
- Changed files: `backend/src/repositories/repository-lock.service.ts`,
  `backend/src/repositories/repository-lock.service.spec.ts`, and
  `backend/test/repository-lock.e2e-spec.ts`.
- Change: uses a real Git receive-pack child and terminates only the
  lock-owning PostgreSQL backend, then asserts child cancellation, unchanged
  target ref, and pool connection release. The test sends no pack bytes; its
  title/comments now narrowly claim cancellation while receive-pack is waiting
  for input, not safety during an active push. Production fix keeps the pg
  client error listener active through repeated socket/connection-end errors.
- Evidence: an isolated PostgreSQL E2E initially reproduced the unhandled
  second `error` event; after the listener fix, focused E2E passed 2/2. Unit,
  backend typecheck/lint, and diff-check passed on the agent branch. Root
  `thviet` backend unit passes 17 suites / 111 tests; hosted CI for `b538c65`
  is pending. Active valid-pack/ref-update lock-loss remains unproven.

## T-AGY — persistent Gemini 3.8 Flash preference

- Owner: Codex lead; explicitly requested by the user.
- Verified available IDs from `agy models`: `gemini-3.8-flash-low`,
  `gemini-3.8-flash-medium`, and `gemini-3.8-flash-high`. The user-provided
  Antigravity screenshot shows Gemini 3.8 Flash Medium selected in the IDE.
- Saved and read back a global preference in
  the user-level AGY memory: use only Gemini 3.8 Flash, default to
  Medium, pass `--model gemini-3.8-flash-medium`, never silently fall back, and
  do not use the bridge when it cannot pin the model. The current Codex AGY
  bridge tool schema has no model argument.
- IDE verification: with Gemini 3.8 Flash Medium selected, the pane returned
  the exact harmless health-check response. The user then asked to use CLI or
  bridge, not further computer-use interaction.
- CLI evidence: `agy models` listed the Flash family but reported the CLI
  selected override as Gemini 4 Argon (Medium). A direct command pinned to
  `gemini-3.8-flash-medium` returned a 45-second print-timeout with the turn
  still in progress. C: had 0 bytes free, and AGY logged that its C-drive
  summary store could not be written. The bridge schema has no model override.
  Do not launch bridge jobs until the CLI is pinned to Flash and completes a
  short prompt; do not silently use Argon.

## T-AGY-REVIEW — historical maintenance grace review (superseded)

- Owner: AGY review result supplied by the user; Codex verified the findings
  against the current service and test code.
- Scope: `maintenance-jobs.service.ts`, its unit spec, and the PostgreSQL
  cleanup E2E.
- Status: historical report before current-branch verification. No duplicate
  changes were required; both findings were already present in `c944f9a` and
  runtime-verified in T-MAINT-GRACE below.
- Original report described those assertions as missing. The current branch
  already contained the 119–121 second cutoff assertion, the no-`createdAt`
  assertion for `NEEDS_RECONCILIATION`, and the immediate-pickup E2E. No source
  changes were made. Current runtime evidence is recorded under
  `T-MAINT-GRACE` below (unit 15/15; maintenance E2E 2/2).

## T-SEC — independent security audit

- Owner: `/root/security_audit_current`.
- Status: complete (read-only).
- Worktree: `E:\Prj1`, branch `thviet`, HEAD `9f1eb0b`.
- Changed paths: none.
- Initial review found no confirmed actionable vulnerability in its reviewed
  surfaces; static review only. A subsequent focused admin/Git authorization
  audit found the PAT lock race recorded under T-SEC-LOCK below. No live-cloud
  proxy/storage behavior was tested.
- Repeat after substantive security-sensitive code changes.

## T-SEC-LOCK — locked PAT owner recheck

- Owner: Codex security audit identified the race; a scoped agent implemented
  the fix; Codex lead reviewed and integrated it.
- Finding: a PAT could pass initial authentication, then its owner could be
  locked before `recheckGit`; the final read path checked repository access but
  not current user status.
- Fix: final recheck now requires `ACTIVE` for authenticated users on both reads
  and writes; anonymous public reads remain allowed. Tests cover a locked PAT
  member denied private read, an active private member, and anonymous public
  read.
- Evidence: regression failed before fix and passed after; focused spec passed
  3/3, backend typecheck/diff-check passed. Local commit `a49656d` is on
  `thviet`, not yet pushed.
- Semantics: if the final status check succeeds before a later lock, the
  already-authorized in-flight Git request may still complete. This is not a
  lock operation serialized across every repository's active Git children.

## T-ADMIN-A11Y — admin keyboard regression

- Owner: `/root/admin_a11y_test`; Codex lead reviewed/integrated.
- Committed and pushed as `cdb2d1f`; hosted run `40158529985` succeeded.
- Added `frontend/test/admin-accessibility.spec.ts` only. It checks keyboard
  traversal/activation of admin controls and confirmation-dialog focus entry,
  Escape close, and focus return at desktop and 375px widths.
- Evidence: focused Playwright run passed 2/2 and frontend lint passed on root
  `thviet` after integration. A concurrent Playwright/lint attempt briefly
  hit a transient missing `test-results` directory; serial rerun passed. This
  is automated keyboard coverage, not screen-reader or physical-device review.

## T-GAP — independent acceptance/WBS audit

- Owner: `/root/acceptance_gap_audit`.
- Status: complete (read-only).
- Changed paths: none.
- Result: identified the stale-ledger claims and produced prioritized task cards
  now reflected in `acceptance-task-board-2026-10-25.md`.
- Next: keep audit as a review input; implementation evidence still comes from
  tests, runtime checks, and current provider state.

## T-CI-55 — hosted backend E2E discrepancy

- Owner: Codex lead; `/root/ci_run55_triage` read-only.
- Status: unresolved; exact hosted failure requires authenticated GitHub logs.
- Branch/commit: `thviet`, `b51c88c` (`test: make repository lock fixture self-contained`).
- Evidence: GitHub run `40160123068` failed at backend E2E after 3m43s. Run
  `40159331450` for `b538c65` failed at the same visible step. GitHub shows
  only exit code 1; the Node/Ubuntu annotations are warnings. The logs page
  requires GitHub sign-in, which is not active in the browser session.
- Local evidence: full backend E2E passed 9 suites / 34 tests on isolated
  PostgreSQL 17 with global Git identity disabled; focused repository-lock
  E2E passed 2/2. This does not identify or clear the hosted failure.
- Changes: `b51c88c` sets explicit Git author identity in the new commit-tree
  fixture. Hosted run #55 still failed, so do not treat that fix as root cause.
- Next safe action: after the owner signs in interactively, inspect the exact
  failed E2E log and reproduce that case. No credentials were entered.

## T-MERGE-CRASH — actual child API crash boundary

- Owner: `/root/merge_crash_acceptance`; Codex lead reviews/integrates.
- Status: process-tree correction tried; focused E2E still fails and remains
  unaccepted/unpushed.
- Worktree/branch: `E:\Prj1-worktrees\merge-restart-acceptance`,
  `codex/merge-restart-acceptance`, base `9f1eb0b`.
- Owned file: `backend/test/pull-requests.e2e-spec.ts` only.
- Evidence: after process-tree kill, no host API/ts-node process remained, but
  the focused E2E failed after 73.4s because PostgreSQL retained one active
  advisory-lock waiter (`client_addr=172.17.0.1`, test-scoped application name)
  after a 60s natural-disappearance wait. This is consistent with Windows
  host-to-Docker TCP/NAT teardown behavior or unresolved harness semantics; it
  is not a passing process-crash proof.
- Stop condition: preserve the worktree and test container until the corrected
  Linux/CI or redesigned harness result is known. No success-path
  `pg_terminate_backend` was used; existing exact-PID cleanup fallback ran.
  Container `e74c3913a02b` is intentionally preserved pending the deferred
  Docker status check.

## T-COMPOSE — isolated local runtime smoke

- Owner: Codex lead; `/root/compose_runtime_isolation` read-only review.
- Status: runtime verified; test containers/network stopped; isolated volumes
  intentionally retained.
- Commit under test: `b51c88c`; Compose project
  `codeforge-smoke-20261025-b51c88c`.
- Evidence: project config bound ports only to loopback 4000/5433 and used new
  project-specific volumes. PostgreSQL became healthy; migration image applied
  all 7 migrations; backend Compose healthcheck was healthy and
  `GET /api/v1/health/ready` returned HTTP 200.
- Cleanup: `docker compose ... down` removed only that project's two
  containers and network, without `-v`; its new `git-data` and `postgres-data`
  volumes remain. Existing `peaceful_chaplygin` was not touched.

## T-ISSUE-AMBIGUOUS — operator recovery draft

- Owner: Codex lead; `/root/ambiguous_journal_design` read-only security/design
  review.
- Status: local draft prepared; not posted to GitHub.
- Artifact: `docs/operations/issue-draft-ambiguous-git-journals.md`.
- Finding: fail-closed unresolved push/merge journals can block writes
  indefinitely, but there is no supported operator resolution endpoint/tool.
  No confirmed vulnerability; this is a medium operational-availability gap.
  Existing issues #3–#5 remain open; draft says to confirm with the owner
  before opening a distinct issue and asks who may resolve/if dual approval is
  required.

## T-AGY-CI-LOCK — focused AGY read-only audit

- Owner: Codex lead dispatched one `agy_ask` with
  `dangerously_skip_permissions=false`; project wrapper pins
  `gemini-3.8-flash-medium`.
- Status: `timed_out` after 90 seconds; no usable output, no file changes.
- Next: do not infer a clean audit and do not retry blindly. Codex read-only
  review and isolated tests remain the evidence until AGY is operational.

## T-MAINT-GRACE — 120-second reconciliation acceptance gaps

- Owner: `/root/pending_reconcile_grace_tests`; Codex lead reviews/integrates.
- Status: review findings confirmed fixed and runtime-verified on `b51c88c`; no
  duplicate code changes were needed.
- Scope: assert the unit-query cutoff is 119–121 seconds old and that the
  `NEEDS_RECONCILIATION` OR branch has no `createdAt` constraint; add a real
  PostgreSQL E2E proving a newly created `NEEDS_RECONCILIATION` merge is
  processed immediately.
- Evidence: the unit test asserts 119–121 seconds and no `createdAt` on the
  `NEEDS_RECONCILIATION` query branch; focused unit passed 15/15. The full E2E
  file ran against isolated PostgreSQL in test-only container
  `codeforge-merge-crash-test-20261025` and passed 2/2: a recent
  `NEEDS_RECONCILIATION` operation changed to `REF_OUTCOME_UNKNOWN` on the
  first `runOnce()`, while a recent `PENDING` operation stayed pending.

## T-DOCKER-DEFERRED-CHECK — post-transfer read-only health check

- Owner: Codex lead.
- Status: checked after approximately five minutes; Docker is responsive.
- Evidence: `docker info` reports server 29.9.2, 2 containers, both running.
  `codeforge-merge-crash-test-20261025` is up on loopback port 49588 and
  `peaceful_chaplygin` remains running. No container was started, stopped, or
  modified by this health check; no volume was inspected or changed.
- Follow-up after this continuation's requested delay: `docker info` again
  reported server 29.9.2 and 2/2 running containers. `docker ps` showed the
  isolated test PostgreSQL up for 43 minutes on `127.0.0.1:49588->5432/tcp`
  and `peaceful_chaplygin` up for 2 hours. This was read-only; no container or
  volume was started, stopped, inspected, reset, or modified.

## T-VALID-PACK-LOCK-LOSS — in-flight receive-pack cancellation

- Owner: `/root/valid_pack_lock_loss_e2e`; Codex lead reviews/integrates.
- Status: integrated and verified on `thviet`; prior isolated worktree evidence
  is retained below as the implementation record.
- Worktree/branch: `E:\Prj1-worktrees\valid-pack-lock-loss`,
  `codex/valid-pack-lock-loss`, base `b51c88c`.
- Owned file: `backend/test/repository-lock.e2e-spec.ts` only.
- Design: generate a valid protocol-v0 receive-pack payload creating
  `refs/heads/feature/lock-loss` with the zero old OID; pause in a test-local
  `pre-receive` hook after pack unpack but before ref movement; terminate the
  exact lock-owning DB backend and assert cancellation/ref/session invariants.
- Evidence: disposable Linux runner on the isolated `code_forge_test` database
  reported `PASS` for the focused case (1/1, 3.233s); GitHttpService logged
  HTTP 503. The case passed hook PID exit, Git child SIGKILL, pool-session
  release, unchanged `main`, and absent feature-ref assertions. Backend
  typecheck, targeted ESLint and diff-check passed. Windows skips this
  POSIX-process-group case, so that skip is not treated as evidence.
- Security: independent read-only follow-up confirmed the prior protected-main
  issue is fixed and found no remaining actionable issue for the Linux target.
  AGY review timed out separately and is not counted as a pass.
- Integration: commit `c2b451f` was cherry-picked into `thviet` as
  `9c2eb81` (`test: cover valid receive-pack lock cancellation`) and pushed.
  Hosted workflow `40162474987` completed successfully on that exact SHA; the
  focused Windows E2E passed 2/2 with the POSIX-only test skipped, and backend
  typecheck/targeted ESLint passed locally. The focused Linux runner evidence
  above is the execution proof for the process-specific case.

## T-CI-9C2 — final hosted acceptance

- Owner: Codex lead.
- Status: passed and pushed.
- Branch/commit: `thviet`, `9c2eb8159cf110467f9e1562e16c5c4d75c68ebc`.
- Evidence: GitHub Actions run `40162474987` completed with `conclusion=success`.
  Backend unit, backend E2E, lint, typecheck, build, frontend E2E, full-stack,
  Docker API image smoke, migration image smoke, all 7 migrations, and diff
  whitespace steps passed.
- Historical note: runs `40159331450` and `40160123068` failed at backend E2E;
  their exact cause remains unknown. The later green run does not explain or
  retroactively change those results.

## T-AGY-VALID-PACK-REVIEW — independent AGY static audit

- Owner: Codex lead; AGY used Gemini 3.8 Flash Medium through the configured
  bridge, with `dangerously_skip_permissions=false`.
- Scope/worktree: read-only review of the one-file diff in
  `E:\Prj1-worktrees\valid-pack-lock-loss`.
- Status: timed out after 120 seconds with no usable review. Post-call
  `git status`, changed-path list and `git diff --check` show only the expected
  agent-owned test diff; AGY made no additional changes. Do not infer a pass or
  retry blindly; independent security review and Linux E2E evidence are
  recorded separately.

## T-SEC-VALID-PACK-REVIEW — independent test/security review

- Owner: `/root/valid_pack_test_security_review`; read-only.
- Status: complete read-only follow-up; prior finding resolved.
- Finding/resolution: the first diff targeted protected default branch `main`.
  The implementation now creates `refs/heads/feature/lock-loss` using the
  zero old OID, asserts main stays unchanged and the feature ref remains absent,
  and checks the hook process exits. Follow-up review found no remaining
  actionable issue for the Linux target. The reviewer did not run the Linux
  test; see the agent-reported runtime evidence above.

## T-MERGE-RESTART-E5 — replacement API startup reconciliation

- Owner: Codex lead with bounded test implementation and independent static
  review agents; leader owns integration.
- Status: implemented, typechecked, diff-checked, and pushed; Linux E2E result
  is pending inspection and the test is not yet accepted.
- Branch/commits: `thviet`, `e5eda1a` (`test: verify merge recovery after API
  restart`) plus `250ffdc` (`test: allow crash recovery E2E runtime margin`).
- Owned file: `backend/test/pull-requests.e2e-spec.ts` only.
- Acceptance target: kill a separate API process after Git moves the target ref
  but before PR metadata commits; prove its database sessions exit naturally;
  pause the surviving test process's scheduler; start a replacement API and
  prove its startup maintenance completes PR/journal metadata and one audit;
  retry the same operation without duplicate merge; verify fetch retains the
  two-parent commit.
- Verification performed: `corepack pnpm --filter backend typecheck` passed;
  `git diff --check` still passes after the timeout follow-up. Targeted ESLint
  reports only the existing
  `await-thenable` at line 507, unchanged from the base. The test is Linux-only
  because it uses PostgreSQL's client-connection check setting to observe the
  killed process socket. No local E2E, database, or Docker operation was run.
- Additional local regression evidence at HEAD `250ffdc`: `corepack pnpm
  --filter backend test` passed 17 suites / 111 tests. This is the backend unit
  suite only; it does not execute the new crash/restart E2E.
- Follow-up: `250ffdc` increases the Jest timeout from 119 seconds to 180
  seconds to provide runtime margin for the natural PostgreSQL-session exit and
  replacement startup. This changes no production behavior.
- Review: independent static review found and the implementation fixed a
  startup-failure child-process leak; follow-up review found no actionable
  process cleanup race. This is static evidence only, not runtime acceptance.
- CI: run `40164718122` for `e5eda1a` completed failure at the aggregate step
  `Run corepack pnpm --filter backend test:e2e:failure`. The exact failing test
  and cause are unknown until authenticated logs are inspected. Run
  `40164867636` for `250ffdc` is currently in progress. The latest verified
  green hosted run remains `40162474987` on ancestor `9c2eb81`.
- Next safe action: after the current run completes and authenticated logs are
  available, inspect the exact failing test and correct only from reproducible
  evidence. Do not infer a cause from the aggregate step name and do not
  force-terminate PostgreSQL sessions on the test's success path.

## T-AGY-CRASH-SECURITY-REVIEW — bounded read-only audit attempt

- Owner: Codex lead requested a bounded AGY review; AGY model is pinned by
  `scripts/agy.ps1` to `gemini-3.8-flash-medium`.
- Scope: read-only, plan-mode security review of the current merge
  crash/restart test; permission bypass was not enabled.
- Status: `timed_out` after 120 seconds with no usable output. No file changes
  resulted. This is not a successful audit and does not add security-review
  acceptance evidence.
- Next: do not retry this AGY task. Preserve the timeout as an unresolved
  review attempt; rely only on the separately recorded static review evidence
  and pending Linux runtime CI until new direction is given.

## T-AGY-MODEL-LOW — verify and pin a responsive local AGY model

- Owner: Codex lead; model check requested by user.
- Status: local model listing and wrapper smoke passed; no global AGY/MCP
  configuration or credentials changed.
- Evidence: `agy.exe models` listed Gemini 4 Argon, Gemini 3.8 Flash, Claude
  Opus 5.5, Claude Sonnet 5.5, and GPT-OSS 120B variants. A no-tools prompt
  with `gemini-3.8-flash-low` returned `AGY_MODEL_SMOKE_OK`; the project wrapper
  then returned `AGY_WRAPPER_READY` with its pinned model. Each invocation
  completed within the 30-second timeout.
- Change: `scripts/agy.ps1` now pins `gemini-3.8-flash-low`, and
  `docs/agy-plans/README.md` records the available model list and smoke result.
  The earlier Medium audit timeout remains classified as inconclusive; this
  smoke does not prove a full repository audit or MCP access.
- Next: use the wrapper only for bounded tasks; keep permission bypass off and
  do not retry the timed-out audit unless separately authorized with a new
  bounded scope.
