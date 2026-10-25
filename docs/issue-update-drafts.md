# GitHub issue update drafts

**All text in this file is a draft only. No issue comment was posted by this update.** Recheck live issue state and refresh evidence immediately before posting; prior open-state checks are dated 2026-10-25 and are not proof of current state.

## Current evidence baseline (2026-10-25, branch `thviet`)

- Current pushed commit: `250ffdc`. It adjusts the timeout to 180 seconds for the Linux-only backend E2E that kills a separate API process after the Git target ref moves and lets replacement startup maintenance reconcile.
- Backend typecheck and `git diff --check` passed before the commit was pushed. Targeted ESLint reports only a pre-existing `await-thenable` at `backend/test/pull-requests.e2e-spec.ts:507`.
- Public Actions metadata: run `40164718122` on `e5eda1a` failed at `Run corepack pnpm --filter backend test:e2e:failure`; exact logs are not available, so cause remains unknown. Run `40164867636` on `250ffdc` is `in_progress`; no result is claimed. The new E2E has not been run locally. Do not claim the process-crash/restart scenario passes until the `250ffdc` Linux run completes and verifies it.
- Latest verified hosted green run remains `40162474987` on `9c2eb81`; it does not include the crash/restart test added in `250ffdc`.
- Local Compose runtime smoke and earlier backend E2E evidence are recorded in the acceptance board; neither is cloud-release evidence. Vercel/Render/Neon deployment, direct Render Git, backup/restore, source-loss recovery, and manual screen-reader/device review remain unverified.
- Issue #5's durable push audit is implemented, but a supported operator workflow for permanently ambiguous journals remains a gap. Keep the system fail-closed; do not suggest manual database/ref repair.
- The earlier exact logs for `40160123068` and `40159331450` remain unexplained. Historical drafts below are obsolete; do not post them as written.

## Current short drafts (refresh run IDs and issue state before use)

### Issue #3 — PR/Git recovery

```markdown
### Status update — 2026-10-25

- `thviet` is at `250ffdc`. This commit sets a 180-second timeout for the Linux-only process-crash/restart E2E covering the window after a merge target ref moves but before PR metadata commits. Run `40164867636` is currently `in_progress`.
- Static acceptance so far: backend typecheck and `git diff --check` pass. Targeted ESLint still has a pre-existing `await-thenable` at `backend/test/pull-requests.e2e-spec.ts:507`.
- Run `40164718122` for `e5eda1a` failed at `Run corepack pnpm --filter backend test:e2e:failure`, but that step name alone does not establish the cause; exact log diagnosis awaits user GitHub sign-in. Do not count crash/restart recovery as accepted until run `40164867636` for this exact commit proves natural process/session exit, replacement-startup reconciliation, one audit, idempotent retry, and the resulting two-parent commit.
- The previous verified hosted run is `40162474987` on `9c2eb81`; earlier E2E failures remain historical and unexplained.
- Permanently ambiguous/cross-type journals still have no supported operator resolution workflow and remain fail-closed. No manual SQL or Git ref repair is supported.
- Cloud Git transport and source-loss recovery remain untested.
```

### Issue #4 — CI, Docker, and cloud release

```markdown
### Status update — 2026-10-25

- `thviet` is at `250ffdc`; run `40164867636` is `in_progress`, and its result has not been inspected. Run `40164718122` on `e5eda1a` failed at the backend E2E step; its cause is unknown pending detailed logs. The latest verified green run remains `40162474987` on `9c2eb81`.
- Earlier isolated Compose runtime smoke applied migrations 7/7 and returned backend readiness 200. This is local evidence only, not cloud acceptance.
- Vercel/Render/Neon, direct Render Git HTTPS (including payloads above 4.5 MB), cold start, TLS/proxy behavior, backup/restore, and source-loss/recovery have not been verified.
- Free Render Git storage may be ephemeral while PostgreSQL metadata persists. Do not describe the demo source as durable; require a visible warning and a tested restore from a local clone before release.
- Cloud setup requires owner-selected provider resources, canonical hostname/audience, and explicit acceptance of ephemeral source storage.
```

### Issue #5 — durable push audit / ambiguous recovery

Keep the existing issue open until the owner reviews the remaining gap. Before commenting, recheck the issue's live state and decide whether to keep the operator-resolution follow-up scoped under #5 or track it separately. Current draft issue `docs/operations/issue-draft-ambiguous-git-journals.md` is unpublished; it records the unresolved questions about `ADMIN` versus a separate operator role and single versus dual approval. No duplicate issue has been created by this task.

## Historical drafts — obsolete, do not post

## Issue #3 — [P3/P4/P7] Kiểm thử full-stack PR, merge an toàn và phục hồi cạnh tranh

Suggested comment/update:

```markdown
### Cập nhật trạng thái (2026-10-25)

- Nhánh `thviet` có commit code mới nhất `298fb62`; hosted workflow `40149241856` đang chạy. Local backend unit 15 suite/100 test, targeted admin/PR PostgreSQL-Git E2E 2 suite/5 test và workspace lint/typecheck/build đạt.
- Run `40138087574` trên `7e0aa27` trước đó pass bộ acceptance hosted.
- Logs xác thực: `40142759395` lộ lỗi parse body hai lần; `40143199809` lộ assertion đòi `resultingSha` từ API detail dù endpoint chỉ chọn operationId/status/errorCode. Commit `0403bda` giữ contract, kiểm tra journal SHA/actor trong PostgreSQL và retry/ref/audit như trước; run `40143448486` đã thành công.
- Commit `51fca2a`/`2955e36` bổ sung E2E PostgreSQL/Git cho hai merge request cùng operation ID và AdminController lock/unlock: session cũ bị thu hồi, PAT Git chuyển từ 200 sang 401 khi user bị khóa, Admin không có membership không đọc/merge private repo, audit API lọc secret. Run `40144424454` pass.
- Commit `2305390` thêm E2E conflict thật qua HTTP/Git/PostgreSQL, chứng minh target ref giữ nguyên, PR OPEN, operation FAILED và không có merge audit; đồng thời thêm AdminController restore success, source-reset disclosure và audit. Run `40145289400` pass.
- Commit `d1019a2` thêm PostgreSQL failure injection sau khi Git ref được cập nhật; hosted E2E sau đó xác nhận HTTP `202`, merge commit hai parent, reconciliation, actor attribution, một audit và retry idempotent trên run `40143448486`.
- Commit `851013e` sửa lỗi focus khi mở form từ empty state và hiển thị/retry lỗi tải branches; `141f749` bổ sung admin UI assertions; `31cb306` bổ sung admin restore/audit privacy tests. Local frontend 49/49 và backend 14 suite/86 test cùng lint/typecheck/build đạt.
- Commit `1227730` bổ sung enforce `COOKIE_SECURE=true` cho production; backend unit (14 suite/84 test), lint, typecheck, build đã đạt local.
- Commit `298fb62` bổ sung session-row serialization cho login/refresh so với admin lock và repository fence cho merge chưa đối soát; local targeted DB/Git E2E đạt 2 suite/5 test. Current local UI regression adds background reconciliation announcement coverage; PR Playwright 9/9, frontend lint/typecheck pass. Hosted run `40149241856` đang chạy code commit trước UI test mới.

### Còn lại

1. Case metadata failure trên non-default target và descendant push bị fence đến khi reconciliation đã pass targeted E2E local trên `298fb62`. Còn stale/permission/quota/source reset và process crash/lock loss quanh CAS–DB.
2. Chờ hosted run `40149241856`, rồi ghi bằng chứng theo release commit; chưa có cloud smoke.

### Chấp nhận

- Git ref, PR state, merge operation và audit được kiểm chứng cùng nhau.
- Merge thành công là commit hai parent, `mergedById` bằng actor trong journal, chỉ một reconciliation audit.
- Retry cùng operation ID không tạo commit/audit thứ hai.
- Ghi commit, hosted run, môi trường và giới hạn còn lại trong `docs/implementation-status.md`.
```

## Issue #4 — [P0/P8] Docker, CI và smoke release cho demo cloud

Suggested comment/update:

```markdown
### Cập nhật trạng thái (2026-10-25)

- Branch `thviet`, latest pushed code commit `298fb62`; hosted workflow `40149241856` is in progress. Local targeted gates are recorded above.
- Hosted run `40147767567` trên `edb0ced` pass toàn bộ gates của revision đó; hosted acceptance cho `298fb62` đang chờ run mới.
- Commit `298fb62` sửa Compose local từ production mode + insecure cookie sang development mode cho local HTTP; production guard không đổi. Compose config pass nhưng runtime chưa chạy. API/migration image smoke, migration 7/7 và readiness 200 đã được xác minh trên `edb0ced`; Compose volumes hiện hữu không bị đụng đến.
- Vercel/Render/Neon, backup/restore rehearsal, direct Render Git và source recovery vẫn chưa được xác minh.
- Chưa có smoke trên Vercel/Render/Neon; URLs, proxy headers, Render-direct Git payload và source-reset recovery đều chưa được xác minh.
- Cấu hình Vercel cần đặt server-side `APP_ORIGIN` bằng origin production canonical cùng `BACKEND_URL` và proxy secret; preview/custom origins cần quyết định và kiểm thử rõ.

### Việc cần làm

1. Khôi phục Docker Engine an toàn từ Docker Desktop; xác nhận `docker info` và `docker ps` trả về nhanh, rồi chạy local image/runtime smoke trên database test cô lập.
2. Chủ repository chọn project/account Vercel, Render, Neon, hostname và chính sách truy cập. Không đưa secrets vào issue/chat/repository.
3. Trên bản sao production-like, diễn tập backup/restore metadata, migration additive/forward-only, app rollback và migration-failure recovery; không reset DB đang dùng.
4. Chạy `docs/deployment/cloud-smoke-checklist.md`, bao gồm Git trực tiếp Render với payload >4.5 MB, cold start, restart/reset và restore source từ clone local.

### Chấp nhận

- Một hosted run xanh trên release commit; local runtime/image smoke có output; backup/restore và rollback rehearsal đạt trên bản sao; cloud checklist có URL, thời gian, commit và bằng chứng không nhạy cảm.
- Source reset/ephemeral behavior được hiển thị rõ trong demo và có quy trình restore đã thử.
```

## Future issue — Secure-cookie production validation (optional only if fix regresses)

No new issue is needed while the fix remains in the current patch. If regression appears, use this scoped title: `P6 Security: bắt buộc COOKIE_SECURE=true trong production`.

Acceptance: production config missing/false is rejected before serving requests; `true` accepted; development/test defaults remain compatible; `environment.spec.ts` and full CI pass. Implementation is committed in `1227730`; local focused/full backend tests and hosted workflow `40145289400` pass.

## Issue #5 — [P6] Durable audit for Git push ref changes

Created after the 2026-10-25 read-only security review identified the missing durable audit for successful ordinary Git pushes. [Issue #5](https://github.com/VuLeCoder/Code-forge/issues/5) remains open. Commit `edb0ced` implements the journal, ref snapshot delta, atomic audit, unresolved-operation mutation gates, snapshot clearing after terminal states, and crash reconciliation. Local evidence: backend unit 15 suites/93 tests; isolated PostgreSQL 17/Git E2E 8 suites/29 tests, including DB audit failure after refs move, second-push blocking, and one-time reconciliation; Prisma validate/generate, workspace lint/typecheck/build and diff check pass. Hosted workflow `40147767567` succeeded. Residual: permanently ambiguous operations fail closed and need an operator recovery procedure; no cloud test was done. This issue was created per the user's request to track gaps; no comments were posted to #3 or #4.
