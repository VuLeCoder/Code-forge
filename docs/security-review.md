# Security review checkpoint

Date: 2026-10-25
Baseline: `c484c42`
Scope: local static review of auth/session, invitation, Git HTTP/storage, PR/merge, admin and maintenance code. This is not a penetration test or cloud review.

## Findings and remediation

| Finding | Severity estimate | Remediation | Verification state |
| --- | --- | --- | --- |
| Direct Git receive-pack could update the default branch, allowing a WRITE member to bypass owner PR merge. | High; estimated CVSS 6.5 | Pre-receive rejects every update to an existing default branch. Only the owner may initialize an empty default branch; server-side PR merge uses compare-and-swap and bypasses receive-pack. | Hook regression tests pass for owner/WRITE update rejection, owner-only initial branch creation, and feature-branch push. PostgreSQL-backed owner-merge journey remains unverified in this environment. |
| Server-side PR merge could create a target ref that exceeded file/repository logical quotas. | Medium; estimated CVSS 4.3 | Merge candidate objects are measured with `rev-list --objects --all` and `cat-file --batch-check` while the repository advisory lock is held; quota errors mark the durable operation failed before target ref CAS. | Real-Git unit tests pass for oversized-file and repository-total rejection; service unit test verifies no ref update and durable failure. Full PostgreSQL/API exercise remains unverified. |
| PR edits could race with collaborator permission removal or role downgrade. | Medium; estimated CVSS 4.3 | PR edit/close/reopen now uses the repository advisory lock and rechecks active user, repository state, membership, author and PR version in a database transaction before write/audit. | Unit test verifies a removed WRITE membership is denied before mutation. Concurrent PostgreSQL race test remains unverified. |
| Repository create/update/soft-delete/restore mutations were missing audit records. | Control gap | Added transaction-scoped allowlisted audit events. Details record IDs, changed field names, visibility transition and retention timestamp; no description, source, diff, token or credential is recorded. | PostgreSQL e2e assertions were added. They could not be rerun because the local database listener is unavailable. |
| Missing baseline anti-frame/security response headers. | Low–medium, deployment-dependent | Added CSP `frame-ancestors 'none'`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` and restrictive `Permissions-Policy` in Next config. | Previously verified from `GET /login`. HSTS remains the TLS edge's responsibility. |

## Remaining security validation

- Run PostgreSQL e2e in a fresh isolated schema, especially merge/reconciliation and concurrent membership-revocation cases.
- Build and inspect both Docker images; confirm hook executable mode, Git, Prisma client and migration CLI in the respective images.
- Run the hosted CI and cloud Git HTTP checks before publishing a URL.
- Repeat the audit on the release commit and record any later changes. The review used no destructive payloads and does not establish absence of vulnerabilities outside the inspected paths.

AGY's broad and narrowed read-only reviews both timed out without usable findings. An independent static follow-up review found an operation-ID replay race in PR merge; the working-tree fix rechecks the operation under the repository lock and resolves globally unique-ID collisions. The PR service unit test passes; PostgreSQL replay/concurrency coverage was added but remains unverified until the isolated database is available. Reverse-proxy-aware rate limiting remains a deployment check, not a confirmed vulnerability. See `docs/audits/security-followup-2026-10-25.md`.
