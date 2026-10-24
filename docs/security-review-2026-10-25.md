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

## Remaining release verification

- Verify Vercel/Render trusted-proxy settings against real cloud requests, including attempts to spoof forwarded-IP headers. Vercel documents that it overwrites `X-Forwarded-For` to prevent IP spoofing: [request headers](https://vercel.com/docs/headers/request-headers). This documentation is not a substitute for a smoke test of the configured deployment.
- Test direct Render Git HTTPS, source loss after restart, and recovery on the selected cloud resources.
- Run real multi-process Git write races and crash/reconciliation scenarios in isolated PostgreSQL/Git fixtures.
- Run local Docker image smoke when the Docker Engine is available. No containers or volumes were modified during this review.

## Evidence boundaries

Local worktree checks after the race-test additions passed workspace lint, typecheck, build, backend unit tests (14 suites / 82 tests), ESLint for `pull-requests.e2e-spec.ts`, Compose config validation, and `git diff --check`. The existing repository E2E file retains 122 ESLint diagnostics, unchanged from baseline and none on the added lines; browser tests passed 48/48 in the preceding UI batch. Hosted CI run `40138087574` on `7e0aa27` subsequently passed the full suite, including isolated PostgreSQL/Git E2E, the full-stack PR journey, both image/migration checks, Compose backend-config validation, cross-process repository advisory-lock contention, and two-instance maintenance-lock serialization. The same branch's prior run `40137272731` covers concurrent refresh reuse, push–push, push–merge, reset-read recovery, merge–soft-delete, and PR error-retry regressions. Backend PostgreSQL/Git E2E was not run locally because `127.0.0.1:5433` had no listener. Three AGY audit attempts, including a final read-only review of `9c2439b`, timed out without usable output; AGY review remains unverified.
