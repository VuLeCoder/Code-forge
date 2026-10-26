# Agent task execution log

Purpose: preserve evidence, errors, and exact next steps so another AI or a
future `/handoff` can continue without reconstructing undocumented state.
Never include credentials, tokens, cookies, database URLs, source code excerpts,
or private cloud values.
This is a chronological log: entries labeled **historical/superseded** are
snapshots, not current status. Current acceptance state is in the task board.

## T-CURRENT-RELEASE — latest verified release snapshot

- Owner: Codex release lead.
- Status: incomplete; this entry supersedes older current-state claims below.
- Branch/worktree: `thviet`, `E:\Prj1`, HEAD and `origin/thviet` both
  `4407e7d2e49d0e43aeb48b1e49ee96e986745a03`.
- Hosted evidence: GitHub Actions run [#92 / `40198015346`](https://github.com/VuLeCoder/Code-forge/actions/runs/40198015346)
  succeeded on that exact SHA.
- Cloud evidence: Render deployment of `4407e7d` failed startup with Prisma
  `P1001`. The sanitized connectivity probe reported DNS and TCP `ok`. Neon UI
  showed public internet enabled, `Any IP`, and IP allowlisting unavailable.
  This confirms only the observed DNS/TCP path; it does not establish database
  authentication or successful SQL queries. No migration or cloud smoke is
  claimed as passed.
- Diagnostic lead (not a confirmed root cause): Neon's [Prisma guide](https://neon.com/docs/guides/prisma)
  says scale-to-zero wake-up can cause P1001 and shows `connect_timeout=15`.
  A local unpushed candidate now uses a 15-second default, preserves explicit
  overrides, and adds an opt-in bounded PostgreSQL handshake probe. Focused
  focused tests pass (2 suites / 17 tests, including a stalled-server case),
  and the full backend unit suite passes (20 suites / 166 tests). Backend
  lint/typecheck/build and `git diff --check` pass. Read-only independent review
  found no actionable issue after inspecting the pinned `pg@8.23.1` timeout
  behavior. Push, Render deploy, and post-change DB/health verification remain
  pending; this is not yet a confirmed fix.
- Audit evidence: AGY static review timed out after 120 seconds with no usable
  result. Codex static security review reported no actionable finding in the
  reviewed scope and did not run dynamic tests.
- Open controls: P0–P8 are not complete; P2/P8 cloud release/recovery and
  remaining P3/P4 acceptance are open. Issue #6 remains fail-closed pending the
  owner authority/approval policy. Vercel is deferred/out of scope per the
  latest owner objective.
- Changed paths in this documentation task: `docs/implementation-status.md`,
  `docs/next-actions.md`, `docs/operations/acceptance-task-board-2026-10-25.md`,
  `docs/operations/task-execution-log-2026-10-25.md`, `docs/tasks/plan.md`,
  `docs/tasks/todo.md`, and `docs/remaining-work-breakdown.md`. No secrets,
  database URLs, or private cloud values are included.

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
- Status: published as open GitHub issue #6; API recheck on 2026-10-25 confirmed
  the issue is open.
- Artifact: `docs/operations/issue-draft-ambiguous-git-journals.md`.
- Finding: fail-closed unresolved push/merge journals can block writes
  indefinitely, but there is no supported operator resolution endpoint/tool.
  No confirmed vulnerability; this is a medium operational-availability gap.
  Issue #6 is [tracked here](https://github.com/VuLeCoder/Code-forge/issues/6);
  its authorization and approval design remains subject to the owner decisions
  recorded in `docs/next-actions.md`.

## T-AGY-CI-LOCK — focused AGY read-only audit

- Owner: Codex lead dispatched one `agy_ask` with
  `dangerously_skip_permissions=false`; project wrapper pins
  `gemini-3.8-flash-medium`.
- Status: `timed_out` after 90 seconds; no usable output, no file changes.
- Next: do not infer a clean audit from this timed-out Gemini attempt. A later
  separate AGY read-only review using `claude-sonnet-5-5-medium` completed with
  no blocking finding; see the alternative-model follow-up below.

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
- Status: run `40166811302` completed with failure on exact SHA
  `1209bca8cde9e3f594c6dc44036426a9e73f7ea6`. Its backend unit/E2E, lint,
  typecheck, and build steps passed. Frontend Playwright had 51 passed / 1
  failed: `frontend/test/admin-accessibility.spec.ts:7`, desktop case; Escape
  closed the dialog but focus was not restored to the opener button
  “Khóa tài khoản” (assertion line 54). Later full-stack, Docker image,
  migration, and diff-whitespace steps were skipped. The full hosted workflow
  was unaccepted at that time. The local frontend fix passed the full frontend
  E2E and focused spec, then was committed/pushed as `45cb1f4`. Replacement
  hosted run `40167861108` succeeded in 5m32s on exact SHA
  `24e6abc69cb947d575306134c362491bc96c93ad`.
- Branch/commits: `thviet`, `e5eda1a` (`test: verify merge recovery after API
  restart`) plus `250ffdc` (`test: allow crash recovery E2E runtime margin`).
- Owned file: `backend/test/pull-requests.e2e-spec.ts` only.
- Acceptance target: kill a separate API process after Git moves the target ref
  but before PR metadata commits; prove its database sessions exit naturally;
  pause the surviving test process's scheduler; start a replacement API and
  prove its startup maintenance completes PR/journal metadata and one audit;
  retry the same operation without duplicate merge; verify fetch retains the
  two-parent commit.
- Verification performed: authenticated runs `40164718122` on `e5eda1a`,
  `40164867636` on `250ffdc`, `40165071044` on `c98f548`, and `40165266658` on
  `f1fb835` all showed
  the child API transaction session still `active`, waiting on the test-owned
  advisory barrier after the 60-second wait. The test released that barrier
  only after waiting for the session, creating a circular wait; independent
  static triage and security review both localized the evidence to the test
  barrier, not the production lock pool. `b191165` releases the barrier before
  checking for natural session exit. Run `40166209913` then passed that
  crash/restart test but failed later in the same suite because the long PR
  fixture exhausted the registration endpoint's five-per-minute limit. A
  follow-up override of `APP_GUARD` did not take effect because Nest rewrites
  that enhancer token; run `40166484359` failed at the same later `429`.
  Commit `1209bca` replaces only the PR suite's throttler storage with a
  non-blocking test fixture while preserving the real guard; the separate
  `auth.e2e-spec.ts` rate-limit acceptance remains unchanged. Latest local
  backend typecheck passed; backend unit tests passed 17 suites / 113 tests.
  A separate PR-specific E2E was refused by its `_test` safety guard because
  `backend/.env` points to a non-test DB; do not count this as a test failure or
  integration result. The Linux-only crash case is skipped on Windows. Targeted ESLint
  still reports the pre-existing
  `await-thenable` at line 507, outside this edit. Docker Desktop responded;
  no container or volume was modified.
- Follow-up: `250ffdc` increases the Jest timeout from 119 seconds to 180
  seconds to provide runtime margin for the natural PostgreSQL-session exit and
  replacement startup. This changes no production behavior.
- Review: independent static review found and the implementation fixed a
  startup-failure child-process leak; follow-up review found no actionable
  process cleanup race. This is static evidence only, not runtime acceptance.
- CI: `40166209913` on `b191165` explicitly showed the crash/restart test
  passing, then failed at the next PR test with HTTP 429; `40166484359` on
  `75e9ec0` failed at the same later 429. On `1209bca`, run `40166811302`
  passed the complete backend E2E command, as well as backend unit, lint,
  typecheck, and build; frontend Playwright had 51 passed / 1 failed. The sole
  failure was the desktop Escape case in
  `frontend/test/admin-accessibility.spec.ts:7`: closing the dialog did not
  restore focus to “Khóa tài khoản” (assertion line 54). Later full-stack,
  Docker, migration, and diff-whitespace steps were skipped in this historical
  run. It was superseded by successful hosted run `40167861108` in 5m32s on
  exact SHA `24e6abc69cb947d575306134c362491bc96c93ad`.
- Local verification (latest): backend unit tests passed 17 suites / 113 tests;
  workspace typecheck, lint, and build passed; focused backend lock spec passed
  3/3; frontend Playwright passed 52/52; full-stack Playwright passed 3/3.
  Full-stack used the dedicated existing `codeforge-merge-crash-test` database
  `code_forge_test` on loopback port 49588; only the harness random schema and
  temp Git root were created/cleaned, with no Docker volume reset/deletion. The
  separate PR-specific E2E was refused by its `_test` safety guard because
  `backend/.env` points to a non-test DB; it is not a test failure or integration
  result. Frontend/repository-lock code fixes are committed and pushed as
  `45cb1f4` and `896575c`; Markdown consolidation/status edits remain local,
  uncommitted, and unpushed.
- AGY review: Gemini 3.8 Flash timed out at 180 seconds and is not counted as a
  successful audit. AGY model listing showed Gemini 4 Argon, Gemini 3.8 Flash,
  Claude Opus/Sonnet 5.5, and GPT-OSS 120B. A separate read-only
  `claude-sonnet-5-5-medium` review completed in 75 seconds with no blocking
  finding; Nemotron Ultra also found no blocker. These reviews do not replace
  hosted CI.
- Hosted CI disposition: run `40167861108` succeeded in 5m32s on pushed SHA
  `24e6abc69cb947d575306134c362491bc96c93ad`. Keep P3/P4 remaining matrix
  work open. Never use
  `pg_terminate_backend` as success-path evidence.

## T-LOCK-SERVICE-FOLLOWUP — reproduced local regression and fix

- Owner: Codex lead.
- Status: a repository-lock service finding was reproduced RED, fixed, and
  committed/pushed as `896575c`; it was independently reviewed by Codex
  security reviewer, Nemotron Ultra via Continue CLI, and AGY
  `claude-sonnet-5-5-medium`, with no blocking finding.
- Local acceptance evidence: backend unit tests passed 17 suites / 113 tests;
  workspace typecheck, lint, and build passed; focused backend lock spec passed
  3/3; frontend Playwright 52/52 and full-stack Playwright 3/3 passed. Full-stack
  used the dedicated existing test DB and only a random schema/temp Git root;
  no Docker volume was reset or deleted. The PR-specific E2E was refused by the
  `_test` guard because `backend/.env` points to a non-test database; no failure
  or integration result is claimed. These are local results, not hosted CI.
- Review: Gemini 3.8 Flash timed out and is not counted. One AGY read-only
  `claude-sonnet-5-5-medium` review completed in 75 seconds with no blocking
  finding; Nemotron Ultra and Codex security reviewer also found no blocker.
- Hosted follow-up: run `40167861108` succeeded in 5m32s on pushed SHA
  `24e6abc69cb947d575306134c362491bc96c93ad`. Keep remaining P3/P4
  failure-matrix cases open. Markdown consolidation/status edits remain local
  and were not included in that run.

## T-AGY-CRASH-SECURITY-REVIEW — bounded read-only audit attempt

- Owner: Codex lead requested a bounded AGY review; AGY model is pinned by
  `scripts/agy.ps1` to `gemini-3.8-flash-medium`.
- Scope: read-only, plan-mode security review of the current merge
  crash/restart test; permission bypass was not enabled.
- Status: `timed_out` after 120 seconds with no usable output. No file changes
  resulted. This is not a successful audit and does not add security-review
  acceptance evidence.
- Next: do not retry this AGY task. Preserve the timeout as an unresolved
  review attempt; rely only on separately recorded static review evidence and
  hosted backend E2E results. Run `40166811302` passed the backend E2E gate but
  failed later at frontend E2E; neither result is an AGY audit.

- Follow-up: after the exact CI failure was identified, one smaller
  plan-mode review on Gemini 3.8 Flash Medium was attempted with a 180-second
  print timeout. It returned no usable output. This remains `timed_out`, not a
  successful audit; it was not retried. Independent Codex static triage and
  security review found no confirmed exploitable vulnerability; neither review
  substitutes for hosted runtime evidence. Run `40166811302` passed backend
  E2E but failed later at frontend Playwright; overall workflow acceptance
  remains incomplete.

- Later bounded AGY review: Gemini 3.8 Flash timed out at 180 seconds with no
  usable output and is not counted as an audit pass. A separate repository-lock
  fix was independently reviewed by Codex security reviewer and Nemotron Ultra
  via Continue CLI; both found no blocking issue. This does not change the
  failed status of hosted run `40166811302` on old SHA `1209bca`.

- Alternative-model follow-up: the AGY CLI model list included Gemini 4 Argon,
  Gemini 3.8 Flash, Claude Opus 5.5, Claude Sonnet 5.5, and GPT-OSS 120B. A
  single read-only `claude-sonnet-5-5-medium` review completed in 75 seconds
  with no blocking finding on the repository-lock change. This makes AGY usable
  through that alternative model for this bounded review; it does not convert
  the Gemini timeout into a pass or change hosted CI status.

## T-AGY-MODEL-TIERS — verify and select local AGY model effort

- Owner: Codex lead; model check requested by user.
- Status: local model listing plus low/medium/high smoke prompts passed both
  directly and through the project wrapper. Wrapper default is Medium, with
  explicit low/medium/high effort for task-specific selection. No global
  AGY/MCP configuration or credentials changed.
- Evidence: `agy.exe models` listed Gemini 4 Argon, Gemini 3.8 Flash, Claude
  Opus 5.5, Claude Sonnet 5.5, and GPT-OSS 120B variants. No-tools prompts for
  Gemini 3.8 Flash low/medium/high each returned `AGY_MODEL_SMOKE_OK` within
  their 30-second limits. Wrapper default Medium, `-Effort high`, and
  `-Effort low` each returned their expected response within 30 seconds.
- Historical state at this entry: `scripts/agy.ps1` selected only Gemini 3.8 Flash tiers, defaulting to
  Medium, and accepts `-Tier low|medium|high`. AGY rejects a mismatched CLI
  `--effort` (for example, model High with effort Low); the wrapper now rejects
  that combination clearly, accepts matching values, and rejects arbitrary
  `--model` overrides. `docs/agy-plans/README.md` records the available model
  list and task-specific tier guidance. The earlier 120-second Medium audit
  timeout remains inconclusive; prompt smoke does not prove full repository
  audit or MCP access.
- Next: use the wrapper only for bounded tasks; use `-Tier high` for complex
  review or architecture, Medium for normal implementation, and `-Tier low`
  for quick checks.
  Keep permission bypass off. The timed-out audit itself remains incomplete.

## T-LOCAL-IMAGE-SMOKE — candidate Docker image runtime contents

- Owner: Codex lead; local smoke only.
- Status: candidate images built with unique local tags
  `code-forge-api:codex-local-20261025` and
  `code-forge-migrate:codex-local-20261025`.
- API image checks: verified Git 2.39.5, executable `pre-receive` hook, and
  Prisma client availability inside the container.
- Migration image checks: verified Prisma 6.19.3 and Prisma client resolution.
  No database migration was applied. No Docker volumes were reset or deleted.
- Scope: this is local image/content smoke, not the skipped hosted Docker or
  migration gates in failed run `40166811302`, and not release acceptance.

## T-AGY-GEMINI4-SMOKE — one-off model responsiveness

- Owner: Codex lead; bounded direct CLI smoke.
- Evidence: direct `gemini-4-argon-medium` prompt returned
  `AGY_GEMINI4_OK` within 30 seconds.
- Interpretation: confirms the model responds to a short prompt only; it is
  not a code review or security audit. At the time of this smoke, the project
  wrapper remained pinned to Gemini 3.8 Flash Medium. The prior Gemini 3.8 Flash review timeout remains
  uncounted; the separate successful Claude Sonnet Medium review is recorded
  above.

## T-PR-LIFECYCLE-AND-NO-MERGE-BASE — isolated regression evidence

- Owner: Codex lead; test execution and independent bounded review.
- Evidence: PostgreSQL HTTP E2E for “PR author and repository owner update
  lifecycle state while denying other WRITE members” passed 1/1 in a newly
  created tmpfs-only PostgreSQL test container. Container removal was verified;
  no volumes were used or removed. Backend full typecheck passed.
- Evidence: real-Git storage suite passed 20/20, including unrelated branch
  histories returning `NO_MERGE_BASE` without moving refs. `git diff --check`
  passed for the tested changes.
- Review scope: an earlier AGY `gemini-4-argon-medium` Medium read-only review
  covered the PR lifecycle test plus the then-current Git compare test and
  reported no actionable findings. It did not cover the later storage-reset
  E2E; AGY did not execute tests. This is separate from the later Gemini 3.8/
  Gemini 4 PR-slice timeouts recorded in the latest verification entry.
- Scope: these are local targeted test results, not evidence of cloud release
  or completion of the remaining P3/P4 matrix. The Markdown documentation
  updates are uncommitted/unpushed and are not part of hosted run `40167861108`.

## T-AGY-DEFAULT-MODEL — current wrapper selection

- Current decision: default to Gemini 3.8 Flash Medium. The user reports its
  quota resets hourly, while Gemini 4 Argon resets weekly; prioritize the more
  frequently replenished quota. Use Gemini 4 Argon Medium only as a bounded
  fallback after a scoped Gemini 3.8 call times out. The earlier broad Gemini
  3.8 review timeout does not imply every scoped task should skip 3.8.
- The wrapper accepts Gemini 3.8 Flash, Gemini 4 Argon, Claude Sonnet 5.5, and
  Claude Opus 5.5 families; default is Gemini 3.8 Flash Medium. Claude selection
  is intentional via `-Family claude-sonnet-5-5` or `-Family claude-opus-5-5`.
  Gemini 4 is the explicit fallback via `-Family gemini-4-argon`; user preference
  is 3.8 first, Claude only when intentionally selected/available, and Gemini 4
  after an observed Claude quota error. There is no quota-balance field to
  pre-check. Tier selection remains `-Tier low|medium|high`; arbitrary model
  overrides remain rejected.
- Review evidence remains distinct: the bounded `gemini-4-argon-medium`
  review of the PR lifecycle test plus then-current Git compare test completed
  in about 40 seconds with no actionable findings; it did not cover the later
  storage-reset E2E, and AGY did not run those tests. Gemini 3.8 broad-review
  attempts timed out and are not counted as audits.
- The earlier default-family smoke returned `AGY_GEMINI4_WRAPPER_OK` before
  the latest default was changed back to Gemini 3.8. A later bounded review
  invoked the current wrapper default (`gemini-3.8-flash-medium`) and returned
  `NO_ACTIONABLE_FINDING`; this verifies the default invocation, though it is
  not a standalone no-tools smoke.
- Scope: current wrapper/docs changes are local and not included in pushed
  code SHA `24e6abc` or hosted run `40167861108`.

## T-PR-E2E-AND-AGY-3.8 — latest bounded verification

- Backend unit: 17 suites / 114 tests passed.
- PR E2E: full suite passed 6/6 using isolated tmpfs-only PostgreSQL. The
  Linux crash/restart test was skipped on Windows and is not counted as a
  local pass. This supersedes the earlier safe refusal by the `_test` guard
  when `.env` targeted a non-test database.
- AGY current-default review: `gemini-3.8-flash-medium` with
  `--disable-slash-commands` reviewed only `git-storage.service.spec.ts` and
  returned exact output `NO_ACTIONABLE_FINDING` (successful narrow review).
- Larger PR review status is terminal: the two-test slice of
  `pull-requests.e2e-spec.ts` timed out at 45s on Gemini 3.8 Medium; one exact
  bounded Gemini 4 Medium fallback timed out at 60s. Neither returned usable
  findings; there were no further retries and neither is an audit pass.
- Separate earlier evidence: Gemini 4 Argon Medium's read-only review of the
  PR lifecycle test plus then-current Git compare test completed with no
  actionable findings. It did not cover the later storage-reset E2E. Prior
  broad Gemini 3.8 review timeouts remain unsuccessful attempts.
- Scope: targeted local acceptance only; cloud release and remaining P3/P4
  matrix remain open. These documentation changes are not committed/pushed.

## T-PUSHED-TESTS-A71 — historical snapshot (superseded by be99b55)

- Source: branch `thviet` and `origin/thviet` point to exact SHA
  `a71a2f021c1d6ef2a3bad7983a1805dcd4f2b75e`, commit
  `test: cover PR lifecycle and storage reset`. It contains the PR lifecycle
  and storage-reset backend test additions plus `scripts/agy.ps1` routing and
  default changes.
- Hosted status: workflow `40169100366` (MVP verification #67) is currently
  `In progress`. It has no terminal result yet. The last terminal green run,
  `40167861108`, succeeded on predecessor SHA
  `24e6abc69cb947d575306134c362491bc96c93ad`; do not attribute that pass to
  `a71a2f0`.
- Local verification after test additions: backend unit 17 suites / 114 tests;
  Git storage suite 20/20; full PR PostgreSQL/Git E2E 6/6, with the Linux
  crash/restart test skipped on Windows; backend typecheck; PowerShell parser
  and invalid-family guard; `git diff --check` all passed.
- The documentation consolidation/status edits remain local and were not part
  of SHA `a71a2f0`. Hosted CI remains pending; cloud release remains
  unverified.

## T-PR-COMPARE-BOUNDS — commit be99b55, CI newly triggered

- Source: `thviet` and `origin/thviet` point to exact SHA
  `be99b5509b760258a7b391b3b2f91dd972fcba32`, commit
  `feat: bound pull request diffs per file`.
- Behavior: PR compare reports per-file `TEXT`, `BINARY`, `TRUNCATED`, or
  `UNAVAILABLE`; maximum 128 KiB per file, 1 MiB aggregate, and 15 seconds
  overall.
- Local verification on this change: backend unit 17 suites / 115 tests;
  backend typecheck; frontend lint/typecheck; Git-storage real tests 21/21.
- Hosted workflow for this SHA was just triggered; its terminal result has not
  been verified. Previous green/in-progress runs belong to earlier SHAs.
- The documentation updates remain local/uncommitted and are not part of
  `be99b55`. Cloud release remains unverified.

## T-PR-COMPARE-LOCK-POOL — commit 94ceb6f, hosted status unchecked

- Source: `thviet` and `origin/thviet` point to exact SHA
  `94ceb6fdb090c1632c53de0ec96e8a975f9a265d`.
- Change: compare requests are capped at two concurrent operations per
  process and endpoint rate-limited to 10 requests/IP/minute. A regression
  test verifies that a third concurrent request is rejected before lock
  acquisition.
- Local gates: backend unit 17 suites / 116 tests; backend lint/typecheck;
  frontend lint/typecheck; Git-storage real tests 21/21.
- Hosted history: workflow #68 / `40169475724` failed on predecessor SHA
  `be99b5509b760258a7b391b3b2f91dd972fcba32` at backend lint in
  `git-storage.service.spec.ts:260` (`no-unsafe-assignment`). The lint issue
  was corrected in `045f5c1`; CI for `94ceb6f` has not been checked and is not
  assumed green.
- Review evidence: Gemini 3.8 audit timed out after 90 seconds with no usable
  result. Gemini4 fallback invocation used unsupported flags and produced no
  completed review. Neither counts as an audit pass. A human security
  subagent identified moderate denial-of-service risk; the concurrency and
  rate-limit mitigation is committed.
- Documentation updates remain local/outside the pushed SHA. Cloud release
  remains unverified.

## T-PR-PAGINATION — commit 41c23ec, hosted CI failed

- Source: `thviet` and `origin/thviet` point to exact SHA
  `41c23eca31823b9f12dc93924699d873120b0788`.
- Local gates passed: backend PR E2E 6/6 (Linux-only crash test skipped on
  Windows), GitStorage real-Git 21/21, frontend pulls/proxy Playwright 15/15,
  backend/frontend lint and typecheck, and `git diff --check`.
- Hosted run #70 / `40170763221` failed on this SHA: frontend Playwright 53/55;
  desktop and narrow admin accessibility tests failed the Escape focus-return
  assertion at `frontend/test/admin-accessibility.spec.ts:54`. `[WebServer]`
  also logged `Không thể tải hồ sơ lúc này`. Full-stack, Docker, migration,
  and diff-whitespace stages were skipped after that failure.
- Distinction: run #69 / `40170013908` was on predecessor `94ceb6f` and failed
  the same admin flow at a different dialog-visibility assertion. The current
  admin fix agent is reproducing in an isolated worktree; no fix is verified.
  These local results do not complete P4 acceptance or cloud release
  acceptance. Documentation edits remain local/outside the pushed SHA.

## T-AMBIGUOUS-JOURNAL-RESOLUTION — commit 1e8736c, pushed to origin/thviet

**Superseded on 2026-10-25 by revert `4b7eaed`:** this implementation is no longer present and must not be treated as current or accepted. Per the owner's choice to defer operator resolution and preserve fail-closed behavior, Issue #6 remains open. Review found that `MARK_FAILED` / `RETRY_RECONCILE` did not establish safe resolution for ambiguous evidence, the retry audit was not atomic with reconciliation, and free-text reasons could enter audit records. Revisit only after the authorization/approval policy and security contract are approved.

- Source: `thviet` and `origin/thviet` point to exact SHA
  `1e8736ce3b4fe765c9b63481aa3a18a09f874287`, commit
  `feat(admin): implement audited resolution workflow for ambiguous Git journals (Issue #6)`.
- Implemented behavior:
  - Added `AdminUnresolvedQueryDto` and `AdminResolveOperationDto` to `backend/src/admin/admin.dto.ts`.
  - Added routes in `AdminController`:
    - `GET /admin/operations/unresolved` to list unresolved operations across repositories with pagination, filtering, non-sensitive projection.
    - `GET /admin/operations/:id` to inspect safe metadata (excluding private refs, commit messages, secrets).
    - `POST /admin/operations/:id/resolve` with `@UseGuards(OriginGuard)` to resolve PUSH or MERGE operations via `MARK_FAILED` or `RETRY_RECONCILE`.
  - Resolution executes under `RepositoryLockService.acquire(repositoryId)` exclusive advisory lock.
  - Fail-closed rules enforced: operations are never deleted; Git refs are never rolled back; atomic transaction writes `AdminAuditLog` (`action: ADMIN_OPERATION_RESOLVED`).
  - Made `reconcileOne` in `GitPushJournalService` and `reconcileOperation` in `MaintenanceJobsService` public.
  - Exported `MaintenanceJobsService` from `MaintenanceModule` and imported into `AdminModule`.
- Verification evidence:
  - Backend unit test suite: 19 suites / 133 tests passed in 41.6s.
  - Focused spec `admin.service.spec.ts`: 8/8 passed.
  - Workspace typecheck (`corepack pnpm typecheck`) passed cleanly.
  - Workspace lint (`corepack pnpm lint`) passed with 0 errors, 0 warnings.
  - `git diff --check` passed.
  - Pushed to `origin/thviet`.

## T-MAINTENANCE-PURGE-JOURNAL-RETAIN — commit 027751b, pushed to origin/thviet

- Source: `thviet` and `origin/thviet` point to exact SHA `027751b`, commit `test(maintenance): assert purge retains expired storage while merge journal needs reconciliation`.
- Scope: P4/P6 invariant in `backend/test/maintenance-cleanup.e2e-spec.ts`.
- Behavior verified:
  - `RepositoryPurgeService.purgeDue()` refuses to purge soft-deleted repositories that have an active or unresolved merge operation (`NEEDS_RECONCILIATION`), preserving filesystem bare Git storage and repository records.
  - Once the blocking journal transitions to a terminal state (`FAILED`), subsequent purge invocations successfully purge the repository and delete the storage directory.
- Verification evidence:
  - Isolated PostgreSQL container `codeforge-merge-crash-test-20261025` on loopback port 49588 (`code_forge_test`).
  - `jest test/maintenance-cleanup.e2e-spec.ts`: 3/3 passed in 5.92s.
  - `jest test/pull-requests.e2e-spec.ts`: 7 passed, 1 skipped in 42.87s.
  - Full backend unit suite: 19 suites / 132 tests passed in 44.93s.
  - Workspace typecheck (`corepack pnpm typecheck`): 0 errors.
  - Workspace lint (`corepack pnpm lint`): 0 errors, 0 warnings.
  - `git diff --check`: 0 errors.
  - Pushed to `origin/thviet`.

## T-GIT-HTTP-TIMER-OPEN-HANDLE — commit 1b0901b, pushed to origin/thviet

- Source: `thviet` and `origin/thviet` point to exact SHA `1b0901b`, commit `fix(git-http): unref process timer and clear on stop to prevent open handles`.
- Scope: Backend Git HTTP streaming handler in `backend/src/repositories/git-http.service.ts`.
- Root cause diagnosis:
  - When Git push operations fail or trigger reconciliation in E2E tests (e.g. `push-audit.e2e-spec.ts`), `git-http.service.ts` calls `stop()`.
  - Previously, `stop()` set `stopped = true` but did not invoke `cleanup()`, leaving the 60,000 ms process timeout active in the Node.js event loop without `.unref()`.
  - This caused Jest to hang with `Jest did not exit one second after the test run has completed` after running `push-audit.e2e-spec.ts`.
- Fix applied:
  - Invoked `cleanup()` inside `stop()` to immediately cancel the timer and detach abort listeners.
  - Called `timer.unref()` on timer creation so the timer never prevents the process from cleanly exiting.
- Verification evidence:
  - `push-audit.e2e-spec.ts` executed without `--forceExit` and exited cleanly in 11.29s (exit code 0).
  - All 9 backend E2E suites verified against isolated PostgreSQL container on loopback port 49588: 39 passed, 2 skipped (Windows process harness).
  - `git-http.service.spec.ts`: 8/8 passed.
  - Full backend unit suite: 19 suites / 132 tests passed in 38.11s.
  - `corepack pnpm typecheck`: 0 errors.
  - `corepack pnpm lint`: 0 errors, 0 warnings.
  - `git diff --check`: 0 errors.
  - Pushed to `origin/thviet`.

## T-AGY-ADMIN-RESPONSIVE — plan commit 24e8d85; implementation timed out

- Scope: admin responsive/accessibility task in `docs/agy-plans/2026-10-25-admin-frontend-responsive.md`; local Antigravity skill created at `C:\Users\ADmin\.gemini\config\skills\codeforge-admin-responsive\SKILL.md`.
- Plan commit `24e8d85` was pushed to `origin/thviet`. Implementation ran in isolated worktree `E:\Prj1-worktrees\agy-admin-responsive`, branch `codex/agy-admin-responsive`, using Gemini 3.8 Flash Medium with permission bypass disabled.
- Bridge job `102280b4ddec421c82a3b6f2613d9673` terminated as `FAILED` with `agy timed out after 300.0s`. The assigned worktree was checked after termination and had no changed files. No retry was made.
- The user later said AGY had been started to code; no separate job or file changes were observable in the assigned worktree at the next check. Do not start another job against this worktree until its state is rechecked.
- Next safe action: continue the user-requested backend tasks; retain this AGY task as timed out, not accepted.

## T-PUSH-PURGE-UNRESOLVED-JOURNAL — commit 6f09ddf, local integration verified

- Worktree: `E:\Prj1-worktrees\push-purge-acceptance`; agent commit `f416fec` was reviewed and cherry-picked onto `thviet` as `6f09ddf`.
- Owned path: `backend/test/maintenance-cleanup.e2e-spec.ts` only. The test proves purge preserves a deleted repository and Git storage while either a `PENDING` or `NEEDS_RECONCILIATION` push journal remains unresolved, and purges only after both become terminal.
- Agent verification: focused maintenance E2E 1 suite / 4 tests, backend typecheck, and `git diff --check` passed. Test used the dedicated loopback `code_forge_test` DB with a random schema and test-owned temporary Git directory; no `.env`, other DB, container, or volume was touched.
- Leader rerun after integration: `corepack pnpm --filter backend exec jest --config test/jest-e2e.json --runInBand test/maintenance-cleanup.e2e-spec.ts` passed 1 suite / 4 tests (exit 0). Expected warning logs show purge deferral while merge/push journals are unresolved.
- Not pushed yet. Next: include this code commit in the verified backend batch after the remaining review/test commits pass.

## T-MERGE-OWNER-LOCK-RACE — commit 364f854, local integration verified

- Worktree: `E:\Prj1-worktrees\merge-lock-user-state`; agent commit `545db83` was reviewed and cherry-picked onto `thviet` as `364f854`.
- Owned path: `backend/test/pull-requests.e2e-spec.ts` only. The test holds the repository advisory lock, waits until a real merge request is queued, locks the owner, then releases the lock and verifies the merge is rejected with HTTP 403, refs unchanged, PR still OPEN, and no merge operation or success audit.
- Agent verification: focused E2E passed (1 test; 8 skipped by test-name filter), backend typecheck, lint, and `git diff --check` passed. Test used only the dedicated loopback test database with a random schema and test-owned temporary Git path; no `.env` or credentials were printed/persisted.
- Leader rerun after integration: focused owner-lock E2E printed 1 passed / 8 intentionally skipped; an explicit `JEST_EXIT=0` was captured. The surrounding PowerShell wrapper still returned exit 1 during cleanup, so wrapper status is recorded as a harness issue and not as a clean command exit.
- The root rerun confirms the test body passes. The wrapper cleanup status caveat above remains; agent run had a clean exit. Not pushed yet.

## T-PRE-RECEIVE-BRANCH-LIMIT — commit 89962e3, local integration

- Worktree: `E:\Prj1-worktrees\pre-receive-branch-limit`; agent commit `52d09e9` was reviewed and cherry-picked onto `thviet` as `89962e3`.
- Owned path: `backend/src/repositories/pre-receive-hook.spec.ts` only. The test builds 999 branches, verifies creation of branch 1,000 is accepted, then verifies branch 1,001 is rejected and the ref set is unchanged.
- Verification: focused hook spec 5/5, backend typecheck, lint, and `git diff --check` passed; an independent read-only review found no actionable finding. No database/container used.
- Not pushed yet; root will rerun focused unit verification in the integrated tree.

## T-PUSH-CHILD-SUCCESS-PROOF — commit 8d9caa9, local integration

- Worktree: `E:\Prj1-worktrees\issue5-partial-push-audit`; agent commit `7a9ca90` was reviewed and cherry-picked onto `thviet` as `8d9caa9`.
- Scope: `git-http.service.ts` and its spec, `git-push-journal.service.ts` and its spec. Receive-pack completion/audit now requires a durable child-success marker; failed, unknown, and legacy rows without that proof remain unresolved and fail-closed. A retryable reconciliation error preserves the child-outcome evidence.
- Verification in agent worktree: 2 focused unit suites / 37 tests; backend typecheck, lint, and `git diff --check` passed. Independent static review found no actionable finding.
- Leader integrated rerun: `push-audit.e2e-spec.ts` passed 1/1 with explicit `JEST_EXIT=0` against the dedicated loopback test DB. Full backend unit suite also passed 19 suites / 154 tests; backend typecheck and lint passed.

## T-PURGE-NEEDS-ONLY-REGRESSION — commit 370a6a7, local integration

- Worktree: `E:\Prj1-worktrees\purge-needs-only`; agent commit `0e7c729` was reviewed and cherry-picked onto `thviet` as `370a6a7`.
- Owned path: `backend/test/maintenance-cleanup.e2e-spec.ts` only. This closes the review gap by isolating `NEEDS_RECONCILIATION` as the only unresolved push journal, proving purge retains the repository/storage, then terminalizing the journal and proving purge proceeds.
- Static verification: Prisma client generation, backend typecheck/lint, direct ESLint, and diff-check passed; independent review had identified the gap, and the revised test covers it.
- Leader integrated rerun: `maintenance-cleanup.e2e-spec.ts` passed 4/4 with explicit `JEST_EXIT=0`; expected warnings show purge is deferred while journals remain unresolved. Not pushed yet.

## T-PUSH-DELETE-RACE — commit c5bf02a, local integration verified

- Worktree: `E:\Prj1-worktrees\push-delete-race`; agent commit `c5882cd` was reviewed and cherry-picked onto `thviet` as `c5bf02a`.
- Owned path: `backend/test/repositories.e2e-spec.ts` only. A valid receive-pack is paused in pre-receive, DELETE is observed waiting on the same repository advisory lock, push completion/audit/ref are checked before deletion, and a subsequent push is denied with refs/audit unchanged.
- Verification: focused E2E passed 1 test / 13 intentionally skipped; backend typecheck, lint, and `git diff --check` passed. A read-only review found no actionable finding.
- Test-harness caveat: two earlier E2E setup attempts may have left empty random `repo_test_*` schemas in the dedicated test database. Their names/ownership were not captured, so none were deleted. Application data and Docker volumes were not touched.
- Not pushed yet.

## T-AUTH-LOGOUT-REFRESH-RACE — P2 finding, remediation in progress

- Read-only auth review found that if refresh rotates an active token before a concurrent logout processes the old token, current logout revokes only the old row and can leave the new session active in the same family.
- Root verified the code path in `AuthService.refresh()` and `logout()`; this is a security finding, not yet a runtime reproduction.
- Remediation/test task assigned in an isolated worktree: serialize logout with refresh on the user-row lock; revoke the token family associated with the supplied token; add deterministic service and E2E regression coverage.
- Root integrated implementation and tests as `6d8c827`/`da020f9`; agent unit suite 11/11, backend typecheck/lint and diff-check passed. The 19-suite backend unit run now passes 156/156; backend typecheck and lint also pass on integrated `thviet`.
- Root E2E found the fixture's raw node `pg` connection ignored Prisma's `schema=` option; this was corrected. Final serial rerun remained 8/9: refresh queued behind the user-row barrier, but logout did not appear as a second waiter and both handlers emitted sanitized errors. The old waiter-count variant is not accepted; agent stopped further DB retries.
- Independent review found the E2E setup lacked a guard against non-loopback/non-`_test` databases. The isolated follow-up adds a guard for both URLs and validates they target the same loopback test DB; backend typecheck, file lint and diff-check pass. It remains uncommitted in `E:\Prj1-worktrees\logout-refresh-family`.
- Independent security review found no confirmed production defect in the family-revocation fix, but confirmed the test observer cannot attribute connections from one shared Prisma pool. A separate test-only real-Postgres `AuthService` concurrency E2E with two uniquely named clients is in progress; no DB run starts until the current bootstrap E2E finishes.
- Not accepted until E2E passes; production fix is present locally on `thviet`, not pushed.

## T-AGY-ADMIN-RESPONSIVE — correction pending accessibility review

- AGY reported success in `E:\Prj1-worktrees\agy-admin-responsive` with only the three planned frontend files changed. Root reran frontend lint/typecheck and Playwright (4/4) successfully at 1280×800 and 375×812; `git diff --check` passed.
- Independent review found a screen-reader semantics gap: narrow CSS uses `display:none` on the only table header row while visible labels are CSS-generated. The change is not accepted yet.
- A bounded corrective AGY job was started in the same worktree with `dangerously_skip_permissions=false`, same three-file ownership and no commit/push permission; job id `1ac37ca652584bb4acc8b1f3` completed without fixing the issue. Current diff still has `display:none` and tests do not assert accessible column headers. Per user preference, Codex provided a precise prompt for the user to send; no further AGY job was dispatched. Not accepted/integrated.

## T-STORAGE-RECOVERY-E2E-ASSERTION — commit 71a0c48, local integration

- Independent static review found the recovery E2E asserted the recreated Git `HEAD` but omitted the repository/API `defaultBranch` metadata.
- Added `defaultBranch: 'main'` to both response and database assertions in `backend/test/repositories.e2e-spec.ts`; integrated as `71a0c48` on `thviet`.
- `git diff --check` passed in the agent worktree. Root reran `repositories.e2e-spec.ts -t "serializes completed push before missing-storage recovery"` serially; 1 passed, 14 intentionally skipped, exit 0. It verifies the push journal/audit/ref are durable before storage loss, recovery waits behind the repo lock, API/DB retain default branch `main`, generation increments 0→1, and recreated Git HEAD is `refs/heads/main`.

## T-ADMIN-BOOTSTRAP-IDEMPOTENCE — local integration verified

- Read-only security review of `0587f3f` found no secret-output or privilege-promotion defect. Password is read from stdin, hash is Argon2id, and audit mutation is transactional.
- Remaining low-severity coverage gap: invoking bootstrap for an account already ADMIN should prove no password/state/audit mutation on repeat.
- A test-only E2E was added in commit `4b43f71` (`backend/test/admin-bootstrap.e2e-spec.ts` only), after redaction commit `19a908c`. The agent's first harness attempt used the wrong test DB username and failed before schema creation; after correcting it to the dedicated `code_forge` user, agent and leader each verified the suite 4/4 on loopback `code_forge_test`. Password input remains stdin-only, repeated bootstrap leaves role/status/password and audit unchanged. No external DB or Docker volume was touched.

## T-AUTH-SERVICE-CONCURRENCY-E2E — commit d7435ca, first integrated run failed

- Replaced the unreliable shared HTTP-pool waiter observation with a separate real-PostgreSQL `AuthService` E2E using independently named Prisma clients, per-operation barrier waiter checks, and a loopback `_test` guard.
- Test-only commit `d7435ca` adds `backend/test/auth-session-concurrency.e2e-spec.ts`; static typecheck, direct ESLint, and file diff-check passed.
- Leader's first focused run failed to observe `auth-refresh-*` as a waiter. A second bounded diagnostic run confirmed app name and schema identity, then showed PostgreSQL reports the blocked refresh connection as `state=idle`, `wait_event_type=Lock`, with the barrier PID in `pg_blocking_pids`. The `state='active'` predicate was too strict. A one-line observer correction (remove that predicate, keep app name/lock/barrier checks) is in progress; one targeted run and then the full auth suite are the remaining gates.

## T-RENDER-NEON-P1001 — local configuration audit

- Read-only audit confirms the API image installs Git, copies built output and Prisma assets, runs non-root and binds `0.0.0.0:$PORT`; migration image contains Prisma CLI/schema and invokes `prisma migrate deploy`.
- Prisma runtime `DATABASE_URL` is pooled; `DATABASE_URL_UNPOOLED` is direct for migrations and session advisory locks. No tracked Render blueprint was found; dashboard settings are not verified.
- Render P1001 root cause remains unknown. Local DNS/TCP success does not prove Render connectivity. Safe next diagnostic: enable the existing sanitized `DATABASE_CONNECTIVITY_DIAGNOSTICS=true` on the exact deployed release and compare bounded DNS/TCP probe results with Prisma startup logs. No secrets, deployment, or external mutation occurred.

## T1 P4 gap inventory — snapshot contract and unrelated histories

- Read-only inventory compared current PR service/test behavior against the acceptance checklist and found two specific public-contract gaps, not confirmed product defects: (1) snapshot identity is asserted for commits/files but not diff, and stale snapshot subrequests are not all tested after a ref advance; (2) `NO_MERGE_BASE` is covered by Git-storage unit tests but not the PR API contract.
- Snapshot test task is in progress in isolated worktree `E:\Prj1-worktrees\pr-snapshot-contract`, owned file `backend/test/pull-requests.e2e-spec.ts`. The unrelated-history test should follow sequentially because it owns the same file and needs the same DB slot.

## T-MERGE-STALE-VERSION-QUEUE — commits 736c108, 9774bf9, ebd2816; local integration verified

- Worktree: `E:\Prj1-worktrees\merge-stale-version-lock-queue`; added a barrier-based E2E where an owner PATCH and merge carrying the old version queue on the same repository lock. The test observes both waiters before release and asserts PATCH v2 wins, merge returns `409 STALE_COMPARE`, refs remain unchanged, PR stays OPEN, and no merge operation/audit is created.
- Root first rerun exposed an invalid owner slug in the fixture (404); corrected in `ebd2816`. Cleanup now unlocks and awaits both started requests on failure.
- Leader rerun after the fix: focused E2E passed 1 test / 9 intentionally skipped, `JEST_EXIT=0`, against the dedicated loopback test database. No `.env` read; random schema/temp Git storage were test-owned.
- Not pushed yet.

## T-AGY-ADMIN-RESPONSIVE — corrected accessibility fix accepted locally

- AGY correction worktree `E:\Prj1-worktrees\agy-admin-responsive` changed only the three allowed paths: `frontend/src/app/admin/admin.module.css`, `frontend/src/app/admin/page.tsx`, and `frontend/test/admin-accessibility.spec.ts`.
- The mobile table header row now uses a clipped visually-hidden pattern instead of `display:none`; native `<table>`, `<caption>`, and `<th scope="col">` semantics remain. Each of Users, Repositories, and Audit has five accessible column-header assertions; mobile cells retain visible `data-label` values and the tests check button bounds and horizontal overflow.
- Independent review found no API, authorization, mutation, or source-content exposure changes. An initial full browser run failed once at the existing narrow dialog focus-return sequence (`Khóa bob?`); isolated narrow rerun passed, then the full 4-test suite passed twice including a root integrated rerun.
- Integrated on `thviet` as commit `af80826` (`fix(admin): preserve mobile table headers for screen readers`). Root verified frontend lint, typecheck, Playwright 4/4 at 1280×800 and 375×812, and `git diff --check`. Not pushed yet.

## T-AUTH-LOGOUT-REFRESH-RACE — deterministic test acceptance in agent worktree

- Agent commit `3dd7e97` (`test(auth): make refresh logout concurrency acceptance deterministic`) changes only the auth E2E tests: direct-service concurrency uses separate named Prisma clients; both auth suites fail closed unless their PostgreSQL URLs are same-database loopback `*_test` URLs; redundant `.env` loading was removed; only the unreliable shared-pool waiter-count HTTP case was removed while sequential refresh/logout HTTP coverage remains.
- Agent verification: direct-service concurrency E2E 1/1 and HTTP auth E2E 8/8, run serially on dedicated test database with a process-only test JWT secret; backend typecheck, lint for both files, diff-check and test-safety security review passed.
- Commit is isolated in `E:\Prj1-worktrees\auth-e2e-acceptance`; root integration review/rerun still pending. No push.

## T1 P4 PR snapshot and unrelated-history tests — agent implementation, E2E running

- Agent commits `e711c94`, `f99c49b`, and `2b4b4a5` in `E:\Prj1-worktrees\pr-snapshot-contract` add compare snapshot consistency/stale-subrequest coverage and unrelated-history `NO_MERGE_BASE` API coverage in `backend/test/pull-requests.e2e-spec.ts`; the snapshot test has an explicit 60-second timeout.
- Agent reports backend typecheck and diff-check pass; focused ESLint matches three diagnostics already present on the baseline. No DB tests had run at handoff.
- After auth released the serial DB slot, the agent was assigned focused snapshot and unrelated-history E2Es, one after another, against the dedicated loopback test DB. Wait for exact exit codes and independent review before integration. No push.

## T-MAINTENANCE-GRACE-GAP — existing coverage verified

- Agent inspected `maintenance-jobs.service.spec.ts` and `maintenance-cleanup.e2e-spec.ts`; both requested 120-second cutoff precision and immediate `NEEDS_RECONCILIATION` pickup coverage already exist on `thviet`.
- Focused maintenance unit suite passed 16/16. No duplicate changes were made. E2E remains covered by the existing test; no additional run was needed for this inventory task.

## T1-AUTH-RACE — integrated root rerun passed

- Agent change integrated on `thviet` as `b1c2c2a`. Root reran `auth-session-concurrency.e2e-spec.ts` and `auth.e2e-spec.ts` sequentially on the dedicated loopback `code_forge_test` database: concurrency 1/1 and HTTP auth 8/8 passed, each with exit 0.
- Root backend typecheck and backend lint also passed after integration. Secrets were process-scoped and not printed; no `.env`/database outside the dedicated loopback test DB was targeted. This closes the race-test acceptance for the current candidate; production implementation remains `6d8c827`/`da020f9`.

## T1-PR-SNAPSHOT / T1-NO-MERGE-BASE — integrated root reruns passed

- Agent implementation was independently reviewed with no actionable finding and integrated as `c380bac`, `52face3`, `22d94a5`, `6c3a6c3` on `thviet`.
- The first broad file run exposed a test fixture error in orphan branch setup (`git rm -rf .` against an empty index). The exact test-only correction removed that unnecessary command; no production code changed.
- Root reran the two named cases serially on the dedicated loopback `code_forge_test` DB: snapshot/stale subrequests 1/1 and unrelated history `409 NO_MERGE_BASE` 1/1; 10 other cases intentionally skipped, process exit 0. Test assertions verify stale snapshot ref consistency and no unintended refs/PR/merge-operation/audit/push-operation effects.
- Agent static verification: backend typecheck and diff-check pass; focused ESLint has only three diagnostics verified identical to baseline. No push.

## T2-ADMIN-STATUS / T2-ADMIN-ROUTE-GUARDS — locally integrated

- Agent added `admin.service.spec.ts` coverage for preventing generic reactivation of a deleted repository; integrated as `4d0f6a3`. Root focused service suite passed 6/6.
- Agent added a new controller metadata spec for class-level access-token/admin guards and origin guards on all three mutations; integrated as `7bbe25f`. Root focused controller suite passed 4/4 and the new spec's lint/diff-check passed.
- Both are test-only; no production/controller authorization code changed. Not pushed.

## T3-BACKEND-E2E-REGRESSION — integrated local backend gate passed

- Hardened test teardown in `backend/test/repository-lock.e2e-spec.ts`: wait boundedly for child close, terminate detached process groups where applicable, preserve Git test storage if closure is unconfirmed, and still attempt pool/monitor cleanup. Added missing push-journal methods to test doubles. Repository lifecycle E2Es now delete only the two repository IDs created by their race fixtures, preventing quota leakage into later cases.
- Added private PR read-isolation assertions in `backend/test/pull-requests.e2e-spec.ts`: anonymous and authenticated non-members receive hidden 404s on list, detail, compare, commits, files, and diff, with no private markers in the body. Independent read-only review found no actionable issue.
- On the dedicated loopback `code_forge_test` DB, root ran lock E2E (2 passed, 1 POSIX-only test skipped on Windows), repository E2E (15/15), then the complete backend E2E suite serially (10/10 suites, 49 passed, 2 skipped, exit 0; Jest exited cleanly). Backend unit passed 20/20 suites / 161 tests; backend lint, typecheck, build and `git diff --check` passed.
- Both Docker images built from this tree. API image smoke confirmed Node 24, Git 2.39.5, built entry point and Prisma schema; migration image smoke confirmed Prisma CLI/client 6.19.3 and Linux engine. No migrations were executed by this smoke.
- This closes the local backend regression subgate only. Hosted CI has not run on the new integrated candidate; cloud Render/Neon smoke and final documentation/handoff remain open. No secrets were displayed or committed; the only database target was the dedicated loopback test DB.

## T4-PR-MERGE-OPERATION-ID-REUSE — local gate and hosted CI passed

- On clean `origin/thviet` base `0e380dbc6c7d3aede3f6a23561cbd993f01186d3`, added five table-driven service assertions that reusing a merge `operationId` with a changed repository, PR, source SHA, target SHA, or storage generation returns `409 OPERATION_ID_REUSED` before repository lock, Git/ref mutation, database mutation, audit, or transaction work.
- Production logic was unchanged. Focused service suite passed 21/21; complete backend unit suite passed 20 suites / 187 tests. Backend lint and typecheck passed. Independent static review found no actionable issue in the added test or the existing production guard.
- Commit `93b356a2db42dd79088584aed868cd74f11adb74` was pushed to `thviet` after confirming the remote tip still matched the clean base. GitHub Actions workflow run `40259575032` (#114) succeeded on that commit; documentation follow-up `95a765134c751fdd827ad398bf3873f4b6562c87` was also pushed and run `40259796538` (#115) succeeded on the exact SHA. No cloud database/storage was touched.

## T5-P3/P4/P6 ACCEPTANCE BUNDLE — local verification and hosted CI passed

- Scope is one cohesive backend acceptance bundle: reset/read race barrier (`backend/test/repositories.e2e-spec.ts`), stale PR snapshot subrequests (`backend/test/pull-requests.e2e-spec.ts`), compare diff rename and aggregate/file caps (`backend/src/repositories/git-storage.service.spec.ts`), admin bootstrap password-confirmation mismatch (`backend/test/admin-bootstrap.e2e-spec.ts`), repeated admin status no-op behavior (`backend/src/admin/admin.service.spec.ts`), and truthful Render/Neon release evidence (`docs/deployment/README.md`, `docs/deployment/cloud-smoke-checklist.md`). No runtime production code changed.
- The reset/read test now waits for the four lock clients supported by `RepositoryLockService`'s max-4 pool; the fifth request is still awaited and asserted alongside the other four. All five responses report `RESET`/generation 1 and metadata generation increments once. Root reran the containing repository test 1/1 against a fresh loopback PostgreSQL 17 database (`codeforge_test`) and test-owned Git storage.
- Root verification: full backend unit suite 20 suites / 192 tests passed; backend typecheck and lint passed; GitStorage focused real-Git regression 1/1 passed (the full suite was covered in the 192-test run); admin bootstrap CLI/PostgreSQL E2E 5/5 passed; repository reset/read E2E 1/1 passed; PR stale snapshot E2E 1/1 passed. `git diff --check` passed before final log update and is rerun before commit.
- E2E database ran only in a new PostgreSQL 17 container with tmpfs and loopback-only dynamically assigned port; container was stopped and removed after the focused suites. The first reset/read run exposed an impossible expectation of five simultaneous advisory-lock clients against a pool capped at four; assertion now verifies the actual four lock waiters and still awaits/asserts all five HTTP responses. A first attempt to run the M3.6 test by itself skipped the earlier fixture that creates its Public repository; the corrected run selected the containing private-repository test that owns the reset/read scenario.
- Independent review of admin idempotency, reset barrier, PR stale snapshots, and compare-limit test found no actionable code issue. Reviewer caught that the readiness endpoint writes/deletes a temporary file; README/checklist were corrected to describe this side effect rather than calling it read-only. No cloud DB, migration, deployment, backup, or Render storage was touched. The checklist records readiness only on deployed `388c584`; it explicitly does not claim full cloud smoke or resolve the historical P1001 cause.
- Bundle commit `3a0b31a513d7452d2dad455ed83c570a3c1109de` was pushed to `thviet` after exact-parent and clean-tree checks. GitHub Actions `MVP verification` run #116 (`40261320693`) succeeded on that exact SHA, including backend E2E, frontend browser/full-stack, Docker API/migration image smoke and disposable migration checks. No cloud deployment or cloud migration was performed. P2/P8 cloud acceptance remains open.

## T6-P3/P4 MERGE→DELETE LOCK ORDER — deterministic E2E added

- Strengthened the existing merge/delete race in `backend/test/pull-requests.e2e-spec.ts`. The test pauses the real merge immediately before compare-and-swap, verifies its durable journal is `PENDING` with a candidate SHA, observes DELETE waiting on the same PostgreSQL advisory lock, then releases merge and requires merge completion before repository soft-delete.
- Assertions require a two-parent merge commit, target ref pointing at that commit, PR `MERGED`, merge operation `COMPLETED`, and exactly one merge and soft-delete audit. No runtime production code changed.
- Verification on the dedicated loopback `code_forge_test` PostgreSQL container and test-owned Git storage: containing workflow E2E passed 1/1 (15 other cases intentionally skipped); complete `pull-requests.e2e-spec.ts` passed 14/14 runnable cases (2 process-crash cases intentionally skipped); backend typecheck, backend lint, and `git diff --check` passed. No cloud DB, Render storage, migration, or deployment was touched.
- Commit `b6411ad78d6b5e66f0e6b1809330b6352e8a4441` was pushed to `thviet` after review and local gates. GitHub Actions `MVP verification` run #118 (`40262580445`) succeeded on that exact SHA, including backend unit/E2E, frontend browser/full-stack, Docker image smoke, and disposable migration checks.
- This closes deterministic merge→delete lock-order coverage, not all P3/P4 acceptance. No cloud DB, Render storage, migration, or deployment was touched.

## T7-DOCUMENTATION CURRENT-STATE RECONCILIATION — local review complete

- Updated the current execution/evidence blocks across the docs index, implementation ledger, remaining-work plan, next actions, task plan/checklist, acceptance board, and deployment guide/checklist. Dated older records remain intact but are explicitly labeled historical where they could be mistaken for current status.
- Current verified facts are separated by environment: code CI #118 passed exact code SHA `b6411ad`; source tip at the start of this documentation change was `23cb1c7`; Render still serves `388c584` and has readiness-only evidence; cloud migration, backup/restore, direct Git transport, business smoke, and P1001 root cause remain unverified/open. P0–P8 are not complete; issue #6 remains fail-closed and Vercel remains out of scope.
- Local documentation diff review and `git diff --check` passed. The initial snapshot recorded Actions #119 as `in_progress`; this was superseded by documentation commit `de76447` pushed to `thviet` and Actions #120 passing on that exact commit. The cloud and owner-policy gates remain open despite the docs CI pass.

## T8-P4 DUPLICATE OPEN BRANCH-PAIR ACCEPTANCE — local E2E passed

- Corrected a static-review false alarm: the Prisma migration already creates partial unique index `pull_requests_open_pair_unique_idx` for `(repository_id, source_branch, target_branch)` where status is `OPEN`; the service maps the resulting unique violation to `409 OPEN_PULL_REQUEST_EXISTS`.
- Added E2E assertions to the existing owner/collaborator PR journey: a repeated POST for the same branch pair returns the documented 409, leaves exactly one OPEN PR row, and writes only one creation audit. Independent read-only review found no actionable issue.
- First test invocation had no `DATABASE_URL` in its process and was safely blocked by the suite's loopback `*_test` guard; no test ran against a database. Reran with a new PostgreSQL 17 container bound only to loopback, a dynamically assigned port, and `tmpfs` storage, database `code_forge_test`, plus the suite's own random schema and temporary Git root. Focused case passed 1/1 (15 unrelated cases skipped by the name filter). The test-owned container was stopped and auto-removed; no volume, cloud DB, or Render storage was touched.
- Backend typecheck and `git diff --check` passed. Direct ESLint on this long E2E file reports 8 existing diagnostics outside the added lines (including the unchanged throttler fixture); no diagnostic points into the new assertion. No runtime implementation changed. Independent review is clean. The change was committed as `ccff0021d4c05b8e1108bab173053d50a1b93bb4` and pushed to `thviet` (no main push); hosted Actions #121 (`40264984366`) passed on that exact SHA. The commit contains this evidence log and current-status updates.
- Parallel acceptance inventory found two separate uncovered tests: restore-vs-purge concurrency (P3) and scheduled stale-temp-directory cleanup wiring (P6). These are coverage gaps; no production failure was established. P2/P8 cloud acceptance and issue #6's owner policy remain open.

## T9-P3 RESTORE-VS-PURGE RACE — local E2E passed

- Added a deterministic PostgreSQL/Git E2E beside the existing restore/purge lifecycle tests. It pauses the real storage removal while purge holds the repository lock, starts restore, observes its PostgreSQL advisory-lock wait, then releases purge. Assertions require purge to complete, restore to return 404, repository metadata and Git source both to be absent, and no restore audit to exist.
- Focused E2E passed 1/1 (20 unrelated cases skipped by test-name filter) against a new PostgreSQL 17 loopback-only test container using `tmpfs`, a random schema, and the suite's temporary Git root. Container was stopped and auto-removed; no volume, cloud DB, or Render storage was touched. Backend typecheck and `git diff --check` passed.
- ESLint on the full legacy E2E file reports 149 pre-existing diagnostics; filtering diagnostics to the new test's lines returned none. This is not a claim that the entire file lint passes. No production code changed. The implementation already takes the same repository lock for restore and purge; the new test verifies that contract under real concurrent requests. The change was reviewed, committed as `b51ae232627b182d7485919a65fcb876671b4562`, pushed to `thviet`, and Actions #122 (`40265483751`) was queued on that SHA.

## T10-P6 SCHEDULED TEMP-JANITOR WIRING — local E2E passed

- Added a focused maintenance E2E that calls the real `MaintenanceJobsService.runOnce()` path and delegates its janitor call to the real cleanup helper with two fixture-only roots under the test's temporary storage. Aged valid-name stage/README directories are removed, while fresh and invalid-name sentinels remain. The default OS temp root is never scanned or mutated.
- Focused test passed 1/1 (5 unrelated cases skipped by name filter) against a loopback-only PostgreSQL 17 test container with tmpfs and a random test schema. Container was stopped and auto-removed. Backend typecheck and `git diff --check` passed; ESLint produced no diagnostics in the added test region. No production code changed. The test and this record are local and not yet hosted-verified.

## T11-P2 RENDER P1001 LOG REVIEW — root cause still unverified

- Read-only browser inspection of Render's existing failed deploy `4407e7d` (`dep-dbf0fdfb9u1s73b6mntg`) found a startup diagnostic with DNS/TCP `ok` at 107 ms, followed about six seconds later by Prisma 6.19.3 `P1001` for the Neon pooler endpoint. That older diagnostic did not log PostgreSQL handshake status; it is insufficient to distinguish transient endpoint behavior, TLS/auth configuration, or another cause.
- Read-only inspection of current Live deploy `388c584` found PostgreSQL handshake `ok` in 1,384 ms. This verifies current startup DB connectivity only; it does not retroactively explain the failed deploy or verify application flows, migrations, backup/restore, Git HTTPS, or source recovery.
- No Environment Values were opened/read, no secrets were copied, and no redeploy, migration, backup, SQL query, or cloud data mutation was performed. Static audit found no environment-variable-name mismatch. Safe remaining path is to establish source recovery first, then use the existing opt-in bounded diagnostic if another controlled deploy is authorized/necessary.

## T12-BTL ACCEPTANCE SLICE + CURRENT CI/CLOUD SNAPSHOT — hosted CI passed

- Agent-authored test-only changes: `backend/test/auth-session-concurrency.e2e-spec.ts` now deterministically races two refreshes using the same active token and asserts family/successor revocation; `backend/test/pull-requests.e2e-spec.ts` retries the same operation ID while the first merge journal is `PENDING` and asserts `202 RECONCILING`, one operation, no merge audit/ref move before release; `backend/test/admin-bootstrap.e2e-spec.ts` asserts promotion preserves a locked account and `lockedAt`. A previously missing Render/Neon operator runbook was added at `docs/deployment/render-neon-free-operator-runbook.md`; it explicitly marks source-loss recovery and backup/restore as not rehearsed and blocks unsafe migration without a verified write freeze.
- Verification used a newly created PostgreSQL 17 container bound to loopback only, random host port `62007`, tmpfs database storage `code_forge_acceptance_test`, and each suite's isolated schema/test-owned Git root. Full auth concurrency E2E passed 3/3; admin bootstrap CLI/PostgreSQL E2E passed 5/5; full PR E2E passed 14/14 runnable tests with the two Linux-only crash tests skipped on Windows. Backend typecheck and `git diff --check` passed. Container `codeforge-acceptance-20261026-0359` was stopped and auto-removed; existing containers/volumes were not touched. An initial PR test-name filter matched zero tests; corrected filter then passed, followed by the complete file.
- GitHub Actions #125 (`40267226563`) passed on exact commit `48b29f2931e910c6aebfb6e5a1e1ae35fec6c2cd`; the T12 changes are committed and hosted-verified. Earlier runs #123 (`40265797091`) and #124 (`40266111595`) passed on their recorded SHAs.
- Read-only cloud check after Render sleep: initial wake attempts returned HTTP 503 with `x-render-routing: hibernate-pending-wake`; a later GET to the public repository list returned HTTP 200 and an empty list. This confirms endpoint recovery after cold start and no public fixture available for Git transport; it does not verify Git Smart HTTP, authentication, migration, backup/restore, PR/admin flows, or explain the historical P1001. No cloud data was created or changed; no secrets, environment values, migration, restart, or backup were accessed.
- Cloud P2/P8 remain open; source-loss recovery is still not rehearsed. Keep the MVP lightweight: do not add production-scale machinery or repeat broad gates without a changed codebase.

## T13-BTL CLOUD READINESS RECHECK + EVIDENCE RECONCILIATION

- On 2026-10-26 at 04:11 UTC, `GET /api/v1/health/ready` returned HTTP 200 with database, Git executable, and storage all `up`; the public repository list returned HTTP 200 with an empty list. The readiness endpoint may write/delete its documented temporary storage probe file. `/health` and `/api/v1/health` returned 404; use `/api/v1/health/ready` for this app.
- This is readiness/list evidence only. No account/repository was created; no migration, backup, deploy, restart, or source-storage mutation occurred. Git HTTPS/authenticated workflows and the business-flow smoke remain unverified.
- Updated the current acceptance snapshot to match clean source tip `48b29f2` and green Actions #125 on its exact SHA. The historical P1001 cause remains unknown; no attempt was made to infer it from the current readiness result.

## T14-BTL RENDER GIT CHALLENGE + LOCAL DEMO AVAILABILITY

- At 2026-10-26 04:19 UTC, a GET to the Render Git Smart HTTP route for a deliberately nonexistent repository returned `401` with `WWW-Authenticate: Basic realm="Code Forge Git", charset="UTF-8"`. This proves the direct Render route and challenge are reachable, not successful clone/fetch/push for an existing repository.
- Quick local checks found no listener on `localhost:3000/login` or `localhost:4000/api/v1/health/ready`; both connections were refused. No local server was started, and no cloud account/repository was created.
- Current acceptance docs now record CI #126 (`40267850619`) passing on exact source `f240e72`, the Render Git challenge, and the remaining demo smoke gaps. `git diff --check` passed; P2/P8 remain open.

## T15-BTL LOCAL FRONTEND → RENDER API SMOKE

- Started the local Next.js frontend on `http://127.0.0.1:3000` with process-only `BACKEND_URL=https://code-forge-api-thviet.onrender.com` and `APP_ORIGIN=http://localhost:3000`; no environment file or cloud secret was written. Render's CORS preflight allowed the local origin.
- Observed `/login` and `/` return HTTP 200; proxied `/api/v1/auth/me` returns the expected unauthenticated 401; proxied POST `/api/v1/auth/register` with `{}` returns 400 `INVALID_REQUEST`. This verifies the local-to-cloud path and origin handling without creating a user. No cloud data was changed.
- The local demo server is left running for manual use. Next dev generated untracked `frontend/AGENTS.md` and `frontend/CLAUDE.md`; neither is staged or committed. CI #127 (`40268514645`) passed on source `2689b6c`. Real account/repository/Git push, migration, backup/restore and restart recovery remain unverified.

## T16-BTL RENDER PUBLIC/PRIVATE GIT SMOKE — passed

- On 2026-10-26, anonymous clone and fetch passed for the public test fixture `btl-demo-873496/btl-demo`.
- Authenticated clone, push, and fetch passed for private fixture `btl-demo-user-579004/btl-smoke`; branch `cloud-smoke-579004` fetched at the exact pushed SHA `05c7aad9dd6e3bd5fcfcc8a7586de83df3c28935`. This verifies the HTTPS Git path directly to Render beyond the Basic challenge.
- The temporary PAT was revoked and the test session logged out. Test fixtures contain only generated README content and an empty smoke commit; no application source or secret was committed. The first public-fixture account was created without a retained credential, so it is not offered as a login; the second synthetic account is available for demo login separately from this log.
- Scope intentionally stays BTL-sized: no migration, backup/restore, redeploy/restart, PR/invitation/admin cloud workflow, or source-loss recovery was attempted. The local Next frontend remains running for manual demo; its two generated untracked helper files remain untouched.
- CI #128 (`40269234926`) passed on exact pushed source `df77e2b`. These cloud checks occurred after that CI run and are operational smoke evidence, not hosted CI evidence.

## T17-BTL CLOUD ACCEPTANCE DOC RECONCILIATION

- Updated `docs/deployment/cloud-smoke-checklist.md` and `docs/deployment/render-neon-free-operator-runbook.md` to record the verified public clone/fetch and private PAT clone/push/fetch, plus the revoked PAT and explicit untested boundaries. Updated `docs/next-actions.md` and the acceptance snapshot to current `thviet` tip `fca4839`; no code, environment values, migration, or cloud state changed.
- `git diff --check` passed. The earlier successful CI evidence remains #128 on `df77e2b`; runs #129 (`2d124b3`) and #130 (`fca4839`) were still running when checked. No claim is made that those pending workflows passed.
- Remaining course-demo gap: one cloud PR→compare/diff→owner merge→fetch check. Render restart/source-loss recovery, backup/restore and migration remain untested and are recorded as free-tier/release limitations rather than silently passed.

## T18-BTL RENDER PR/MERGE SMOKE — passed

- On the deployed Render API, a new synthetic account/repository `btlclouda930e3db/pr-smoke` completed a bounded private flow: create a source branch with one test-only file, push by temporary PAT, create PR #1, compare and inspect files/diff, verify owner merge permission, merge, then fetch `main`.
- Fetched `main` resolved to merge commit `f8468c6063a70aea4306f6ab6de7a1c58cafb7bd`; Git inspection confirmed exactly two parents. PAT deletion and session logout requests succeeded. No application repository/source or credential was included.
- This proves direct API/Git cloud integration for the owner PR journey; it is not visual/browser acceptance and does not cover collaborator invitation, admin, stale/conflict cloud cases, quota boundary, migration, backup/restore or restart/source-loss recovery. No deployment or migration occurred.

## T19-BTL RENDER COLLABORATOR→PR→OWNER MERGE SMOKE — passed

- On a separate private Render fixture, owner `btlown653b1a6a` invited `btlcol653b1a6a` with role `WRITE`; collaborator listed and accepted the invitation, cloned the repository via temporary PAT, pushed `collaborator-feature`, and created PR #1. Owner fetched the compare/files snapshot and verified `canMerge`; owner merged, then collaborator fetched `main`.
- Fetched target points to merge SHA `481d75d44f2ad2855bab853cb55d28c96235877b`; Git inspection confirmed two parents. PAT revoke and owner/collaborator logout succeeded. Fixture repo `collab-smoke` contains only a smoke file; no project source or credentials were written to the repo or log.
- This does not test admin/audit, stale/conflict cloud behavior, payload/quota limits, migration, backup/restore or restart/source-loss recovery. No deployment or migration occurred.

## T20-BTL FINAL STATUS RECHECK — latest source CI and two focused checks

- Current `origin/thviet` and worktree HEAD are `97db5ff38ce3fba79968ffcd22f8e9a5140a4f8a`; GitHub Actions run #133 (`40271694208`) completed successfully on that exact SHA. Render remains on the older verified deployment `388c584`.
- Read-only live check: Render `/api/v1/health/ready` returned HTTP 200. This confirms current deployed readiness only, not migration/recovery or latest-source deployment.
- Local focused checks: admin bootstrap CLI/PostgreSQL E2E passed 5/5 on an isolated loopback test DB and left zero `admin_bootstrap_*` schemas; homepage demo-storage warning was visible at 375×812 with no horizontal overflow.
- No application code, cloud data, deployment, migration, Docker volume, or generated untracked helper file was changed. CI, local checks, and cloud evidence remain distinguished; recovery, migration, payload-boundary and admin/audit cloud gates remain open for full P0–P8 completion.

## T21-P6 PUSH AUDIT CRASH-BOUNDARY REVIEW

- Independent read-only review of open issue #5 at source `5fb8153` confirmed journal creation before receive-pack, actor/generation/ref snapshot binding, atomic idempotent success audit, and isolated DB-failure reconciliation coverage.
- Boundary: if Git moves refs but the process/database fails before `GIT_CHILD_SUCCEEDED` is durably recorded, the row remains `GIT_CHILD_OUTCOME_UNKNOWN`; reconciliation intentionally does not infer success and further writes stay fenced. Existing E2E covers audit-transaction failure after child-success proof, not this earlier window. This remains unproven against issue #5's broad crash wording; per the owner's fail-closed choice, do not auto-attribute it or modify refs. Operator resolution remains deferred under issue #6.
- Reconciled the cloud checklist summary so it consistently distinguishes the passed API/Git collaborator invitation→PR→merge smoke from the still-unverified browser UI, admin/audit, quota, migration and recovery checks. No runtime code or cloud state changed.

## T22-BTL CI RECHECK — documentation commit verified

- GitHub Actions `MVP verification` run #135 (`40273582715`) completed successfully on exact `thviet` source `2eed94471d4a1d8c3ea80163b26afec0a05ebf1c`; backend unit/E2E, lint, typecheck, build, frontend E2E/full-stack, Docker image checks, migration-image checks and diff whitespace all completed in the green workflow.
- Updated the current acceptance, next-actions and cloud-checklist snapshots to this exact source/CI evidence. Render remains on `388c584`; this CI result does not claim a new cloud deployment or verify migration, backup/restore, admin cloud, quota, or restart recovery. No runtime code or cloud state changed.

## T23-BTL SOURCE TIP CI RECHECK — complete

- Read-only GitHub Actions API check found `MVP verification` run #136 (`40274166587`) completed with `success` on exact `thviet` SHA `e0a5fc4b93b21ac4d848c42dd14c6d93c4d453b4`.
- Updated the current acceptance, next-actions and cloud-checklist snapshots from #135 / `2eed944` to #136 / `e0a5fc4`. Render remains on `388c584`; this CI result does not claim a cloud deploy or close migration, backup/restore, admin cloud, quota, or restart-recovery acceptance. No runtime code, cloud data, or service configuration changed.
