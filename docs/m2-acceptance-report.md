# Báo cáo nghiệm thu M2.6 — Repository metadata và quyền đọc

Ngày nghiệm thu: **24/10/2026**  
Commit nền: `7c485d740453a95d502f393018591c9f1adb70cf`  
Kết luận: **Đạt local**

## Phạm vi

M2.6 đóng phần repository metadata và quyền đọc: tạo/list/đọc/cập nhật, public/private, bare Git và README ban đầu, quota số repository, soft-delete/restore/purge, phục hồi khi storage mất, cùng các trạng thái UI liên quan.

Git push/quota ghi, invitation/member mutation, pull request, admin và deployment thật không thuộc M2.6; các phần này lần lượt nằm ở M4–M8.

## Môi trường nghiệm thu

- Frontend production build: Node.js `24.22.1` trong image chính thức `node:24-bookworm-slim`.
- Test runner host: Node.js `25.9.0`, pnpm `12.3.4`, Playwright `1.63.0`.
- PostgreSQL: `postgres:17-alpine`, health `healthy`, cổng host `5433`.
- Git: `2.43.0`.
- Docker Compose: `v5.5.1`.

Các HTTP/full-stack test tạo schema PostgreSQL và Git storage tạm, sau đó tự dọn; dữ liệu local hiện hữu không được dùng làm fixture phá hủy.

## Kết quả nghiệp vụ

| Hạng mục | Kết quả | Bằng chứng chính |
| --- | --- | --- |
| Tạo repository private/public, normalize tên, UUID storage key, README ban đầu | Đạt | Repository HTTP integration và full-stack |
| List/search/profile; ẩn private và trả lỗi không làm lộ sự tồn tại | Đạt | Repository HTTP integration và browser |
| Owner đổi tên, mô tả, visibility; người khác không mutation được | Đạt | Repository HTTP integration và browser |
| Soft-delete giữ tên/quota; list deleted; restore đúng hạn | Đạt | Repository HTTP integration và browser |
| Hết hạn restore; purge xóa storage trước metadata; lỗi storage được retry | Đạt | Repository HTTP integration với fault injection |
| Serialize create đồng thời và chặn vượt quota | Đạt | Repository HTTP integration |
| Storage mất được tạo lại rỗng, tăng generation và không tuyên bố khôi phục source | Đạt | Repository HTTP integration, browser và full-stack |
| User/repository locked và anonymous public read | Đạt | Repository HTTP integration |
| Loading/error/empty/unauthorized, desktop/mobile | Đạt | 34 browser tests và 2 full-stack journeys |
| Cảnh báo demo, cold start và storage không bền vững | Đạt | Banner trang khám phá, reset notice và browser assertion |

## Quality gates

| Gate | Kết quả |
| --- | --- |
| Backend unit/Git lifecycle | 35/35 test đạt |
| Auth HTTP + PostgreSQL | 6/6 test đạt |
| Repository HTTP + PostgreSQL/Git | 11/11 test đạt |
| Frontend browser trên production build Node 24 | 34/34 test đạt |
| Full-stack Next/Nest/PostgreSQL/Git | 2/2 hành trình đạt |
| Backend lint/typecheck/build | Đạt |
| Frontend lint/typecheck/build | Đạt |
| `git diff --check` | Đạt tại thời điểm chốt thay đổi |

Các lệnh chuẩn để chạy lại từ repository root:

```bash
docker compose up -d postgres
corepack pnpm --filter backend test
corepack pnpm --filter backend test:e2e
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm build
corepack pnpm --filter frontend test:e2e
corepack pnpm --filter frontend test:fullstack
git diff --check
```

Không chạy hai browser suite hoặc frontend build đồng thời vì dùng chung `.next` và `test-results`. Dùng Node 24 như Dockerfile; Node 25 trên máy nghiệm thu làm Next production build lỗi khi đọc TypeScript config và không được coi là môi trường chuẩn.

## Giới hạn và backlog không chặn M2.6

- Git storage demo không bền vững; PostgreSQL còn metadata không đồng nghĩa lịch sử commit còn tồn tại. Persistent storage/backup/restore là quyết định deployment M8.
- Push, quota 500 MB/repository, 25 MB/file và 100 MB/push thuộc M4.
- CI, shared contracts/OpenAPI và chuẩn hóa error envelope/logging vẫn là backlog foundation/hardening; cần thực hiện hoặc gắn milestone trước khi tuyên bố production-ready.
- Nghiệm thu này là local, không thay thế smoke test Vercel/Render/Neon ở M8.
