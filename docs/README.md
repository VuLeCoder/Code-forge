# Code Forge documentation

Project documentation lives here, grouped by purpose. Start with the overview documents, then use the acceptance ledger for current evidence and the deployment guides for environment-specific steps.

**Current execution snapshot (2026-10-25; evidence is environment-specific):**
local branch `thviet` is at `25487b5`; `origin/thviet` matches. The squashed
MVP commit `e2b5a1a` is on `origin/main`; hosted run `40180253512` failed
on the narrow admin focus-return test (55 passed, 1 failed). Backend, lint,
typecheck, and build jobs passed. On the local checkout,
workspace lint, typecheck, and build passed; backend unit tests passed 18
suites / 120 tests. Backend E2E reported 9 suites / 38 passed / 2 skipped,
but Jest remained alive after its open-handle warning and was interrupted; do
not describe that invocation as a clean exit. The local demo is running.
Render still fails at Prisma startup with `P1001`; Vercel Git integration is
waiting on repository-owner access. Neither cloud deployment is accepted.

Earlier snapshots below are historical evidence, not current state. In
particular, older commit IDs, test counts, CI failures and pending-review
statements must not be reused as claims about `25487b5` or `e2b5a1a`.

## Project overview

- [Product goals and scope](01_muc_tieu_va_nghiep_vu.md)
- [Architecture and technology](02_kien_truc_va_cong_nghe.md)
- [Local run and testing](03_chay_va_kiem_thu.md)
- [Milestones and roadmap](04_tien_do_va_lo_trinh.md)
- [Current implementation status](implementation-status.md)
- [Remaining work breakdown](remaining-work-breakdown.md)
- [Next actions](next-actions.md)
- [Completed frontend work](completed_frontend.md)

## Acceptance and operations

- [M2 acceptance report](m2-acceptance-report.md)
- [M4 acceptance report](m4-acceptance-report.md)
- [M5 acceptance report](m5-acceptance-report.md)
- [Acceptance task board](operations/acceptance-task-board-2026-10-25.md)
- [Execution log](operations/task-execution-log-2026-10-25.md)
- [Git operation recovery](operations/git-operation-recovery.md)
- [Ambiguous Git journal issue draft](operations/issue-draft-ambiguous-git-journals.md)
- [Issue update drafts](issue-update-drafts.md)

## Deployment and review

- [Deployment guide](deployment/README.md)
- [Cloud smoke checklist](deployment/cloud-smoke-checklist.md)
- [Security reviews](security-review.md)
- [Dated security review](security-review-2026-10-25.md)
- [Security follow-up](audits/security-followup-2026-10-25.md)

## Agent handoffs

- [AGY plan index](agy-plans/README.md)
- [Frontend package README](frontend/README.md)

## Execution planning

- [Completion and release plan](tasks/plan.md)
- [Completion checklist](tasks/todo.md)

`AGENTS.md` stays at the repository root because coding agents discover repository instructions there. Product, operations, deployment, handoff, and execution-planning documentation is grouped under `docs/`.
