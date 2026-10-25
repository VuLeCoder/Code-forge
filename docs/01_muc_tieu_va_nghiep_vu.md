# 01 — Mục tiêu và nghiệp vụ

## Dự án giải quyết việc gì?

Code Forge cung cấp nơi lưu trữ và cộng tác trên mã nguồn Git: người dùng có tài khoản, tạo repository public/private, đọc code trên web, làm việc bằng Git CLI và đề xuất thay đổi qua pull request. Đây là MVP học tập/demo, chưa có cam kết vận hành như dịch vụ lưu trữ source production.

Hành trình khi **MVP hoàn thiện**:

1. Người dùng đăng ký, đăng nhập và tạo repository, có thể khởi tạo README trên branch `main`.
2. Chủ repository chọn public/private; khách đọc và clone public, người có quyền đọc được private.
3. Người dùng tạo Personal Access Token (PAT), dùng username + PAT để xác thực Git HTTP(S).
4. Owner mời một tài khoản bằng username với quyền READ hoặc WRITE; quyền chỉ có sau khi người nhận chấp nhận.
5. WRITE/OWNER push branch, tạo PR giữa hai branch trong cùng repository.
6. Owner xem commits/diff rồi merge PR không conflict; hệ thống chống ghi đè thay đổi khi có thao tác đồng thời.
7. Admin quản lý tài khoản và trạng thái repository, xem audit. Admin không tự có quyền đọc source private.

Các bước 4–7 và push đã có implementation trong source hiện tại. Hosted CI gần nhất trên `7e0aa27` xác nhận các journey chính cùng test Git/PostgreSQL/advisory lock; các failure/crash matrix rộng hơn và cloud smoke vẫn mở. Xem [ledger nghiệm thu](implementation-status.md) và [các việc còn lại](next-actions.md).

## Vai trò và quyền mục tiêu

| Hành động | Khách/user không có quyền repo | READ | WRITE | OWNER |
| --- | --- | --- | --- | --- |
| Xem, clone/fetch public ACTIVE | Có | Có | Có | Có |
| Xem, clone/fetch private | Không | Có | Có | Có |
| Push branch hợp lệ | Không | Không | Có | Có |
| Tạo PR | Không | Không | Có | Có |
| Sửa/đóng PR của mình | Không | Không | Có | Có |
| Merge PR | Không | Không | Không | Có |
| Sửa repo, visibility, xóa/restore | Không | Không | Không | Có |
| Quản lý member/lời mời | Không | Không | Không | Có |

`OWNER` được xác định bằng `Repository.ownerId`. `RepositoryMember` chỉ có READ/WRITE; không tạo member role OWNER. Một user có thể sở hữu repo A nhưng chỉ có READ ở repo B. `ADMIN` là system role riêng, không nằm trên thang quyền repository; quyền quản trị metadata/status không cấp quyền đọc private hoặc merge.

Frontend phản ánh quyền để người dùng thao tác đúng; backend phải kiểm tra quyền ở mọi endpoint. Quyền push/PR trong bảng là yêu cầu MVP, không có nghĩa các endpoint đó đã tồn tại.

## Các quy tắc cần giữ

- **Web và Git xác thực khác nhau:** web dùng cookie/access token và refresh session; Git dùng Basic username + PAT. Đăng nhập web không thay cho PAT khi clone private.
- **PAT không tự cấp quyền repository:** quyền hiệu lực cần cả scope token và quyền của user. `repo:write` không ngầm bao gồm `repo:read`. Secret chỉ hiện một lần, DB lưu hash, token có hạn và thu hồi được.
- **Private không được lộ qua lỗi:** web không có quyền trả 404. Git chưa có PAT hợp lệ dùng 401 + Basic challenge đồng nhất; có PAT hợp lệ nhưng không có quyền trả 404. Giữ cả trường hợp repo không tồn tại/deleted/locked trong kiểm thử.
- **Thu hồi quyền:** request tiếp theo phải kiểm tra trạng thái mới. Stream đã authorize có thể hoàn tất; không hứa hủy tức thì mọi byte đang truyền.
- **User bị khóa:** chặn đăng nhập và thao tác ghi của user; public repository còn ACTIVE vẫn đọc anonymous được. Khóa repository là thao tác riêng.
- **Tên repository:** duy nhất theo owner sau normalize; đổi tên không đổi UUID/storageKey. Repo soft-delete vẫn giữ tên và tính quota đến khi purge.
- **Xóa:** mặc định soft-delete 30 ngày, có restore trong thời hạn; purge xóa storage rồi metadata. Restore metadata không khôi phục được source đã mất khỏi filesystem.
- **PR:** cùng repository, không fork; OPEN/MERGED/CLOSED; chỉ owner merge bằng merge commit. Kiểm tra lại quyền, branch và SHA tại thời điểm ghi ref.
- **Lời mời:** trong ứng dụng theo username, không gửi email. PENDING/ACCEPTED/DECLINED/EXPIRED/REVOKED; chưa accept thì chưa có quyền.

## Phạm vi, quota và giới hạn demo

Quota MVP đã triển khai từ environment: 20 repository/user, 500 MiB/repository, 25 MiB/file, 100 MiB/push. Các trường hợp biên chính có trong báo cáo M4; ma trận quota API đầy đủ vẫn là kiểm thử mở. Giới hạn preview source là cơ chế riêng, không phải quota upload.

Hạ tầng demo dự kiến là Vercel + Render + Neon. Thiết kế chấp nhận Git storage không bền vững: khi metadata còn nhưng bare repo mất, tạo lại repo rỗng và báo reset. PostgreSQL giữ metadata không đồng nghĩa giữ lịch sử commit. Khi triển khai, kiểm chứng điều kiện hosting thực tế và công bố giới hạn; khi cần bảo toàn source phải bổ sung persistent storage/backup/restore.

Ngoài MVP: SSH, Git LFS, fork, organization, issue, star, notification, CI/review/approval rules, release, wiki, tìm kiếm source, transfer ownership, email verification/reset password, dark theme và i18n.

Điều chỉnh quota theo từng user/repo nằm ngoài scope hiện tại; kế hoạch đã chốt quota toàn cục và chưa có override theo đối tượng.

Tài liệu nguồn còn hiện hữu trong repository: [nghiệm thu M2](m2-acceptance-report.md), [nghiệm thu M4](m4-acceptance-report.md), [nghiệm thu M5](m5-acceptance-report.md), [ledger implementation](implementation-status.md) và [next actions](next-actions.md). Tài liệu yêu cầu/kế hoạch cũ được dẫn trong bản trước không có tại các đường dẫn đó trong checkout này.
