# Dựng môi trường UAT (staging)

Môi trường kiểm thử chấp nhận (UAT) trước khi deploy production. Theo TDD §12.1, staging là **một
Compose project thứ hai trên chính VPS production**, với domain riêng và database riêng; dùng cho
UAT, diễn tập phát hành và chạy thử migration. Các lệnh dưới đây chạy trên VPS (Ubuntu LTS), trừ
khi ghi khác.

> Quy ước trong tài liệu: domain chính `example.vn`, UAT ở `uat.example.vn`, thư mục mã nguồn
> `/opt/bookstore-uat`, file cấu hình `/etc/bookstore/uat.env`, Compose project `bookstore-uat`.
> Thay bằng giá trị thật của cửa hàng.

## 0. Trước khi bắt đầu

| Việc | Ai | Ghi chú |
| --- | --- | --- |
| Gộp nhánh đang làm vào `main`, đặt tag bản ứng viên, ví dụ `v1.0.0-rc1`, và push | Dev | UAT luôn chạy đúng một tag, không chạy nhánh đang sửa |
| Thuê VPS ở Việt Nam: ≥ 4 vCPU, 8 GB RAM, SSD, Ubuntu LTS | Chủ cửa hàng | Dùng luôn VPS sẽ chạy production (TDD §12.6) |
| Domain và quyền sửa DNS | Chủ cửa hàng | Cần một subdomain cho UAT |
| Bucket S3 tại Việt Nam **riêng cho UAT** + access key | Chủ cửa hàng | Để chạy sao lưu và diễn tập khôi phục, không lẫn với production |
| Tài khoản GHN **sandbox**: token và shop ID | Chủ cửa hàng | UAT không dùng GHN thật |
| Một email liên hệ cho Open Library | Chủ cửa hàng | Gửi trong User-Agent để được hạn mức cao hơn |
| Trình quản lý mật khẩu (password manager) | Chủ cửa hàng | Lưu toàn bộ secret ở bước 4 |

Những điểm UAT **chưa** kiểm được, cần biết trước:

- **Hóa đơn điện tử là bản giả lập.** Worker chỉ có `EINVOICE_ADAPTER=mock`; chưa có kết nối MISA
  meInvoice. Đơn bán sẽ hiện "Đã xuất" nhưng không có hóa đơn thật.
- **Cổng 80/443 chỉ có một Caddy dùng được.** Trước go-live, UAT chạy một mình trên VPS nên không
  vướng. Sau go-live muốn chạy staging song song thì phải cho hai project dùng chung một Caddy
  (chưa có cấu hình sẵn).

## 1. Dựng VPS

1. Khi tạo VPS, dán nội dung `infra/cloud-init.yaml` vào ô *user data / cloud-init*. Script cài
   Docker, bật tường lửa (chỉ mở SSH, 80, 443), fail2ban, cập nhật tự động và đặt múi giờ
   Asia/Ho_Chi_Minh.
2. Đăng nhập bằng SSH key (tắt đăng nhập bằng mật khẩu), rồi kiểm tra:

   ```bash
   docker version && docker compose version
   sudo ufw status            # 22, 80, 443 ALLOW
   timedatectl | grep "Time zone"
   ```

3. Tạo thư mục cho UAT:

   ```bash
   sudo mkdir -p /opt/bookstore-uat /srv/bookstore-uat-dumps
   sudo chown "$USER" /opt/bookstore-uat
   ```

## 2. Trỏ DNS

Tạo bản ghi `A` cho `uat.example.vn` trỏ về IP của VPS, rồi chờ có hiệu lực:

```bash
dig +short uat.example.vn     # phải ra đúng IP VPS
```

Phải có domain và HTTPS: cookie đăng nhập dùng tiền tố `__Host-` (bắt buộc HTTPS), và camera quét
mã trên iPhone cũng cần HTTPS. Không truy cập UAT bằng địa chỉ IP.

## 3. Lấy mã nguồn đúng tag

```bash
git clone https://github.com/<owner>/<repo>.git /opt/bookstore-uat
cd /opt/bookstore-uat
git checkout v1.0.0-rc1
```

## 4. Tạo file cấu hình `/etc/bookstore/uat.env`

Sinh các secret:

```bash
openssl rand -base64 32    # FIELD_ENCRYPTION_KEY
openssl rand -base64 24    # POSTGRES_PASSWORD
openssl rand -base64 32    # BACKUP_CIPHER_PASS
openssl rand -hex 24       # GHN_WEBHOOK_SECRET
```

Tạo file (xuất phát từ `infra/env.production.example`):

```bash
sudo install -m 600 /dev/null /etc/bookstore/uat.env
sudo nano /etc/bookstore/uat.env
```

```ini
# Bắt buộc: các container đọc đúng file này, không phải file production mặc định.
ENV_FILE=/etc/bookstore/uat.env
APP_VERSION=v1.0.0-rc1
SITE_DOMAIN=uat.example.vn
POSTGRES_USER=bookstore
POSTGRES_PASSWORD=<secret>
POSTGRES_DB=bookstore_uat
FIELD_ENCRYPTION_KEY=<secret>
LOG_LEVEL=info
OPEN_LIBRARY_CONTACT=<email liên hệ>
# Bucket riêng của UAT
S3_ENDPOINT=<endpoint>
S3_REGION=<region>
S3_BACKUP_BUCKET=<bucket-uat>
S3_ACCESS_KEY=<key>
S3_SECRET_KEY=<secret>
BACKUP_CIPHER_PASS=<secret>
DUMP_HOST_DIR=/srv/bookstore-uat-dumps
# GHN sandbox
GHN_TOKEN=<token sandbox>
GHN_SHOP_ID=<shop id sandbox>
GHN_ENV=sandbox
GHN_WEBHOOK_SECRET=<secret>
```

Lưu bản sao file này và `BACKUP_CIPHER_PASS` vào password manager. **Không commit file này.**

## 5. Build và khởi động

Mọi lệnh Compose của UAT đều dùng cùng một tiền tố. Đặt alias cho gọn:

```bash
cd /opt/bookstore-uat
alias uat='sudo docker compose -p bookstore-uat -f infra/docker-compose.yml --env-file /etc/bookstore/uat.env'
uat up -d --build
```

- `-p bookstore-uat` tách volume, network và container khỏi project production `bookstore`.
- Lần đầu build mất vài phút (cài package và build staff app trong image).
- Job `migrate` chạy trước; `api` và `worker` chỉ khởi động khi migrate xong.

## 6. Kiểm tra kỹ thuật (smoke test)

| # | Kiểm tra | Lệnh / nơi xem | Đạt khi |
| --- | --- | --- | --- |
| 6.1 | Container | `uat ps -a` | `migrate` *Exited (0)*; `api` *healthy*; `postgres` *healthy*; `caddy`, `worker`, `backup` *Up* |
| 6.2 | HTTPS và API | `curl -s https://uat.example.vn/healthz` | `{"ok":true}`, chứng chỉ hợp lệ (Caddy tự lấy) |
| 6.3 | Log API | `uat logs --tail=50 api` | Có `api listening`, không có lỗi `Invalid environment` |
| 6.4 | Log worker | `uat logs --tail=50 worker` | Có `worker started` và các dòng `job done` (kiểm tra lỗi B-24: log worker phải hiện ra) |
| 6.5 | Dữ liệu địa chỉ GHN | `uat exec postgres psql -U bookstore -d bookstore_uat -tc "select count(*) from orders.geo_province"` | > 0 sau vài phút (worker tự nạp khi bảng trống) |
| 6.6 | Sao lưu | `uat run --rm --user postgres --entrypoint pgbackrest backup --stanza=bookstore info` | Stanza có, không lỗi kết nối S3 |
| 6.7 | Giao diện | Mở `https://uat.example.vn` | Hiện màn **Thiết lập cửa hàng** |

## 7. Khởi tạo cửa hàng UAT

1. **Thiết lập lần đầu** tại `/setup`: thông tin cửa hàng và tài khoản chủ cửa hàng.
2. **Cài đặt → Cấu hình:** thông tin cửa hàng, VAT, chế độ hóa đơn điện tử, quy tắc đặt trước,
   thư viện, tích điểm… theo số liệu thật của cửa hàng.
3. **Cài đặt → Danh mục dùng chung:** tạo **Danh mục sản phẩm** (bắt buộc trước khi thêm/nhập sản
   phẩm), **Kệ hàng**, Nguồn đơn hàng, Đơn vị tính.
4. **Cài đặt → Sao lưu & dữ liệu:** bấm sao lưu thủ công và chờ thành công.
5. **Nhân viên:** tạo một tài khoản cho mỗi người tham gia UAT, đúng vai trò thật (thu ngân, thủ kho,
   thủ thư, nhân viên bán online, quản lý). Mật khẩu tạm được sinh tự động; người dùng đổi ở lần
   đăng nhập đầu.
6. **Dữ liệu ban đầu** qua **Nhập dữ liệu**: nhà cung cấp (tạo tay trước), sản phẩm kèm tồn đầu kỳ,
   khách hàng kèm điểm, sách thư viện. Nên dùng bản xuất từ hệ thống cũ để UAT sát thực tế.
   Với dữ liệu khách hàng, chỉ dùng khi đã có sự đồng ý, hoặc thay bằng dữ liệu giả.
7. **Máy bán hàng:** trên từng máy POS / điện thoại sẽ dùng thật, quản lý đăng nhập, mở **Bán hàng**
   và đăng ký quầy. Kiểm tra máy in hóa đơn 80 mm, máy quét cầm tay, camera.
8. **Webhook GHN sandbox:** trong trang quản trị GHN sandbox, đăng ký URL
   `https://uat.example.vn/webhooks/ghn?token=<GHN_WEBHOOK_SECRET>`. Không có webhook thì trạng
   thái vận đơn vẫn được cập nhật mỗi 3 phút.

## 8. Diễn tập khôi phục (bắt buộc trước go-live)

Làm trên UAT theo `docs/runbooks/restore.md`, với `uat` thay cho
`docker compose -f infra/docker-compose.yml`: bán vài đơn, ghi lại thời điểm, khôi phục về một thời
điểm trước đó, kiểm tra đơn cuối cùng khớp. Ghi thời gian thực hiện vào biên bản (mục tiêu RTO
4 giờ, RPO 15 phút).

## 9. Chạy UAT

- Kịch bản theo vai trò lấy từ `docs/test-plan-deployment.md` (mục 5), ưu tiên các phần còn ghi
  "chưa test" trong `docs/test-results-deployment.md`: in ấn, ký gửi, đối soát COD, hạn mức giảm giá
  của thu ngân, khóa màn hình PIN, kiểm kê thư viện, POS mất mạng thật (tắt Wi-Fi).
- Mỗi người dùng thiết bị thật của mình (máy POS, điện thoại iPhone/Android, máy tính văn phòng).
- Ghi lỗi vào một bảng chung: mô tả, bước tái hiện, ảnh chụp, người phát hiện, mức độ.

## 10. Cập nhật bản sửa trong lúc UAT

```bash
cd /opt/bookstore-uat
git fetch --tags && git checkout v1.0.0-rc2
sudo sed -i 's/^APP_VERSION=.*/APP_VERSION=v1.0.0-rc2/' /etc/bookstore/uat.env
uat up -d --build          # migrate chạy trước, dữ liệu UAT giữ nguyên
```

Quay lại bản trước: checkout tag cũ, sửa `APP_VERSION`, chạy lại lệnh trên. Migration được thiết kế
expand/contract nên code cũ vẫn chạy được với schema mới (TDD §12.4).

## 11. Kết thúc UAT và chuyển sang production

Tiêu chí kết thúc (đề xuất): không còn lỗi Blocker/Major mở; diễn tập khôi phục đạt; các vai trò ký
xác nhận kịch bản của mình; đã quyết định về hóa đơn điện tử.

Sau đó:

1. Dừng UAT, **giữ** dữ liệu để đối chiếu: `uat down` (không có `-v`).
2. Production dựng theo đúng các bước trên nhưng với: thư mục `/opt/bookstore`, file
   `/etc/bookstore/.env` (bỏ dòng `ENV_FILE` hoặc trỏ đúng file này), project mặc định
   (`docker compose -f infra/docker-compose.yml up -d --build`, không có `-p`), domain chính,
   bucket production, **GHN live** (`GHN_ENV=live`) và database `bookstore`.
3. **Không chép database UAT sang production.** Production bắt đầu sạch bằng `/setup` và nhập dữ
   liệu ban đầu, để không lẫn đơn hàng, phiếu nhập và điểm thử nghiệm.
4. Xóa hẳn UAT khi không cần nữa (mất toàn bộ dữ liệu UAT, không hoàn tác được):
   `uat down -v` và xóa bucket UAT.
