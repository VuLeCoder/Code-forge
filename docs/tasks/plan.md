# Code Forge: completion and release plan

**Plan origin:** 2026-10-25 14:02 Asia/Saigon (historical estimate; see current execution snapshot below).
**Current branch / pushed SHA:** `thviet` / `25487b5` (`origin/thviet` matches).
**Scope:** finish the already user-approved P0–P8 MVP plan; no new product scope.

## Current verified state

- `thviet` and `origin/thviet` are at `25487b5`. The squash commit `e2b5a1a` is on `origin/main`; hosted run `40180253512` failed on the narrow admin focus-return test (55 passed, 1 failed). Backend, lint, typecheck, and build jobs passed. Treat the frontend regression as open; do not count the workflow as passed.
- Local workspace lint, typecheck, and build passed; backend unit passed 18 suites / 120 tests. Backend E2E reported 9 suites / 38 passed / 2 skipped, but Jest stayed alive after an open-handle warning and was interrupted. The test results are observed, but this invocation did not exit cleanly and is not a clean gate pass.
- The admin focus fix is complete on `thviet`: hosted run #77 (`40178590940`) passed all workflow gates on exact SHA `25487b5c99603e09254c2b5a6e30d358193dad01`. Earlier failures #69 (`40170013908`) and #70 (`40170763221`) are historical failures on older SHAs; retain them as history, not as current status.
- The local demo is running with a local-only database and storage. Render deployment remains unresolved with Prisma `P1001` at startup. Vercel's GitHub App connection is still dependent on the personal repository owner granting/installing access; no Vercel deploy is verified.
- P3/P4 interaction-matrix gaps and P6 operational/owner-decision gaps remain. Cloud acceptance is not complete. These local and hosted-code results do not establish cloud success or durable source storage.

## Estimate and completion target

The original estimate was **13–21 focused hours**, plus hosted CI wait time (then estimated at about 5–7 minutes per full run) and cloud-provider setup/propagation. This remains an estimate from the planning snapshot, not a measured remaining-duration guarantee. The calendar targets below are likewise the original forecast, not a current completion promise. With three parallel workers plus the lead, the original forecast was:

- **Local + hosted-code acceptance:** 2026-10-27 to 2026-10-28.
- **Cloud demo smoke and handoff:** 2026-10-29 to 2026-10-30, only if the owner supplies the cloud-resource/hostname decisions by 2026-10-26 and accepts the documented ephemeral Git-source limitation.

Confidence is medium for local/CI and low-to-medium for cloud. If U2/U3/U4 below remain unanswered, cloud release or the audited ambiguous-journal workflow is blocked; dates must move rather than silently weakening acceptance. This is a forecast, not a completion claim.

## Workflow changes to reduce wasted checking

1. For a failing run, inspect the first failed step and exact test/log before any retry. Fix the cause, run only the focused reproducer, then one relevant suite.
2. Run tests in a gate ladder: changed-module lint/typecheck → focused unit/browser/E2E → full local regression after 2–3 slices → one hosted CI for the integrated SHA. Do not run concurrent commands that share `.next`.
3. Keep each agent slice to 3–5 files, one owner per file set, explicit acceptance commands, and a report containing exact counts/output. The current tool allows four concurrent participants total including the lead, so the practical team is the lead plus three agents, not four agents plus the lead.
4. Start with backend/API contracts, then UI against the fixed contract; parallelize docs and read-only review only when they do not edit those files.
5. Time-box independent audits. A timeout is “no result”; switch model only for a bounded, narrower task and never count the timeout as a pass.
6. Update the evidence ledger after each integrated commit. Keep documentation-only local changes separate from code acceptance until reviewed; never stage `AGENTS.md` accidentally.

## Work breakdown and dependencies

```mermaid
flowchart TD
  T0[Diagnose and fix admin focus CI regression] --> T0b[Focused then full frontend verification]
  T0b --> T1[Close P3/P4 acceptance gaps]
  T1 --> T2[Admin/jobs and U4 decision]
  T1 --> T3[Full local regression]
  T2 --> T3
  T3 --> T4[One hosted CI on integrated SHA]
  T4 --> T5[Cloud smoke: P2/P8]
  T5 --> T6[Docs and owner handoff]
  U2[Cloud resources] --> T5
  U3[Hostname and ephemeral-source acceptance] --> T5
  U4[Ambiguous-journal authority decision] --> T2
```

### T0 — Diagnose and fix admin focus CI regression

**Owner:** frontend agent in isolated worktree; Codex reviews/integrates. **Estimate:** 0.5–1.5 h.
**Skills:** `frontend-ui-engineering`, `ui-ux-pro-max`, `ui-styling`, `test-driven-development`.

- [x] Historical failure #70 on `41c23ec`: frontend Playwright failed 53/55; desktop and narrow focus-return tests failed after Escape.
- [x] Preserve the test contract: focus returns to the connected opener; if removed, focus falls back to the admin heading.
- [x] Implement the focus restoration fix on `thviet` and verify it in the subsequent frontend tests and hosted workflow #77 on exact SHA `25487b5`.

**Status:** complete for the admin focus regression. Historical failure evidence remains in the record. This does not resolve unrelated cloud or P3/P4 gaps.

### T0b — Frontend regression checkpoint

**Owner:** Codex QA lead. **Estimate:** 0.5–1 h.
**Skills:** `browser-testing-with-devtools`, `debugging-and-error-recovery`.

- [x] Frontend browser suite, lint/typecheck/build, and hosted workflow passed on `25487b5`; run #77 (`40178590940`) completed successfully on the exact branch SHA.
- [ ] Fix and verify the narrow admin focus-return regression from hosted run `40180253512` on squash commit `e2b5a1a`; do not infer its outcome from the green `thviet` run.

**Status:** branch `thviet` checkpoint complete; `origin/main` squash-run checkpoint remains pending at last observation.

### T1 — Close P3/P4 Git and PR acceptance gaps

**Owner:** backend/Git agent; Codex owns final contract and integration. **Estimate:** 4–7 h.
**Skills:** `api-and-interface-design`, `test-driven-development`, `security-and-hardening`; read-only reviewer: `security-auditor`.

- [ ] Inventory existing real PostgreSQL/Git coverage before adding tests; close only uncovered permission-change, stale-ref/version, storage-generation reset, and push/merge/delete/reset interactions.
- [ ] Verify paginated summary/commits/files/diff remains one snapshot, stale requests return 409, and no response leaks private repository data.
- [ ] Confirm merge conflict/stale/lock-loss outcomes leave refs and metadata consistent; use isolated test schema and temporary Git root.

**Acceptance:** focused real-DB/Git cases plus PR E2E pass; each prohibited mutation proves refs unchanged; no duplicate coverage added without a gap.

### T2 — Close P6 admin and maintenance owner-dependent work

**Owner:** Codex backend + admin agent after contract. **Estimate:** 2–4 h after U4.
**Skills:** backend: `security-and-hardening`, `test-driven-development`; UI: `frontend-ui-engineering`, `ui-ux-pro-max`, `ui-styling`; reviewer: `security-auditor`.

- [ ] Reconcile remaining admin restore/session-lock/job idempotence gaps against the acceptance board.
- [ ] Before building ambiguous-journal resolution, obtain U4: which authority (ADMIN or operator role) and one-person or two-person approval. Until answered, keep fail-closed behavior and the runbook.
- [ ] Ensure audit excludes secrets/source and records actual Git outcomes, not merely HTTP success.

**Acceptance:** isolated PostgreSQL tests cover the approved authority, repeat-safe jobs, locked-user behavior, restore, and audit privacy. No manual SQL/ref repair.

### T3 — Integrated regression checkpoint

**Owner:** Codex QA lead; agents may own independent test suites. **Estimate:** 2–3 h + test runtime.
**Skills:** `code-review-and-quality`, `browser-testing-with-devtools`, `test-driven-development`.

- [ ] Run backend unit/E2E, frontend browser suite, full-stack journey, lint/typecheck/build, Docker image smoke, and `git diff --check` once on the integrated candidate. Latest local workspace lint/typecheck/build pass and backend unit passes 18 suites / 120 tests. Backend E2E reported 9 suites / 38 passed / 2 skipped, but Jest did not exit after its open-handle warning and was interrupted; rerun/diagnose before calling this gate clean.
- [ ] If one gate fails, inspect exact logs and rerun only its focused reproducer before another whole gate.
- [ ] Cover owner → collaborator → push → PR compare → owner merge → fetch, plus admin lock/unlock/restore/audit.

**Acceptance:** all required gates green on the candidate commit; platform-specific skips are explicitly recorded, never counted as passes.

### T4 — Hosted CI gate

**Owner:** Codex release lead. **Estimate:** 0.25 h active + 5–7 min typical CI.
**Skills:** `ci-cd-and-automation`, `debugging-and-error-recovery`.

- [x] Hosted run #77 (`40178590940`) passed on exact SHA `25487b5c99603e09254c2b5a6e30d358193dad01` on `thviet`.
- [ ] Fix the admin focus-return failure in run `40180253512` for main squash `e2b5a1a`, then verify CI on the resulting commit.

**Status:** CI passed for `thviet` at `25487b5`; `origin/main` run `40180253512` failed on one narrow focus-return test and is open for repair.

### T5 — P2/P8 cloud demo and recovery smoke

**Owner:** Codex release lead + owner. **Estimate:** 4–8 h after U2/U3, plus provider delays.
**Skills:** `shipping-and-launch`, `browser-harness`, `security-and-hardening`.

- [x] Local demo is running with a local-only database/storage and a separate normal demo account. This is not cloud acceptance.
- [ ] Diagnose Render's unresolved Prisma `P1001` startup failure without blind redeploys or exposing connection strings.
- [ ] U2: complete Vercel GitHub App authorization for the Code Forge personal repo; current integration requires the repo owner to grant/install access.
- [ ] U3: choose hostname/audience and explicitly accept that free Render storage can lose Git source on sleep/restart/redeploy while metadata persists.
- [ ] Deploy additive migration safely; rehearse metadata backup/restore, application rollback, and failed-migration recovery.
- [ ] Smoke auth/private/public, PAT, direct Render HTTPS clone/fetch/push (including >4.5 MB), invitations, PR merge, admin/audit, cold start, source-loss warning, and restore from local clone.

**Status:** cloud acceptance remains open. Render `P1001` is unresolved; Vercel Git integration remains owner-dependent. Do not mark any cloud smoke item complete based on the local demo.

### T6 — Documentation and handoff

**Owner:** docs agent; Codex verifies. **Estimate:** 1–2 h.
**Skills:** `documentation-and-adrs`, `code-review-and-quality`.

- [ ] Reconcile overview docs, acceptance board, task log, deployment/runbook, and API contract to exact release SHA.
- [ ] Record evidence, skipped tests, residual issues, limits, and operator restore steps.

**Acceptance:** a new operator can reproduce local setup and demo recovery; docs claims match CI/cloud evidence.

## Owner decisions required

- **U2:** cloud resource/project access for Vercel, Render, Neon.
- **U3:** demo hostname/audience and acceptance of ephemeral Git-source storage.
- **U4:** authority and approval count for permanently ambiguous merge/push journals.

No secrets are requested in chat. These choices only gate the affected cloud/operator tasks; local implementation can proceed independently where safe.
