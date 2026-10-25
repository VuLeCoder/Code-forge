# Security review — Code Forge

Review date: 2026-10-25
Scope: authentication/session handling, repository permissions, Git HTTP/proxy, PR merge/reconciliation, admin/audit/bootstrap, trusted-proxy IP signing, and local Compose exposure.
Method: read-only code/test review; no destructive payloads or production/cloud access. The source review is not a cloud penetration test.

## Findings and dispositions

### High — PostgreSQL development port was exposed on all host interfaces

- **Status:** fixed in commit `9c2439b`; rendered Compose config verified.
- **Evidence:** at baseline `7bf51ec`, [`compose.yaml`](../compose.yaml) line 7 used a known development database credential and line 8 published `5433:5432` without a loopback address. Compose therefore bound the host port on all interfaces by default. A reachable LAN client could attempt database access using the repository's known development credential.
- **Severity:** High; reviewer estimate CVSS 8.8, conditional on network reachability. This is local-development exposure, not evidence of cloud exposure.
- **Remediation:** PostgreSQL and backend mappings now bind to `127.0.0.1` (`compose.yaml` lines 8 and 37). `docker compose config --format json` rendered `127.0.0.1:5433 -> 5432` and `127.0.0.1:4000 -> 4000`.
- **Retest:** Docker Engine was not responsive, so containers were not started. The rendered configuration check passed; actual socket binding remains unverified until Docker runs.

### Hardening — PR proxy mutation body had no route-level byte cap

- **Status:** fixed in commit `9c2439b`; focused proxy tests pass.
- **Evidence:** before the fix, the Next route buffered mutation data with `request.text()` without enforcing a route-level cap. Hosting limits might reduce exposure, but standalone/local behavior was not established. The PR DTO fields total well below 32 KiB.
- **Severity:** no CVSS assigned; this was a resource-exhaustion hardening gap, not a confirmed exploitable vulnerability in the deployed hosting setup.
- **Remediation:** the proxy now validates `Content-Length` and reads mutation bodies as a bounded stream with a 32 KiB limit, cancelling oversized requests before forwarding.
- **Retest:** proxy browser tests cover declared oversized content and chunked content without `Content-Length`; both return 413 and produce no upstream request.

## Reviewed controls

No confirmed exploitable authentication bypass, private-repository disclosure, command injection, admin escalation, or secret logging was found in the inspected code and tests. Verified controls include session revalidation against active, unrevoked, unexpired database sessions; atomic refresh-token rotation and family revocation on reuse; private repository read policy; Git execution through argument arrays and streaming quotas; repository advisory locks and expected-snapshot checks for merges; and allowlisted admin audit details.

### P6 control gap — successful Git pushes have no durable attributable audit

- **Status:** the review-time gap has an implementation in commit `edb0ced`; hosted CI passes, with owner review and operator runbook still pending. Tracked in [GitHub issue #5](https://github.com/VuLeCoder/Code-forge/issues/5).
- **Evidence:** in [`git-http.service.ts`](../backend/src/repositories/git-http.service.ts), receive-pack requests emit fixed operational logs only. HTTP 200 is set after parsing CGI response headers, before the child process exits and its output drains. On child close, the service releases the repository lock but does not persist actor/repository/ref changes. The `pre-receive` quota hook validates proposed updates but writes no durable journal. A successful push can therefore change refs without an attributable audit row.
- **Severity:** P2 operational/security-control gap; no direct exploit or CVSS assigned. This fails the P6 requirement to audit the actual outcome of pushes, not HTTP status.
- **Implementation:** `edb0ced` adds a pending journal before receive-pack, sorted refs/heads snapshots, actor and storage generation, atomic status/audit completion from the actual ref delta, reconciliation after interrupted DB finalization, and gates on subsequent Git/PR/repository/admin/invitation/purge/storage-recovery writes. Ref snapshots are cleared on terminal operations; unresolved rows retain them only for reconciliation. Audit details contain operation/repository/generation/changed-ref count only, not branch names or SHAs.
- **Verification:** local unit 15 suites/93 tests; isolated PostgreSQL 17 + real Git E2E 8 suites/29 tests, including audit DB failure after refs moved, blocking a second push, and one attributed reconciliation audit; Prisma validate/generate, workspace lint/typecheck/build and diff check pass. Hosted workflow `40147767567` succeeded on this commit.
- **Residual risk:** permanently ambiguous or generation-mismatched rows fail closed and can leave a repository unwritable. There is no admin-facing resolution workflow yet; operator recovery must inspect the exact operation and storage before taking a manual action. No automatic ref rollback is attempted.
- **Acceptance:** add hosted evidence for the above and complete the admin/operator recovery runbook before declaring P6/release complete. Never log/store pack data, diffs, path/content, credentials, headers, URLs, or stderr.

## Remaining release verification

- Verify Vercel/Render trusted-proxy settings against real cloud requests, including attempts to spoof forwarded-IP headers. Vercel documents that it overwrites `X-Forwarded-For` to prevent IP spoofing: [request headers](https://vercel.com/docs/headers/request-headers). This documentation is not a substitute for a smoke test of the configured deployment.
- Test direct Render Git HTTPS, source loss after restart, and recovery on the selected cloud resources.
- Run real multi-process Git write races and crash/reconciliation scenarios in isolated PostgreSQL/Git fixtures.
- Run local Docker image smoke when the Docker Engine is available. No containers or volumes were modified during this review.

### Conditional hardening — production could omit Secure cookie attributes

- **Status:** fixed in commit `1227730`; focused config test and subsequent hosted workflows pass.
- **Evidence:** at `d1019a2`, `COOKIE_SECURE` defaulted to `false`, and production validation did not require it. The auth controller applies this setting to access and refresh cookies. Deployment documentation says production must set it to `true`, but configuration was not enforced.
- **Impact/severity:** deployment-dependent. If production omits the setting and accepts HTTP, browser cookies can lack the `Secure` attribute. No active deployment exposure was established; no CVSS assigned.
- **Remediation:** `validateEnvironment` now rejects `NODE_ENV=production` unless `COOKIE_SECURE=true`. Local/test behavior still defaults to `false`; unit tests cover both modes.
- **Verification:** backend typecheck, focused ESLint, `environment.spec.ts` (8/8), and `git diff --check` pass locally; hosted workflow `40145289400` on `2305390` passes.

## Evidence boundaries

At `edb0ced`, local backend unit tests pass (15 suites/93 tests), isolated PostgreSQL/Git E2E passes (8 suites/29 tests), workspace lint/typecheck/build pass, and hosted workflow `40147767567` succeeded. The test DB was a new disposable PostgreSQL 17 container with no mounted volume; no existing container or volume was reset. A focused AGY review was retried with user-authorized MCP access in an isolated read-only worktree, but timed out at 120 seconds without usable findings; no global permission or Windows/Antigravity setting was changed. The project includes `scripts/agy.ps1` to pin local AGY CLI calls to `gemini-3.8-flash-medium`; the Codex AGY bridge does not expose a model selector.
