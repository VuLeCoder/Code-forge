# GitHub issue update drafts

Prepared 2026-10-25 for the existing public issues below. The public issue pages were observed as Open. These are drafts only; do not create duplicates. Latest pushed code is `31cb306`; workflow `40142665347` failed but its job details are unavailable through the unauthenticated API. The previous run `40142070744` is confirmed to fail at backend E2E after unit passed. Local frontend/backend gates are recorded in `implementation-status.md`.

## Issue #3 — [P3/P4/P7] Kiểm thử full-stack PR, merge an toàn và phục hồi cạnh tranh

Suggested comment/update:

```markdown
### Cập nhật trạng thái (2026-10-25)

- Nhánh `thviet` có commit code mới nhất `31cb306`; backend hardening gần nhất là `1227730`.
- Run `40138087574` trên `7e0aa27` trước đó pass bộ acceptance hosted.
- Run `40142070744` fail ở `backend test:e2e` sau khi backend unit pass. Latest `40142665347` kết thúc failure nhưng chưa lấy được job details do GitHub API rate limit; không kết luận step nào fail.
- Commit `d1019a2` thêm PostgreSQL failure injection sau khi Git ref được cập nhật, kiểm tra HTTP `202`, merge commit hai parent, reconciliation, actor attribution, một audit và retry idempotent. Test chưa được chấp nhận đến khi E2E xanh.
- So sánh source cho thấy đây là test E2E mới đầu tiên cần chạy riêng để khoanh vùng; chưa có bằng chứng nó là nguyên nhân lỗi.
- Commit `851013e` sửa lỗi focus khi mở form từ empty state và hiển thị/retry lỗi tải branches; `141f749` bổ sung admin UI assertions; `31cb306` bổ sung admin restore/audit privacy tests. Local frontend 49/49 và backend 14 suite/86 test cùng lint/typecheck/build đạt.
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

- Branch `thviet`, latest pushed code commit `31cb306`; latest backend runtime hardening is `1227730`.
- Hosted run `40138087574` trên `7e0aa27` đã pass toàn bộ gates của revision đó.
- Run `40142070744` fail tại `backend test:e2e` sau khi backend unit pass; các bước sau bị skip. Newest run `40142665347` cũng kết thúc failure, nhưng job detail chưa truy cập được qua GitHub API rate limit. Chưa kết luận failure step trên run mới.
- Docker Desktop đang mở nhưng Docker Engine/PostgreSQL local chưa phản hồi; local image/runtime smoke chưa chạy. Không reset hoặc xóa container/volume để chữa trạng thái này.
- Chưa có smoke trên Vercel/Render/Neon; URLs, proxy headers, Render-direct Git payload và source-reset recovery đều chưa được xác minh.
- Cấu hình Vercel cần đặt server-side `APP_ORIGIN` bằng origin production canonical cùng `BACKEND_URL` và proxy secret; preview/custom origins cần quyết định và kiểm thử rõ.

### Việc cần làm

1. Khôi phục Docker Engine an toàn từ Docker Desktop; xác nhận `docker info` và `docker ps` trả về nhanh.
2. Lấy log và sửa lỗi E2E trên commit chính xác, rồi chạy lại full CI.
3. Chỉ sau đó chạy local image/migration smoke trên database test cô lập.
4. Chủ repository chọn project/account Vercel, Render, Neon, hostname và chính sách truy cập. Không đưa secrets vào issue/chat/repository.
5. Trên bản sao production-like, diễn tập backup/restore metadata, migration additive/forward-only, app rollback và migration-failure recovery; không reset DB đang dùng.
6. Chạy `docs/deployment/cloud-smoke-checklist.md`, bao gồm Git trực tiếp Render với payload >4.5 MB, cold start, restart/reset và restore source từ clone local.

### Chấp nhận

- Một hosted run xanh trên release commit; local runtime/image smoke có output; backup/restore và rollback rehearsal đạt trên bản sao; cloud checklist có URL, thời gian, commit và bằng chứng không nhạy cảm.
- Source reset/ephemeral behavior được hiển thị rõ trong demo và có quy trình restore đã thử.
```

## Issue #5 — Secure-cookie production validation (optional new issue if fix regresses)

No new issue is needed while the fix remains in the current patch. If regression appears, use this scoped title: `P6 Security: bắt buộc COOKIE_SECURE=true trong production`.

Acceptance: production config missing/false is rejected before serving requests; `true` accepted; development/test defaults remain compatible; `environment.spec.ts` and full CI pass. Implementation is committed in `1227730`; local focused/full backend tests pass, hosted acceptance pending because the E2E step is failing.
