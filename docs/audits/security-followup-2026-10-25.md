# Security follow-up review

Date: 2026-10-25
Reviewed revision: `thviet` at `9ab5c0f` plus working-tree changes visible during review
Review type: static, read-only inspection. This is not a penetration test or release certification.

## Confirmed security findings

No new confirmed authentication bypass, cross-repository access, Git authorization bypass, quota bypass, injection, or source disclosure was established in the reviewed paths. The previously documented default-branch protection, merge quota check, PR permission recheck, and repository audit changes are present in the inspected code.

## Confirmed correctness / integrity gap (not assigned CVSS)

### Retried merge operation can fail instead of returning its prior result

- **Priority:** P2 reliability/integrity; not a demonstrated security vulnerability.
- **Location:** `backend/src/repositories/pull-requests.service.ts:152-187`.
- **Evidence:** `merge()` checks for `operationId` at line 156 before acquiring the repository lock at line 164. After waiting for the lock, it does not repeat that lookup before inserting the operation at line 186. The schema makes `operationId` unique (`backend/prisma/schema.prisma:204`).
- **Impact:** Two simultaneous requests with the same operation ID can both observe no operation. The first can finish or enter reconciliation; the second then reaches the unique insert and receives a database uniqueness error instead of the contractually expected prior result or `RECONCILING` response. This does not by itself duplicate the ref update, but breaks safe client retry behavior and may surface as an unhandled 500.
- **Remediation:** After acquiring the repository lock, look up and validate the operation ID again before checking/creating a new operation. Return the stored result for `COMPLETED`, `RECONCILING` for pending states, and reject mismatched reuse. Also map a residual unique conflict to the same idempotent response.
- **Verification:** Add a PostgreSQL integration test that races two same-operation-ID merge requests behind the repository lock and asserts one durable operation, no duplicate merge commit, and equivalent replay results. The database-dependent test could not be run in this environment.

### Remediation status in the current working tree

- `merge()` now repeats the operation-ID lookup after acquiring the repository lock and before validating the PR's OPEN state or creating an operation. A residual unique-key race across different repository locks resolves through the same replay validation.
- The PR service unit test for a completed operation discovered after lock acquisition passes. The isolated PostgreSQL HTTP/Git test now sends two concurrent requests with the same operation ID and performs a later replay; it could not reach assertions because PostgreSQL is unavailable at `localhost:5433`.

## Deployment-dependent hardening to verify

### Reverse-proxy-aware rate limiting needs cloud verification

- **Severity:** Medium, conditional on deployment topology; estimated CVSS 5.3 for temporary availability impact.
- **Evidence:** `backend/src/app.module.ts` installs a global Nest throttler (100 requests/minute) and `backend/src/main.ts` does not configure Express `trust proxy`. The Git HTTP handlers also share the global rate limit, with an additional four-active-process cap in `git-http.service.ts`.
- **Inference:** If the Render deployment terminates requests through a proxy whose client address is not represented by the socket peer, the default tracker may treat many visitors as the same IP. This could cause cross-user throttling; the exact behavior depends on Render's request path and proxy headers and was not tested.
- **Remediation in working tree:** All 17 Next API routes and the two server-rendered backend fetches sign the platform-supplied client IP with `RATE_LIMIT_PROXY_SECRET`. The backend tracker accepts only valid HMAC-SHA256 signatures and otherwise falls back to Express `req.ip`/socket peer. `TRUST_PROXY_HOPS` is explicit, bounded to 0–10, and defaults to 0; production requires a 32-character signing secret. Backend unit tests pass 81/81, frontend helper tests 2/2, and browser suite 43/43 locally. Vercel's official request-header documentation says it overwrites `X-Forwarded-For` with the client IP to prevent spoofing ([Request headers](https://vercel.com/docs/headers/request-headers)).
- **Still required:** Set the same secret in Vercel and Render; verify through a deployed request that independent clients map to independent buckets; spoof `X-Forwarded-For` and `X-CodeForge-Client-IP` and confirm they cannot choose a bucket; measure Render's proxy path before setting trust hops. The local machine cannot establish those cloud facts.
- **Scope note:** Direct Render API/Git requests and the local Next Git proxy are not signed by the web proxy helper; their client-IP attribution depends on the verified hosting socket/proxy topology and remains a deployment check.

## Existing controls observed

- Access JWTs are checked against a live user and a non-revoked, unexpired session in `backend/src/auth/access-token.guard.ts`.
- Refresh-token reuse revokes the session family in `backend/src/auth/auth.service.ts`; cookie-authenticated mutations require a configured Origin.
- Private repository reads are filtered by `RepositoryPolicy`; PAT authentication checks user state, token status, expiry and scope.
- Git write handlers recheck repository/user/membership after acquiring the advisory lock. The pre-receive hook accepts only branch refs, rejects direct updates to an existing default branch, and checks file/repository/branch quotas.
- PR merge is owner-only, snapshot/version/generation guarded, creates a merge candidate under the repository lock, checks quotas, performs expected-SHA ref compare-and-swap, and journals reconciliation state.
- Admin source reads are not exposed; status/restore mutations are guarded and audited. Audit details inspected are allowlisted and do not include raw source/diff or credentials.
- API exception handling emits a request ID and does not return unhandled exception details. Git transport logs fixed metadata rather than request headers or Git diagnostics.

## Commands and limitations

- Read-only source inspection with `Get-Content`/`rg` over auth, invitations, repository policy/service, Git transport/storage/hook, PR service/controller, admin, maintenance, configuration and API exception handling.
- No destructive payloads, real data, credentials, cloud service, or production endpoint was used. A local `docker ps` probe did not return during the check window, so local PostgreSQL integration was not established.
- PostgreSQL-backed concurrency and merge-reconciliation behavior remains unverified because the local PostgreSQL listener was unavailable. Cloud proxy/rate-limit behavior, Docker images, TLS edge headers and hosted CI remain unverified.
