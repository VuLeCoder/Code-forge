# Cloud smoke checklist

Cập nhật tài liệu 23/11/2026; chưa kiểm tra provider hoặc chạy smoke cloud mới. Tất cả checkbox dưới đây dành cho **candidate tiếp theo**. Bằng chứng lịch sử nằm cuối trang và không tự hoàn tất checklist mới.

## Phiếu nghiệm thu candidate

| Trường | Giá trị cần ghi |
| --- | --- |
| Release SHA / CI run URL | Chưa ghi nhận candidate mới |
| Render service / revision / URL | Operator xác nhận trước thao tác |
| Neon project / branch / database | Operator xác nhận đúng target, không ghi DB URL |
| Frontend origin / URL | Frontend cloud chưa nằm trong phạm vi đã nghiệm thu |
| Thời gian / operator | Ghi theo lượt chạy |
| Metadata backup / Git backup / restore evidence | Chưa có bằng chứng cloud mới |
| Kết quả / mục chưa đạt / quyết định mở ghi | Chưa nghiệm thu |

Chỉ lưu output đã loại PAT, cookie, Authorization, connection string và source/diff private. Quy trình: [operator runbook](huong-dan-van-hanh-render-neon-mien-phi.md); việc mở: [remaining-tasks](../cong-viec-con-lai.md).

## Preflight và kiểm soát ghi

- [ ] Xác minh đúng target/revision/CI, topology proxy và auto-deploy; có quyền operator.
- [ ] Backup metadata mã hóa/checksum, Git clone đủ refs/objects; restore vào đích cô lập đã kiểm chứng.
- [ ] Production bootstrap frozen; admin GET/PATCH write-freeze và audit hoạt động, drain về `activeWriteCount=0` trước migration/restart.
- [ ] Migration/image đúng SHA; kết quả migrate rõ ràng, rollback compatibility đã review.
- [ ] Đã thống nhất cửa sổ smoke fixture có ghi: ingress hạn chế người dùng thường, operator mở freeze có kiểm soát; freeze lại khi lỗi.

## Auth, quyền và transport

- [ ] Health/live và readiness đạt; readiness có kiểm tra DB/Git và ghi/xóa file tạm, không chứng minh revision hoặc toàn bộ nghiệp vụ.
- [ ] HTTPS/TLS, Origin/cookie, frontend proxy hoạt động trên host thực tế được chọn; frontend cloud chỉ đánh giá khi có host trong phạm vi.
- [ ] Hai client có rate-limit bucket đúng; header IP/signature giả không bypass được, trusted hops khớp topology.
- [ ] Register/login/refresh/logout; access/session cũ bị từ chối sau logout/khóa theo contract.
- [ ] Public đọc anonymous; private URL/list/profile/Git chỉ cho owner/member hợp lệ, không rò qua lỗi.
- [ ] READ/WRITE/member `canMerge`, revoke/downgrade/locked/deleted được kiểm tra ở request tiếp theo; ADMIN không tự có quyền private/merge.
- [ ] Account/avatar/password/PAT và one-time token hoạt động; revoke sau smoke.

## Git HTTP, PR và quản trị

- [ ] Clone URL đi trực tiếp backend `/api/v1/git`; Basic challenge/Authorization, public/private clone/fetch/push qua TLS đạt.
- [ ] Payload hợp lệ >4,5 MB; sát/vượt quota, ref giữ nguyên khi bị từ chối; không nhận tags/non-fast-forward hoặc xóa default branch.
- [ ] Nhánh đầu tiên/default HEAD đúng; bảo vệ bật/tắt và permission được áp dụng đúng.
- [ ] Timeout/disconnect/mất lock hủy child phù hợp; hook lỗi không ghi audit thành công, outcome chưa rõ giữ journal.
- [ ] WRITE invite → accept → push → PR; owner hoặc WRITE có grant merge; thu hồi grant chặn merge.
- [ ] Compare/files/diff đúng snapshot; stale/conflict không cập nhật target; retry operation ID idempotent, merge hai parent.
- [ ] Journal reconciliation/admin lock/unlock/restore/audit đúng quyền, không lộ secret/source/diff; mở ghi bình thường chỉ khi các mục bắt buộc đạt.

## Cold start và recovery

- [ ] Ghi cold-start/restart và phản hồi client; không coi job cadence khi host ngủ là bảo đảm thời gian thực.
- [ ] Trên fixture có backup, diễn tập source loss; UI báo reset/generation, PR cũ không merge được.
- [ ] Phục hồi từng branch được duyệt từ clone, default branch trước; clone/fetch kiểm chứng refs/content; tag backup giữ riêng vì server chưa nhận tags.
- [ ] Ghi bằng chứng, mục chưa đạt và quyết định release; không dùng repo chứa source duy nhất để rehearsal.

## Bằng chứng lịch sử — không xác nhận trạng thái hiện tại

| Thời điểm/phạm vi | Ghi nhận đã có |
| --- | --- |
| 26/10/2026, Render API/Git fixture | Public clone/fetch; PAT private clone/push/fetch; WRITE invite/accept/push/PR và owner merge. Hai parent đã kiểm chứng; PAT revoke, session logout. Không phải browser UI/admin/quota/recovery acceptance. |
| 27/10 và 05/11/2026, deploy từng ghi nhận `388c584` | Health/readiness/public list đạt; Git public fixture rỗng `ls-remote` exit 0, private anonymous trả 401. Live endpoint không có commitSha, không suy revision từ probe. |
| Dashboard lịch sử | Render `code-forge-api-thviet`, Free, không persistent disk, auto-deploy `After CI Checks Pass`; Neon project Code Forge/branch production, Singapore. Phải xác nhận lại trước thao tác. |
| Neon 27/10/2026 | History window 6 giờ, chưa snapshot/backup schedule; chưa có export/restore cloud rehearsal. Không suy capability/gói hiện tại từ ghi nhận này. |
| CI lịch sử write-freeze | PR #11 merge `3b7ec51`; runs `41902788424`, `41902832903`, post-merge `41903915472` đã được ghi nhận đạt. Không chứng minh candidate hiện tại hoặc deployed target. |
| CI/runtime lịch sử khác | `thviet` candidate `f58ef3d`, run `40453128999` đạt; docs checkpoint `dfe735b`, run `40456342235` đạt. Không thay đổi bằng chứng cloud của deploy cũ. |
| Local lịch sử | T-COMPOSE: project cô lập, 7 migration, backend healthy; T37/T38/T40 là process-crash/backup/release local, không phải cloud. Kết quả gần nhất tại [verification](../ket-qua-kiem-thu.md). |

Cloud migration, backup/restore, payload/quota lớn, admin/audit, browser UI và source-loss recovery vẫn chưa có nghiệm thu mới. Render Free có ephemeral filesystem; xem [giới hạn chính thức](https://render.com/docs/free) và xác minh gói thực tế trước release.
