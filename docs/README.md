# Code Forge documentation

Project documentation lives here, grouped by purpose. Start with the overview documents, then use the acceptance ledger for current evidence and the deployment guides for environment-specific steps.

**Current execution snapshot (2026-10-26; local, hosted, and cloud evidence are distinct):**
`thviet` and `origin/thviet` are at `23cb1c7` (latest commit is documentation-only). Code commit `b6411ad` passed hosted Actions [#118 / `40262580445`](https://github.com/VuLeCoder/Code-forge/actions/runs/40262580445); docs-only run #119 for `23cb1c7` was in progress at this snapshot. The merge→delete lock-order E2E passed locally and in the full CI workflow. Render still serves `388c584`; readiness returned HTTP 200 with database/Git/storage up, but no cloud migration or end-to-end smoke is accepted. Historical `P1001` root cause remains unknown. P2/P8 and full P0–P8 acceptance remain open; issue #6 stays fail-closed; Vercel is deferred/out of scope.

Older snapshots below are historical evidence, not current state. Do not reuse their SHAs, test counts, or provider states as present-day evidence.

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
