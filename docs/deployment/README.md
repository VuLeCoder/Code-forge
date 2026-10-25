# Release demo Code Forge

Tài liệu này mô tả cách dựng bản demo miễn phí bằng Vercel (frontend), Render (NestJS backend) và Neon (PostgreSQL). Đây là quy trình demo; **không dùng để lưu mã nguồn cần độ bền production**.

## Trạng thái triển khai

Tạo image và chuẩn bị hướng dẫn không chứng minh dịch vụ cloud đã được provision hay smoke test. Trước khi công bố URL, điền release commit, URL thật, thời điểm và kết quả từng bước trong [cloud smoke checklist](./cloud-smoke-checklist.md). Không ghi secret vào repo, ticket hoặc output kiểm thử.

### Bằng chứng hiện tại

Commit code mới nhất trên `thviet` là `edb0ced` (durable Git push journal/audit). Hosted workflow [40147767567](https://github.com/VuLeCoder/Code-forge/actions/runs/40147767567) succeeded trên commit này qua backend unit/E2E, lint, typecheck, build, browser/full-stack E2E, Docker API/migration image checks, migration-image Prisma check/deploy và `git diff --check`.

Local verification trên `edb0ced`: backend unit 15 suites/93 tests và PostgreSQL/Git E2E 8 suites/29 tests; Prisma validate/generate, workspace lint/typecheck/build và `git diff --check` đều đạt. API và migration Docker images đã build; migration image áp dụng đủ 7 migration vào PostgreSQL disposable không mount volume, API readiness trả HTTP 200. Các container kiểm thử đã được dừng/gỡ; không đụng container hoặc volume phát triển có sẵn. `docker compose config` đã được kiểm tra nhưng Compose runtime chưa khởi chạy.

Chưa có cloud deployment hoặc smoke test: nâng cấp từ snapshot production-like, proxy/TLS, Git HTTP trực tiếp Render, cold start, mất source khi restart và quy trình phục hồi vẫn chưa được nghiệm thu. Không suy ra cloud acceptance từ CI hay local image smoke.

Chỉ đánh dấu cloud release đạt sau khi điền kết quả thật theo release commit vào [cloud smoke checklist](./cloud-smoke-checklist.md).

## Kiến trúc và giới hạn

- Vercel phục vụ Next.js. Các Next API routes dùng `BACKEND_URL` làm backend origin và tự thêm `/api/v1`. Git URL mà giao diện cấp cho người dùng lại dùng `GIT_PUBLIC_BASE_URL` để đi thẳng tới Render.
- Render chạy image `backend/Dockerfile`. Render Free không hỗ trợ persistent disk; local filesystem mặc định ephemeral. Vì vậy restart/redeploy/mất instance có thể làm Git bare repository mất đi. Chỉ khi chuyển sang plan hỗ trợ disk mới mount disk vào `/data/git`; disk không biến cấu hình Free thành durable storage. [Render Free limitations](https://render.com/docs/free), [Render Persistent Disks](https://render.com/docs/disks)
- Neon giữ metadata PostgreSQL. `DATABASE_URL` dùng pooled endpoint cho API; `DATABASE_URL_UNPOOLED` dùng direct endpoint cho advisory lock và Prisma migration. Migration chạy riêng bằng `backend/Dockerfile.migrate` trước khi mở traffic phiên bản mới.
- Public clone/fetch/push URL dùng `GIT_PUBLIC_BASE_URL` trỏ thẳng tới Render `/api/v1`; ví dụ `https://<render-host>/api/v1`. URL này tránh giới hạn payload 4,5 MB của Vercel Functions. Chỉ là cấu hình mẫu; URL thực phải được kiểm tra với `git ls-remote`, clone, fetch và push.
- Cookie web cần TLS và domain/origin đúng. Không đặt PAT trong URL hoặc command line có thể lưu vào history.

## Biến môi trường backend

| Biến | Giá trị cloud | Ghi chú |
| --- | --- | --- |
| `NODE_ENV` | `production` | Bắt buộc khi deploy |
| `PORT` | Render cung cấp hoặc `4000` | Backend bind `0.0.0.0` |
| `API_PREFIX` | `api/v1` | Giữ prefix hiện tại |
| `DATABASE_URL` | Neon pooled connection string | Dùng cho Prisma runtime queries |
| `DATABASE_URL_UNPOOLED` | Neon direct connection string | Prisma `directUrl`; dùng cho advisory locks và migration |
| `FRONTEND_ORIGIN` | Origin Vercel chính xác | Không thêm path; preview domains phải được cấu hình có chủ đích |
| `GIT_PUBLIC_BASE_URL` | `https://<render-host>/api/v1` | Không có dấu `/` cuối; Git URL tạo từ base này |
| `GIT_STORAGE_PATH` | `/data/git` | Thư mục bare repo; ghi rõ khi storage bị reset |
| `JWT_ACCESS_SECRET` | Secret ngẫu nhiên ≥32 ký tự | Dùng secret manager của host; không commit |
| `COOKIE_SECURE` | `true` | HTTPS production |
| `COOKIE_SAME_SITE` | `lax` | Phải cân nhắc cookie và domain thực tế trước khi đổi |
| `TRUST_PROXY_HOPS` | `1` trên Render sau khi xác nhận topology | Số hop Express tin cậy; không bật blanket trust. Mặc định local là `0`. |
| `RATE_LIMIT_PROXY_SECRET` | Secret ngẫu nhiên ≥32 ký tự; cùng giá trị tại Vercel và Render | Ký IP do Vercel cung cấp khi Next proxy gọi backend; chỉ lưu trong secret manager, không expose client-side. |
| `MAX_REPOSITORIES_PER_USER` | `20` | Quota MVP toàn cục |
| `MAX_REPOSITORY_BYTES` | `524288000` | 500 MiB |
| `MAX_FILE_BYTES` | `26214400` | 25 MiB |
| `MAX_PUSH_BYTES` | `104857600` | 100 MiB |
| `SOFT_DELETE_RETENTION_DAYS` | `30` | Thời gian restore repo đã xóa mềm |

Vercel cần `BACKEND_URL=https://<render-host>` (không gồm `/api/v1`), `APP_ORIGIN=https://<canonical-vercel-host>` và cùng `RATE_LIMIT_PROXY_SECRET` như backend. `APP_ORIGIN` là expected origin cho các mutation proxy; chỉ thêm preview/custom origins nếu đã quyết định và kiểm thử rõ ràng. Vercel ghi đè `X-Forwarded-For` bằng IP request client ([tài liệu request headers](https://vercel.com/docs/headers/request-headers)); Next proxy chỉ gửi IP đã được ký HMAC, backend bỏ qua header giả/không hợp lệ. Giữ secrets ngoài client bundle. Nếu dùng Vercel phía sau một proxy khác, header/IP contract phải được đánh giá lại trước khi deploy.

Các biến TTL mặc định hiện tại nằm trong `backend/.env.example`; chỉ override khi có acceptance test cho cấu hình mới. Không copy giá trị secret mẫu sang cloud.

`compose.yaml` chỉ dành cho local: dùng `NODE_ENV=development`, PostgreSQL trực tiếp và các secret đánh dấu `local-only-*`; không dùng các giá trị đó cho cloud hoặc môi trường public. Các port host chỉ bind loopback. Chế độ local cho phép `COOKIE_SECURE=false`; production vẫn bắt buộc `COOKIE_SECURE=true` qua kiểm tra backend. Compose config đã được xác thực, nhưng chưa chạy `docker compose up` hoặc health check runtime; cần nghiệm thu riêng trên máy local trước khi coi stack Compose là đã chạy.

## Trình tự release

### 1. Chuẩn bị

1. Chọn release commit đã qua CI: lint, typecheck, build, unit, HTTP integration, browser/full-stack, backend/migration Docker image smoke, migration deploy vào PostgreSQL disposable và `git diff --check`. Xem run thật, không suy ra kết quả từ workflow file. Trước release vẫn phải diễn tập backup và nâng cấp trên bản sao metadata có cấu hình/version gần với cloud đích; CI disposable không thay thế bước đó.
2. Tạo Neon database riêng cho demo. Lưu cả pooled lẫn direct connection string trong secret manager. Không chạy migration trên database không xác định chủ sở hữu.
3. Tạo Render backend service từ repo với Dockerfile path `backend/Dockerfile`, root/build context là thư mục gốc repo. Cấp `/data/git` làm storage path. Nếu plan không hỗ trợ persistent disk, công bố source reset ngay trong UI.
4. Tạo Vercel project với root `frontend`. Đặt `BACKEND_URL` tới backend Render origin, `APP_ORIGIN` tới origin production canonical; không gồm `/api/v1` trong `BACKEND_URL` nếu frontend proxy tự thêm prefix.
5. Điền origin chính thức vào `FRONTEND_ORIGIN`, Git base vào `GIT_PUBLIC_BASE_URL`, bật secure cookie và thiết lập secret.

### 2. Sao lưu metadata và migrate

1. Bật maintenance/chặn mutation, drain Git push và các thao tác ghi đang chạy. Với chỉ một instance demo, không deploy backend mới trong lúc request Git còn mở.
2. Tạo bản sao Neon/pg_dump có mã hóa và kiểm tra bản sao đọc được. Không đưa dump hoặc connection string vào Git.
3. Build migration image từ cùng commit:

   ```powershell
   docker build -f backend/Dockerfile.migrate -t code-forge-migrate:release-candidate .
   ```

4. Chạy one-shot migration task với `DATABASE_URL_UNPOOLED` và `DATABASE_URL` được inject từ secret manager. Không thêm giá trị secret vào command line. Chỉ mở backend khi `prisma migrate deploy` exit 0 và migration history khớp commit.
5. Migration phải additive/forward-only. Không sửa migration đã áp dụng và không dùng `migrate reset` trên demo/database đang có dữ liệu.
6. Deploy Render backend, rồi Vercel frontend; xác minh API và Git URL thực tế trước khi tắt maintenance.

### 3. Smoke test và công bố

Hoàn thành mọi mục trong [cloud smoke checklist](./cloud-smoke-checklist.md). Dùng tài khoản và repository fixture riêng dành cho demo. Clone local có thể được dùng để khôi phục source sau reset; metadata PR/invitation trong DB không đảm bảo commit còn tồn tại.

## Rollback và phục hồi

- Nếu API lỗi nhưng migration vẫn tương thích, rollback image ứng dụng về release trước đó, giữ nguyên metadata DB. Không tự revert migration SQL.
- Nếu migration thất bại trước khi hoàn tất, giữ maintenance bật; lưu nguyên log và `prisma migrate status`, so với backup, sửa migration mới theo quy trình forward-only rồi chạy lại sau khi xác minh trạng thái. Không chạy lặp mù khi kết quả chưa rõ.
- Nếu source bare repo đã mất, hệ thống sẽ tạo repo rỗng với generation mới và giao diện thông báo lịch sử cũ không còn. Từ máy có clone còn đủ dữ liệu, kiểm tra remote rồi push lại các branch cần thiết:

  ```sh
  git remote -v
  git push --all code-forge-demo
  git push --tags code-forge-demo
  ```

- Trước khi chạy lệnh push, cấu hình `code-forge-demo` thành remote trỏ tới clone URL Render thực tế và kiểm tra `git remote -v`; không nhúng PAT vào URL. Push lại source không khôi phục Git object/ref nào không có trong clone đó. Pull request cũ giữ metadata và được nhận diện bằng storage generation cũ; tạo PR mới sau khi push lại branch.
- Nếu database metadata mất, phục hồi từ backup metadata đã kiểm chứng. Không kết luận source được phục hồi chỉ vì PostgreSQL còn user/repository record.
- Free Render có cold start và có thể ngủ; background job không được đảm bảo đúng thời điểm khi service ngủ. Chạy kiểm tra thủ công sau khi wake.

## Hạn chế demo

Source có thể mất theo lifecycle của instance; giới hạn quota áp dụng toàn cục; không có SSH, LFS, fork, tổ chức, issue, email, reset password, HA hay multi-writer Git storage. Đây không phải dịch vụ lưu trữ production và không nên nhận source duy nhất của người dùng.
