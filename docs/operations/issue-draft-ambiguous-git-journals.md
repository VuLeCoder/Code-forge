# Draft issue — audited recovery for ambiguous Git journals

**Status:** Published as open GitHub issue [#6 — Add an audited, fail-closed workflow for ambiguous Git journals](https://github.com/VuLeCoder/Code-forge/issues/6). This local document is a supporting copy of the published issue; do not create a duplicate. The 2026-10-28 feature candidate proceeds with the existing active `ADMIN` role and one operator; hosted review/CI and the issue status remain pending.

## Proposed title

`[P6] Add an audited, fail-closed workflow for ambiguous Git journals`

## Problem

When a Git push or pull-request merge has an outcome that cannot be proven after a crash, the current behavior correctly keeps the journal unresolved and fences further repository writes. There is no supported operator workflow to inspect or resolve that state, so a genuinely ambiguous operation can block writes indefinitely. The existing runbook intentionally forbids manual database/ref repair.

## Acceptance criteria

- Admin/operator views list unresolved push and merge journals using an allowlist of non-sensitive metadata only; never expose source, raw ref snapshots, credentials, cookies, or free-form diagnostics.
- Resolution is serialized by the repository advisory lock and rechecks journal revision, repository generation, permissions, and current Git evidence immediately before mutation.
- Automated completion is allowed only when the recorded outcome is provable. For merges, verify the candidate commit has the recorded two parents and is reachable from the intended target. For pushes, verify the before/after ref delta is attributable without a competing journal.
- An explicitly authorized human resolution may update metadata and audit only; it must never move/rollback Git refs or delete the journal. Unknown or contradictory evidence remains unresolved and keeps writes fenced.
- The resolution and audit are atomic and idempotent; record the resolving operator separately from the original actor and use a bounded reason code rather than unsanitized free text.
- Integration tests cover unauthorized access, stale revisions, missing/reset storage, generation mismatch, competing journals, provable success/failure, retries, audit privacy, and continued fencing for ambiguous evidence.

## Decisions needed before implementation

- Should the existing `ADMIN` role be allowed to resolve, or is a separate operator role required?
- Is one authorized operator sufficient, or should ambiguous human decisions require a second approver?

## Boundaries

- No raw SQL or manual Git ref editing as the supported workflow.
- No automatic rollback of a ref after an ambiguous outcome.
- Do not expand issue #5 (durable push audit) without its owner's agreement; this workflow covers both push and merge journals.
