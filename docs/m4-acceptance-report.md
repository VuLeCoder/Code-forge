# Báo cáo nghiệm thu M4 — Git push

Ngày nghiệm thu: **28/10/2026**

Commit nền: `7f7e397`

Kết luận: **Đạt local**

## Phạm vi

M4 hoàn thiện Git Smart HTTP push trên đường dẫn frontend hiện có: receive-pack, Basic username + PAT, scope `repo:write`, quyền WRITE/OWNER, pre-receive protection, quota ghi cấu hình được, hướng dẫn UI và regression test xuyên Next/Nest/PostgreSQL/Git.

Invitation/member mutation UI, pull request/merge, audit đầy đủ cho mọi lần push, admin và deployment thật không thuộc M4; các phần này nằm ở M5–M8.

## Contract đã chốt

| Hạng mục | Quy tắc |
| --- | --- |
| Xác thực | Basic username + PAT; push cần scope `repo:write` |
| Quyền repository | Chỉ member WRITE hoặc OWNER; ADMIN không được mặc định đọc/ghi private |
| Scope | `repo:write` không ngầm bao gồm `repo:read`; UI tạo token ghi kèm cả hai scope |
| Ref | Chỉ `refs/heads/*`; đầu ref mới phải là commit; cập nhật ref hiện hữu phải fast-forward |
| Xóa branch | Cho phép branch thường, không cho xóa default branch |
| Quota file | `MAX_FILE_BYTES`, mặc định 26214400 byte (25 MiB), đo kích thước blob |
| Quota push | `MAX_PUSH_BYTES`, mặc định 104857600 byte (100 MiB), đo HTTP body nhận vào và dữ liệu sau gzip |
| Quota repository | `MAX_REPOSITORY_BYTES`, mặc định 524288000 byte (500 MiB), kiểm tra tổng object logic reachable và object storage vật lý trong quarantine/current directories |
| Failure | Hook chạy trước cập nhật ref; force-push, ref/quota sai không làm dịch chuyển ref |

## Kết quả nghiệp vụ

| Hạng mục | Kết quả |
| --- | --- |
| OWNER push branch mới và fast-forward | Đạt |
| WRITE member push, xóa branch thường | Đạt |
| READ/member bị thu quyền/token chỉ đọc bị chặn | Đạt |
| Token hết hạn/thu hồi và user/repository bị khóa bị chặn | Đạt |
| `repo:write` đơn lẻ không clone/fetch được | Đạt |
| Force-push, tag namespace và xóa default branch bị chặn | Đạt |
| Vượt file/repository/push quota bị chặn, ref cũ giữ nguyên | Đạt |
| Git CLI push qua Next proxy và backend thật | Đạt |
| Hook được đóng gói vào production `dist` và giữ quyền thực thi | Đạt |
| UI PAT/Clone hiển thị scope và lệnh push phù hợp quyền | Đạt |

## Quality gates

| Gate | Kết quả |
| --- | --- |
| Backend unit/Git lifecycle | 36/36 test đạt |
| Auth HTTP + PostgreSQL | 6/6 test đạt |
| Repository HTTP + PostgreSQL/Git | 12/12 test đạt |
| Frontend browser trên production build | 34/34 test đạt |
| Full-stack Next/Nest/PostgreSQL/Git | 2/2 hành trình đạt, gồm push thật qua Next |
| Backend/frontend lint, typecheck và build | Đạt |
| `git diff --check` | Đạt tại thời điểm chốt thay đổi |

Các test tích hợp tạo schema PostgreSQL và Git storage tạm rồi tự dọn. Không dùng dữ liệu phát triển hiện hữu làm fixture phá hủy.

## Giới hạn và backlog không chặn M4

- Quota là giới hạn toàn cục từ environment; override theo từng user/repository chưa có contract và thuộc hardening/admin sau này.
- Tổng object logic đếm object reachable duy nhất sau push; physical quota đo object directories tại pre-receive. Garbage collection/maintenance dài hạn chưa có job riêng.
- M4 chưa thêm audit row bền vững cho từng push; transport có event log allowlist `git_write` không chứa credential/source. Audit nghiệp vụ đầy đủ thuộc M7.
- Git storage demo chưa có backup/persistent-storage guarantee; deployment thực và smoke test nằm ở M8.
- Git LFS, protected-branch rules tùy chỉnh và force-push có cấu hình nằm ngoài MVP.
