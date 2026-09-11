# Nhật ký triển khai frontend

Tài liệu này ghi nhận phần frontend đã thực sự được triển khai. Kế hoạch chưa code vẫn nằm trong `frontend-design.md` và `implementation-plan.md`.

## 2026-09-11 — Khởi tạo nền tảng giao diện

### Cấu trúc dự án đã chốt

```text
Code-forge/
├── frontend/              # Next.js App Router
├── backend/               # NestJS REST + Git Smart HTTP (milestone sau)
├── packages/
│   ├── contracts/         # API schema/type dùng chung (khi bắt đầu tích hợp API)
│   └── config/            # config chia sẻ nếu phát sinh nhu cầu
├── docs/                  # yêu cầu, thiết kế và nhật ký triển khai
├── package.json           # lệnh workspace ở cấp root
└── pnpm-workspace.yaml
```

Prisma sẽ đặt tại `backend/prisma/`. Component chỉ phục vụ frontend tiếp tục nằm trong `frontend`; chưa tạo package `ui` khi chưa có consumer thứ hai.

### Phần đã triển khai

- Khởi tạo Next.js App Router với TypeScript và ESLint trong `frontend/`.
- Thêm pnpm workspace ở root và các lệnh `dev`, `build`, `lint` cho frontend.
- Xây application shell dùng chung: header responsive, wordmark Code Forge và footer.
- Xây trang khám phá `/` gồm hero, ví dụ Git terminal, tìm kiếm dạng giao diện, danh sách repository public mẫu và cảnh báo filesystem demo.
- Xây trang `/login` và `/register` với cấu trúc form, autocomplete, label và focus state phù hợp.
- Thiết lập design tokens bằng CSS variables, layout responsive, reduced-motion và các primitive đầu tiên: button, badge, container, eyebrow.
- Metadata và ngôn ngữ tài liệu HTML đã chuyển sang tiếng Việt.

### Giới hạn hiện tại

- Repository trên trang khám phá đang là mock data tĩnh để duyệt UI.
- Form xác thực chưa submit vì backend và API contract chưa được triển khai.
- Link tạo repository và link repository là route dự kiến; màn hình tương ứng sẽ được làm ở lát cắt tiếp theo.

### Bước frontend kế tiếp

1. Tạo API client/error envelope và schema trong `packages/contracts` khi backend foundation có sẵn.
2. Nối session thật vào header và hai form xác thực.
3. Xây trang profile, tạo repository và repository empty state theo Milestone 1–2.
