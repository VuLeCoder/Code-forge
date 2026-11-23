# Tài liệu Code Forge

Cập nhật 23/11/2026, đối chiếu source tại `9b2b6bd`. Các hướng dẫn mô tả chức năng đã có; trạng thái nghiệm thu được ghi riêng theo môi trường.

| Cần tìm | Tài liệu |
| --- | --- |
| Tính năng, quyền, giới hạn | [Mục tiêu và nghiệp vụ](muc-tieu-va-nghiep-vu.md) |
| Stack, luồng dữ liệu, bản đồ source | [Kiến trúc](kien-truc-va-cong-nghe.md) |
| Cài đặt, chạy local, test và xử lý lỗi | [Chạy và kiểm thử](chay-va-kiem-thu.md) |
| Kết quả kiểm tra gần nhất | [Bằng chứng kiểm thử](ket-qua-kiem-thu.md) |
| Việc chưa hoàn thành | [Công việc còn lại](cong-viec-con-lai.md) |
| Nhánh đầu tiên và bảo vệ nhánh | [Nghiệp vụ — nhánh mặc định](muc-tieu-va-nghiep-vu.md#nhánh-mặc-định) |
| Routes và thành phần frontend | [Frontend](giao-dien/README.md) |
| Ranh giới và nguyên tắc giao diện | [Kiến trúc frontend](giao-dien/README.md#ranh-giới), [design system](thiet-ke-giao-dien/he-thong-thiet-ke.md) |
| Cấu hình, quy trình phát hành | [Deployment](trien-khai/README.md), [operator runbook](trien-khai/huong-dan-van-hanh-render-neon-mien-phi.md) |
| Nghiệm thu môi trường triển khai | [Cloud smoke checklist](trien-khai/danh-sach-kiem-tra-trien-khai.md) |
| Push/merge chưa rõ kết quả | [Git operation recovery](van-hanh/khoi-phuc-thao-tac-git.md) |

Kết quả và giới hạn của các lượt kiểm thử được tổng hợp tại [bằng chứng kiểm thử](ket-qua-kiem-thu.md); không dùng số liệu cũ để xác nhận candidate mới.

Quy chuẩn đặt tên: tài liệu và thư mục dùng tiếng Việt không dấu, chữ thường, phân tách bằng dấu gạch nối (`ten-tai-lieu.md`). Báo cáo theo ngày thêm hậu tố `YYYY-MM-DD`; giữ các tên quy ước của công cụ như `README.md`, `AGENTS.md`, `CLAUDE.md`, `CONSTRAINTS.md`. Tên sản phẩm và thuật ngữ như Git, Render, Neon được giữ khi cần.

Chỉ dẫn agent: [AGENTS.md](../AGENTS.md). Ràng buộc bắt buộc: [CONSTRAINTS.md](../CONSTRAINTS.md). Không lưu secret, token, dump hoặc source private vào tài liệu.
