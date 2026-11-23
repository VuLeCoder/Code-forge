# Frontend Code Forge

Next.js App Router + React, CSS Modules và theme variables. Chạy từ root bằng `corepack pnpm dev:frontend`; cần backend riêng. Hướng dẫn env/test tại [chạy và kiểm thử](../chay-va-kiem-thu.md).

| Route | Chức năng |
| --- | --- |
| `/`, `/explore` | Giới thiệu, demo Git minh họa, khám phá/tìm public repo |
| `/login`, `/register` | Xác thực và return URL |
| `/settings`, `/settings/tokens` | Account/avatar/password; tạo/revoke PAT |
| `/new`, `/:username` | Tạo repo; hồ sơ, repo được phép xem, restore cho owner |
| `/:username/:repo` | Tổng quan, branch/tree/file/README, tìm file, lịch sử/chi tiết commit |
| `/:username/:repo/guide` | Hướng dẫn sử dụng repo |
| `/:username/:repo/pulls`, `/pulls/:number` | Danh sách/tạo PR; compare/files/diff, lifecycle và merge |
| `/:username/:repo/settings`, `/invitations` | Repo settings, protection/member/merge grant; nhận lời mời |
| `/admin` | User/repo/audit, journal reconciliation, write-freeze |

Source chính: `frontend/src/app`, `components`, `lib`. Server Components đọc dữ liệu; Client Components xử lý tương tác/session. `app/api/v1` proxy REST; `app/git` proxy Git local. Quyền cuối cùng do backend quyết định.

Avatar dùng component chung. Activity người push lấy avatar từ tài khoản theo actor ID; avatar của chính mình cập nhật qua auth context, tài khoản khác theo lần tải dữ liệu. Không gán avatar tài khoản cho author Git khi chưa có liên kết xác minh.

Chi tiết commit có metadata rút gọn và mục “Thông tin chi tiết” chứa SHA/parents/metadata đầy đủ. Author viết thay đổi; committer ghi commit vào lịch sử. Khi hai danh tính/thời gian giống nhau, phần tóm tắt tránh lặp. Diff từng file có dòng cũ/mới, thêm/xóa, lọc file và thu gọn; binary/truncated/unavailable có trạng thái riêng.

## Ranh giới

- Next.js App Router/React/TypeScript, CSS Modules và CSS toàn cục; không có UI framework riêng.
- Nest sở hữu auth, policy, quota, Git và journal. Frontend dùng permission API để hiển thị thao tác; ẩn nút không thay cho kiểm tra backend.
- REST proxy dưới `app/api/v1`; Git proxy local dưới `app/git`. Giữ contract cookie/Origin/IP signature, stream và cancellation khi đổi UI.
- Profile server tải public trước; client có session tải lại repo owner mà viewer được phép đọc. Không biến API failure thành danh sách rỗng hợp lệ.

## Thành phần và dữ liệu

| Khu vực | Quy tắc |
| --- | --- |
| Header/account | Auth context, theme sáng/tối, tìm kiếm; avatar dùng shared component |
| Repository cards | Tên nổi bật nhất, mô tả nhỏ hơn tên nhưng lớn hơn thời gian cập nhật |
| Source viewer | Sidebar thu gọn/mở lại; giữ file/branch trong URL; code cuộn trong panel, không kéo giãn cả layout |
| Commit browser | Pagination/filter/snapshot; summary metadata và details; diff từng file từ API |
| PR | Compare snapshot, version/generation/SHA, lifecycle và `canMerge`; trạng thái đối soát khác thành công |
| PAT/settings/admin | Dialog/pending/error/focus rõ; plaintext PAT chỉ xuất hiện lúc tạo |

Không tự dựng stars, contribution heatmap, last commit từng file hoặc số liệu backend không cung cấp. File preview bị cắt không được tải xuống như nội dung đầy đủ. Author Git không phải actor tài khoản đã xác minh.

## Kiểm tra khi thay đổi

1. Giữ URL/back/reload/branch, auth và quyền READ/WRITE/OWNER, member merge grant.
2. Phân biệt loading, error, empty, unauthorized và reset storage.
3. Kiểm tra sáng/tối, keyboard/focus/reduced motion; code/diff escaped và cuộn độc lập.
4. Source viewer hiện ưu tiên laptop 1366/1440 px. Các test mobile khác vẫn có; chưa coi đó là nghiệm thu file viewer trên thiết bị nhỏ hoặc screen reader.
5. Không chạy build/browser suite đồng thời vì dùng chung artifact; xem [lệnh kiểm tra](../chay-va-kiem-thu.md).

Xem [hệ thống thiết kế](../thiet-ke-giao-dien/he-thong-thiet-ke.md), [kết quả kiểm thử](../ket-qua-kiem-thu.md). Đọc `frontend/AGENTS.md` và tài liệu Next đã cài trước khi sửa code.
