# Bằng chứng kiểm thử

Cập nhật 23/11/2026. Kết quả dưới đây được ghi nhận trong các lượt làm việc local, không phải một lượt release gate mới cho toàn bộ dự án. Source nền khi rà tài liệu: `9b2b6bd`.

| Phạm vi | Kết quả ghi nhận | Giới hạn |
| --- | --- | --- |
| Backend E2E sau sửa Git abort | 75/75, 10 suite; PostgreSQL/Git local thật | Chạy với hai DB URL cùng trỏ loopback `code_forge_test` |
| Backend unit liên quan Git storage/PR | 54/54 | Gồm regression khóa đã mất trước ref CAS; không phải full unit run |
| Backend lint/typecheck | Đạt sau sửa Git abort | Local |
| Frontend browser sau sửa commit selectors | 90/90; production build trong Playwright đạt | Fixture API/Git; không thay thế backend/cloud |
| Frontend lint/typecheck | Đạt sau sửa commit selectors | Local |
| Full-stack và full backend unit trước đó | 4/4 full-stack; 268/268 unit | Kết quả local ngày 23/11 trước bản sửa Git abort; không xác nhận HEAD |

## Sửa tải lại snapshot PR — 24/11/2026

Nhánh local `fix/pr-refresh-merge-snapshot`, nền `36d187a`. Phạm vi: frontend cho phép merge snapshot mới đã tải đồng nhất sau khi source/target đổi kể từ lúc tạo PR; đóng hộp xác nhận cũ khi tải lại. Không đổi backend hoặc dữ liệu.

- Hai regression source/target đều thất bại trước sửa vì hộp xác nhận cũ vẫn mở; sau sửa, toàn bộ `frontend/test/pulls.spec.ts` đạt **14/14**, gồm gửi SHA mới, tải lại sau compare 409, báo lỗi merge stale và chặn merge khi đang đối soát.
- Thay test cũ yêu cầu khóa merge với mọi `stale=true`: cờ này so với thời điểm **tạo PR**, không phải snapshot hiện đang xem. Đây là sửa kỳ vọng nghiệp vụ sai, không bỏ kiểm tra snapshot lỗi; giữ cảnh báo và assertion 409, bổ sung kiểm tra commits/files/diff dùng cùng SHA/generation và phải xác nhận lại.
- `pnpm --filter frontend lint`, `pnpm --filter frontend typecheck`: đạt. Production build được chạy thành công bởi Playwright trước browser suite.
- `pnpm --filter backend test --runTestsByPath src/repositories/pull-requests.service.spec.ts`: **25/25**. Lần đầu bị chặn do Prisma Client cũ thiếu `branchUpdate`; chạy `pnpm --filter backend prisma:generate` rồi kiểm thử lại đạt. Không chạy migration.
- Môi trường local: Node **25.9.0**, khác Node 24 quy định của CI. Máy thiếu Corepack; web server test dùng shim tạm ngoài repository để gọi pnpm. API browser là fixture; unit backend dùng mock, không thay thế full-stack hoặc Git/DB thật.
- Chưa chạy CI cho thay đổi này; chưa nghiệm thu cloud hoặc deploy. Cần gate trên SHA tích hợp cuối trước merge/release.

Lệnh browser: `pnpm --filter frontend exec playwright test test/pulls.spec.ts` (PATH bổ sung shim Corepack tạm).

## Giới hạn và ghi nhận lịch sử

- File viewer ưu tiên laptop 1366/1440 px theo phạm vi đã chốt; test mobile khác vẫn giữ, chưa nghiệm thu file viewer trên mobile hoặc screen reader.
- Full-stack 4/4 đạt sau khi fixture concurrency tạo hai user bằng hash Argon2id trong DB test rồi đăng nhập qua API thật; các journey khác vẫn kiểm tra đăng ký. Giữ nguyên giới hạn đăng ký 5 lần/phút/IP và assertion Git.
- Từng gặp timeout setup 5 giây ở test pre-receive hook; chạy riêng đạt 7/7 và chạy lại toàn bộ unit đạt 268/268. Chưa chứng minh lỗi chập chờn này đã hết.
- Từng gặp lỗi mở clone dialog thoáng qua; test đạt ở lượt chạy đầy đủ sau đó, chưa xác nhận nguyên nhân đã được xử lý.
- Accessible name của custom select admin vẫn cần rà thủ công; selector theo label hiển thị không chứng nhận accessibility.

## Hai lỗi gần nhất

- **Backend local sai DB:** mọi test dừng trước nghiệp vụ khi URL không phải loopback `*_test`. Cấu hình test riêng, không nới guard hoặc dùng DB phát triển. Hướng dẫn tại [chạy test](chay-va-kiem-thu.md#kiểm-thử).
- **CI mất khóa merge:** log người dùng cung cấp có 74/75 đạt, ca pre-CAS lock loss nhận 202 thay vì 503. `execFile` có thể spawn trước khi xử lý signal đã hủy; thêm `throwIfAborted()` trước Git spawn và regression giữ nguyên refs. Backend E2E local sau sửa đạt 75/75; chưa có kết quả Actions sau sửa được xác minh trong lần cập nhật này.

Frontend commit test đã được scope vào summary metadata và mở “Thông tin chi tiết” trước khi dùng parent link. Không bỏ assertion hoặc skip test.

## Cách nghiệm thu candidate

Chạy [MVP verification](../.github/workflows/ci.yml) trên SHA tích hợp cuối: unit, E2E, lint/typecheck/build, browser/full-stack, Docker backend/migration và migration disposable. Ghi SHA, lệnh, môi trường, kết quả, thời gian và giới hạn; không dùng số test lịch sử để chứng nhận HEAD.

Cloud chưa được kiểm tra lại. Bằng chứng cũ và checklist mới nằm tại [cloud smoke](trien-khai/danh-sach-kiem-tra-trien-khai.md). Manual accessibility/thiết bị thật và backup/restore cloud vẫn mở.
