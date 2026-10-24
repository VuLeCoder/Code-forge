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

### Conditional hardening — production could omit Secure cookie attributes

- **Status:** fixed in the current worktree; focused config test passes; hosted CI for this change is pending.
- **Evidence:** at `d1019a2`, `COOKIE_SECURE` defaulted to `false`, and production validation did not require it. The auth controller applies this setting to access and refresh cookies. Deployment documentation says production must set it to `true`, but configuration was not enforced.
- **Impact/severity:** deployment-dependent. If production omits the setting and accepts HTTP, browser cookies can lack the `Secure` attribute. No active deployment exposure was established; no CVSS assigned.
- **Remediation:** `validateEnvironment` now rejects `NODE_ENV=production` unless `COOKIE_SECURE=true`. Local/test behavior still defaults to `false`; unit tests cover both modes.
- **Verification:** backend typecheck, focused ESLint, `environment.spec.ts` (8/8), and `git diff --check` pass locally.

## Evidence boundaries

Local worktree checks after the race-test additions passed backend unit tests (14 suites/83 tests), typecheck, build, and scoped ESLint. Current cookie validation additionally passes focused typecheck, lint, its unit suite, and diff check. Hosted CI run `40138087574` on `7e0aa27` passed all gates; latest run `40139229848` on `d1019a2` failed at backend E2E and exposes no test detail to the unauthenticated reader. Backend PostgreSQL/Git E2E was not run locally because Docker Desktop remains stuck shutting down and `127.0.0.1:5433` has no listener. Three earlier AGY reviews and a new bounded read-only review of `d1019a2` timed out without usable output; no AGY output is accepted.
