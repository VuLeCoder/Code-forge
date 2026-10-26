# 03 — Chạy và kiểm thử

Các lệnh chạy từ thư mục gốc repository, trừ khi có chỉ dẫn khác. Hosted CI `40138087574` trên `7e0aa27` đã chạy toàn bộ gate; báo cáo hiện tại và giới hạn còn mở nằm trong [ledger](implementation-status.md) và [deployment guide](deployment/README.md).

## Chuẩn bị

- Node.js 24 theo Dockerfile, Corepack và pnpm phiên bản trong `package.json`.
- Git executable trong PATH của backend và máy chạy test.
- Docker/Compose để chạy PostgreSQL local.
- Chromium của Playwright cho browser test.

Gate hosted hiện dùng Node 24 theo Dockerfile; baseline CI xanh trên commit `d2577fb`. Không dùng số test lịch sử làm bằng chứng thay cho run gắn commit.

```bash
node --version
corepack --version
git --version
docker compose version
corepack enable
corepack pnpm install --frozen-lockfile
```

## Khởi động local

1. Nếu chưa có file môi trường, sao chép mẫu. Không ghi đè file cấu hình đã có:

```bash
cp -n backend/.env.example backend/.env
cp -n frontend/.env.example frontend/.env.local
```

2. Chạy PostgreSQL, đợi `healthy`:

```bash
docker compose up -d postgres
docker compose ps
```

3. Sinh client và áp dụng migration đã có:

```bash
corepack pnpm db:generate
corepack pnpm db:deploy
```

`db:deploy` dùng khi tiếp nhận schema hiện hữu. `db:migrate` là `prisma migrate dev`, dùng khi phát triển thay đổi schema; xem kỹ yêu cầu reset nếu Prisma báo drift, không reset dữ liệu bàn giao để bỏ qua lỗi.

4. Mở hai terminal, cùng đứng tại root:

```bash
# Terminal 1
corepack pnpm dev:backend
```

```bash
# Terminal 2
corepack pnpm dev:frontend
```

Mở `http://localhost:3000`. Backend ở `http://localhost:4000/api/v1`. `pnpm dev` tại root chỉ chạy frontend, không tự chạy toàn stack.

```bash
curl http://localhost:4000/api/v1/health/live
curl http://localhost:4000/api/v1/health/ready
```

Readiness kiểm tra database, Git executable và storage; nếu 503, xem từng trường checks để tìm thành phần lỗi. Compose cũng có service backend nhưng không có frontend container: nếu chọn backend Docker, áp dụng migration trước rồi chạy `docker compose up -d --build backend`, không đồng thời chạy backend host cùng cổng 4000.

`compose.yaml` bind các port ra loopback và chứa direct database URL cùng proxy secret chỉ dành cho local để qua production config validation. CI kiểm tra cấu hình này, nhưng local Docker Engine hiện chưa phản hồi nên thao tác start backend container chưa được smoke trên máy này.

## Cấu hình cần hiểu

| Biến | Ý nghĩa/local |
| --- | --- |
| DATABASE_URL / DATABASE_URL_UNPOOLED | Runtime PostgreSQL; local direct URL trỏ tới service `postgres`, cloud dùng Neon pooled/direct tương ứng |
| GIT_STORAGE_PATH | Mẫu host là `../data/git`; container dùng `/data/git`; kiểm tra path thực tế theo working directory |
| PORT / API_PREFIX | Backend 4000 / api/v1 |
| FRONTEND_ORIGIN | Origin frontend được backend chấp nhận, local `http://localhost:3000` |
| JWT_ACCESS_SECRET | Secret ít nhất 32 ký tự; giá trị mẫu chỉ dùng local |
| ACCESS_TOKEN_TTL_SECONDS | Mặc định 900 |
| REFRESH_TOKEN_TTL_DAYS | Mặc định 30 |
| COOKIE_SECURE / COOKIE_SAME_SITE | HTTP local false/lax; HTTPS cần cấu hình phù hợp |
| MAX_REPOSITORIES_PER_USER | Mặc định 20, tính cả repo soft-delete chưa purge |
| SOFT_DELETE_RETENTION_DAYS | Mặc định 30 |
| BACKEND_URL | Frontend server gọi backend, local `http://localhost:4000` |
| GIT_PUBLIC_BASE_URL | Base URL tạo clone link; local `http://localhost:3000`, cloud trỏ trực tiếp tới Render `/api/v1` |
| RATE_LIMIT_PROXY_SECRET | ≥32 ký tự; local Compose có giá trị `local-only-*`, production phải inject cùng secret qua secret manager |
| APP_ORIGIN | Origin người dùng mở, phải đồng bộ FRONTEND_ORIGIN |

Nguồn: [backend mẫu](../backend/.env.example), [frontend mẫu](../frontend/.env.example). Khởi động lại service sau khi sửa env. Không dùng tiền tố public cho secret/backend credential. Secret thật bàn giao qua kênh riêng, không chép vào markdown.

## Kịch bản tự kiểm tra khi nhận dự án

1. Đăng ký tài khoản mới, login, reload và logout; thử mở `/new` khi chưa login để kiểm tra returnTo.
2. Tạo public repo có README; xem branch, README, tree và commit. Mở ẩn danh vẫn đọc được.
3. Sao chép URL từ Clone dialog và clone vào thư mục mới:

```bash
# Thay alice/demo bằng owner/repository vừa tạo.
git clone http://localhost:3000/git/alice/demo.git
git -C demo fetch origin
```

4. Tạo private repo có README; cửa sổ ẩn danh không thấy nội dung. Tại `/settings/tokens`, tạo PAT có `repo:read`; clone URL private và nhập username của người dùng, PAT ở prompt Password. Không đưa token vào URL/lệnh/tài liệu.
5. Thu hồi token rồi fetch lại: request kế tiếp bị từ chối. Nếu Git tự dùng credential cũ, kiểm tra credential helper.
6. Trên repo thử nghiệm, kiểm tra owner đổi visibility, soft-delete và restore từ hồ sơ. Không thử xóa trên dữ liệu cần bảo toàn.

Hành trình Git push đã hỗ trợ qua PAT (`repo:write`), invitation/member UI có tại Settings và `/invitations`; PR create/compare/diff/merge và admin dashboard cũng đã có. Với smoke local, dùng repository/tài khoản fixture riêng và chạy test E2E trên PostgreSQL cô lập; không dùng `backend/.env` chứa database phát triển. Hosted CI bao phủ owner mời WRITE → accept → push → PR → owner merge, và các race regression được ghi trong [ledger](implementation-status.md).

## Các tầng kiểm thử

```bash
corepack pnpm --filter frontend exec playwright install chromium
corepack pnpm --filter backend test
corepack pnpm --filter backend test:e2e
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm build
corepack pnpm --filter frontend test:e2e
corepack pnpm --filter frontend test:fullstack
git diff --check
```

| Gate | Điều kiện và phạm vi |
| --- | --- |
| Backend unit | Git trong PATH; có test Git thật và lifecycle fault injection |
| Backend test:e2e | PostgreSQL/Git thật; tạo schema riêng rồi dọn; cần quyền tạo/xóa schema |
| Frontend test:e2e | Next production + fixture API/Git; cổng 3111/4111 trống; không đại diện toàn backend thật |
| Frontend test:fullstack | Tự build, chạy Next/Nest/PostgreSQL/Git thật; cổng 3112/4112 trống; DB URL từ env/backend .env |

Không chạy hai browser suite hoặc build frontend đồng thời vì dùng chung `.next`/`test-results`. Full-stack dùng schema `m38_test_<random>` và storage tạm; không dùng database production. Root `pnpm test` không thay thế các script HTTP/browser phải gọi riêng. Artifact test liên quan token phải được xem xét trước khi chia sẻ.

**Bằng chứng lịch sử 30/09/2026:** 35 unit, 17 HTTP, 34 browser fixture, 2 hành trình full-stack đạt; lint/typecheck/build đạt. Đây không phải kết quả mới ngày bàn giao, không phải phần trăm coverage hoặc chứng nhận production. Ghi kết quả tiếp nhận mới kèm ngày, commit và môi trường.

## Lỗi thường gặp

| Hiện tượng | Kiểm tra |
| --- | --- |
| Readiness 503 | DB URL, trạng thái PostgreSQL, Git PATH, quyền/path storage |
| Login/mutation bị từ chối | APP_ORIGIN, FRONTEND_ORIGIN, BACKEND_URL, cookie HTTP/HTTPS và backend đã chạy |
| Prisma thiếu model/column | Generate client, áp dụng migration hiện có, restart backend |
| Clone private 401 | Username, PAT expiry/revoke/scope, credential helper; cookie web không thay PAT |
| PAT hợp lệ nhưng 404 | Đúng repo, trạng thái repo, user có quyền owner/member không |
| Repo còn metadata nhưng rỗng | Kiểm tra storage reset/generation; metadata không phục hồi source |
| Test browser lỗi bất thường | Cổng test, server cũ, chạy suite/build đồng thời, Chromium đã cài |

`docker compose down` giữ named volume. Không dùng tùy chọn xóa volume nếu cần giữ dữ liệu. Khi cần chuyển dữ liệu thật, phải chuyển cả PostgreSQL và Git storage tương ứng, không chỉ dump DB.
