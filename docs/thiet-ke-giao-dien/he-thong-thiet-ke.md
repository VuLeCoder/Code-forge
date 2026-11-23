# Design system Code Forge

Cập nhật 23/11/2026. Nguồn chính: [globals.css](../../frontend/src/app/globals.css); bố cục chi tiết nằm trong CSS Modules theo trang. Dùng token thay vì chép màu cố định.

| Vai trò/token | Sáng | Tối |
| --- | --- | --- |
| `--canvas` | `#f7f9fc` | `#0b111b` |
| `--surface` | `#ffffff` | `#111a28` |
| `--text` | `#101828` | `#f3f6fb` |
| `--muted` | `#586579` | `#adbbcd` |
| `--border` | `#e4e7ec` | `#27364a` |
| `--brand-600` | `#175cd3` | `#76a7ff` |
| `--primary` | `#175cd3` | `#2866ce` |
| `--success-text` | `#027a48` | `#75e0a7` |
| `--danger-text` | `#b42318` | `#ff9b94` |
| `--merged-text` | `#8250df` | `#c6a7ff` |

Theme tối qua `html[data-theme="dark"]`. Status có token surface/text/border riêng; màu cần đi kèm nhãn hoặc cấu trúc. Không dùng `--primary` của button thay cho màu text tùy ý.

- Font UI: Inter với system fallback; code/SHA/diff dùng monospace. Tên repo > mô tả > dòng cập nhật về cỡ chữ; không đổi timestamp chỉ để cân layout.
- Radius: `--radius-sm/md/lg` là 10/12/16 px; khoảng trang dùng `--page-space`, `--page-gutter`; shadow có ba mức.
- Dùng shared dropdown, dialog, Avatar, repository navigation và feedback states. Form có label/error/pending; destructive action cần xác nhận phù hợp.
- Source sidebar và code/diff panel có ràng buộc chiều rộng/chiều cao riêng; nội dung dài cuộn trong vùng chứa. Không dùng độ dài source để giãn khoảng cách các control sidebar.
- Focus-visible rõ, điều khiển bằng bàn phím, tôn trọng reduced motion. Không chỉ dùng màu để phân biệt thêm/xóa/quyền.

Mục tiêu review: tương phản text thường ≥4,5:1, sáng/tối và hover/selected/disabled, keyboard/dialog, laptop và màn hình hẹp. Manual contrast, screen reader và thiết bị thật vẫn là [công việc mở](../cong-viec-con-lai.md); bảng token không phải chứng nhận accessibility.
