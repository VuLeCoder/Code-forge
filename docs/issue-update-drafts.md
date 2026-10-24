# GitHub issue update drafts

Prepared 2026-10-25 for the existing public issues below. The public issue pages were observed as Open. These are drafts only; no GitHub comments or issue edits have been submitted because the current session lacks authenticated issue-write access. Do not create duplicates.

## Issue #3 — [P3/P4/P7] Kiểm thử full-stack PR, merge an toàn và phục hồi cạnh tranh

Suggested comment/update:

```markdown
### Cập nhật trạng thái (2026-10-25)

- Nhánh `thviet` hiện ở commit `1227730`.
- Run `40138087574` trên `7e0aa27` trước đó pass bộ acceptance hosted.
- Runs `40139229848` (`d1019a2`) và `40140118957` (`1227730`) fail ở bước `backend test:e2e`; log công khai chỉ cho biết exit code 1, chưa xác định được test/cause. Không suy luận từ thời lượng chạy.
- Commit `d1019a2` thêm PostgreSQL failure injection sau khi Git ref được cập nhật, kiểm tra HTTP `202`, merge commit hai parent, reconciliation, actor attribution, một audit và retry idempotent. Test chưa được chấp nhận đến khi E2E xanh.
- Commit `1227730` bổ sung enforce `COOKIE_SECURE=true` cho production; backend unit (14 suite/84 test), lint, typecheck, build đã đạt local.

### Còn lại

1. Lấy stdout/stack trace chính xác hoặc tái lập riêng suite trong PostgreSQL/Git test environment.
2. Sửa đúng nguyên nhân, chạy toàn bộ `backend test:e2e` trên commit mới.
3. Bổ sung các case còn thiếu sau khi đối chiếu test hiện hữu: conflict/stale/permission/quota/source reset và crash/retry quanh CAS–DB; refs phải giữ nguyên khi request không hợp lệ.

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

- Branch `thviet`, latest pushed commit `1227730`.
- Hosted run `40138087574` trên `7e0aa27` đã pass toàn bộ gates của revision đó.
- Runs `40139229848` (`d1019a2`) và `40140118957` (`1227730`) fail tại `backend test:e2e`; tên test/stack trace chưa lấy được do Actions log cần phiên đăng nhập. Đây là blocker mới và cần xử lý trước khi tuyên bố CI xanh.
- Docker Desktop có cài nhưng dashboard hiện “Turning off the Docker Engine…”; local image/runtime smoke chưa chạy. Không reset hoặc xóa container/volume để chữa trạng thái này.
- Chưa có smoke trên Vercel/Render/Neon; URLs, proxy headers, Render-direct Git payload và source-reset recovery đều chưa được xác minh.

### Việc cần làm

1. Khôi phục Docker Engine an toàn từ Docker Desktop; xác nhận `docker info` và `docker ps` trả về nhanh.
2. Lấy log và sửa lỗi E2E trên commit chính xác, rồi chạy lại full CI.
3. Chỉ sau đó chạy local image/migration smoke trên database test cô lập.
4. Chủ repository chọn project/account Vercel, Render, Neon, hostname và chính sách truy cập. Không đưa secrets vào issue/chat/repository.
5. Chạy `docs/deployment/cloud-smoke-checklist.md`, bao gồm Git trực tiếp Render với payload >4.5 MB, cold start, restart/reset và restore từ clone local.

### Chấp nhận

- Một hosted run xanh trên release commit; local runtime/image smoke có output; cloud checklist có URL, thời gian, commit và bằng chứng không nhạy cảm.
- Source reset/ephemeral behavior được hiển thị rõ trong demo và có quy trình restore đã thử.
```

## Issue #5 — Secure-cookie production validation (optional new issue if fix regresses)

No new issue is needed while the fix remains in the current patch. If regression appears, use this scoped title: `P6 Security: bắt buộc COOKIE_SECURE=true trong production`.

Acceptance: production config missing/false is rejected before serving requests; `true` accepted; development/test defaults remain compatible; `environment.spec.ts` and full CI pass. Implementation is committed in `1227730`; local focused/full backend tests pass, hosted acceptance pending because the E2E step is failing.
