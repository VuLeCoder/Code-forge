# Git operation journal recovery runbook

## Scope and current capability

This runbook applies to a repository whose push or pull-request merge operation
is `PENDING` or `NEEDS_RECONCILIATION`. It is a conservative incident-triage
procedure, not a manual database repair guide. The supported application
reconcilers can complete or fail operations only when the Git refs and journal
state prove an unambiguous outcome. A `CROSS_TYPE_OPERATION_UNRESOLVED` row is
deliberately excluded from automatic attribution; there is currently no
admin-facing journal resolution tool. Such an operation can keep repository
writes blocked until reviewed recovery tooling exists.

Relevant behavior is implemented in `backend/src/repositories/git-http.service.ts`,
`backend/src/repositories/git-push-journal.service.ts`,
`backend/src/maintenance/maintenance-jobs.service.ts`, and
`backend/src/repositories/repository-lock.service.ts`. This runbook does not
claim that abrupt process-kill or lock-connection-loss recovery has been
verified end to end.

## Triage

1. Declare a write-maintenance window for the affected repository. Stop new
   writes at the ingress, drain active requests and Git child processes, and
   confirm only the intended backend instance can write the repository. Do not
   restart, reset, purge, copy over, or otherwise mutate its Git storage.
2. Use an approved protected **read-only** direct database connection. Inspect
   the operation ID, repository ID, operation type/status, error code, actor ID,
   storage generation, timestamps, and linked PR/merge metadata needed to
   identify the incident. Do not export or paste ref snapshots, branch names,
   commit SHAs, pack data, source, credentials, or connection strings into
   tickets or chat.
3. Read-only inspect the exact repository storage location and its generation
   and branch refs. Confirm there is no active application Git process or
   repository lock holder. If storage is absent, generation differs, refs cannot
   be read, another writer may have changed refs, or the operation is
   cross-type/otherwise ambiguous, stop here: preserve the Git directory and
   journal rows, keep writes blocked, and escalate to the project maintainer
   for reviewed recovery tooling.
4. For an ordinary unresolved operation that is not marked cross-type and whose
   database, storage generation, and refs are available, prefer the existing
   idempotent reconciliation job. Ensure the service is awake and the single
   writer is healthy; push reconciliation intentionally waits at least 120
   seconds after operation creation. Do not repeat the original push/merge
   request to force a result. A sleeping free-tier service may delay scheduled
   work; its cadence is not a real-time guarantee.
5. Verify the journal and audit outcome through the application/database after
   reconciliation. A successful push requires a terminal journal and exactly
   one attributed push audit for the recorded ref delta. A successful merge
   additionally requires the PR to be `MERGED`, the expected merge SHA and
   owner attribution, and the target ref to contain the verified two-parent
   merge commit. Do not infer success from HTTP status alone.
6. Reopen writes only when the operation is terminal, repository generation
   and refs are consistent, required audit/PR metadata is present, and no
   unresolved journal remains for that repository. Otherwise preserve the
   maintenance window and escalate.

## Prohibited recovery shortcuts

Until a reviewed, tested resolution command exists, do not:

- update journal, PR, or audit rows by hand;
- delete journal/audit rows, clear the unresolved state, or clear advisory
  locks merely to resume writes;
- run `git update-ref`, reset, force-push, recreate/purge storage, or perform
  Git repair/GC on the affected repository as an attempted recovery;
- automatically roll back a ref that has moved; or
- disclose snapshots, source, branch names, SHAs, pack data, tokens, headers,
  or database connection details in external reports.

The safe default for an unknown outcome is to preserve both Git refs and
operation evidence and keep writes fail-closed. Build a supported, audited
operator resolution tool before claiming permanent ambiguous cases are
recoverable.

## Verification references and remaining work

Existing automated coverage includes idempotent push reconciliation and
cross-type hold in `backend/src/repositories/git-push-journal.service.spec.ts`,
merge reconciliation invariants in
`backend/src/maintenance/maintenance-jobs.service.spec.ts`, real PostgreSQL/Git
push audit recovery in `backend/test/push-audit.e2e-spec.ts`, and merge metadata
failure recovery in `backend/test/pull-requests.e2e-spec.ts`. These tests do not
simulate killing the backend during an active Git child or loss of the lock
connection while the child is running. Those crash/restart and lock-loss cases,
plus a protected operator resolution tool for ambiguous cross-type rows, remain
open acceptance work.
