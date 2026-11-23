# Test plan trước deployment – Staff web app (R1 · R2a · R4)

Ngày lập: 23/11/2026 · Nhánh: `stock-in-scan` · Trạng thái: **đề xuất, chờ xác nhận**

## 1. Phạm vi

| Trong phạm vi | Ngoài phạm vi |
| --- | --- |
| API (`apps/api`), worker (`apps/worker`), staff web app (`apps/staff`) đã build ở R1, R2a, R4 | Website công khai (R2b), Sự kiện (R3), R5, R6 – mục menu chưa có chỉ là "Màn hình đang được xây dựng" |
| Tất cả màn hình trong menu + trang chi tiết + POS + in ấn | Tải nặng/hiệu năng quy mô lớn, pentest |
| Giao diện desktop, tablet, mobile (chỉ giao diện sáng – Design §4: v1 chưa có dark mode) | Thiết bị thật (iPhone/Android) – chỉ giả lập viewport; ghi chú các mục cần thử trên máy thật |

## 2. Môi trường và cách chạy

- Postgres 18 qua `infra/docker-compose.dev.yml`, **CSDL test riêng (làm mới từ đầu)** để kiểm tra cả luồng `/setup` lần đầu và migrations trên DB trống.
- `api` (:3000), `staff` (:5173) qua `.claude/launch.json`; worker chạy song song để có job nền (sao lưu, poll GHN, hóa đơn điện tử, thông báo).
- Trình duyệt: built-in browser của Claude; dùng `resize_window` cho các viewport bên dưới.
- GHN: sandbox (`GHN_TOKEN`, `GHN_SHOP_ID` trong `.env`), không có webhook → dùng poll.
- Hóa đơn điện tử, Open Library: dùng chế độ sandbox/giả lập nếu có; nếu không, chỉ test đường lỗi/hàng đợi.

### Viewport

| Mã | Kích thước | Đại diện (Design §6.2) |
| --- | --- | --- |
| M1 | 360 × 740 | Điện thoại tối thiểu (NFR-USE-02) – sidebar dạng drawer |
| M2 | 390 × 844 | iPhone phổ biến |
| T1 | 768 × 1024 | Tablet dọc – sidebar rail 72 px |
| T2 | 1024 × 768 | Tablet ngang / laptop nhỏ – POS cảm ứng |
| D1 | 1280 × 800 | Máy POS / PC văn phòng |
| D2 | 1536 × 900 | Màn lớn – nội dung tối đa 1440 px, căn giữa |

### Dữ liệu test (tạo ở bước đầu, dùng xuyên suốt)

- 1 chủ cửa hàng (từ `/setup`) + 4 tài khoản theo vai trò: thu ngân, thủ kho, thủ thư, kế toán/quản lý (vai trò tạo trong "Vai trò").
- ~30 sản phẩm: sách (có ISBN), văn phòng phẩm, combo, hàng ký gửi; **có tên rất dài, giá lớn (≥ 100.000.000 ₫), số lượng lớn**, sản phẩm ẩn/ngừng bán.
- 3 nhà cung cấp (1 ký gửi), 10 khách hàng (có cặp trùng để gộp), 5 khuyến mãi các loại.
- Thư viện: 10 đầu sách, 20 bản, 3 bạn đọc.
- Một phần dữ liệu nhập qua màn "Nhập dữ liệu" (Excel) để test luôn luồng import.

## 3. Cách kiểm tra

**Chức năng:** đi từng luồng theo mục 5, kiểm tra kết quả trên UI, dữ liệu liên quan (tồn kho, điểm, báo cáo, nhật ký) và console/network không có lỗi 4xx/5xx ngoài ý muốn.

**Giao diện (mỗi màn × 6 viewport):** chạy một đoạn script kiểm tra tự động rồi chụp màn hình để xem bằng mắt:

- Tràn ngang: `document.documentElement.scrollWidth > innerWidth`; phần tử vượt mép viewport.
- Chữ bị cắt/chồng: `scrollWidth > clientWidth` trên ô không có `truncate`/tooltip; phần tử đè nhau.
- Bảng → dạng thẻ trên điện thoại (Design §12.2); bảng rộng phải cuộn trong khung, không cuộn cả trang.
- Dialog/drawer/sheet: vừa màn hình, nút hành động không bị khuất, cuộn được nội dung dài, bàn phím ảo không che ô nhập (ghi chú để thử máy thật).
- Shell: drawer (M), rail (T1), sidebar mở/thu (≥ lg); badge số; thông báo; menu người dùng.
- Vùng chạm ≥ 44 px trên M/T, focus ring khi dùng bàn phím, nút disabled/loading đúng Design §10.1.
- Trạng thái rỗng / đang tải / lỗi (Design §10.12); định dạng số, tiền, ngày theo §14.3.

**Mức độ lỗi:** Blocker (chặn deploy) · Major (sai nghiệp vụ / mất dữ liệu / không dùng được trên 1 viewport) · Minor · Cosmetic.

## 4. Giai đoạn 0 – Kiểm tra tự động

| # | Việc | Kỳ vọng |
| --- | --- | --- |
| 0.1 | `pnpm typecheck`, `pnpm lint` | Không lỗi |
| 0.2 | `pnpm test` (vitest + Testcontainers) | Tất cả pass |
| 0.3 | `pnpm build`; build Docker image (`Dockerfile`) | Build thành công |
| 0.4 | Migrations trên DB trống; `integrity.test` | Thành công |

## 5. Kiểm thử chức năng theo luồng

### 5.1 Thiết lập, đăng nhập, phân quyền
- `/setup` lần đầu (thông tin cửa hàng, tài khoản chủ); không vào lại được sau khi đã thiết lập.
- Đăng nhập đúng/sai; khóa tài khoản sau nhiều lần sai và mở khóa; đổi mật khẩu (mật khẩu tạm bắt buộc đổi).
- Hết phiên, đăng xuất; màn khóa + PIN.
- Mỗi vai trò: menu chỉ hiện mục có quyền; gõ URL trực tiếp vào màn không có quyền → "không có quyền"; trang đích đúng (dashboard vs POS).

### 5.2 Cài đặt và quản trị
- Cài đặt: tab Cấu hình, Danh mục dùng chung (thêm/sửa/sắp xếp), Kênh bán, Quầy & máy bán hàng (đăng ký, thu hồi, xử lý máy), Sao lưu & dữ liệu (tình trạng hệ thống, hàng đợi job, lần sao lưu gần đây, xuất dữ liệu).
- Nhân viên: tạo, sửa, vô hiệu, mật khẩu tạm. Vai trò: tạo/sửa quyền, kiểm tra quyền có hiệu lực ngay.

### 5.3 Sản phẩm
- Danh sách: tìm kiếm, lọc theo loại/trạng thái, phân trang, mở chi tiết.
- Thêm sản phẩm mới (2 cột): sách có ISBN (tra cứu Open Library), VPP, combo, hàng ký gửi (chiết khấu, hạn đối soát), số lượng nhập lần đầu, chọn kệ từ danh sách cố định; validate trường bắt buộc.
- Chi tiết: sửa thông tin, thêm mã vạch, ảnh (tải lên/xóa), trạng thái ẩn/ngừng bán.
- In mã vạch / nhãn kệ: mẫu nhãn, khổ giấy, bắt đầu từ ô số – xem bản in.
- Nhập sản phẩm từ Excel.

### 5.4 Kho, nhập hàng, nhà cung cấp, ký gửi
- Nhà cung cấp: thêm/sửa.
- Nhập thêm hàng: chọn NCC, quét mã (ô nhập + camera), thêm/bớt 1, giá nhập/giá bán, sản phẩm chưa có → tạo mới; tồn tăng đúng.
- Tồn kho: danh sách, lọc (sắp hết/hết hàng), chi tiết lịch sử giao dịch, điều chỉnh tồn có lý do; nhập phiếu nhập từ Excel.
- Kiểm kho: tạo phiếu, quét đếm (camera chế độ liên tục), gửi duyệt, duyệt → tồn được điều chỉnh, chênh lệch đúng.
- Ký gửi: lập bảng đối soát theo kỳ, số lượng trả, duyệt, in bảng đối soát A4.

### 5.5 Bán hàng tại quầy (POS)
- Đăng ký quầy, mở ca (tiền đầu ca).
- Tìm theo SKU/tên, quét mã, camera; tăng/giảm số lượng, xóa dòng; giỏ chờ (giữ/khôi phục nhiều giỏ).
- Khách hàng: tìm theo SĐT, tạo nhanh; đổi điểm / bỏ dùng điểm.
- Khuyến mãi tự áp dụng; giảm giá tay; thao tác cần quản lý duyệt.
- Thanh toán: tiền mặt (tiền thừa), chuyển khoản, thẻ, kết hợp; in hóa đơn 80 mm; yêu cầu hóa đơn điện tử.
- Thu phí thư viện tại POS (R4).
- Ngoại tuyến: ngắt mạng → bán tiếp → chỉ báo kết nối → có mạng lại đồng bộ, không trùng đơn.
- Đóng ca: đếm mệnh giá, lý do chênh lệch; xem lại ở "Ca làm".
- Hủy đơn đang tạo.

### 5.6 Đơn hàng (Đơn bán)
- Danh sách: lọc tại quầy/hoàn tất/đã hủy, đơn chưa xem, badge.
- Chi tiết: hủy đơn (lý do), đổi/trả, hoàn tiền (phương thức), xuất hóa đơn điện tử (MST, tên đơn vị, email), thử lại khi lỗi.

### 5.7 Đặt trước
- Tạo phiếu (từ trang Đặt trước và từ POS): loại phiếu, cách nhận hàng, thu cọc.
- Chuyển trạng thái Chờ xác nhận → Đang đặt hàng → Chờ nhận → Đã nhận (thanh toán phần còn lại ở POS); đổi khách/sản phẩm; hủy + hoàn cọc (mã giao dịch).

### 5.8 Giao hàng (R2a)
- Tạo đơn giao: Hình thức, Nguồn đơn, trang/tài khoản, khách theo SĐT, địa chỉ Tỉnh/Phường, phí giao, giảm giá, tổng cộng.
- Xác nhận chuyển khoản; tạo vận đơn GHN sandbox; theo dõi trạng thái (poll); lịch sử.
- Hàng trả: nhận hàng trả (phí gửi trả), từ chối trả; hoàn tiền.
- Đối soát COD: chờ đối soát / đã khớp / chênh lệch, mã bảng kê.
- Chia sẻ sản phẩm (link trang).

### 5.9 Khách hàng
- Danh sách và lọc (chỉ mua hàng / chỉ thư viện / chưa hoạt động).
- Chi tiết, sửa; điều chỉnh điểm (+/−, lý do); gộp hồ sơ trùng; xóa theo yêu cầu (gõ XOA).

### 5.10 Khuyến mãi
- Tạo từng loại: phần trăm, mua X tặng Y, giá combo, quà tặng; đơn tối thiểu, phạm vi, giới hạn mỗi khách/tổng lượt, thời gian bắt đầu/kết thúc.
- Kiểm tra áp dụng đúng ở POS và đơn giao; hết lượt/hết hạn thì không áp.

### 5.11 Thư viện (R4)
- Danh mục: đầu sách (Dewey, Cutter, ngôn ngữ, thể loại), thêm bản (mã cá biệt, giá trị), sửa, in tem gáy.
- Mượn/trả: mượn, trả (tình trạng), đặt giữ/hủy giữ, quá hạn, phí → thanh toán ở POS, phiếu mượn.
- Kiểm kê thư viện: tạo, quét, gửi duyệt, duyệt, báo cáo chênh lệch.

### 5.12 Tổng quan, báo cáo, ca làm
- Dashboard: các ô số liệu khớp dữ liệu đã tạo (doanh thu, bán chạy, sắp hết, tổng quan tồn kho, thư viện).
- Báo cáo doanh thu, kho & nhập hàng, thuế & kiểm toán, thư viện: lọc theo kỳ, đối chiếu số, xuất danh sách (Excel).
- Ca làm: danh sách, chi tiết (doanh thu theo phương thức, mệnh giá đã đếm).

### 5.13 Nhập dữ liệu và Nhật ký
- Nhập dữ liệu: từng loại dữ liệu, file lỗi → báo dòng lỗi, file hợp lệ → nhập xong, hoàn tác lượt nhập.
- Nhật ký thao tác: các thao tác ở trên đều được ghi, lọc theo người/hệ thống, xem chi tiết.

### 5.14 Hệ thống và triển khai
- Worker: job nền chạy (sao lưu, poll GHN, hóa đơn điện tử, email/thông báo); trung tâm thông báo, badge.
- Sao lưu hằng ngày + WAL; thử quy trình khôi phục theo `docs/runbooks/restore.md` trên bản sao.
- Cấu hình production: `infra/docker-compose.yml`, Caddy, `env.production.example` đủ biến; chạy bản build production (không phải dev server) và smoke test lại 5.1, 5.5, 5.8.

## 6. Ma trận giao diện

Mỗi ô = chạy script kiểm tra + chụp màn hình + mở các dialog chính của màn đó.

| Nhóm | Màn hình | M1 | M2 | T1 | T2 | D1 | D2 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Xác thực | Thiết lập, Đăng nhập, Đổi mật khẩu, Không có quyền | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Shell | Drawer / rail / sidebar, thông báo, badge | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Tổng quan | Dashboard | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Bán hàng | POS (giỏ, thanh toán, khách, giỏ chờ, mở/đóng ca, camera) | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| | Đặt trước: danh sách, tạo, chi tiết | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| | Giao hàng: danh sách, tạo đơn giao, chi tiết | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| | Đối soát COD | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| | Đơn bán: danh sách, chi tiết, đổi/trả, HĐĐT | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| | Khách hàng: danh sách, chi tiết, gộp | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| | Khuyến mãi: danh sách, form | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Danh mục | Sản phẩm: danh sách, thêm mới, chi tiết, in nhãn | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| | Tồn kho: danh sách, chi tiết, nhập hàng | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| | Kiểm kho: danh sách, chi tiết/quét | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| | Nhà cung cấp, Ký gửi | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Thư viện | Danh mục, đầu sách, quầy mượn/trả, phiếu, kiểm kê | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Nhân sự | Nhân viên, Vai trò | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Báo cáo | Ca làm (+ chi tiết), 4 báo cáo | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Cài đặt | 5 tab Cài đặt, Nhập dữ liệu, Nhật ký | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| In ấn | Hóa đơn 80 mm, A4 (HĐĐT, đối soát), nhãn kệ, tem gáy, phiếu mượn | – | – | – | – | ☐ | – |

## 7. Ghi nhận kết quả và sửa lỗi

- Kết quả ghi vào `docs/test-results-deployment.md`: mã ca, viewport, Pass/Fail, mức độ, ảnh chụp, bước tái hiện.
- Lỗi giao diện (tràn, lệch, cắt chữ) và lỗi rõ ràng sai so với SRS/TDD/Design: sửa sau mỗi giai đoạn, kiểm tra lại.
- Hành vi mà tài liệu không mô tả hoặc mâu thuẫn tài liệu: không sửa code, ghi lại và đề xuất sửa tài liệu trước.
- Điều kiện deploy: 0 Blocker, 0 Major còn mở; Minor/Cosmetic có danh sách chấp nhận.

## 8. Thứ tự thực hiện đề xuất

0 Tự động → 5.1 → 5.2 → 5.3 → 5.4 → 5.9 → 5.10 → 5.5 → 5.6 → 5.7 → 5.8 → 5.11 → 5.13 → 5.12 → 5.14 → ma trận giao diện (mục 6, có thể làm xen kẽ khi đi qua từng màn) → retest lỗi đã sửa.
