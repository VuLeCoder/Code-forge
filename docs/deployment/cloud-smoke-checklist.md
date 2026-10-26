# Cloud smoke checklist

Điền release commit và thời gian chạy. Lưu output không chứa PAT, cookie, access token, Authorization header, mã nguồn private hoặc diff private.

Đã có readiness probe và smoke Git HTTPS trực tiếp tới Render. Đây chưa phải nghiệm thu cloud end-to-end: invitation/PR/admin, quota payload lớn, restart/source recovery, migration và backup/restore vẫn chưa chạy. Readiness endpoint chạy `SELECT 1`, kiểm tra Git và ghi/xóa một file tạm; đây không phải probe chỉ đọc. Vercel nằm ngoài phạm vi; chưa có frontend cloud URL được nghiệm thu.

| Trường | Kết quả |
| --- | --- |
| Source tip hiện tại | `fca4839` trên `thviet` (exact SHA `fca48391e988ec73c9795345802fd7036c23512c`) |
| Code CI evidence | Actions #128 (`40269234926`) passed on exact SHA `df77e2b`; earlier #118–#127 passed on their respective SHAs |
| Latest CI | Actions #129 (`40270158604`) on `2d124b3` and #130 (`40270270878`) on current `fca4839` were in progress when checked |
| Render commit đang chạy | `388c584` theo Render Dashboard; chưa phải source tip hiện tại |
| Frontend URL | Chưa có; Vercel deferred/out of scope |
| Backend URL | `https://code-forge-api-thviet.onrender.com` |
| Readiness probe | 2026-10-26: `GET /api/v1/health/ready` → HTTP 200; database/Git/storage đều `up` trên deployed `388c584` |
| Public repository API | 2026-10-26: HTTP 200 sau cold start; initial wake requests returned `503 hibernate-pending-wake` |
| Git HTTPS smoke | 2026-10-26: anonymous public clone/fetch passed; private PAT clone/push/fetch passed and fetched SHA matched pushed SHA; temporary PAT revoked. Payload/quota boundaries not tested. |
| Người nghiệm thu | Codex; Render/API/Git smoke, không phải nghiệm thu PR/admin/recovery |

Readiness implementation chạy `SELECT 1` qua Prisma và ghi/xóa file tạm trong Git storage (có thể tạo thư mục nếu thiếu). Public/private Git HTTPS clone/fetch và private push đã được smoke-test, nhưng login UI, PR/invitation/admin cloud flows, migration, backup/restore, payload quota và source recovery sau restart chưa được nghiệm thu. Render Dashboard vẫn cho thấy last verified successful deploy là `388c584`; không deploy/restart trước khi có kế hoạch sao lưu/khôi phục Git vì storage Free có thể mất dữ liệu.

## Tài khoản và quyền truy cập

- [x] Backend readiness: `GET https://code-forge-api-thviet.onrender.com/api/v1/health/ready` trả HTTP 200; database, Git executable và storage đều `up` (2026-10-26; deployed commit `388c584`).
- [ ] Frontend HTTPS tải được. Chưa có frontend cloud host trong phạm vi hiện tại; không suy ra từ API readiness.
- [ ] Kiểm tra rate limit qua Render với hai client độc lập; gửi `X-Forwarded-For`/`CF-Connecting-IP` và `X-CodeForge-Client-IP`/signature giả từ client, xác minh không chia sẻ bucket sai hoặc vượt giới hạn. Ghi lại số trusted proxy hop thực tế; backend phải bỏ qua IP chưa ký hợp lệ.
- [ ] Đăng ký hoặc đăng nhập, refresh, logout; sau logout request API dùng access token cũ bị từ chối.
- [x] Tạo fixture repository public/private và xác minh public anonymous clone cùng private authenticated Git access tới Render (2026-10-26). Đây là smoke fixture, không phải dữ liệu dự án.
- [ ] Anonymous đọc public được, không đọc được private; unauthorized response không phân biệt thông tin repo private.
- [x] Tạo PAT giới hạn cho smoke test; private clone/push/fetch thành công. PAT đã revoke; không ghi PAT vào URL/log/history.

## Git HTTP trực tiếp Render

- [ ] `git ls-remote <public-url>` hoạt động qua HTTPS/TLS.
- [x] Private clone, commit, push branch và fetch branch bằng PAT hoạt động (2026-10-26); SHA fetch khớp SHA push.
- [x] Basic challenge trả về `401` cho request không có credential và authenticated private Git operation thành công qua Render, xác nhận Authorization tới được backend.
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
