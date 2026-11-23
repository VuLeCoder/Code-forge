# Khôi phục journal Git push/merge

Cập nhật 23/11/2026. Áp dụng khi `GitPushOperation` hoặc `PullRequestMergeOperation` ở `PENDING`/`NEEDS_RECONCILIATION`. Đây là quy trình đối soát bằng chứng, không phải hướng dẫn sửa DB/ref thủ công.

## Cơ chế

DB và Git không chung transaction. Journal lưu operation ID, actor, generation và bằng chứng refs; reconciler chỉ hoàn tất/thất bại khi đủ bằng chứng rõ ràng. Trường hợp không xác định hoặc có journal cạnh tranh giữ hàng rào chặn ghi.

Admin → **Đối soát Git** liệt kê metadata allowlist và chạy cùng proof checks. Admin không được đọc private source hoặc dùng màn hình này để ép một kết quả. Kiểm tra có khóa repository, active-admin authorization, journal revision, storage generation, ref evidence và competing journals; operator reason hiện là `OPERATOR_REVIEW`. Revision thay đổi trả `GIT_JOURNAL_CHANGED`: tải lại.

## Quy trình xử lý

1. Xác định repo/operation, thông báo cửa sổ bảo trì; freeze ingress ghi, drain REST/Git writes. Không restart/purge/reset storage trong khi điều tra. Xác nhận chỉ writer dự kiến có thể thao tác filesystem.
2. Lưu operation ID, repo ID, journal status/revision, generation và log đã loại secret. Giữ bằng chứng source/refs ở nơi được phép; không đưa raw diff/source private vào issue/log công khai.
3. Kiểm tra storage còn/đúng generation; có journal push/merge cạnh tranh hay không. Mất storage, generation lệch hoặc bằng chứng mâu thuẫn: giữ fail-closed, không sửa để ép khớp.
4. Ưu tiên reconciler có sẵn. Push reconciliation chờ ít nhất 120 giây từ operation creation để tránh nhận nhầm child còn chạy sau crash. Background jobs có thể chậm khi demo host ngủ.
5. Khi cần, admin chọn **Kiểm tra bằng chứng**, xác nhận thao tác và đọc kết quả; không thao tác SQL/ref ngoài workflow.
6. Xác minh kết quả terminal bằng DB và Git theo bảng dưới. Chỉ mở ghi khi không còn unresolved journal, generation/refs/metadata/audit nhất quán.

| Trường hợp | Bằng chứng cần xác minh |
| --- | --- |
| Push thành công | Journal terminal, ref delta được gán đúng actor, đúng một audit tương ứng |
| Push đầu repo rỗng | Đúng một branch; symbolic HEAD và DB defaultBranch trỏ branch đó; completion thử lại idempotent |
| Merge thành công | PR MERGED, target chứa merge commit hai parent đã xác minh, journal COMPLETED và đúng actor có quyền merge |
| Thao tác không thay ref | Reconciler chứng minh refs cũ/generation hợp lệ trước khi đánh FAILED |
| Admin hỗ trợ resolution | Đúng một `ADMIN_GIT_JOURNAL_RESOLVED`, tách operator khỏi actor gốc; outcome/reason/resolution giới hạn |
| Chưa rõ kết quả | Giữ unresolved; HTTP 202/RECONCILING không phải merge thành công |

## Không dùng làm đường tắt

Không sửa/xóa journal, PR hoặc audit bằng SQL; không xóa lock để mở ghi; không `update-ref`, reset, force-push, GC/repair hay tự rollback ref đã đổi; không dùng operation ID mới để bỏ fencing. Không phục hồi source chỉ bằng restore metadata.

Khi khóa đã mất trước ref CAS, không được spawn Git mới. Source hiện kiểm tra signal trước spawn; mất khóa khi child đang chạy vẫn cần cancellation và đối soát outcome. Không suy ra mọi dạng network partition đã được giải quyết từ một test pre-CAS.

## Source và kiểm thử

- `backend/src/repositories/git-http.service.ts`, `git-push-journal.service.ts`, `repository-lock.service.ts`, `pull-requests.service.ts`, `git-storage.service.ts`.
- `backend/src/maintenance/maintenance-jobs.service.ts`, `backend/src/admin/admin-git-journal.service.ts`.
- Unit cạnh source; E2E `backend/test/push-audit.e2e-spec.ts`, `repository-lock.e2e-spec.ts`, `pull-requests.e2e-spec.ts`, `admin.e2e-spec.ts`.

Phạm vi đã có: crash boundaries, audit attribution/idempotence, storage generation, cross-type fencing, active push lock loss và pre-CAS merge lock loss/retry. Kết quả local gần nhất tại [verification](../ket-qua-kiem-thu.md); chưa phải cloud backup/restore rehearsal. Source-loss recovery và rollout cần [operator runbook](../trien-khai/huong-dan-van-hanh-render-neon-mien-phi.md).
