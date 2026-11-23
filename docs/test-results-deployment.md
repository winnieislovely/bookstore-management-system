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

- **Đã sửa trong phiên (6):** B-02, B-05, B-06, B-09, B-16, B-23 – đều kiểm lại trên trình duyệt hoặc test tự động. Chưa commit. Bản `.docx` của SRS/TDD chưa cập nhật theo bản `.md`.
- **Còn mở chặn deploy:** không còn Blocker.
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
| B-24 | Minor | Worker | – | Log pino của worker không ra stdout khi chuyển hướng output (file log 0 byte dù job chạy) – cần kiểm lại trong Docker để có log vận hành | Mở – cần kiểm |
| B-25 | Minor | Thư viện – Phiếu mượn | D1 | Ô tìm người mượn không chọn được bằng phím mũi tên + Enter (ô Tỉnh/Phường thì được); hộp thành công lặp tiêu đề "Đã cho mượn" | Mở |
| B-26 | Cosmetic | Nhật ký | – | Dòng tạo khách hiện "thêm khách hàng **Đã gộp vào khách hàng khác**" (trạng thái hiện tại thay vì tên lúc tạo) | Mở |

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

## Chưa test trong phiên này

- Ký gửi: lập/duyệt/in bảng đối soát; Đối soát COD (cần bảng kê GHN); nhận hàng trả/từ chối trả của đơn giao.
- Kiểm kê thư viện; đặt giữ sách thư viện; quá hạn và phí trễ; in tem gáy.
- Cài đặt tab Cấu hình và Sao lưu (vai trò chủ cửa hàng); thêm/sửa vai trò; vô hiệu nhân viên + thu hồi máy.
- Hạn mức giảm giá 10% với thu ngân (đã thử 15% bằng quản lý); hóa đơn điện tử có MST/email; khóa màn hình PIN.
- In ấn: hóa đơn 80 mm, nhãn kệ/mã vạch, A4.
- POS mất mạng thật (trình duyệt offline) – mới thử máy chủ không phản hồi (502).
- Sao lưu/khôi phục theo `docs/runbooks/restore.md`; chạy `infra/docker-compose.yml` + Caddy production; HTTPS cho camera trên iPhone; thiết bị thật.
