| B-21 | Major | Kiểm kho (chi tiết) | M1/M2 | Trên điện thoại phiếu kiểm là bảng cuộn ngang; Design §10.6/§12.2 yêu cầu card list | **Đã sửa** – dưới 640 px hiện danh sách thẻ (tên, SKU, Hệ thống · Chênh lệch, ô Đếm được 44 px); bảng giữ nguyên từ 640 px. Đã kiểm 360 px (nhập số → chênh lệch −1, tiến độ 5%) và 768 px |
| B-10 | Major | Thêm sản phẩm / Thư viện – Tìm sách | – | Tra cứu Open Library thường thất bại: timeout 5 s/request, Open Library trả lời 3–8 s, các lời gọi tuần tự | **Đã cải thiện** (TDD §8.8 sửa trước): timeout 12 s, gọi work + tác giả song song, bỏ qua tác giả lỗi, thử lại 1 lần khi rớt kết nối, lý do lỗi trong `details.reason`; 2 test mới. Đã tra thành công 1 ISBN (7,7 s). Sau đó Open Library **không truy cập được từ mạng máy test** (curl cũng hết 15 s, các trang khác bình thường) → **cần kiểm lại trên máy chủ thật** |
| B-04 | Minor | API | – | Thông báo mặc định của zod bằng tiếng Anh | **Đã sửa** – `z.config(z.locales.vi())` |
| B-03 | Major | Mọi form (vd. Nhà cung cấp) | – | Lỗi `validation_failed` chỉ hiện "Hãy kiểm tra các ô được đánh dấu" nhưng không ô nào được đánh dấu | **Đã sửa** – API nêu từng lỗi kèm tên trường: "Dữ liệu chưa hợp lệ. Số điện thoại không hợp lệ. Email: địa chỉ email không hợp lệ. Hãy sửa rồi lưu lại." (`apps/api/src/http/middleware.ts`) + test. Chưa tô đỏ từng ô (mỗi form phải tự ánh xạ `details`) |
# Kết quả test trước deployment

Theo [test-plan-deployment.md](test-plan-deployment.md). Môi trường: CSDL `bookstore_qa` làm mới từ đầu (`.env.qa`), api :3000, staff :5173 (dev server), worker.

## Giai đoạn 0 – Tự động

| # | Việc | Kết quả | Ghi chú |
| --- | --- | --- | --- |
| 0.1 | typecheck | Pass | |
| 0.1 | lint | Fail → **đã sửa** → Pass | 2 biến không dùng: `EmptyState` trong `apps/staff/src/pages/library.tsx`, `valueOf` trong `packages/modules/src/orders/preorders.ts` |
| 0.2 | `pnpm test` | Pass | domain 84, db 8, api 205 (297 test) |
| 0.3 | `pnpm build` | Pass (cảnh báo) | Bundle JS staff 1,12 MB (gzip 327 kB) > 500 kB – Minor, hiệu năng tải lần đầu |
| 0.3 | Docker image | Pass | `docker build` thành công |
| 0.4 | Migrations trên DB trống | Pass | |
| 0.5 | Chạy lại sau các bản sửa: typecheck, lint, test | Pass | domain 84, db 8, api 210 (+5 test mới). Lần chạy `pnpm test` đầu tiên lỗi do Testcontainers khởi động quá 180 s (môi trường), chạy lại pass |

## Tóm tắt

- **Đã sửa trong phiên (15):** B-02, B-03, B-04, B-05, B-06, B-09, B-16, B-21, B-23, B-28, B-34, B-35, B-36, B-37, B-39 – đều kiểm lại trên trình duyệt hoặc test tự động. Chưa commit. Bản `.docx` của SRS/TDD chưa cập nhật theo bản `.md`.
- **Còn mở chặn deploy:** không còn Blocker sau khi sửa B-34, B-35, B-36 (sao lưu/khôi phục production). B-28 (PIN/màn khóa) đã sửa.
- **Major:** B-03, B-21 đã sửa; B-10 đã cải thiện nhưng cần kiểm lại trên máy chủ thật vì Open Library không truy cập được từ mạng máy test.
- **Giao diện:** 38 màn × 6 viewport – **không có tràn ngang cấp trang và không có chữ bị cắt**. Bảng cuộn ngang trong khung (cả ở 1280 px) là đúng Design §10.6.
- **Chưa test:** xem cuối file.

## Lỗi ghi nhận

| ID | Mức | Màn / luồng | Viewport | Mô tả | Trạng thái |
| --- | --- | --- | --- | --- | --- |
| B-01 | Minor | Build | – | Bundle JS chính 1,12 MB, chưa tách chunk | Mở |
| B-02 | **Blocker** | Sản phẩm / Nhập dữ liệu | – | Cửa hàng mới không có danh mục nào và không có màn hình tạo danh mục (FR-CAT-06) → không tạo/nhập được sản phẩm | **Đã sửa** – tài liệu trước (SRS FR-CAT-06, FR-ADM-10; Design Appendix A; TDD §6.2 + nhật ký thay đổi), rồi: Cài đặt → Danh mục dùng chung → **Danh mục sản phẩm** (cây thụt lề + đường dẫn, thêm/sửa tên Anh–Việt/chuyển cha/thứ tự/ngừng dùng); API `PATCH /catalog/categories/{id}`, `?all=true`, chặn vòng lặp và chặn ngừng dùng khi còn danh mục con; test API mới. Đã kiểm ở 1280 và 360 px |
| B-03 | Major | Mọi form (vd. Nhà cung cấp) | – | Lỗi `validation_failed` chỉ hiện "Hãy kiểm tra các ô được đánh dấu" nhưng không ô nào được đánh dấu; chi tiết theo trường (`details[].path`) bị bỏ qua (chỉ màn đăng nhập hiện) | Mở |
| B-04 | Minor | API | – | Thông báo lỗi mặc định của zod bằng tiếng Anh, vd. email: "Invalid email address" (NFR-USE-05) | Mở |
| B-05 | **Blocker** | Đăng nhập lần đầu | – | Nhân viên mới (mật khẩu tạm) đăng nhập → "Bạn không có quyền xem trang này", không vào được màn đổi mật khẩu: API chặn `GET /api/v1/setup` khi phiên phải đổi mật khẩu (cũng như khi khóa màn hình) | **Đã sửa** – thêm `/api/v1/setup` vào danh sách cho phép (`apps/api/src/http/middleware.ts`) + test hồi quy |
| B-06 | **Blocker** | Đổi mật khẩu | – | Đổi mật khẩu thành công nhưng app quay lại form trống (dữ liệu `me` cũ) → người dùng kẹt ở màn đổi mật khẩu. Cùng lỗi ở đăng nhập (`invalidateQueries` không tải lại query không có observer) | **Đã sửa** – `refetchQueries` trong `pages/auth.tsx` |
| B-07 | – | Nhà cung cấp | D1 1280 | ~~Bảng phải cuộn ngang trên desktop~~ – đúng Design §10.6 (bảng rộng cuộn trong khung, cột đầu cố định) | Không phải lỗi |
| B-08 | Cosmetic | Thiết lập | – | Bước 2 ghi "Nhập lại mật khẩu **mới**" dù là mật khẩu đầu tiên | Mở |
| B-09 | **Major** | Nhân viên | – | Quản lý (có `user.unlock`, không có `user.manage`) thấy menu Nhân viên nhưng danh sách báo "không có quyền" → không mở khóa được tài khoản (FR-ADM-01). Cùng lỗi cho bộ lọc người ở Nhật ký với vai trò chỉ có `audit.view` | **Đã sửa** – `listUsers` nhận `user.manage`/`user.unlock`/`audit.view` + test |
| B-10 | Major | Thêm sản phẩm – Tìm sách | – | Tra cứu Open Library thường thất bại: timeout 5 s/request trong khi Open Library trả lời 3–8 s (có redirect), luồng ISBN gọi 3+ request nối tiếp. Có thông báo lỗi để nhập tay. Phụ thuộc mạng – cần thử lại trên máy chủ thật | Mở |
| B-11 | Minor | Thêm sản phẩm | D1 | Thông báo lỗi tra cứu vẫn nổi che ô "Tên sản phẩm" sau khi đã chuyển sang ô khác | Mở |
| B-12 | Minor | Chi tiết sản phẩm | – | Nhà xuất bản đã lưu nhưng không hiển thị trên trang chi tiết (FR-CAT-02) | Mở |
| B-13 | Minor | Nhập dữ liệu | D1 | Giá bán âm báo "Thiếu giá bán"; thông báo lộ mã "(FR-WEB-22)"; cột SKU xuống dòng ở dấu gạch ("SACH-/0001"); tên file mẫu `mau-nhap-products.xlsx` | Mở |
| B-14 | Minor | Tồn kho – lịch sử | – | Cột Ghi chú của điều chỉnh hiện mã thô `damaged` thay vì "Hư hỏng" | Mở |
| B-15 | Minor | Kiểm kho, Chi tiết đơn | – | Tên sản phẩm tiếng Anh ở phiếu kiểm và dòng đơn bán trực tuyến ("De Men Phieu Luu Ky"), trong khi Sản phẩm/Tồn kho/POS và đơn bán ngoại tuyến dùng tên tiếng Việt | Mở |
| B-16 | **Blocker** | POS ngoại tuyến | – | Khi API tắt/khởi động lại sau reverse proxy (Caddy/Vite trả 502 rỗng), bán hàng báo lỗi kỹ thuật "Failed to execute 'json' on 'Response'…" và **không lưu ngoại tuyến**; tải lại POS thì kẹt "Đang tải danh mục về máy…". Chỉ coi lỗi `fetch` (status 0) là mất mạng | **Đã sửa** – `parseBody` + `proxyUnreachable` (502/503 không có envelope lỗi = mất kết nối) trong `lib/api.ts`, `pos/device.ts`, `pos/actions.ts`; đã kiểm: bán ngoại tuyến Q1-000001, bật lại API → đồng bộ |
| B-17 | Minor | POS – giỏ chờ | D1 | Danh sách giỏ đang giữ chỉ hiện "Giỏ 23/11/2026 20:29" + lặp lại thời gian, không có số món/khách/tổng tiền; banner "Đã giữ giỏ hàng" vẫn còn sau khi gọi lại giỏ | Mở |
| B-18 | Minor | Chi tiết đơn bán | D1 1280 | Bảng sản phẩm (cột trái) phải cuộn ngang, cột "Thành tiền" bị khuất; thẻ Khách hàng chỉ ghi "Đơn có gắn khách hàng." không có tên/SĐT | Mở |
| B-19 | Cosmetic | POS | – | Placeholder "Nhập SKUs/tên sản phẩm"; báo cáo ca còn dòng "Thu vào/Chi ra" dù FR-POS-20 đã bỏ | Mở |
| B-20 | Cần xác nhận | Dashboard | – | "Doanh thu hôm nay" 350.150 ₫ chưa trừ khoản trả hàng 58.500 ₫ – cần đối chiếu FR-RPT-01 (doanh thu gộp hay thuần) | Hỏi |
| B-21 | Major | Kiểm kho (chi tiết) | M1/M2 | Trên điện thoại phiếu kiểm là bảng 560 px cuộn ngang; Design §10.6/§12.2/§13.8 yêu cầu **card list** cho kiểm kho trên điện thoại | Mở |
| B-22 | Minor | Nhiều màn | M1/M2 | Vùng chạm nhỏ: công tắc "Hiển thị trên website" 36×20, liên kết SĐT/tên khách 18–20 px cao (Design §15) | Mở |
| B-23 | **Major** | Giao hàng | – | Bản cài mới không có dữ liệu địa chỉ GHN (chỉ nạp bởi cron 03:00) → "Tạo đơn giao" không chọn được Tỉnh/Phường suốt ngày đầu | **Đã sửa** – worker chạy `geo.refresh` khi khởi động nếu bảng trống (`orders.geoIsEmpty`); đã kiểm: 65 tỉnh, 11.981 phường/xã, tạo đơn DH-2026-00001 + vận đơn GHN sandbox |
| B-24 | – | Worker | – | ~~Log worker không ra~~ – do `LOG_LEVEL=warn` trong `.env`/`.env.qa` của máy dev; bản production (`LOG_LEVEL=info`) có "worker started" và "job done" (smoke test 6.4) | Không phải lỗi |
| B-25 | Minor | Thư viện – Phiếu mượn | D1 | Ô tìm người mượn không chọn được bằng phím mũi tên + Enter (ô Tỉnh/Phường thì được); hộp thành công lặp tiêu đề "Đã cho mượn" | Mở |
| B-26 | Cosmetic | Nhật ký | – | Dòng tạo khách hiện "thêm khách hàng **Đã gộp vào khách hàng khác**" (trạng thái hiện tại thay vì tên lúc tạo) | Mở |
| B-27 | Minor | Phân quyền | – | Form vai trò còn liệt kê quyền đã bỏ: "Sửa giá bán" (`sale.price_override`, bỏ 13/11) và "Thu/chi tiền mặt trong ca" (`shift.cash_movement`, FR-POS-20) | Mở |
| B-28 | **Major** | POS / Nhân viên | – | Không có giao diện đặt mã PIN và không có màn khóa (NFR-SEC-07, Design §13.5) → không ai duyệt được thao tác vượt hạn mức của thu ngân; phiên bị khóa chỉ hiện lỗi | **Đã sửa** – tài liệu trước (SRS FR-ADM-01, Design §13.5, TDD §6.2), rồi: menu người dùng góc phải trên (Đặt/Đổi mã PIN, Khóa màn hình, Đăng xuất; có cả trên POS); hộp đặt PIN xác nhận mật khẩu (`PUT /me/pin` cần `currentPassword`); màn khóa trên mọi trang khi phiên bị khóa (bàn phím số + phím cứng, báo còn n lần, rung khi sai, “Đổi người dùng”); POS tự khóa sau `pos.lock_minutes` khi có PIN và có mạng; `/me` trả `hasPin`; không cho khóa khi chưa có PIN. Đã kiểm: khóa/mở khóa 1280 và 360 px, tải lại trang vẫn khóa, tự khóa sau 60 s, quản lý đặt PIN rồi duyệt giảm 15% cho thu ngân; api 210/210 |
| B-29 | Cosmetic | In nhãn kệ | A4 | Giá 9 chữ số (125.000.000 ₫): "₫" xuống dòng, mã vạch bị thu nhỏ | Mở |
| B-30 | Minor | Đơn giao – trả hàng | – | Lịch sử ghi "Hoàn 135000 ₫" (chưa định dạng); mã giao dịch hoàn tiền không hiện ở đâu; trạng thái thanh toán vẫn "Đã thanh toán" sau khi hoàn | Mở |
| B-31 | Minor | Thư viện – Nhận trả | – | Sau khi "Thu phí" xong, nút "Thu phí 10.000 ₫" vẫn hiện; bấm lại mở hộp "Khách không còn khoản nào chưa thu" nhưng nút "Thu tiền" vẫn bật (không thu trùng) | Mở |
| B-32 | Minor (a11y) | Đối soát COD, Trả hàng đơn giao | – | Ô nhập trong hộp thoại không gắn nhãn (`label` không liên kết với `input`) – trình đọc màn hình không đọc được tên ô | Mở |
| B-33 | Minor | Hóa đơn điện tử | – | Mã số thuế người mua không kiểm tra định dạng (10 hoặc 13 số); "abc" được nhận, chỉ lỗi khi gửi MISA | Mở |
| B-34 | **Blocker** | Sao lưu (production) | – | pgBackRest kết nối bằng role `postgres` không tồn tại (`POSTGRES_USER=bookstore`) → stanza-create và **mọi bản sao lưu thất bại** | **Đã sửa** – `PGBACKREST_PG1_USER: ${POSTGRES_USER}` trong `infra/docker-compose.yml` |
| B-35 | **Blocker** | Sao lưu (production) | – | `backup-loop.sh` chỉ thử stanza-create **một lần** lúc khởi động; trên volume mới lúc đó Postgres còn khởi động lại (initdb) nên thất bại im lặng → không có sao lưu và **không lưu WAL** cho tới khi tạo tay | **Đã sửa** – thử lại mỗi phút đến khi được, có log; chờ bảng `platform.backup_run` (không còn lỗi lúc migrate chưa xong). Đã kiểm: stanza tự tạo khi bucket xuất hiện |
| B-36 | **Blocker** | Runbook khôi phục | – | `docker compose run … backup` khởi động lại `postgres` (do `depends_on`) ngay lúc dời thư mục dữ liệu và khôi phục | **Đã sửa** – thêm `--no-deps` và bước kiểm tra postgres đã dừng trong `docs/runbooks/restore.md`; diễn tập PITR đạt |
| B-37 | Minor | Caddy | – | Đường dẫn sâu (vd. `/dashboard`) trả `index.html` không có `Cache-Control: no-cache` → sau khi deploy có thể tải shell cũ trỏ tới asset đã xóa | **Đã sửa** – `@shell not path /assets/*` trong `infra/caddy/Caddyfile`; đã kiểm header |
| B-38 | Minor | Compose | – | `up --build` lần đầu in `bookstore-postgres:18 … pull access denied` (service `backup` dùng image do `postgres` build); chỉ là cảnh báo, stack vẫn lên | Mở – có thể thêm `pull_policy: build` |
| B-39 | Minor | Khách hàng – lọc Hoạt động gần nhất | – | Bộ lọc so với `now()` của CSDL thay vì đồng hồ app (`ctx.clock`) → test `pos.test.ts` bắt đầu fail từ 25/11 (đồng hồ test cố định 25/10). Production không bị vì hai đồng hồ trùng | **Đã sửa** – dùng `ctx.clock.now()`; api 210/210 pass |

## Chức năng

### 5.1 Thiết lập, đăng nhập, phân quyền

| Ca | Kết quả | Ghi chú |
| --- | --- | --- |
| `/setup` trên DB trống, nút vô hiệu khi thiếu tên, quay lại giữ dữ liệu, mật khẩu ngắn/không khớp | Pass | B-08 |
| Mở lại `/setup` sau khi thiết lập → về Dashboard | Pass | |
| Sai mật khẩu → thông báo chung; 6 lần sai → khóa 15 phút | Pass | |
| Mật khẩu tạm → buộc đổi; mật khẩu mới trùng cũ bị từ chối | Pass sau sửa | B-05, B-06 |
| Thu ngân: trang đích POS; gõ URL `/users`, `/settings`, `/audit`, `/reports/sales`, `/library` → "không có quyền"; menu chỉ hiện mục được phép | Pass | |
| POS trên máy chưa đăng ký → yêu cầu quản lý đăng ký | Pass | |

### 5.2 Cài đặt và quản trị

| Ca | Kết quả | Ghi chú |
| --- | --- | --- |
| Vai trò mặc định có sẵn (8 vai trò) | Pass | |
| Thêm nhân viên, mật khẩu tạm tự sinh, chip "Chờ đổi mật khẩu" | Pass | |
| Thêm NCC: dữ liệu sai → báo lỗi; dữ liệu đúng → lưu, toast | Pass (lỗi hiển thị) | B-03, B-04, B-07 |
| Danh mục dùng chung: không có loại "danh mục sản phẩm" | Fail | B-02 |
| Quản lý mở khóa tài khoản bị khóa | Pass sau sửa | B-09 |
| Quản lý đăng ký máy POS cho Quầy 1 | Pass | |

### 5.3 Sản phẩm / 5.13 Nhập dữ liệu

| Ca | Kết quả | Ghi chú |
| --- | --- | --- |
| Tải file mẫu sản phẩm | Pass | B-13 |
| Import file lỗi: ISBN sai, danh mục không có, VAT 7, giá âm, thiếu tên/mô tả → báo theo dòng, không cho nhập | Pass | B-13 |
| Import 18 sản phẩm hợp lệ (tồn đầu kỳ 741) | Pass | |
| Import 8 khách hàng (480 điểm); không có nút hoàn tác cho khách hàng (code cố ý, Design "where allowed") | Pass | ghi chú |
| Thêm sản phẩm bằng form (ảnh, giá, lãi %, tồn đầu) | Pass | B-10, B-11, B-12 |
| Tìm kiếm không dấu / tác giả / ISBN / SKU / không có kết quả | Pass | |

### 5.4 Kho, nhập hàng

| Ca | Kết quả | Ghi chú |
| --- | --- | --- |
| Nhập hàng: quét ISBN 2 lần cộng dồn; mã lạ bị chặn với hướng dẫn; NCC tùy chọn (FR-PUR-04) | Pass | |
| Đổi giá nhập → giá vốn bình quân 63.333 ₫ (2×55.000 + 10×65.000)/12 | Pass | |
| Điều chỉnh tồn −1 "Hư hỏng" | Pass | B-14 |
| Kiểm kho theo loại VPP, đếm, chênh lệch, gửi duyệt, duyệt | Pass | B-15 |

### 5.10 Khuyến mãi / 5.5 POS / 5.6 Đơn hàng

| Ca | Kết quả | Ghi chú |
| --- | --- | --- |
| Tạo KM "Giảm 10% sách thiếu nhi" theo danh mục | Pass | |
| Mở ca 1.000.000 ₫; quét SKU; KM tự áp (81.000 − 6.500 = 74.500) | Pass | |
| Gắn khách theo SĐT/tên; tiền mặt thiếu → nút vô hiệu; 100.000 → thối 25.500 | Pass | |
| Giữ giỏ / gọi lại giỏ | Pass | B-17 |
| Đổi 100 điểm = 10.000 ₫ + giảm 15% (quản lý) + chuyển khoản → 150.650 ₫ | Pass | Cần thử hạn mức 10% với thu ngân |
| Bán khi máy chủ không phản hồi → lưu ngoại tuyến → bật lại → đồng bộ | Pass sau sửa | B-16 |
| Đóng ca: dự kiến 1.109.500, đếm theo mệnh giá 1.100.000, lệch −9.500 bắt buộc lý do; báo cáo ca đúng theo phương thức | Pass | B-19 |
| Trả 1 sách (nhập lại kho) → hoàn 58.500 ₫ (giá sau KM), phiếu TH-2026-00001 | Pass | |
| Hủy đơn ngoại tuyến; HĐĐT đã xuất được worker hủy (bất đồng bộ) | Pass | |
| Chi tiết đơn: VAT 8% VPP 1.185 ₫, +7 điểm, HĐĐT mock đã xuất | Pass | B-15, B-18 |

## Ma trận giao diện

Script trong trang quét 38 màn (danh sách + chi tiết + form) ở mỗi viewport: tràn ngang cấp trang, phần tử vượt mép màn hình không nằm trong khung cuộn, chữ bị cắt không có dấu "…", vùng chạm < 32 px (M1). Kèm ảnh chụp các màn chính.

| Viewport | Tràn trang | Chữ bị cắt | Ghi chú |
| --- | --- | --- | --- |
| M1 360×740 | 0 | 0 | Drawer menu, POS (tên dài 2 dòng, 250.045.000 ₫), bottom sheet thanh toán, Tạo đơn giao, Thiết lập – hiển thị tốt. Bảng cuộn trong khung (đúng Design). B-21, B-22 |
| M2 390×844 | 0 | 0 | |
| T1 768×1024 | 0 | 0 | Sidebar rail 72 px, Thêm sản phẩm 1 cột |
| T2 1024×768 | 0 | 0 | |
| D1 1280×800 | 0 | 0 | Bảng rộng hơn vùng nội dung ở Giao hàng, Đơn hàng, Khách hàng, Sản phẩm, Tồn kho, NCC, chi tiết đơn/khách/đầu sách → cuộn trong khung (đúng §10.6) |
| D2 1536×900 | 0 | 0 | |

## Chức năng (tiếp)

### 5.7 Đặt trước

| Ca | Kết quả | Ghi chú |
| --- | --- | --- |
| Tạo phiếu không có khách → báo lỗi; tạo khách mới ngay trong hộp chọn | Pass | |
| Phiếu giữ sách không cọc DT-2026-00001, giữ 3 ngày (đến 26/11) | Pass | BR-10 |
| POS gắn khách → hiện phiếu → Đưa vào giỏ → trả thẻ → HD-2026-00003, phiếu "collected" | Pass | |

### 5.8 Giao hàng

| Ca | Kết quả | Ghi chú |
| --- | --- | --- |
| Tạo đơn giao: Nguồn Facebook, KM tự áp −15.000, phí GHN sandbox 20.900, tổng 155.900 | Pass sau sửa | B-23 |
| Tạo vận đơn GHN sandbox (LYFG7A), lịch sử trạng thái, tự tạo hồ sơ khách | Pass | |

### 5.9 Khách hàng

| Ca | Kết quả | Ghi chú |
| --- | --- | --- |
| Lịch sử điểm: 120 nhập + 7 tích − 5 thu hồi khi trả = 122 | Pass | |
| Gộp hồ sơ trùng (cùng tên, SĐT khác) | Pass | |

### 5.11 Thư viện

| Ca | Kết quả | Ghi chú |
| --- | --- | --- |
| Thêm đầu sách (Dewey 895.922, Cutter V500), 2 bản VN-000001/2 | Pass | |
| Phiếu mượn: người mượn theo SĐT, phí 50.000, hạn 30 ngày, PT-2026-00001 | Pass | B-25 |
| Nhận trả bằng mã cá biệt → "Trả đúng hạn" | Pass | |

### 5.12 Tổng quan, báo cáo / 5.13 Nhật ký

| Ca | Kết quả | Ghi chú |
| --- | --- | --- |
| Dashboard: doanh thu/đơn hôm nay, thư viện 50.000, tồn kho theo loại, bán chạy, sắp hết | Pass | B-15, B-20 |
| Xuất Excel 10 báo cáo (doanh thu ×4, kho ×2, nhập hàng, thuế ×3) + báo cáo thư viện | Pass | Kiểm bằng fetch, không tải file về máy |
| Nhật ký ghi đủ thao tác ở trên bằng câu đọc được | Pass | B-26 |

### Đợt 25/11 – phần còn lại

| Ca | Kết quả | Ghi chú |
| --- | --- | --- |
| Cài đặt → Cấu hình: sửa "Thời hạn đổi trả", nút "Lưu cài đặt" hiện khi có thay đổi, toast | Pass | |
| Cài đặt → Sao lưu & dữ liệu: tình trạng hệ thống, yêu cầu sao lưu thủ công | Pass | Chạy thật ở bộ production |
| Tạo vai trò "Thu ngân ca tối" (3 quyền) | Pass | B-27 |
| Vô hiệu nhân viên → đăng nhập bị từ chối "Tài khoản đã bị vô hiệu hóa" | Pass | |
| Khóa màn hình PIN | Pass sau sửa | B-28 |
| Hạn mức giảm giá thu ngân: 10% không cần duyệt, 15% cần duyệt; PIN sai bị từ chối, PIN đúng → mã duyệt 2 phút | Pass (API) | Giao diện không duyệt được – B-28 |
| HĐĐT: gửi lại cho khách với tên đơn vị, MST, địa chỉ, email | Pass | B-33 |
| In phiếu 80 mm (khổ 72 mm, khách hàng + điểm, chân phiếu) | Pass | |
| In nhãn kệ / mã vạch A4 (bắt đầu ô 5), nhãn giá / mã vạch cuộn | Pass | B-29 |
| In tem gáy thư viện 30 × 45 mm (mã cá biệt, Dewey, Cutter) | Pass | |
| Ký gửi: sản phẩm ký gửi (CK 30%, hạn), bán 3, trả bên ký gửi 2, lập bảng đối soát 11/2026 = 210.000 ₫, in A4 ngang, duyệt quyết toán | Pass | |
| Webhook GHN (token đúng/sai) → đơn "Đã giao" → bảng kê COD; đối soát 150.000/155.900 → "Chênh lệch"; badge menu | Pass | B-32 |
| Trả hàng sau giao: yêu cầu → duyệt → nhận hàng trả (không nhập kho), hoàn 135.000 ₫ | Pass | B-30, B-32 |
| Thư viện: mượn hết bản → đặt giữ; quá hạn 5 ngày → phí trễ 10.000 ₫, "Giữ cho … gọi …", thu phí; badge quá hạn | Pass | B-31 |
| Kiểm kê thư viện: tạo theo kệ, quét, mã lạ báo lỗi, gửi duyệt, duyệt, báo cáo chênh lệch | Pass | |

### Smoke test bộ production (`infra/docker-compose.yml` + Caddy, máy cục bộ, `SITE_DOMAIN=localhost`, kho S3 tạm SeaweedFS)

| # (runbook UAT §6) | Kết quả | Ghi chú |
| --- | --- | --- |
| 6.1 Container | Pass | migrate Exited (0); api, postgres healthy; caddy, worker, backup Up. B-38 |
| 6.2 HTTPS + `/healthz` | Pass | HTTP → HTTPS 308; HSTS, nosniff, Referrer-Policy; asset immutable + zstd. B-37 đã sửa |
| 6.3 Log API | Pass | "api listening" |
| 6.4 Log worker | Pass | "worker started", "job done" – B-24 không phải lỗi |
| 6.5 Dữ liệu địa chỉ GHN | Pass | Worker tự nạp (carrier giả lập khi không có token) |
| 6.6 Sao lưu | **Fail → đã sửa** | B-34, B-35; sau sửa: sao lưu thủ công từ app thành công (full 4,2 MB), WAL lưu liên tục |
| 6.7 Giao diện / thiết lập | Pass | `/setup` qua HTTPS; cookie `__Host-bms_sid` Secure, HttpOnly, SameSite=Strict |
| Diễn tập khôi phục (runbook `restore.md`) | **Fail → đã sửa** | B-36; sau sửa: PITR về thời điểm T giữ "Marker A", bỏ "Marker B"; sao lưu sau khôi phục thành công |

## Chưa test được ở máy test (làm ở UAT)

- POS mất mạng thật (tắt Wi-Fi) – mới thử máy chủ không phản hồi (502); camera quét mã trên iPhone/Android (cần HTTPS và thiết bị thật); máy in 80 mm và máy quét cầm tay thật.
- Thu hồi máy POS khi vô hiệu nhân viên; từ chối trả hàng; GHN live và webhook qua URL công khai.
- Tra cứu Open Library từ máy chủ thật (B-10).
- Sao lưu lên S3 thật (đã thử với kho S3 tạm); bản dump hằng tuần (chạy 03:00 Chủ nhật).
- Hóa đơn điện tử thật (chỉ có adapter giả lập).
