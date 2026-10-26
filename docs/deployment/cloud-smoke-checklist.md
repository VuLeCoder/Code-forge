# Cloud smoke checklist

Điền release commit và thời gian chạy. Lưu output không chứa PAT, cookie, access token, Authorization header, mã nguồn private hoặc diff private.

Đã có một probe readiness trên Render; endpoint chạy `SELECT 1`, kiểm tra Git và tạo thư mục nếu thiếu rồi ghi/xóa một file tạm. Đây không phải probe chỉ đọc và cũng **không phải** cloud smoke end-to-end. Các kiểm tra local được ghi trong [README release](./README.md) và không thay thế nghiệm thu cloud. Vercel hiện nằm ngoài phạm vi; chưa có frontend cloud URL được nghiệm thu.

| Trường | Kết quả |
| --- | --- |
| Source tip hiện tại | `23cb1c7` trên `thviet` (docs-only after tested code SHA `b6411ad`) |
| Code CI evidence | Actions #118 (`40262580445`) passed on exact SHA `b6411ad` |
| Latest docs CI | Actions #119 for `23cb1c7` was in progress at this snapshot |
| Render commit đang chạy | `388c584` theo Render Dashboard; chưa phải source tip hiện tại |
| Frontend URL | Chưa có; Vercel deferred/out of scope |
| Backend URL | `https://code-forge-api-thviet.onrender.com` |
| Readiness probe | 2026-10-26: `GET /api/v1/health/ready` → HTTP 200; database/Git/storage đều `up` |
| Người nghiệm thu | Codex; probe qua endpoint public, không phải kiểm thử nghiệp vụ |

Readiness implementation chạy `SELECT 1` qua Prisma và ghi/xóa file tạm trong Git storage (có thể tạo thư mục nếu thiếu), nhưng probe đơn lẻ không chứng minh login, migration, backup/restore, Git HTTP hoặc quyền dữ liệu. Render Dashboard vẫn cho thấy last successful deploy là `388c584`; không deploy/restart để cập nhật source trước khi có kế hoạch sao lưu/khôi phục Git vì storage Free có thể mất dữ liệu.

## Tài khoản và quyền truy cập

- [x] Backend readiness: `GET https://code-forge-api-thviet.onrender.com/api/v1/health/ready` trả HTTP 200; database, Git executable và storage đều `up` (2026-10-26; deployed commit `388c584`).
- [ ] Frontend HTTPS tải được. Chưa có frontend cloud host trong phạm vi hiện tại; không suy ra từ API readiness.
- [ ] Kiểm tra rate limit qua Render với hai client độc lập; gửi `X-Forwarded-For`/`CF-Connecting-IP` và `X-CodeForge-Client-IP`/signature giả từ client, xác minh không chia sẻ bucket sai hoặc vượt giới hạn. Ghi lại số trusted proxy hop thực tế; backend phải bỏ qua IP chưa ký hợp lệ.
- [ ] Đăng ký hoặc đăng nhập, refresh, logout; sau logout request API dùng access token cũ bị từ chối.
- [ ] Tạo repository public và private, xác minh URL clone trả về Render trực tiếp.
- [ ] Anonymous đọc public được, không đọc được private; unauthorized response không phân biệt thông tin repo private.
- [ ] Tạo PAT đúng scope; clone/fetch private bằng PAT; không đưa PAT vào remote URL/log/history.

## Git HTTP trực tiếp Render

- [ ] `git ls-remote <public-url>` hoạt động qua HTTPS/TLS.
- [ ] Clone, tạo commit, push branch, fetch branch mới hoạt động; test private repo với PAT.
- [ ] Xác minh Basic challenge và `Authorization` không bị proxy/host loại bỏ.
- [ ] Push payload hợp lệ lớn hơn 4,5 MB qua URL Render trực tiếp; kiểm tra push sát quota hoạt động, vượt quota bị từ chối và ref không thay đổi. Git Smart HTTP phải đi trực tiếp backend Render, không đi qua frontend proxy.
- [ ] Timeout/disconnect hủy Git child process; lỗi hook không được audit như push thành công.
- [ ] Kiểm tra clone URL được tạo bằng `GIT_PUBLIC_BASE_URL` và trỏ trực tiếp tới backend Render.

## Cộng tác, pull request, quản trị

- [ ] Owner mời collaborator WRITE; collaborator chấp nhận invitation và push source branch.
- [ ] Collaborator tạo PR; đọc commits/files/diff cùng snapshot; stale compare yêu cầu refresh.
- [ ] Conflict không cập nhật target; merge thành công tạo commit có hai parent và fetch thấy commit đó.
- [ ] Retry cùng operation ID không merge lần hai; trường hợp metadata đang đối soát hiển thị trạng thái tương ứng.
- [ ] Admin khóa/mở user hoặc repo, restore repository còn hạn và xem audit; admin không được tự đọc private source hoặc merge.
- [ ] Audit không chứa token, cookie, Authorization, source code hoặc raw diff.

## Cold start, restart và mất storage

- [ ] Ghi thời gian cold start và xác nhận client xử lý trạng thái chờ/lỗi.
- [ ] Trên Render Free, chỉ thực hiện trên dữ liệu fixture: redeploy/restart backend rồi xác minh storage reset theo hành vi filesystem ephemeral; không dùng repository cloud có source duy nhất. Free service không có persistent disk và có thể spin down khi idle. [Render Free limitations](https://render.com/docs/free)
- [ ] Metadata còn nhưng Git storage mất phải thông báo rõ trạng thái reset/generation; PR cũ không thể merge.
- [ ] Khôi phục source bằng push từ clone giữ sẵn; xác minh branch và PR mới sau phục hồi.
- [ ] Điền URL, commit, thời gian và bằng chứng không nhạy cảm vào bảng đầu trang; các mục chưa chạy giữ nguyên trạng thái chưa đạt.
