# Cloud smoke checklist

Điền release commit và thời gian chạy. Lưu output không chứa PAT, cookie, access token, Authorization header, mã nguồn private hoặc diff private.

Đã có readiness probe, smoke Git HTTPS trực tiếp tới Render, API/Git smoke cho owner–collaborator invitation→PR→merge, read-only dashboard preflight cho Render/Neon và local Compose runtime smoke cô lập. Đây chưa phải nghiệm thu cloud end-to-end: browser UI journey, admin/audit, quota payload lớn, restart/source recovery, migration và backup/restore vẫn chưa được nghiệm thu. Readiness endpoint chạy `SELECT 1`, kiểm tra Git và ghi/xóa một file tạm; đây không phải probe chỉ đọc. Vercel nằm ngoài phạm vi; chưa có frontend cloud URL được nghiệm thu.

| Trường | Kết quả |
| --- | --- |
| Source tip | `thviet`: `31b727d0de7c15ead9a5a53149675b9ef957a0d9` (release-document consistency tip; prior `0878265` passed CI #144) |
| Code CI evidence | Feature #141 (`40351375771`) and thviet candidate #144 (`40354424638`) passed; current tip #145 is still running. |
| Latest CI at check | #145: in progress on `31b727d0de7c15ead9a5a53149675b9ef957a0d9` |
| Render commit đang chạy | `388c584` theo Render Dashboard; chưa phải source tip hiện tại |
| Render auto-deploy | `After CI Checks Pass`; pushes to `thviet` may redeploy. Do not push until the documented source-recovery preflight is satisfied. |
| Render service limits | Dashboard read-only check: `code-forge-api-thviet`, Free plan, no persistent disk; Live `388c584`; source can be lost on restart/redeploy. |
| Neon resource | Dashboard read-only check: project `Code Forge` (`green-mountain-81958216`), branch `production`, Singapore, Free; separate from `BUS Ticket`. |
| Neon history window | 6 hours; this is time-travel/instant-restore history, not a completed production export/restore rehearsal. T38 only rehearsed local PostgreSQL metadata backup/restore. |
| Frontend URL | Chưa có; Vercel deferred/out of scope |
| Backend URL | `https://code-forge-api-thviet.onrender.com` |
| Readiness probe | 2026-10-26: `GET /api/v1/health/ready` → HTTP 200; database/Git/storage đều `up` trên deployed `388c584` (Render vẫn chưa ở source tip `31b727d`) |
| Live revision endpoint | 2026-10-26: `GET /api/v1/health/live` → HTTP 200, body chỉ có `status` và `timestamp`; `commitSha` chưa có trên deployed `388c584`, nên source change `97d5d34` chưa được xác minh live |
| Public repository API | 2026-10-26: HTTP 200 sau cold start; initial wake requests returned `503 hibernate-pending-wake` |
| Git/PR HTTPS smoke | 2026-10-26: anonymous public clone/fetch; private PAT clone/push/fetch; owner PR merge/fetch `f8468c6063a70aea4306f6ab6de7a1c58cafb7bd`; WRITE invitation→accept→collaborator push/PR→owner merge/fetch `481d75d44f2ad2855bab853cb55d28c96235877b`. Both merge commits have two parents. Temporary PATs revoked and sessions logged out. Payload/quota, admin and recovery not tested. |
| Người nghiệm thu | Codex; Render API/Git/PR integration smoke plus local T-COMPOSE/T37/T38/T40 evidence, not visual browser or full release acceptance |

Local runtime evidence (separate from cloud): T-COMPOSE used project `codeforge-smoke-20261025-b51c88c` with loopback-only ports and new task-owned volumes; all 7 migrations applied, backend healthcheck was healthy, and `/api/v1/health/ready` returned HTTP 200. The containers/network were stopped without `-v`; existing user containers and volumes were not touched. T37's isolated Linux/PostgreSQL process-crash evidence is recorded in the execution log and is not a Render/Neon result.

Readiness implementation chạy `SELECT 1` qua Prisma và ghi/xóa file tạm trong Git storage (có thể tạo thư mục nếu thiếu). Public/private Git HTTPS và collaborator invitation→accept→push/PR→owner merge/fetch đã được smoke-test qua API/Git; browser UI journey, admin, migration, backup/restore, payload quota và source recovery sau restart chưa được nghiệm thu. Render Dashboard xác nhận service `code-forge-api-thviet`/`thviet` có Auto-Deploy `After CI Checks Pass`, last verified successful deploy `388c584` (source tip `31b727d` mới hơn), và Free không có persistent disk; `/api/v1/health/live` chưa trả `commitSha`. Neon `Code Forge` có history window 6 giờ nhưng chưa có export/restore rehearsal. Không deploy/restart trước khi có kế hoạch sao lưu/khôi phục Git và metadata.

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

- [x] Owner mời collaborator WRITE; collaborator nhận/chấp nhận invitation, clone private repo và push source branch (2026-10-26).
- [x] Owner tạo PR trên private fixture; compare trả `READY`, files/diff đọc được và owner permission đúng (2026-10-26). Đây là API/Git smoke, không phải browser UI test.
- [x] Owner merge PR fixture; fetch xác nhận target có merge commit hai parent (2026-10-26).
- [x] Collaborator tạo PR; owner compare/files/diff và merge quyền owner được xác minh trên fixture (2026-10-26).
- [ ] Stale compare yêu cầu refresh; conflict không cập nhật target.
- [ ] Retry cùng operation ID không merge lần hai; trường hợp metadata đang đối soát hiển thị trạng thái tương ứng.
- [ ] Admin khóa/mở user hoặc repo, restore repository còn hạn và xem audit; admin không được tự đọc private source hoặc merge.
- [ ] Audit không chứa token, cookie, Authorization, source code hoặc raw diff.

## Cold start, restart và mất storage

- [ ] Ghi thời gian cold start và xác nhận client xử lý trạng thái chờ/lỗi.
- [ ] Trên Render Free, chỉ thực hiện trên dữ liệu fixture: redeploy/restart backend rồi xác minh storage reset theo hành vi filesystem ephemeral; không dùng repository cloud có source duy nhất. Free service không có persistent disk và có thể spin down khi idle. [Render Free limitations](https://render.com/docs/free)
- [ ] Metadata còn nhưng Git storage mất phải thông báo rõ trạng thái reset/generation; PR cũ không thể merge.
- [ ] Khôi phục source bằng push từ clone giữ sẵn; xác minh branch và PR mới sau phục hồi.
- [ ] Điền URL, commit, thời gian và bằng chứng không nhạy cảm vào bảng đầu trang; các mục chưa chạy giữ nguyên trạng thái chưa đạt.
