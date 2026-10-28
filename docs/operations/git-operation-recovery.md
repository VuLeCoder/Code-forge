# Git operation journal recovery runbook

## Scope and current capability

This runbook applies to a repository whose push or pull-request merge operation
is `PENDING` or `NEEDS_RECONCILIATION`. It is a conservative incident-triage
procedure, not a manual database repair guide. The supported application
reconcilers can complete or fail operations only when the Git refs and journal
state prove an unambiguous outcome. The admin-facing **Đối soát Git** view lists
unresolved operations using a non-sensitive allowlist and can run the same
proof checks on demand. It never moves a Git ref. A competing cross-type or
same-type journal deliberately prevents attribution, so genuinely unknown or
contradictory evidence remains unresolved and continues to fence writes.

Relevant behavior is implemented in `backend/src/repositories/git-http.service.ts`,
`backend/src/repositories/git-push-journal.service.ts`,
`backend/src/maintenance/maintenance-jobs.service.ts`, and
`backend/src/admin/admin-git-journal.service.ts`. This runbook does not
claim that abrupt process-kill or lock-connection-loss recovery has been
verified end to end.

## Triage

1. Declare a write-maintenance window for the affected repository. Stop new
   writes at the ingress, drain active requests and Git child processes, and
   confirm only the intended backend instance can write the repository. Do not
   restart, reset, purge, copy over, or otherwise mutate its Git storage.
2. Sign in with an active `ADMIN` account and open **Admin → Đối soát Git**.
   Locate the operation by ID, repository/owner, or type. The view intentionally
   exposes no branch names, SHAs, source, raw ref snapshots, pack data,
   credentials, cookies, or free-form diagnostics.
3. Select **Kiểm tra bằng chứng** and confirm. The API acquires the repository
   advisory lock and rechecks active-admin authorization, the displayed journal
   revision, storage generation and existence, competing journals, and current
   Git evidence. The only accepted operator reason is the bounded
   `OPERATOR_REVIEW` code. A stale view returns `GIT_JOURNAL_CHANGED`; reload it
   before trying again.
4. For an ordinary unresolved operation that is not marked cross-type and whose
   database, storage generation, and refs are available, prefer the existing
   idempotent reconciliation job. Ensure the service is awake and the single
   writer is healthy; push reconciliation intentionally waits at least 120
   seconds after operation creation. Do not repeat the original push/merge
   request to force a result. A sleeping free-tier service may delay scheduled
   work; its cadence is not a real-time guarantee.
5. If the protected check reports missing/reset storage, competing journals,
   unknown child outcome with changed refs, or contradictory merge parents,
   stop. Preserve storage and journal evidence; the operation intentionally
   remains unresolved and repository writes remain blocked. Do not try to make
   the evidence fit a desired result.
6. Verify the journal and audit outcome through the application/database after
   reconciliation. A successful push requires a terminal journal and exactly
   one attributed push audit for the recorded ref delta. A successful merge
   additionally requires the PR to be `MERGED`, the expected merge SHA and
   owner attribution, and the target ref to contain the verified two-parent
   merge commit. Do not infer success from HTTP status alone.
   An operator-assisted terminal transition also requires exactly one
   `ADMIN_GIT_JOURNAL_RESOLVED` audit naming the operator separately from the
   original actor and using bounded outcome/reason/resolution codes.
7. Reopen writes only when the operation is terminal, repository generation
   and refs are consistent, required audit/PR metadata is present, and no
   unresolved journal remains for that repository. Otherwise preserve the
   maintenance window and escalate.

## Prohibited recovery shortcuts

Even with the protected resolution workflow, do not:

- update journal, PR, or audit rows by hand;
- delete journal/audit rows, clear the unresolved state, or clear advisory
  locks merely to resume writes;
- run `git update-ref`, reset, force-push, recreate/purge storage, or perform
  Git repair/GC on the affected repository as an attempted recovery;
- automatically roll back a ref that has moved; or
- disclose snapshots, source, branch names, SHAs, pack data, tokens, headers,
  or database connection details in external reports.

The safe default for an unknown outcome is still to preserve both Git refs and
operation evidence and keep writes fail-closed. The admin workflow records only
proof-based terminal outcomes; it is not a manual override.

## Verification references and remaining work

Existing automated coverage includes idempotent push reconciliation and
cross-type hold in `backend/src/repositories/git-push-journal.service.spec.ts`,
merge reconciliation invariants in
`backend/src/maintenance/maintenance-jobs.service.spec.ts`, real PostgreSQL/Git
push audit recovery in `backend/test/push-audit.e2e-spec.ts`, and merge metadata
failure recovery in `backend/test/pull-requests.e2e-spec.ts`. Operator recovery
coverage is in `backend/src/admin/admin-git-journal.service.spec.ts`,
`backend/test/admin.e2e-spec.ts`, and the admin browser tests. These tests do not
simulate killing the backend during an active Git child or loss of the lock
connection while the child is running. Those crash/restart and lock-loss cases
remain open acceptance work. A cross-type state whose attribution cannot be
proved remains intentionally fenced rather than being force-resolved.
