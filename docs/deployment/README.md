# Release demo Code Forge

Tài liệu này mô tả phạm vi demo hiện tại: Render (NestJS API) và Neon (PostgreSQL). Frontend vẫn chạy local; Vercel đang deferred/out of scope, chưa có frontend cloud URL được nghiệm thu. Đây là quy trình demo; **không dùng để lưu mã nguồn cần độ bền production**.

## Trạng thái triển khai

Tạo image và chuẩn bị hướng dẫn không chứng minh dịch vụ cloud đã được provision hay smoke test. Trước khi công bố URL, điền release commit, URL thật, thời điểm và kết quả từng bước trong [cloud smoke checklist](./cloud-smoke-checklist.md). Không ghi secret vào repo, ticket hoặc output kiểm thử.

### Bằng chứng hiện tại

- Current pushed integration tip `origin/thviet`: `7588c0a` (exact SHA `7588c0a4306abf5309de2fe0cb8c6e0c93dac0e2`). Hosted CI [#138](https://github.com/VuLeCoder/Code-forge/actions/runs/40276491886) passed on that exact SHA. The separate `codex/push-crash-proof` feature is now pushed at `1aa76a8`; its code ancestor `200c22d` passed hosted CI [#139](https://github.com/VuLeCoder/Code-forge/actions/runs/40340975441), while the T37 test/docs commits are not integrated to `thviet` or deployed.
- Render Dashboard xác nhận service `code-forge-api-thviet` đang chạy deploy `388c584`, không phải source tip hiện tại. Probe readiness ngày 2026-10-26 trả HTTP 200 với database/Git/storage `up`; endpoint thực hiện `SELECT 1` qua Prisma và ghi/xóa file tạm trong storage. Đây chỉ là bằng chứng connectivity/readiness trên deploy `388c584`, không phải probe chỉ đọc hay smoke nghiệp vụ.
- Read-only `GET /api/v1/health/live` returned HTTP 200 but only `status` and `timestamp`, without `commitSha`; the health revision field from source commit `97d5d34` is not live yet. Render Settings shows Auto-Deploy `After CI Checks Pass`; a push to `thviet` may redeploy this service.
- Lịch sử có deploy `4407e7d` thất bại `P1001`; nguyên nhân gốc chưa được chứng minh. Readiness hiện tại cho thấy kết nối hoạt động tại thời điểm probe, không chứng minh đã xác định hoặc loại trừ nguyên nhân lỗi cũ.
- Chưa nghiệm thu migration/backup/restore, TLS/proxy, Git HTTP trực tiếp, auth/quyền, cold start, mất source khi restart và khôi phục. Không suy ra cloud acceptance từ CI hay local image smoke.

Chỉ đánh dấu cloud release đạt sau khi điền kết quả thật theo release commit vào [cloud smoke checklist](./cloud-smoke-checklist.md).

## Kiến trúc và giới hạn

- Next.js hiện chạy local; các Next API routes dùng `BACKEND_URL` làm backend origin và tự thêm `/api/v1`. Git URL giao diện cấp cho người dùng dùng `GIT_PUBLIC_BASE_URL` để đi thẳng tới Render. Frontend chưa được phát hành trên cloud.
- Render chạy image `backend/Dockerfile`. Render Free không hỗ trợ persistent disk; local filesystem mặc định ephemeral. Vì vậy restart/redeploy/mất instance có thể làm Git bare repository mất đi. Chỉ khi chuyển sang plan hỗ trợ disk mới mount disk vào `/data/git`; disk không biến cấu hình Free thành durable storage. [Render Free limitations](https://render.com/docs/free), [Render Persistent Disks](https://render.com/docs/disks)
- Neon giữ metadata PostgreSQL. `DATABASE_URL` dùng pooled endpoint cho API; `DATABASE_URL_UNPOOLED` dùng direct endpoint cho advisory lock và Prisma migration. Migration chạy riêng bằng `backend/Dockerfile.migrate` trước khi mở traffic phiên bản mới.
- Public clone/fetch/push URL dùng `GIT_PUBLIC_BASE_URL` trỏ thẳng tới Render `/api/v1`; ví dụ `https://<render-host>/api/v1`. Chỉ là cấu hình mẫu; URL thực phải được kiểm tra với `git ls-remote`, clone, fetch và push. Git Smart HTTP không đi qua frontend proxy.
- Cookie web cần TLS và domain/origin đúng. Không đặt PAT trong URL hoặc command line có thể lưu vào history.

### Giới hạn cloud đã đối chiếu tài liệu chính thức (2026-10-25)

- Render Free web services spin down sau 15 phút không có traffic; lúc spin down thay đổi local filesystem bị mất. Filesystem cũng mất dữ liệu khi restart/redeploy; Free không hỗ trợ persistent disk. PostgreSQL free của Render hết hạn sau 30 ngày, nên kế hoạch demo dùng Neon cho metadata. [Render Free](https://render.com/docs/free), [Render Persistent Disks](https://render.com/docs/disks)
- Neon hướng dẫn dùng pooled URL (`-pooler`) cho ứng dụng và direct/unpooled URL cho Prisma CLI/migrations. Repo hiện dùng Prisma 6: `DATABASE_URL` là runtime URL và `DATABASE_URL_UNPOOLED` được cấu hình qua `directUrl`; advisory lock cũng cần URL direct. [Neon Prisma guide](https://neon.com/docs/guides/prisma), [Neon connection pooling](https://neon.com/docs/connect/connection-pooling), [Prisma v6 data sources](https://www.prisma.io/docs/orm/v6/prisma-schema/overview/data-sources)

Các giới hạn này là tài liệu nền tảng, không phải bằng chứng rằng cloud đã triển khai hoặc Git transport đã smoke-test thành công.

## Biến môi trường backend

| Biến | Giá trị cloud | Ghi chú |
| --- | --- | --- |
| `NODE_ENV` | `production` | Bắt buộc khi deploy |
| `PORT` | Render cung cấp hoặc `4000` | Backend bind `0.0.0.0` |
| `API_PREFIX` | `api/v1` | Giữ prefix hiện tại |
| `DATABASE_URL` | Neon pooled connection string | Dùng cho Prisma runtime queries |
| `DATABASE_URL_UNPOOLED` | Neon direct connection string | Prisma `directUrl`; dùng cho advisory locks và migration |
| `FRONTEND_ORIGIN` | `http://localhost:3000` khi frontend chạy local; origin chính xác nếu chọn host khác sau này | Không thêm path; chỉ thêm origin đã được quyết định và kiểm thử |
| `GIT_PUBLIC_BASE_URL` | `https://<render-host>/api/v1` | Không có dấu `/` cuối; Git URL tạo từ base này |
| `GIT_STORAGE_PATH` | `/data/git` | Thư mục bare repo; ghi rõ khi storage bị reset |
| `JWT_ACCESS_SECRET` | Secret ngẫu nhiên ≥32 ký tự | Dùng secret manager của host; không commit |
| `COOKIE_SECURE` | `true` | HTTPS production |
| `COOKIE_SAME_SITE` | `lax` | Phải cân nhắc cookie và domain thực tế trước khi đổi |
| `TRUST_PROXY_HOPS` | `1` trên Render sau khi xác nhận topology | Số hop Express tin cậy; không bật blanket trust. Mặc định local là `0`. |
| `RATE_LIMIT_PROXY_SECRET` | Secret ngẫu nhiên ≥32 ký tự; cùng giá trị ở frontend server và Render | Ký IP do Next proxy gửi; chỉ lưu server-side trong secret manager, không expose client-side. |
| `MAX_REPOSITORIES_PER_USER` | `20` | Quota MVP toàn cục |
| `MAX_REPOSITORY_BYTES` | `524288000` | 500 MiB |
| `MAX_FILE_BYTES` | `26214400` | 25 MiB |
| `MAX_PUSH_BYTES` | `104857600` | 100 MiB |
| `SOFT_DELETE_RETENTION_DAYS` | `30` | Thời gian restore repo đã xóa mềm |

Khi chạy frontend local với backend Render, đặt `BACKEND_URL` server-side tới `https://<render-host>` (không gồm `/api/v1`), `APP_ORIGIN` bằng origin local, `FRONTEND_ORIGIN` khớp origin local và cùng `RATE_LIMIT_PROXY_SECRET` ở frontend server/Render. Proxy chỉ gửi IP đã được ký HMAC; backend bỏ qua header giả/không hợp lệ. Giữ secrets ngoài client bundle. Nếu sau này chọn host hoặc proxy khác, xác minh lại origin, IP/header contract và HTTPS trước khi deploy.

Các biến TTL mặc định hiện tại nằm trong `backend/.env.example`; chỉ override khi có acceptance test cho cấu hình mới. Không copy giá trị secret mẫu sang cloud.

`compose.yaml` chỉ dành cho local: dùng `NODE_ENV=development`, PostgreSQL trực tiếp và các secret đánh dấu `local-only-*`; không dùng các giá trị đó cho cloud hoặc môi trường public. Các port host chỉ bind loopback. Chế độ local cho phép `COOKIE_SECURE=false`; production vẫn bắt buộc `COOKIE_SECURE=true` qua kiểm tra backend. T-COMPOSE trong `docs/operations/task-execution-log-2026-10-25.md` đã xác minh một project cô lập: 7 migration áp dụng, healthcheck backend healthy và `/api/v1/health/ready` HTTP 200. Chưa có bằng chứng cho việc chạy đồng thời nhiều project Compose hoặc cho cloud release; các volume test của project đó được giữ lại có chủ đích, volume người dùng không bị chạm.

## Trình tự release

### 1. Chuẩn bị

1. Chọn release commit đã qua CI: lint, typecheck, build, unit, HTTP integration, browser/full-stack, backend/migration Docker image smoke, migration deploy vào PostgreSQL disposable và `git diff --check`. Xem run thật, không suy ra kết quả từ workflow file. Trước release vẫn phải diễn tập backup và nâng cấp trên bản sao metadata có cấu hình/version gần với cloud đích; CI disposable không thay thế bước đó.
2. Tạo Neon database riêng cho demo. Lưu cả pooled lẫn direct connection string trong secret manager. Không chạy migration trên database không xác định chủ sở hữu.
3. Tạo Render backend service từ repo với Dockerfile path `backend/Dockerfile`, root/build context là thư mục gốc repo. Cấp `/data/git` làm storage path. Nếu plan không hỗ trợ persistent disk, công bố source reset ngay trong UI.
4. Giữ frontend local trong phạm vi hiện tại; nếu cần truy cập API cloud từ UI local, đặt server-side `BACKEND_URL` tới Render và origin/proxy secrets theo bảng trên. Chưa công bố URL frontend.
5. Điền origin đã chọn vào `FRONTEND_ORIGIN`, Git base vào `GIT_PUBLIC_BASE_URL`, bật secure cookie cho môi trường HTTPS và thiết lập secrets.

### 2. Sao lưu metadata và migrate

1. Trước release, xác định cơ chế operator/provider đã kiểm chứng để chặn mutation mới và xác nhận Git push/merge đang chạy đã drain. Hiện chưa có application-wide write gate được xác minh; maintenance jobs và readiness endpoint không chặn ghi. Nếu chưa có cơ chế thực tế kèm bằng chứng drain, **dừng tại đây: không migrate/deploy và không dùng restart thay cho drain**.
2. Tạo bản sao Neon/pg_dump có mã hóa và kiểm tra bản sao đọc được. Không đưa dump hoặc connection string vào Git.
3. Build migration image từ cùng commit:

   ```powershell
   docker build -f backend/Dockerfile.migrate -t code-forge-migrate:release-candidate .
   ```

4. Chạy one-shot migration task với `DATABASE_URL_UNPOOLED` và `DATABASE_URL` được inject từ secret manager. Không thêm giá trị secret vào command line. Chỉ mở backend khi `prisma migrate deploy` exit 0 và migration history khớp commit.
5. Migration phải additive/forward-only. Không sửa migration đã áp dụng và không dùng `migrate reset` trên demo/database đang có dữ liệu.
6. Deploy Render backend sau backup/rehearsal; frontend host còn deferred. Xác minh API và Git URL thực tế trước khi cho phép mutation trở lại hoặc gỡ cơ chế write-freeze đã xác minh; chưa công bố demo frontend.

### 3. Smoke test và công bố

Hoàn thành mọi mục backend trong [cloud smoke checklist](./cloud-smoke-checklist.md). Dùng tài khoản và repository fixture riêng dành cho demo. Clone local có thể được dùng để khôi phục source sau reset; metadata PR/invitation trong DB không đảm bảo commit còn tồn tại. Frontend cloud và URL công khai chưa thuộc phạm vi hiện tại.

## Rollback và phục hồi

- Nếu API lỗi nhưng migration vẫn tương thích, rollback image ứng dụng về release trước đó, giữ nguyên metadata DB. Không tự revert migration SQL.
- Nếu migration thất bại trước khi hoàn tất, giữ nguyên cơ chế chặn ghi đã xác minh; lưu nguyên log và `prisma migrate status`, so với backup, sửa migration mới theo quy trình forward-only rồi chạy lại sau khi xác minh trạng thái. Không chạy lặp mù khi kết quả chưa rõ.
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
