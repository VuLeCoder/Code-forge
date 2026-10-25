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
