# Mục tiêu và nghiệp vụ

Code Forge là MVP lưu trữ và cộng tác Git cho nhóm nhỏ: tài khoản, repository public/private, đọc source, Git HTTP(S), lời mời, pull request và quản trị. Source hiện tại hỗ trợ các luồng dưới đây; xem [bằng chứng kiểm thử](ket-qua-kiem-thu.md) để biết phần đã được xác nhận.

## Chức năng hiện có

- Đăng ký/đăng nhập, refresh/logout; đổi username, email, mật khẩu và ảnh đại diện tại `/settings`; PAT tại `/settings/tokens`.
- Tạo repository rỗng hoặc có README; sửa mô tả/visibility, bật/tắt bảo vệ nhánh mặc định, xóa mềm và restore.
- Đọc branch/tree/file/README, tìm file, lịch sử và chi tiết commit với diff từng file. File nhị phân hoặc quá giới hạn có thông báo riêng.
- Clone/fetch/push qua HTTP(S). Owner mời READ/WRITE bằng username; người nhận phải accept tại `/invitations` trước khi có quyền.
- PR giữa hai nhánh cùng repo: tạo, sửa/đóng/mở lại, xem commits/files/diff, merge commit có hai parent. Owner có thể cấp quyền merge riêng cho member WRITE.
- Admin quản lý user/repository, audit, đối soát journal và write-freeze; system role ADMIN không tự cấp quyền đọc private hoặc merge.

## Quyền repository

| Hành động | Khách/người ngoài | READ | WRITE | OWNER |
| --- | --- | --- | --- | --- |
| Đọc/clone public ACTIVE | Có | Có | Có | Có |
| Đọc/clone private ACTIVE | Không | Có | Có | Có |
| Push nhánh hợp lệ, tạo PR | Không | Không | Có | Có |
| Sửa/đóng/mở lại PR | Không | Không | PR của mình | Có |
| Merge PR | Không | Không | Khi `canMerge=true` | Có |
| Sửa repo, bảo vệ nhánh, member/lời mời, xóa/restore | Không | Không | Không | Có |

Owner lấy từ `Repository.ownerId`; member chỉ có READ/WRITE. Hạ xuống READ không giữ quyền merge hiệu lực. Backend kiểm tra lại quyền và trạng thái tại thời điểm thao tác.

## Những quy tắc cần hiểu

- **Web khác Git:** web dùng session/cookie; Git dùng Basic username + PAT. Token cần đúng scope và user cần quyền repo; `repo:write` không ngầm bao gồm `repo:read`.
- **Private:** mở URL trực tiếp, clone hoặc tìm trong hồ sơ owner sau khi đăng nhập và đã có quyền. Hồ sơ anonymous chỉ liệt kê public; frontend tải danh sách được phép xem bằng request có xác thực. Danh sách khám phá công khai không phải danh sách private của collaborator.
- **Không lộ private:** web không có quyền trả 404; Git thiếu credential hợp lệ trả 401 kèm Basic challenge, có PAT hợp lệ nhưng thiếu quyền trả 404.
- **Push:** chỉ nhận branch, fast-forward và quota hợp lệ; không hỗ trợ tags. Nhánh mặc định không được xóa. Bảo vệ bật mặc định: sau khởi tạo, cập nhật nhánh này qua PR; owner có thể tắt bảo vệ để cho phép push fast-forward. Xem mục nhánh mặc định bên dưới.
- **Danh tính:** người push lấy từ tài khoản xác thực; author/committer là metadata Git, có thể khác nhau và không chứng minh tài khoản đã xác minh. Avatar tài khoản không tự gán cho tác giả commit theo tên/email Git.
- **Thu hồi:** request sau kiểm tra quyền mới; không cam kết hủy mọi byte của stream đã được cấp quyền. User bị khóa không đăng nhập/ghi được; repo public ACTIVE vẫn đọc anonymous được.
- **Xóa:** soft-delete mặc định 30 ngày; vẫn giữ tên/quota đến khi purge. Restore metadata không khôi phục source đã mất.
- **Merge:** kiểm tra SHA, version, storage generation và khóa repo; kết quả chưa rõ được giữ journal để đối soát, không tự rollback ref.

## Nhánh mặc định

- Repo rỗng lấy **nhánh đầu tiên push thành công** làm mặc định; ví dụ push `develop` trước thì web/PR/clone dùng `develop`.
- Lần push đầu phải tạo đúng một nhánh. Push nhánh mặc định trước, sau đó mới push các nhánh khác.
- Tạo repo kèm README khởi tạo `main`. Repo đã có nhánh giữ mặc định hiện tại; tạo branch trên máy local chưa đổi server.

### Bảo vệ và quyền

`protectDefaultBranch=true` mặc định. Sau khởi tạo, không push trực tiếp lên nhánh mặc định; cập nhật bằng PR do owner hoặc member WRITE có `canMerge=true` merge. Owner có thể tắt bảo vệ trong Settings để cho phép push fast-forward theo quyền WRITE/OWNER.

Tắt bảo vệ không cho phép xóa nhánh mặc định, non-fast-forward/force push, tags hoặc vượt quota. PAT vẫn cần scope và quyền user phù hợp.

Git symbolic HEAD và `Repository.defaultBranch` được đồng bộ khi hoàn tất push. Nếu SQL/HEAD completion lỗi, journal giữ bằng chứng để đối soát và thử lại an toàn; không sửa ref/SQL thủ công. Xem [recovery](van-hanh/khoi-phuc-thao-tac-git.md).

## Quota và phạm vi

Mặc định: 20 repo/user, 500 MiB/repo, 25 MiB/file, 100 MiB/push. Quota cấu hình toàn cục bằng env; giới hạn preview là cơ chế riêng.

Chưa có SSH, LFS, fork/organization, Issues, bình luận/review PR, notification, squash/rebase merge, releases, CI cho repo người dùng, email verification/reset password hoặc 2FA. Theme sáng/tối đã có; i18n chưa có.

Demo cloud dùng metadata PostgreSQL tách khỏi Git filesystem. Mất filesystem có thể làm repo reset về rỗng dù metadata còn. Không dùng làm nơi giữ bản source duy nhất trước khi có lưu trữ bền vững và backup/restore đã nghiệm thu. Công việc mở nằm tại [remaining-tasks](cong-viec-con-lai.md).
