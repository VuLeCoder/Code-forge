# Code Forge

MVP cộng tác Git cho nhóm nhỏ: repository public/private, đọc source và commit diff, Git HTTP(S) qua PAT, lời mời READ/WRITE, pull request, quyền merge và quản trị.

Stack: Node 24, pnpm workspace, Next.js/React, NestJS, PostgreSQL/Prisma và Git CLI.

## Bắt đầu

1. Chuẩn bị Node 24, Corepack và Docker Compose.
2. Theo [hướng dẫn chạy local](docs/chay-va-kiem-thu.md): cài dependency, tạo env từ mẫu, khởi động PostgreSQL, generate/migrate, chạy backend và frontend.
3. Mở `http://localhost:3000`; backend ở `http://localhost:4000/api/v1`.

Backend E2E cần database local riêng kết thúc bằng `_test`; không dùng database phát triển/production. Xem [lệnh kiểm thử](docs/chay-va-kiem-thu.md#kiểm-thử) và [kết quả đã ghi nhận](docs/ket-qua-kiem-thu.md).

## Tài liệu

- [Mục lục đầy đủ](docs/README.md), [nghiệp vụ và quyền](docs/muc-tieu-va-nghiep-vu.md), [kiến trúc](docs/kien-truc-va-cong-nghe.md).
- [Việc còn lại](docs/cong-viec-con-lai.md), [deployment](docs/trien-khai/README.md), [khôi phục journal Git](docs/van-hanh/khoi-phuc-thao-tac-git.md).
- [Chỉ dẫn agent](AGENTS.md), [ràng buộc dự án](CONSTRAINTS.md).

Demo chưa phải dịch vụ lưu source production. Metadata và Git filesystem tách biệt; storage ephemeral có thể làm mất lịch sử dù DB còn. Cần backup/restore đã kiểm chứng trước khi dùng làm nơi giữ bản source duy nhất. CI xanh không thay thế nghiệm thu cloud.
