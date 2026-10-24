# Báo cáo nghiệm thu M5 — Quản lý thành viên và lời mời

Ngày nghiệm thu: **24/10/2026**

Commit nền: `09323be`

Kết luận: **Đạt local**

## Phạm vi

M5 hoàn thiện hệ thống quản lý thành viên và chu trình lời mời cộng tác (Invitation & Member Management) xuyên suốt database, backend NestJS, frontend Next.js và kiểm thử tự động:

- Migration `invitations` với trạng thái `PENDING`, `ACCEPTED`, `DECLINED`, `EXPIRED`, `REVOKED` và partial unique index ngăn lời mời trùng lặp.
- API Owner: mời cộng tác viên theo username, xem danh sách lời mời, thu hồi lời mời, xem danh sách thành viên, cập nhật vai trò (READ/WRITE), xóa thành viên khỏi repository.
- API Invitee: xem danh sách lời mời cá nhân đang chờ duyệt, chấp nhận hoặc từ chối lời mời với tính nhất quán giao dịch (transactional consistency).
- Quyền hạn có hiệu lực tức thời (immediate effect) trên các yêu cầu Git HTTP và Web tiếp theo khi phân quyền thay đổi.
- Giao diện người dùng: mục quản trị thành viên/lời mời trong Repository Settings (`/[username]/[repo]/settings`), trang Lời mời cá nhân (`/invitations`), liên kết điều hướng trên Header và các route proxy an toàn.

Pull request/diff/merge (M6), Admin/Audit nâng cao (M7) và Deployment thực tế (M8) không thuộc phạm vi M5.

## Contract đã chốt

| Hạng mục | Quy tắc |
| --- | --- |
| Xác thực & Quyền | Chỉ OWNER của repository mới có quyền mời, xem danh sách lời mời, thu hồi, đổi vai trò và xóa thành viên |
| Anti-leakage | Người dùng không có quyền truy cập repository nhận 404 thay vì 403 khi truy cập endpoint quản lý thành viên |
| Ràng buộc mời | Không cho phép tự mời chính mình; không mời người dùng đã là thành viên; không tạo lời mời khi đã có lời mời `PENDING` |
| Ràng buộc vai trò | Không thể hạ quyền hoặc xóa chính OWNER; vai trò hỗ trợ `READ` và `WRITE` |
| Vòng đời lời mời | Hỗ trợ 5 trạng thái; thời hạn mặc định 7 ngày; accept/decline kiểm tra lại trạng thái trong database transaction |
| Hiệu lực phân quyền | Thao tác đổi vai trò hoặc xóa thành viên cập nhật trực tiếp bảng `repository_members`, có hiệu lực ngay ở request kế tiếp |
| Audit logging | Ghi nhận sự kiện audit log cho các thao tác mời, thu hồi, chấp nhận, từ chối, cập nhật vai trò và xóa thành viên |

## Kết quả nghiệp vụ

| Hạng mục | Kết quả |
| --- | --- |
| Owner mời người dùng hợp lệ với vai trò READ/WRITE | Đạt |
| Ngăn chặn tự mời chính mình hoặc mời thành viên hiện hữu | Đạt |
| Ngăn chặn tạo trùng lời mời `PENDING` bằng partial index | Đạt |
| Owner thu hồi lời mời chuyển trạng thái sang `REVOKED` | Đạt |
| Người được mời xem danh sách lời mời cá nhân tại `/invitations` | Đạt |
| Người được mời từ chối chuyển trạng thái sang `DECLINED` | Đạt |
| Người được mời chấp nhận chuyển trạng thái `ACCEPTED` và tạo `repository_members` | Đạt |
| Lời mời hết hạn (`EXPIRED`) hoặc bị thu hồi không thể chấp nhận | Đạt |
| Thay đổi vai trò thành viên có hiệu lực ngay lập tức với quyền Git/Web | Đạt |
| Xóa thành viên thu hồi toàn bộ quyền đọc/ghi ngay lập tức | Đạt |
| Giao diện Settings hiển thị danh sách thành viên, phân quyền và lời mời | Đạt |
| Giao diện `/invitations` hiển thị lời mời chờ xử lý với nút Chấp nhận/Từ chối | Đạt |

## Quality gates

| Gate | Kết quả |
| --- | --- |
| Backend unit tests (bao gồm InvitationsService) | 45/45 test đạt (8 suites) |
| Backend E2E tests (HTTP + PostgreSQL + Git + Invitations) | 19/19 test đạt (2 suites) |
| Frontend browser Playwright tests | 36/36 test đạt |
| Backend & Frontend linting (ESLint) | Đạt (0 errors, 0 warnings) |
| Backend & Frontend typecheck (TypeScript) | Đạt (0 errors) |
| Frontend production build (`next build`) | Đạt |
| `git diff --check` | Đạt không lỗi whitespace hay cú pháp |

Tất cả các bài kiểm thử tự động sử dụng schema và database PostgreSQL thật trên môi trường phát triển local, tự động dọn dẹp dữ liệu kiểm thử sau khi hoàn thành.

## Giới hạn và backlog không chặn M5

- Hệ thống thông báo qua Email hoặc Webhook khi có lời mời mới thuộc backlog tương lai, chưa nằm trong phạm vi local core MVP.
- Quản lý nhóm/tổ chức (Organization/Teams) là tính năng mở rộng ngoài mô hình cộng tác viên trực tiếp (Direct Collaborator).
- Cơ chế tự động quét chuyển trạng thái `EXPIRED` qua cron/background job nền định kỳ sẽ được hoàn thiện trong M7 (Hardening & Background Jobs).
