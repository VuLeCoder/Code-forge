# Cloud smoke checklist

Điền release commit và thời gian chạy. Lưu output không chứa PAT, cookie, access token, Authorization header, mã nguồn private hoặc diff private.

Chưa có cloud smoke nào được thực hiện; bảng và mọi mục cloud bên dưới giữ trạng thái chưa chạy. Các kiểm tra local hiện có được ghi trong [README release](./README.md) và không thay thế nghiệm thu cloud.

| Trường | Kết quả |
| --- | --- |
| Release commit | Chưa chạy |
| Frontend URL | Chưa công bố |
| Backend URL | Chưa công bố |
| Thời điểm UTC | Chưa chạy |
| Người nghiệm thu | Chưa ghi nhận |

## Tài khoản và quyền truy cập

- [ ] Frontend HTTPS tải được; `GET /api/v1/health/ready` trả trạng thái database, Git executable và khả năng ghi storage đều khỏe.
- [ ] Kiểm tra rate limit qua Render với hai client độc lập; gửi `X-Forwarded-For`/`CF-Connecting-IP` và `X-CodeForge-Client-IP`/signature giả từ client, xác minh không chia sẻ bucket sai hoặc vượt giới hạn. Ghi lại số trusted proxy hop thực tế; backend phải bỏ qua IP chưa ký hợp lệ.
- [ ] Đăng ký hoặc đăng nhập, refresh, logout; sau logout request API dùng access token cũ bị từ chối.
- [ ] Tạo repository public và private, xác minh URL clone trả về Render trực tiếp.
- [ ] Anonymous đọc public được, không đọc được private; unauthorized response không phân biệt thông tin repo private.
- [ ] Tạo PAT đúng scope; clone/fetch private bằng PAT; không đưa PAT vào remote URL/log/history.

## Git HTTP trực tiếp Render

- [ ] `git ls-remote <public-url>` hoạt động qua HTTPS/TLS.
- [ ] Clone, tạo commit, push branch, fetch branch mới hoạt động; test private repo với PAT.
- [ ] Xác minh Basic challenge và `Authorization` không bị proxy/host loại bỏ.
- [ ] Push payload hợp lệ lớn hơn 4,5 MB qua URL Render trực tiếp; kiểm tra push sát quota hoạt động, vượt quota bị từ chối và ref không thay đổi. Ngưỡng Vercel Function 4,5 MB là lý do test này phải đi trực tiếp Render. [Vercel payload limit](https://vercel.com/docs/errors/function_payload_too_large)
- [ ] Timeout/disconnect hủy Git child process; lỗi hook không được audit như push thành công.
- [ ] Kiểm tra URL từ browser được tạo bằng `GIT_PUBLIC_BASE_URL`, không phải Vercel origin.

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
