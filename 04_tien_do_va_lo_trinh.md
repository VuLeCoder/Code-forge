# 04 — Tiến độ và lộ trình

Đối chiếu ngày 25/10/2026. Nguồn trạng thái hiện tại: [implementation ledger](docs/implementation-status.md), [remaining actions](docs/next-actions.md), [M2](docs/m2-acceptance-report.md), [M4](docs/m4-acceptance-report.md), [M5](docs/m5-acceptance-report.md), schema, source và hosted run `40138087574` trên `7e0aa27`. Các báo cáo milestone M2/M4/M5 bên dưới giữ giá trị lịch sử; hosted CI mới hơn là bằng chứng regression hiện tại.

## Bảng trạng thái tổng hợp

| Mốc | Trạng thái bàn giao | Phần đã có / còn lại |
| --- | --- | --- |
| M0 — Foundation | Implemented; hosted CI pass | Workspace, Next/Nest, Prisma, Compose, Dockerfiles, health and CI exist; local Compose settings validate. Actual local Docker runtime smoke remains unverified. |
| M1 — Auth/profile | Implemented; hosted regression pass | Register/login/refresh/logout, profile and session hardening; current refresh-reuse regression passes hosted. |
| M2 — Repo metadata/quyền đọc | Implemented; local report and hosted regression | CRUD, private/public policy, quota số repo, restore/purge and storage reset/generation are present. |
| M3 — Source/Git read | Implemented | Browser, Markdown/image, commits, public/private clone/fetch and PAT read scope. Historical detailed report remains dated 30/09. |
| M4 — PAT/push | Implemented; M4 report and hosted regression | receive-pack, WRITE/OWNER, hook/ref protection and global quotas; direct Render stream still needs cloud smoke. |
| M5 — Invitation/member | Implemented; M5 report and hosted regression | Owner invitations, accept/decline, member role management, audit and UI. |
| M6 — PR/diff/merge | Implemented; partial acceptance | PR API/UI, compare/diff and merge commit; current hosted journey and write-race tests pass. Broader conflict/crash/reconciliation matrix remains. |
| M7 — Admin/hardening | Implemented; partial acceptance | Admin CLI/dashboard/audit/jobs/security controls are present. Hosted CI verifies two maintenance-service instances on independent PostgreSQL sessions do not overlap; cloud scheduler startup/sleep and proxy/IP behavior remain unverified. |
| M8 — Deploy demo | Pending user resource/hostname choice | Vercel/Render/Neon are not provisioned or tested; direct Git, restart/reset, recovery and public release smoke remain. |

Các báo cáo M2/M4/M5 nêu phạm vi và commit nghiệm thu local tại thời điểm đó; không dùng chúng thay cho hosted regression hiện tại. Trạng thái tích hợp và phần còn mở được theo dõi trong ledger và next-actions.

## Các phần M3 đã hoàn thành local

| Phần | Sản phẩm |
| --- | --- |
| M3.1 | Branch API/selector, validation ref/path, trạng thái empty/reset/missing |
| M3.2 | Tree, breadcrumb, deep link, chuyển branch/path |
| M3.3 | Blob/code viewer, binary/large/truncated, số dòng |
| M3.4 | README theo branch/thư mục, Markdown an toàn và ảnh được kiểm tra |
| M3.5 | Commit history phân trang/snapshot và detail |
| M3.6 | Public Smart HTTP upload-pack, clone/fetch và clone dialog |
| M3.7 | Private Git bằng PAT; OWNER/READ/WRITE; create/list/revoke token và UI |
| M3.8 | Hồi quy, full-stack/CLI, lifecycle, telemetry Git read và tài liệu |

Giới hạn hiện có: 1.000 branch/mục tree; lệnh đọc thường timeout 15 giây; blob/image tối đa 1 MiB, preview text 128 KiB/2.000 dòng; commit history 20/trang. Transport có 4 process/backend instance, 60 giây/process, negotiation request 1 MiB trước/sau gzip; Next proxy timeout 95 giây. Đây là giới hạn code local, không cam kết năng lực hosting.

## Việc còn lại và tiêu chí nghiệm thu

Chi tiết task/owner nằm trong [next-actions](docs/next-actions.md). Ưu tiên kế tiếp:

1. Giữ hai test advisory-lock regression trong CI; repository lock qua process con và maintenance batch giữa hai service instance/DB sessions đã đạt hosted. E2E không chạy local vì cấu hình máy trỏ tới database phát triển.
2. Hoàn thiện failure/crash/reconciliation matrix cho merge và các lifecycle race còn lại; kiểm tra quota API đầy đủ.
3. Khi người dùng chọn tài khoản/tài nguyên Vercel–Render–Neon, hostname và phạm vi truy cập, chạy direct Git HTTPS smoke với payload trên 4,5 MB, cold start, restart/reset, mất source và recovery.
4. Khi Docker Engine local sẵn sàng, smoke service Compose thật trên PostgreSQL/Git fixture riêng. Không xóa volume hoặc dùng database đang chứa dữ liệu.
5. Cập nhật báo cáo theo commit, lệnh, output và phần chưa kiểm chứng; chỉ công bố demo sau khi checklist cloud được ký nhận.

Giới hạn cần công bố: storage Git trên Render Free là ephemeral; metadata PostgreSQL còn lại không khôi phục được commit đã mất. CI/local không thay thế smoke trên tài nguyên cloud đã chọn.

## Definition of Done chung

Một milestone chỉ đóng khi có luồng thành công/lỗi/loading/empty/unauthorized, backend authorization tests, migration/API/UI/tài liệu đồng bộ, lint/typecheck/build và test liên quan đạt, thao tác nhạy cảm có audit phù hợp, không log secret/source private và có cách chạy tái lập. Ghi ngày/commit/môi trường/phạm vi chưa kiểm chứng vào báo cáo.
