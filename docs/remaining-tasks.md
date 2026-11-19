# Công việc còn lại — Code Forge

Rà soát: 19/11/2026. Đây là danh sách task chung, chỉ giữ công việc chưa hoàn thành và đề xuất tương lai. Các file task/báo cáo cũ đã xóa; hướng dẫn triển khai và khôi phục vẫn nằm trong `deployment/` và `operations/`.

Lần rà soát này chỉ đọc tài liệu, mã nguồn và lịch sử Git local (HEAD `18da184`). Không chạy lại test sản phẩm, không kiểm tra GitHub/provider trực tiếp và không xác nhận trạng thái cloud hiện tại. “Chưa nghiệm thu” không đồng nghĩa “chưa có code”.

## Task đang mở

| ID | Công việc đã gộp | Trạng thái và điều kiện hoàn tất | Nguồn |
| --- | --- | --- | --- |
| R-01 | Chốt tài nguyên, quyền operator, hostname và phạm vi demo | Cần xác nhận đúng Render/Neon và quyền thao tác; kiểm tra lại revision/branch/env thực tế. Dữ liệu provider ngày 05/11 chỉ là lịch sử. Vercel vẫn ngoài phạm vi đã ghi nhận. | Operator runbook; cloud checklist |
| R-02 | Sao lưu metadata và source, diễn tập restore trước release | Chưa có bằng chứng provider: inventory clone đủ refs/objects; backup metadata có mã hóa/checksum/quyền truy cập; restore vào đích cô lập và kiểm tra dữ liệu/source. T38 local không thay thế mục này. | Operator runbook §1 |
| R-03 | Diễn tập write-freeze/drain, migration và rollback trên đích được xác nhận | Code write gate đã có; phần vận hành còn mở. Xác minh `WRITE_FREEZE_BOOTSTRAP=true`, admin freeze/drain về 0, backup đọc được, migration/recovery/app rollback; chỉ unfreeze sau smoke bắt buộc. T40 local không phải cloud acceptance. Không deploy/migrate khi chưa xác nhận target và recovery. | Release-control source; operator runbook |
| R-04 | Smoke cloud: auth, phân quyền và proxy/rate limit | Hai client có bucket độc lập; header giả không chọn được IP; kiểm tra trusted hops, TLS/cookie/header, register/login/refresh/logout và ranh giới public/private. Frontend HTTPS chỉ kiểm tra nếu có host trong phạm vi đã chốt. | Cloud checklist §Tài khoản |
| R-05 | Smoke Git trực tiếp: payload/quota và lỗi transport | Payload hợp lệ >4,5 MB; sát/vượt quota; ref không đổi khi bị từ chối; timeout/disconnect dừng child; hook lỗi không audit thành công. Các smoke Git cũ không chứng minh candidate hiện tại. | Cloud checklist §Git HTTP |
| R-06 | Smoke PR/admin/audit trên release candidate | Stale/conflict/retry operation ID không merge sai; trạng thái đối soát đúng; lock/unlock/restore/audit đúng quyền, không lộ secret/private source/raw diff. | Cloud checklist §Cộng tác |
| R-07 | Cold start và source-loss recovery trên fixture | Ghi cold-start, diễn tập restart/reset có kiểm soát sau backup, metadata/generation/PR cũ an toàn, push phục hồi từ clone rồi clone/fetch kiểm chứng. Không dùng repo chứa bản source duy nhất. | cloud checklist §Cold start; operator runbook |
| R-08 | Accessibility và responsive thủ công | Còn thiếu bằng chứng screen reader/thiết bị thật cho PR/admin và các giao diện vừa sửa; kiểm tra bàn phím, focus, thông báo trạng thái, light/dark và màn hình hẹp. Test browser đã ghi nhận không thay thế manual review. | Giao diện PR/admin và yêu cầu accessibility |
| R-09 | Hoàn tất rà soát tương phản giao diện | Đã có sửa màu trong `18da184`; vẫn cần đo text/nền render thực tế, rà sáng/tối, hover/selected/disabled, dropdown/dialog/badge/diff trên các trang. Mục tiêu text thường ≥4,5:1; sửa cặp màu cố định bị lệch theme. Chạy kiểm tra phù hợp trên candidate; kết quả build trước bị lỗi đọc TypeScript `--showConfig`, chưa có bằng chứng build lại thành công trong lần rà soát này. | Yêu cầu giao diện gần nhất; commit `18da184`; globals/CSS Modules |
| R-10 | Nghiệm thu candidate cuối và bàn giao | Chạy gate liên quan và MVP verification trên SHA tích hợp cuối; ghi riêng local/CI/cloud, cập nhật runbook và giới hạn lưu source. Chỉ công bố release khi checklist bắt buộc đạt; không lấy CI cũ làm bằng chứng HEAD. | CI workflow; release candidate |
| R-11 | Đồng bộ tài liệu kỹ thuật còn cũ | Sửa mô tả protection/merge owner-only thành protection bật/tắt và member `canMerge`; cập nhật account settings/PAT, design token và hướng dẫn chạy từ source hiện tại.  | Source hiện tại và tài liệu kỹ thuật còn giữ |

Thứ tự release: R-01 → R-02 → R-03 → R-04/R-05/R-06 → R-07 → R-10. R-08/R-09/R-11 có thể làm local trong lúc thiếu quyền provider. Không coi lịch sử `P1001` là lỗi đang tái diễn; chỉ điều tra nếu có bằng chứng mới trên candidate thực tế.

## Đề xuất tương lai — chưa cam kết vào MVP

| ID | Đề xuất và phạm vi | Điều kiện trước khi triển khai | Nguồn |
| --- | --- | --- | --- |
| B-01 | Bình luận PR, review Approve/Request changes, reviewer và yêu cầu duyệt lại khi có commit mới | Chốt contract/quyền và thứ tự ưu tiên; tách review khỏi quyền merge hiện có | code-forge-vs-github |
| B-02 | Thông báo trong ứng dụng, Issues cơ bản | Chốt sự kiện/người nhận; email/webhook là mở rộng riêng | code-forge-vs-github |
| B-03 | Email verification | Chốt chính sách login trước verify, mail adapter, challenge hash/use-once/expiry/throttle và test; delivery/DNS cần nghiệm thu provider | Yêu cầu bảo mật chưa triển khai |
| B-04 | 2FA TOTP, ưu tiên ADMIN | Chốt secret encryption/recovery/challenge/re-auth; test replay/expiry và thiết bị thật trước bật enforcement | Yêu cầu bảo mật chưa triển khai |
| B-05 | SSH, squash/rebase, tags/releases, CI repo người dùng, quota override và Git GC dài hạn | Chỉ lên lịch khi nhóm có nhu cầu; không phải điều kiện ngầm để đóng MVP | code-forge-vs-github |

## Chi tiết yêu cầu bảo mật chưa triển khai

### B-03 — Xác minh email

- Lưu `emailVerifiedAt` và challenge dạng hash, dùng một lần, có mục đích, hạn dùng, giới hạn số lần thử và thời điểm đã sử dụng.
- Chốt chính sách đăng nhập trước xác minh; khi bật enforcement, đăng ký trả trạng thái chờ xác minh và chưa cấp session.
- Thêm adapter gửi mail, API xác nhận/gửi lại, throttle theo tài khoản/IP và phản hồi không tiết lộ tài khoản. Không trả token thô qua API/log.
- Kiểm thử challenge sai/hết hạn/đã dùng, gửi lại và consume nguyên tử; kiểm tra luồng trình duyệt, bàn phím và màn hình hẹp.
- Nghiệm thu delivery, spam, SPF/DKIM/DMARC trên provider thực tế.

### B-04 — TOTP 2FA

- Ưu tiên ADMIN; mã hóa secret bằng khóa riêng, recovery code chỉ lưu hash.
- Login trả challenge có hạn dùng/giới hạn thử; chỉ cấp session sau khi xác minh thành công.
- Setup/disable yêu cầu xác thực lại mật khẩu; secret/otpauth URI chỉ hiển thị lúc setup.
- Kiểm thử replay, expiry, clock skew, recovery code dùng một lần, re-auth và không rò secret trước khi làm UI.
- Kiểm tra thiết bị authenticator thật và luồng trình duyệt, focus, lỗi và giao diện hẹp trước bật enforcement.
