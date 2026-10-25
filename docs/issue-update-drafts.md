# GitHub issue update drafts

Prepared 2026-10-25 for the existing public issues below. Issues #3/#4 were rechecked Open before preparing; drafts remain unposted. Latest pushed code is `2305390`; workflow `40145289400` passed. Local frontend/backend gates are recorded in `implementation-status.md`.

## Issue #3 — [P3/P4/P7] Kiểm thử full-stack PR, merge an toàn và phục hồi cạnh tranh

Suggested comment/update:

```markdown
### Cập nhật trạng thái (2026-10-25)

- Nhánh `thviet` có commit code mới nhất `2305390`; hosted workflow `40145289400` pass.
- Run `40138087574` trên `7e0aa27` trước đó pass bộ acceptance hosted.
- Logs xác thực: `40142759395` lộ lỗi parse body hai lần; `40143199809` lộ assertion đòi `resultingSha` từ API detail dù endpoint chỉ chọn operationId/status/errorCode. Commit `0403bda` giữ contract, kiểm tra journal SHA/actor trong PostgreSQL và retry/ref/audit như trước; run `40143448486` đã thành công.
- Commit `51fca2a`/`2955e36` bổ sung E2E PostgreSQL/Git cho hai merge request cùng operation ID và AdminController lock/unlock: session cũ bị thu hồi, PAT Git chuyển từ 200 sang 401 khi user bị khóa, Admin không có membership không đọc/merge private repo, audit API lọc secret. Run `40144424454` pass.
- Commit `2305390` thêm E2E conflict thật qua HTTP/Git/PostgreSQL, chứng minh target ref giữ nguyên, PR OPEN, operation FAILED và không có merge audit; đồng thời thêm AdminController restore success, source-reset disclosure và audit. Run `40145289400` pass.
- Commit `d1019a2` thêm PostgreSQL failure injection sau khi Git ref được cập nhật; hosted E2E sau đó xác nhận HTTP `202`, merge commit hai parent, reconciliation, actor attribution, một audit và retry idempotent trên run `40143448486`.
- Commit `851013e` sửa lỗi focus khi mở form từ empty state và hiển thị/retry lỗi tải branches; `141f749` bổ sung admin UI assertions; `31cb306` bổ sung admin restore/audit privacy tests. Local frontend 49/49 và backend 14 suite/86 test cùng lint/typecheck/build đạt.
- Commit `1227730` bổ sung enforce `COOKIE_SECURE=true` cho production; backend unit (14 suite/84 test), lint, typecheck, build đã đạt local.

### Còn lại

1. Đối chiếu test hiện hữu rồi bổ sung các case còn thiếu: stale/permission/quota/source reset và crash/retry quanh CAS–DB; refs phải giữ nguyên khi request không hợp lệ. Real-Git conflict case đã được thêm ở `2305390` và pass run `40145289400`.
2. Chạy các case mới trong PostgreSQL/Git test environment cô lập và ghi bằng chứng.

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

- Branch `thviet`, latest pushed code commit `2305390`; hosted workflow `40145289400` succeeded.
- Hosted run `40138087574` trên `7e0aa27` đã pass toàn bộ gates của revision đó.
- Runs `40142759395`/`40143199809` fail tại backend E2E do test-harness assertions; `0403bda` sửa cả hai và run `40143448486` pass toàn workflow. Run `40144424454` trên `2955e36` tiếp tục pass sau khi thêm same-operation merge và AdminController lock E2E. Code commit `2305390` thêm conflict and admin restore E2E; run `40145289400` passes all gates. Local Docker runtime and all Vercel/Render/Neon, backup/restore rehearsal, direct Render Git and source recovery remain unverified.
- Docker Desktop đang mở nhưng Docker Engine/PostgreSQL local chưa phản hồi; local image/runtime smoke chưa chạy. Không reset hoặc xóa container/volume để chữa trạng thái này.
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

Created after the 2026-10-25 read-only security review identified the missing durable audit for successful ordinary Git pushes. [Issue #5](https://github.com/VuLeCoder/Code-forge/issues/5) is open and tracks the journal, crash reconciliation, fail-closed handling, privacy controls, and isolated PostgreSQL/Git acceptance. This issue was created per the user's request to write issues for tracked gaps; no comments were posted to #3 or #4.
