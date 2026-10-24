# Release demo Code Forge

Tài liệu này mô tả cách dựng bản demo miễn phí bằng Vercel (frontend), Render (NestJS backend) và Neon (PostgreSQL). Đây là quy trình demo; **không dùng để lưu mã nguồn cần độ bền production**.

## Trạng thái triển khai

Tạo image và chuẩn bị hướng dẫn không chứng minh dịch vụ cloud đã được provision hay smoke test. Trước khi công bố URL, điền release commit, URL thật, thời điểm và kết quả từng bước trong [cloud smoke checklist](./cloud-smoke-checklist.md). Không ghi secret vào repo, ticket hoặc output kiểm thử.

### Bằng chứng hiện tại

Nhánh `thviet` có code commit mới nhất `1227730`; docs-only HEAD tại lần cập nhật này là `eac190c`. Lần hosted pass đầy đủ gần nhất là commit `7e0aa27`, run [40138087574](https://github.com/VuLeCoder/Code-forge/actions/runs/40138087574): frozen install, Prisma generate, Compose backend-config validation, backend unit/E2E với PostgreSQL 17 service, lint, typecheck, build, browser (48/48), full-stack PR journey, build/content smoke hai image, migration deploy vào database disposable và whitespace. Các E2E push–push, push–merge, merge–delete, reset-read recovery, repository advisory lock và maintenance-instance lock đều đạt; refresh-token reuse và PR retry đã đạt ở run trước trong cùng nhánh. Các run mới [40139229848](https://github.com/VuLeCoder/Code-forge/actions/runs/40139229848) (`d1019a2`), [40140118957](https://github.com/VuLeCoder/Code-forge/actions/runs/40140118957) (`1227730`), [40140367864](https://github.com/VuLeCoder/Code-forge/actions/runs/40140367864) (`269d008`) và [40140645289](https://github.com/VuLeCoder/Code-forge/actions/runs/40140645289) (`eac190c`) đều thất bại tại `backend test:e2e`. Public job API xác nhận bước lỗi nhưng log endpoint trả HTTP 403; chưa xác định test cụ thể nên không coi revision mới đã qua CI.

Trên local Windows, backend unit (14 suites / 84 tests), backend lint/typecheck/build, focused cookie environment suite (8/8), và `git diff --check` đạt trên `1227730`; `docker compose config` cùng kiểm tra các biến backend bắt buộc cũng đạt trước đó. Docker Desktop hiện mắc ở “Turning off the Docker Engine…” và PostgreSQL tại `localhost:5433` không phản hồi; vì vậy chưa có local container runtime smoke. Hosted PostgreSQL/Git E2E và image checks chỉ được xác nhận cho revision `7e0aa27`, không suy ra là revision mới đã đạt.

Các bằng chứng này xác nhận CI và image, không chứng minh deployment cloud, nâng cấp từ snapshot production-like, proxy/TLS, Git HTTP trực tiếp Render hoặc source recovery đã được nghiệm thu. Chỉ đánh dấu cloud release đạt sau khi điền kết quả thật theo release commit vào [cloud smoke checklist](./cloud-smoke-checklist.md).

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

Vercel cần thêm biến server-side `BACKEND_URL=https://<render-host>` (không gồm `/api/v1`, vì các Next routes tự thêm prefix) và cùng `RATE_LIMIT_PROXY_SECRET` như backend. Vercel ghi đè `X-Forwarded-For` bằng IP request client ([tài liệu request headers](https://vercel.com/docs/headers/request-headers)); Next proxy chỉ gửi IP đã được ký HMAC, backend bỏ qua header giả/không hợp lệ. Giữ secrets ngoài client bundle. Nếu dùng Vercel phía sau một proxy khác, header/IP contract phải được đánh giá lại trước khi deploy.

Các biến TTL mặc định hiện tại nằm trong `backend/.env.example`; chỉ override khi có acceptance test cho cấu hình mới. Không copy giá trị secret mẫu sang cloud.

`compose.yaml` chỉ dành cho local: dùng PostgreSQL trực tiếp và các secret đánh dấu `local-only-*`, không dùng các giá trị đó cho cloud hoặc môi trường public. Các port host chỉ bind loopback. Compose truyền `DATABASE_URL_UNPOOLED` và `RATE_LIMIT_PROXY_SECRET` để qua kiểm tra cấu hình `NODE_ENV=production`; cần chạy runtime smoke trên máy có Docker Engine trước khi coi cấu hình local đã được nghiệm thu.

## Trình tự release

### 1. Chuẩn bị

1. Chọn release commit đã qua CI: lint, typecheck, build, unit, HTTP integration, browser/full-stack, backend/migration Docker image smoke, migration deploy vào PostgreSQL disposable và `git diff --check`. Xem run thật, không suy ra kết quả từ workflow file. Trước release vẫn phải diễn tập backup và nâng cấp trên bản sao metadata có cấu hình/version gần với cloud đích; CI disposable không thay thế bước đó.
2. Tạo Neon database riêng cho demo. Lưu cả pooled lẫn direct connection string trong secret manager. Không chạy migration trên database không xác định chủ sở hữu.
3. Tạo Render backend service từ repo với Dockerfile path `backend/Dockerfile`, root/build context là thư mục gốc repo. Cấp `/data/git` làm storage path. Nếu plan không hỗ trợ persistent disk, công bố source reset ngay trong UI.
4. Tạo Vercel project với root `frontend`. Đặt `BACKEND_URL` tới backend Render origin, không gồm `/api/v1` nếu frontend proxy tự thêm prefix.
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
