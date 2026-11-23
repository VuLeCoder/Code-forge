# Triển khai demo Code Forge

Rà soát source 23/11/2026. Phạm vi từng được ghi nhận: backend Render + PostgreSQL Neon, frontend local; frontend cloud/Vercel chưa được nghiệm thu. Không kiểm tra lại dashboard/deployment trong lần cập nhật tài liệu này. Lịch sử và checklist tại [cloud smoke](danh-sach-kiem-tra-trien-khai.md).

## Kiến trúc và giới hạn

- Backend dùng [Dockerfile](../../backend/Dockerfile); migration chạy riêng bằng [Dockerfile.migrate](../../backend/Dockerfile.migrate).
- Next dùng backend origin qua `BACKEND_URL`. Clone URL cloud dùng `GIT_PUBLIC_BASE_URL=https://<backend-host>/api/v1`, đi thẳng backend; không đưa Git payload lớn qua frontend proxy.
- Prisma 6 trong repo dùng runtime URL và `directUrl`; advisory lock/migration cần kết nối direct. Neon hướng dẫn cấu hình pooled/direct tại [Prisma guide](https://neon.com/docs/guides/prisma).
- Render Free có filesystem ephemeral và không gắn persistent disk; restart/redeploy/spin-down có thể làm mất bare Git source. Metadata Neon còn không chứng minh source còn. [Render Free](https://render.com/docs/free).
- Không nhận bản source duy nhất của người dùng khi chưa có durable storage/backup/restore đã kiểm chứng. Background job có thể chậm khi service ngủ.

## Biến môi trường backend

| Biến | Cấu hình triển khai |
| --- | --- |
| `NODE_ENV`, `PORT`, `API_PREFIX` | `production`, cổng host cấp, `api/v1` |
| `DATABASE_URL` | Runtime pooled URL từ secret manager |
| `DATABASE_URL_UNPOOLED` | Direct URL cho advisory lock/migration |
| `GIT_STORAGE_PATH` | Thư mục writable, thường `/data/git`; phải ghi rõ durability |
| `FRONTEND_ORIGIN` | Origin frontend thực tế, không có path |
| `GIT_PUBLIC_BASE_URL` | Backend HTTPS + `/api/v1`, không có `/` cuối |
| `JWT_ACCESS_SECRET`, `RATE_LIMIT_PROXY_SECRET` | Secret riêng ≥32 ký tự; proxy secret trùng ở Next server/Nest |
| `COOKIE_SECURE`, `COOKIE_SAME_SITE` | `true`, thường `lax`; kiểm chứng cookie/origin thực tế |
| `TRUST_PROXY_HOPS` | Theo topology đã xác minh, không bật blanket trust |
| `WRITE_FREEZE_BOOTSTRAP` | Bắt buộc `true` trong production |
| `WRITE_FREEZE_DRAIN_TIMEOUT_MS` | Mặc định 60000 ms |
| TTL/quota/retention | Default và giới hạn tại [environment.ts](../../backend/src/config/environment.ts); không có override theo user/repo |

Next server cần `BACKEND_URL=https://<backend-host>` (không prefix), `APP_ORIGIN` và `RATE_LIMIT_PROXY_SECRET`. Không expose secret qua biến public hoặc bundle. `.env.example`/Compose chỉ chứa cấu hình local, không dùng secret mẫu trên cloud.

## Trình tự release

1. Chọn SHA đã qua [MVP verification](../../.github/workflows/ci.yml); xác nhận target, quyền operator, hostname, migrations và khả năng tương thích rollback.
2. Xác minh ứng dụng đích hỗ trợ write-freeze. Admin bật freeze và chờ `activeWriteCount=0`; không lấy restart thay drain.
3. Backup metadata có mã hóa/checksum/quyền restore; clone Git dự phòng đủ refs/objects. Diễn tập restore vào đích cô lập trước release.
4. Build hai image từ cùng SHA. Inject DB URLs qua secret manager, chạy one-shot `prisma migrate deploy`; chỉ tiếp tục khi exit 0 và migration history khớp. Không sửa migration đã áp dụng/reset DB.
5. Deploy backend khởi động frozen; chạy các smoke có thể thực hiện khi frozen. Nếu cần mutation cho fixture, operator mở ghi trong cửa sổ kiểm thử có kiểm soát, chạy smoke bắt buộc và freeze lại ngay nếu thất bại. Chỉ mở traffic sử dụng bình thường sau khi nghiệm thu đạt.
6. Ghi SHA, URL, thời gian và kết quả riêng local/CI/cloud. Không công bố frontend cloud khi chưa có host/nghiệm thu.

Chi tiết thao tác và điều kiện dừng: [operator runbook](huong-dan-van-hanh-render-neon-mien-phi.md). Chưa có target/backup/recovery được xác nhận thì không deploy/migrate.

## Rollback và phục hồi

- Rollback image ứng dụng chỉ khi migration tương thích ngược đã được chứng minh; giữ DB, không tự revert SQL.
- Migration lỗi/không rõ kết quả: giữ freeze, kiểm tra log sạch secret và migration status, chọn bước forward-only có review; không retry mù.
- Push/merge chưa rõ kết quả: dùng [journal recovery](../van-hanh/khoi-phuc-thao-tac-git.md), không sửa SQL/ref để bỏ hàng rào.
- Source mất: backup metadata riêng không đủ. Dùng clone dự phòng đã kiểm tra, xác nhận repo/generation đích và chỉ phục hồi branch được duyệt. Push nhánh mặc định trước vào repo rỗng, rồi từng branch còn lại; không dùng `--mirror`, `--all`, `--tags` hoặc force-push. Server hiện chỉ nhận `refs/heads`; tag/object ngoài phạm vi này phải giữ trong backup, chưa có luồng khôi phục tag qua API Git hiện tại.
- Kiểm chứng clone/fetch, content/refs sau phục hồi. PR generation cũ không tự dùng lại source mới; tạo PR mới theo dữ liệu phục hồi.
