# 03 — Chạy và kiểm thử

Chạy lệnh từ root repository. Cần Node 24, Corepack/pnpm 12.3.4, Git trong PATH và Docker Compose. Hướng dẫn này dành cho local; cloud theo [deployment](trien-khai/README.md).

## Khởi động local

```bash
corepack enable
corepack pnpm install --frozen-lockfile
# Chỉ sao chép nếu chưa có file; giữ cấu hình cá nhân hiện hữu.
cp -n backend/.env.example backend/.env
cp -n frontend/.env.example frontend/.env.local
docker compose up -d postgres
docker compose ps
corepack pnpm db:generate
corepack pnpm db:deploy
```

Đợi PostgreSQL healthy trước migration. `db:deploy` áp dụng migration có sẵn; `db:migrate` dùng khi phát triển schema mới. Không reset dữ liệu để bỏ qua drift/lỗi migration.

Mở hai terminal tại root:

```bash
# Terminal 1
corepack pnpm dev:backend
```

```bash
# Terminal 2
corepack pnpm dev:frontend
```

Frontend: `http://localhost:3000`; backend: `http://localhost:4000/api/v1`. Root `dev` chỉ chạy frontend. Health: `/api/v1/health/live` và `/api/v1/health/ready`; readiness kiểm tra DB, Git và ghi/xóa file storage tạm.

Có thể dùng `docker compose up -d --build backend` thay backend host sau khi migration đã áp dụng. Không chạy cả hai trên cổng 4000. Compose không cung cấp frontend container.

Tạo admin local sau migration bằng `corepack pnpm --filter backend admin:bootstrap`, nhập danh tính/mật khẩu qua prompt. Nếu username/email khớp tài khoản hiện hữu, CLI cấp ADMIN mà không mở khóa hoặc thay mật khẩu tài khoản đó. Cloud chỉ bootstrap trên target đã được operator xác nhận.

## Cấu hình chính

| Biến | Local/ý nghĩa |
| --- | --- |
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | Host: `localhost:5433`; trong Compose: `postgres:5432`; DB phát triển `code_forge` |
| `GIT_STORAGE_PATH` | Host mặc định `../data/git` theo cwd backend; container `/data/git` |
| `PORT`, `API_PREFIX` | `4000`, `api/v1` |
| `BACKEND_URL` | Origin backend `http://localhost:4000`, không gồm `/api/v1` |
| `APP_ORIGIN`, `FRONTEND_ORIGIN` | `http://localhost:3000`, phải khớp origin trình duyệt |
| `GIT_PUBLIC_BASE_URL` | Local `http://localhost:3000`; cloud dùng backend origin + `/api/v1` |
| `JWT_ACCESS_SECRET`, `RATE_LIMIT_PROXY_SECRET` | ≥32 ký tự; proxy secret giống nhau ở hai server, không đưa vào client bundle |
| `COOKIE_SECURE`, `COOKIE_SAME_SITE` | HTTP local `false`/`lax`; production cần secure cookie |
| `TRUST_PROXY_HOPS` | Local `0`; cloud xác minh topology trước khi đặt |
| `ACCESS_TOKEN_TTL_SECONDS`, `REFRESH_TOKEN_TTL_DAYS` | `900`, `30` |
| `MAX_REPOSITORIES_PER_USER`, `SOFT_DELETE_RETENTION_DAYS` | `20`, `30` |
| `MAX_REPOSITORY_BYTES`, `MAX_FILE_BYTES`, `MAX_PUSH_BYTES` | 500 MiB, 25 MiB, 100 MiB |
| `WRITE_FREEZE_BOOTSTRAP`, `WRITE_FREEZE_DRAIN_TIMEOUT_MS` | Local `false`, 60000 ms; production bắt buộc bootstrap `true` |

Giá trị mẫu tại [backend/.env.example](../backend/.env.example), [frontend/.env.example](../frontend/.env.example); validator tại [environment.ts](../backend/src/config/environment.ts). Khởi động lại sau sửa env. Không dùng secret local mẫu trên cloud.

## Kiểm thử

### Database riêng cho backend E2E/full-stack

Backend E2E yêu cầu hai DB URL cùng trỏ PostgreSQL loopback, tên kết thúc bằng `_test`. Tài khoản cần tạo/xóa schema. Mỗi suite dùng schema/storage tạm; không sửa URL database phát triển trong `.env`.

Với Compose mặc định, kiểm tra database test đã tồn tại:

```bash
docker compose exec postgres psql -U code_forge -d postgres -tAc   "SELECT datname FROM pg_database WHERE datname = 'code_forge_test';"
# Chỉ chạy dòng sau nếu truy vấn không trả code_forge_test:
docker compose exec postgres createdb -U code_forge code_forge_test
```

Trong một terminal Bash riêng, nhập URL test (host `127.0.0.1`, port `5433`, DB `code_forge_test`) qua prompt để tránh lưu credential trong history:

```bash
read -rsp 'Local PostgreSQL test URL: ' backend_test_url
printf '\n'
export DATABASE_URL="$backend_test_url"
export DATABASE_URL_UNPOOLED="$backend_test_url"
unset backend_test_url
corepack pnpm --filter backend test:e2e
# Cùng terminal này nếu chạy full-stack:
corepack pnpm --filter frontend test:fullstack
unset DATABASE_URL DATABASE_URL_UNPOOLED
```

Dùng DB test riêng cho full-stack dù harness chỉ tạo schema `m38_test_<random>`. Không chạy bất kỳ harness integration nào trên production. Không nạp `NODE_ENV=development` từ file backend vào bước build Next.

### Các gate

```bash
corepack pnpm --filter frontend exec playwright install chromium
corepack pnpm --filter backend test
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm build
corepack pnpm --filter frontend test:e2e
git diff --check
```

| Gate | Phạm vi/điều kiện |
| --- | --- |
| Backend `test` | Jest unit và Git thật; không thay thế HTTP E2E |
| Backend `test:e2e` | PostgreSQL/Git thật, DB test riêng như trên |
| Frontend `test:e2e` | Next production build + fixture API/Git; cổng 3111/4111 |
| Frontend `test:fullstack` | Build Next/Nest + PostgreSQL/Git thật; cổng 3112/4112 |
| [MVP verification](../.github/workflows/ci.yml) | Các gate trên, backend/migration images và migration trên DB CI disposable |

Không chạy hai browser suite hoặc build frontend đồng thời: dùng chung `.next`/`test-results`; lint frontend sau khi fixture đã dọn xong. Root `test` không tự chạy E2E/full-stack. Kết quả đã ghi nhận xem [verification](ket-qua-kiem-thu.md); CI xanh không đồng nghĩa cloud đã deploy.

## Smoke thủ công và lỗi thường gặp

Smoke trên fixture: đăng ký/login/reload/logout → tạo public/private → xem source/commit diff → PAT clone/fetch → owner mời WRITE, accept, push branch/PR → người có quyền merge → revoke PAT và kiểm tra bị từ chối. Thử Settings, avatar và restore bằng tài khoản/repo riêng.

| Hiện tượng | Kiểm tra |
| --- | --- |
| Backend E2E yêu cầu loopback `*_test` | Cả hai DB URL, port 5433 host; không trỏ DB `code_forge` |
| Không kết nối được DB | Compose healthy, port/credential, quyền mạng/Docker; không in secret khi chẩn đoán |
| Readiness 503 | Trường checks: DB, Git PATH, storage writable |
| Mutation bị từ chối | Origin/cookie/session; write-freeze có đang bật không |
| Prisma thiếu model/column | Generate client, áp dụng migration sẵn có, restart |
| Clone private 401/404 | Username/PAT/scope/expiry; đã accept lời mời, quyền user và trạng thái repo |
| Private repo không thấy trên hồ sơ owner | Đăng nhập đúng tài khoản, chờ danh sách authenticated tải; anonymous chỉ thấy public |
| Repo còn metadata nhưng trống | Storage reset/generation; dùng [recovery runbook](van-hanh/khoi-phuc-thao-tac-git.md) |
| Browser test lỗi | Server/cổng cũ, Chromium, suite/build đồng thời; test cần đúng control/dialog hiện tại |
| WARN trong fault-injection test | Đọc kết quả suite/assertion; WARN dự kiến không tự đồng nghĩa test fail |

`docker compose down` giữ named volumes. Không xóa volume, DB hoặc Git storage để làm test xanh.
