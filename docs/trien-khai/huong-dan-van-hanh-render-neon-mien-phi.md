# Runbook operator — Render + Neon

Cập nhật 23/11/2026. Đây là quy trình; không cấp quyền deploy hoặc chứng minh cloud hiện tại đã đạt. Xem [cấu hình deployment](README.md), [cloud checklist](danh-sach-kiem-tra-trien-khai.md) và [task mở](../cong-viec-con-lai.md).

## Preflight bắt buộc

1. Ghi target Render/Neon, release SHA, URL, thời gian, người thực hiện và quyền thao tác. Kiểm tra revision/auto-deploy thực tế; không dựa vào dashboard lịch sử.
2. Xác minh CI của đúng SHA, image/migration và rollback compatibility. Đối chiếu tên biến với [bảng env](README.md#biến-môi-trường-backend), không in giá trị secret.
3. Chuẩn bị metadata backup được mã hóa/checksum, quyền restore tối thiểu, thời hạn lưu và diễn tập restore vào đích cô lập. Xóa artifact plaintext sau rehearsal. History window provider không thay thế backup đã đọc/restore được.
4. Kiểm tra clone Git dự phòng: remote không chứa credential, đủ branch/tag/objects cần giữ và connectivity. Giữ tags trong backup vì receive-pack hiện chưa hỗ trợ tag refs.
5. Xác minh candidate đích có write-freeze và operator có admin session dùng được. Không có target rõ, backup đọc được, clone đủ dữ liệu hoặc freeze/drain khả dụng thì dừng.

Không gửi DB URL/PAT/password/cookie qua chat, issue, command history hoặc log; inject bằng secret manager. Render Free có thể mất source khi restart/redeploy/spin-down; chỉ thao tác demo có chủ sở hữu và phương án recovery đã xác nhận.

## Freeze, migrate, deploy

1. Production cấu hình `WRITE_FREEZE_BOOTSTRAP=true`. Admin gọi `PATCH /api/v1/admin/release/write-freeze` với `{"frozen":true}`; kiểm tra `GET` cùng endpoint trả `frozen=true`, `activeWriteCount=0` và audit. Thiếu endpoint, drain timeout hoặc kết quả không rõ: dừng.
2. Sau drain, chốt backup metadata và Git nhất quán. Readiness/maintenance jobs không chứng minh toàn ứng dụng đã ngừng ghi.
3. Build migration image từ đúng SHA tại root:

   ```bash
   docker build -f backend/Dockerfile.migrate -t code-forge-migrate:release-candidate .
   ```

4. Chạy one-shot job với hai DB URLs inject từ secret manager. Chỉ deploy khi migration exit 0 và lịch sử khớp candidate; lỗi/timeout thì giữ freeze và kiểm tra status/log trước quyết định tiếp.
5. Deploy backend cùng SHA, giữ bootstrap frozen. Login/refresh/logout và freeze control được phép hoạt động để operator điều khiển.

## Smoke và mở ghi

- Kiểm tra health, TLS/origin/proxy/rate limit, auth và read policy trước. Readiness có ghi/xóa file tạm, không phải probe hoàn toàn chỉ đọc.
- Các smoke tạo repo/push/PR/admin mutation cần ghi: operator mở freeze trong cửa sổ fixture có kiểm soát sau backup/migration/deploy, chặn người dùng thường qua cơ chế ingress phù hợp. Nếu không cô lập được cửa sổ này, dừng và chốt phương án trước khi mở ghi.
- Thực hiện [cloud checklist](danh-sach-kiem-tra-trien-khai.md), ghi bằng chứng sạch secret. Nếu lỗi, freeze và drain lại; chỉ mở sử dụng bình thường khi smoke bắt buộc đạt.

## Rollback và sự cố

- App lỗi: chỉ rollback image nếu schema tương thích; không tự rollback SQL hoặc reset migration history.
- Journal mơ hồ: giữ fail-closed, dùng [Git recovery](../van-hanh/khoi-phuc-thao-tac-git.md). Không retry operation mới để che pending journal.
- Source mất: kiểm tra backup, repo đích, generation và branch allowlist; push từng branch, nhánh mặc định trước nếu repo rỗng. Không force/blanket push; tags chưa được server nhận. Kiểm chứng clone/fetch/content sau phục hồi.
- Không drop/truncate/reset DB, xóa volume/storage hoặc rewrite refs để vượt lỗi. Mọi rehearsal có rủi ro chỉ thực hiện trên fixture được duyệt.

Nguồn nền tảng: [Render Free](https://render.com/docs/free), [Neon Prisma](https://neon.com/docs/guides/prisma). Tính năng/gói/quyền thực tế phải được operator xác minh trước release.
