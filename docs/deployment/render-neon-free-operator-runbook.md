# Runbook vận hành demo Render Free + Neon

> **Trạng thái:** runbook hướng dẫn thao tác; các bước có nhãn “chưa thực hiện” chưa phải bằng chứng nghiệm thu. Đây là demo, không phải dịch vụ lưu source production.

## Đã xác minh trong repository

- Backend chạy `backend/Dockerfile`; migration chạy riêng bằng `backend/Dockerfile.migrate` với lệnh `prisma migrate deploy`.
- `DATABASE_URL` là kết nối runtime; `DATABASE_URL_UNPOOLED` là `directUrl` của Prisma và được dùng cho advisory lock/migration. Production validation yêu cầu cả hai, cùng `JWT_ACCESS_SECRET`, `RATE_LIMIT_PROXY_SECRET` và `COOKIE_SECURE=true`.
- `GIT_PUBLIC_BASE_URL` cấu hình clone URL trực tiếp tới backend. Frontend dùng `BACKEND_URL`, `APP_ORIGIN` và `RATE_LIMIT_PROXY_SECRET` server-side.
- Render Free dùng filesystem ephemeral; Git source có thể mất sau spin-down/restart/redeploy. Neon giữ metadata riêng, nhưng metadata còn lại không chứng minh Git objects còn tồn tại.
- Maintenance jobs trong code không phải chế độ maintenance cho toàn ứng dụng. Tôi không thấy cờ/API được hỗ trợ để chặn toàn bộ mutation và drain request trước migration; phải xác minh cách đóng băng ghi trước release.
- Readiness gần nhất được ghi trong [cloud checklist](./cloud-smoke-checklist.md) là HTTP 200 trên deploy `388c584`. Deploy `4407e7d` từng gặp `P1001`; nguyên nhân lịch sử vẫn chưa được xác minh. Migration cloud, backup/restore, Git HTTP và smoke nghiệp vụ chưa nghiệm thu theo [trạng thái deploy](./README.md).
- **Khôi phục source sau khi storage mất chưa được diễn tập.** Không coi khả năng có clone local là bằng chứng khôi phục thành công.

## Điều kiện dừng bắt buộc

Dừng, không deploy/migrate, nếu chưa xác định đúng Neon database và Render service, chưa có backup metadata được kiểm tra đọc, chưa chuẩn bị clone Git đủ refs/tag, hoặc chưa có cách thực tế để ngăn mutation và chờ Git write đang chạy kết thúc. Không đoán Neon retention/backup capability; xác minh trong tài liệu và giao diện chính thức của tài khoản trước khi dựa vào tính năng đó.

Không gửi connection string, password, PAT, cookie hay secret qua chat, issue, shell history hoặc log. Chỉ nhập secret trực tiếp vào secret manager/provider UI. Không in environment values khi chẩn đoán.

## 1. Preflight — thao tác operator, chưa nghiệm thu

1. Ghi release commit, service/backend URL, database identity, thời điểm và người thực hiện vào [cloud smoke checklist](./cloud-smoke-checklist.md). Chỉ dùng tài nguyên demo đã được xác nhận; không dùng nhầm database khác.
2. Đối chiếu **tên biến** với [bảng deployment](./README.md#biến-môi-trường-backend). Không dán giá trị để chia sẻ. Runtime cần `DATABASE_URL`; `DATABASE_URL_UNPOOLED` phải là direct URL phù hợp advisory lock/migration. Frontend local cần `BACKEND_URL`, `APP_ORIGIN`, và cùng `RATE_LIMIT_PROXY_SECRET` ở server frontend/backend.
3. Xác nhận commit có CI cần thiết và image build được. Kiểm tra trạng thái migration bằng quy trình read-only được hỗ trợ; không chạy `migrate reset`, `db push`, hoặc lệnh thay schema để “thử kết nối”.
4. Với clone Git dự phòng: xác minh đúng repository, remote không chứa credential trong URL, branch/tag cần giữ hiện diện và object connectivity đọc được. Không đưa source private vào nơi lưu trữ/chia sẻ không được phép.
5. Xác minh nguồn backup Neon, phạm vi, thời điểm và cách phục hồi trực tiếp theo tính năng đang có trong tài khoản. Chụp backup metadata trước migration; kiểm tra bản backup đọc/khôi phục được trên bản sao cô lập trước khi release. **Hiện chưa có bằng chứng backup/restore cloud đã chạy.**

## 2. Cửa sổ ghi và migration

1. Chọn cửa sổ bảo trì thông báo trước. Vì hiện chưa thấy application-wide write gate, không tuyên bố hệ thống đã ở maintenance chỉ dựa trên maintenance jobs hoặc readiness endpoint.
2. Chỉ tiếp tục nếu operator có thể chặn mutation bằng cơ chế đã kiểm chứng và xác nhận Git push/merge đang chạy đã drain. Nếu không có cơ chế đó, dừng release và bổ sung/kiểm chứng phương án; không dùng restart làm cách thay thế cho drain an toàn.
3. Tạo/kiểm tra backup metadata và clone Git dự phòng trước mọi restart/redeploy. Render Free có thể làm mất filesystem source; chỉ thực hiện trên demo sau khi người vận hành chấp nhận rủi ro và đã chuẩn bị recovery.
4. Build migration image từ đúng release commit, ở thư mục gốc repository:

   ```powershell
   docker build -f backend/Dockerfile.migrate -t code-forge-migrate:release-candidate .
   ```

5. Chạy one-shot job bằng secret manager để inject `DATABASE_URL` và `DATABASE_URL_UNPOOLED`; không thêm URL vào command line. Chỉ mở ghi/deploy backend sau khi job kết thúc thành công và migration history khớp release commit. Migration phải additive/forward-only; không sửa migration đã áp dụng.
6. Nếu job lỗi, timeout hoặc kết quả không rõ: giữ mutation bị chặn; lưu log đã loại secret, kiểm tra `prisma migrate status` và đối chiếu backup. Không chạy lại mù. Không tự rollback SQL.

## 3. Kiểm tra sau release

Chỉ sau migration và deploy thành công, ghi release SHA cùng output không nhạy cảm và chạy các mục tương ứng trong [cloud smoke checklist](./cloud-smoke-checklist.md): readiness, HTTPS/TLS, login, quyền public/private, PAT, clone/fetch/push trực tiếp qua Render, invitation, PR merge, admin/audit. Readiness HTTP 200 riêng lẻ không thay thế các smoke test này.

Tắt write freeze chỉ sau khi kiểm tra dữ liệu và hành trình bắt buộc đạt. Nếu lỗi ảnh hưởng toàn vẹn dữ liệu, giữ freeze và chuyển sang điều tra/rollback.

## 4. Rollback và đối soát

- Nếu ứng dụng lỗi nhưng migration tương thích ngược đã được chứng minh, rollback **image ứng dụng** về bản trước; giữ nguyên database. Không revert migration bằng SQL.
- Nếu migration dở dang/thất bại, không mở ghi. Giữ nguyên trạng thái để điều tra, đối chiếu log migration với backup và quyết định một bước forward-only có review. Không xóa schema, drop database, reset migration history hoặc chạy `migrate reset` trên dữ liệu demo.
- Với merge/push journal `NEEDS_RECONCILIATION` hoặc trạng thái mơ hồ, giữ fail-closed. Thu thập operation ID, repository ID, generation, SHA/ref và log đã làm sạch; chạy reconciliation được hỗ trợ và xác minh ref/ancestry cùng metadata. Không tự sửa ref/SQL, không retry mutation mới để che trạng thái mơ hồ.
- Sau mất Git storage, trước tiên xác minh clone dự phòng còn object/refs cần thiết. Chỉ khôi phục vào repository demo đã được xác nhận và storage đang trống/được chuẩn bị; không force-push để ghi đè source chưa đối soát. Lệnh khôi phục mẫu được ghi trong [README](./README.md#rollback-và-phục-hồi): kiểm tra `git remote -v`, sau đó push branch và tag cần thiết. Không nhúng PAT vào URL.
- **Bằng chứng hiện có không cho thấy source-loss recovery đã được rehearsal.** Đánh dấu mục này chưa đạt cho tới khi rehearsal trên fixture hoàn thành và ghi lại release SHA, branch/tag được khôi phục cùng kết quả clone/fetch.

## Lệnh tuyệt đối không dùng trên dữ liệu cloud

Không chạy `prisma migrate reset`, `prisma db push`, drop/truncate database/schema, xóa migration history, xóa volume/disk, `rm -rf`/xóa thư mục Git storage, hoặc force-push/rewrite refs để khắc phục deploy. Mọi thử nghiệm destructive chỉ được làm trên fixture cô lập có chủ sở hữu rõ ràng, backup/cleanup đã kiểm tra; runbook này không cấp quyền thực hiện chúng.

## Tài liệu tham khảo

- [Render Free instances](https://render.com/docs/free) và [Render Persistent Disks](https://render.com/docs/disks)
- [Neon Prisma guide](https://neon.com/docs/guides/prisma) và [Neon connection pooling](https://neon.com/docs/connect/connection-pooling)
- [Prisma v6 data sources](https://www.prisma.io/docs/orm/v6/prisma-schema/overview/data-sources)
