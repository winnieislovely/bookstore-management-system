# Design Guide – Bookstore Management System (Staff Web App)

**The Bookshelf Hanoi · Back office, POS and staff tools**

|  |  |
| --- | --- |
| **Document version** | 1.1 – Draft for review |
| **Date** | 24 October 2026 |
| **Changes in 1.1** | Lists: on phones status chips fold into the filter button beside search; product list shows SKU only (no ISBN, no channel column); order source shown as text without colour dot; gold tier badge is yellow. Codes set in Be Vietnam Pro (IBM Plex Mono dropped); all buttons are pills, text links for actions became tonal pill buttons; website descriptions required in English; waiting states show no time; order inbox is a table; dashboard alert tiles removed; POS: no lock or offline-test buttons, search reads “Nhập SKUs/tên sản phẩm” with the scan button at the end, confirm button reads “Xác nhận”, no keyboard shortcuts. **25 Oct 2026:** bank transfer at the POS shows the amount and payment reference only; the customer uses the store’s printed QR code, and no QR is generated (13.4); store credit tile on the payment screen (13.4); “Thiếu ảnh” chip and filter for imported products without a photo (12.1, 12.4). **27 Oct 2026:** no global search in the top bar; sign out moved to the bottom of the sidebar (“Đăng xuất”); page titles and the dashboard greeting use Be Vietnam Pro; dashboard KPI tiles are today’s revenue, order count and average order value; revenue trend (bars + order-count line) and sales-by-channel cards have a range filter button (`ListFilter` icon) that opens a range popover; dashboard lists have column headers; “Xem chi tiết” pill under Sắp hết hàng (5.2, 6.3, 12.5). POS cart line: compact stepper (28 px circles) under the unit price; neither the POS header nor the shell top bar shows a “Trực tuyến” pill while online (6.3, 13.1, 13.2); payment method tiles always on one row, 72 px (13.4). Lists: no filter chips above tables on any screen size – all filters sit in the Bộ lọc button beside the search box, which opens a filter popover; pinned first table column is opaque so scrolled cells no longer overlap it; codes, dates and amounts do not wrap (10.6, 10.9, 12.1). Product list: “Thêm sản phẩm” is a separate grouped form page with required cost and a per-unit profit line (12.1, 12.4); Excel import wizard opens in a dialog on the Products page (12.10); create-product dialog on the page, fixed search icon, Bộ lọc (Tồn kho, Loại, Phân loại, Trạng thái, Ảnh), columns SKU, Ảnh, Tên, Tồn, Giá bán, Giá nhập, Trạng thái, Cập nhật, and bulk barcode printing (12.1). Shift list: search and Bộ lọc (Quầy, Thời gian) (12.1). Promotion list: search, Bộ lọc (Thời gian, Trạng thái), separate Mã and Chương trình columns, pause/resume moved into the editor (12.1). Supplier orders removed (no “Đặt hàng NCC” screen or menu item, FR-PUR-07/08). Supplier payables removed: no “Công nợ” tab on Suppliers, no payables report (FR-PUR-06). Supplier form: Tên, Điện thoại (required), Email, Mã số thuế, Nhận hàng ký gửi, Ghi chú; no type, contact person, terms or bank; list search by name or phone. Stock count list: search and Thời gian / Trạng thái filters. Consignment lots and Nhân viên lists have a search box; “Thêm nhân viên” generates the temporary password with “Sao chép” / “Tạo mã khác”. Thêm sản phẩm mới: one “Thông tin sản phẩm” card with Nhà cung cấp after Danh mục; Nhà cung cấp and Số lượng nhập lần đầu are required and saving posts the first stock-in (FR-PUR-02); the opening quantity can enter as consignment (13.8). Stock count: scope by product type and category, Excel/CSV count sheet download/upload (required above 50 products), no scanning, cancel until approved; confirmation dialogs without divider lines (13.8, 10.9). Stock adjustment: quantity and reason per product, no location anywhere (one stock location; also removed from stock counts, the stock page and master data), reasons “Hết hạn sử dụng” and “Hoàn tác nhập dữ liệu” dropped (12.1). Stock list: the “Nhập thêm hàng” form only edits the ticked products (no search, no new product) (12.1). Stock list: stock value under the title; Bộ lọc adds “Thay đổi gần nhất” (time of the latest stock change) (12.1). Bulk bar sits under the search/filter row (they stay visible), expands to list the selected rows (3 visible, scroll) with an X per row (10.6). Stock and stock-in merged into one “Tồn kho” page with a product-style table, search, stock-state filter, bulk “Nhập thêm hàng” / “Điều chỉnh tồn” and a per-product stock page; “Nhập hàng” menu item and stock-in entry list removed (12.1, Appendix A). Product record: “Thông tin sản phẩm” first (photo left, details right, description below), then separate “Giá bán” and “Tồn kho” cards each with its own “Sửa”, and a “Bán trên website” toggle instead of POS/website flags (12.3, FR-CAT-09). Store credit removed everywhere (no payment tile, refund choice, customer tab or field) (13.4, 12.3). Customer record: icon-only Sửa beside ⋯, purchases and points on one page without tabs (12.3). Customer list: Số đơn, Tổng mua, Mua gần nhất columns and a Bộ lọc with Hạng, Mua gần nhất, Số đơn, Điểm (12.1). Page-header buttons fit their label on phones instead of stretching full width (6.3, 10.1, 12.1, 12.3). Sale record: Print and Return moved into the ⋯ menu on every screen size (12.3). Detail pages: overflow ⋯ on the title row and actions side by side on phones; single-column stacking never wider than the screen; line tables become stacked lists on phones; sale record e-invoice card with “Xuất hóa đơn” (12.3). Filter popover: each field is a dropdown with checkboxes for multi-select; sales list filters by time (10.9, 12.1). POS sales list (“Đơn bán”) shows no e-invoice chip in the status column; the e-invoice state is on the sale record (12.1). POS customer lookup by phone or name (FR-POS-04); smaller type and buttons: page titles 28/22 px, `pos-total` 28 px without wrapping, button heights 32/36/44/52 px, POS touch targets 44 px (5.2, 6.5, 10.1, 13). POS header shows cashier and register only; scan button sits beside the search field; empty-cart state “Chưa có sản phẩm nào được chọn”; on tablet portrait / phone the whole cart (customer, lines, totals, Xác nhận) is on the selling screen with no bottom sheet (13.1, 13.3). **27 Oct:** Reports split into separate pages per area – Doanh thu, Kho & nhập hàng (purchasing merged in, only stock-ins remain), Thuế & kiểm toán; each page switches its reports with tabs and uses the list time filter (12.6, Appendix A). Later the same day: the reports of a page are chosen from a “Báo cáo” dropdown instead of tabs; Doanh thu has no by-cashier report and one “Theo thời gian” report (by day, by month above 92 days) defaulting to the last 30 days; no CSV button on reports; product rows show SKU and product name as separate columns; no summary tiles above the table (12.6). **3 Nov:** Báo cáo ca làm moves from CỬA HÀNG to the top of BÁO CÁO, before Doanh thu (Appendix A). Time filters keep four presets only – Tất cả, 7 ngày qua, 30 ngày qua, Tùy chọn (Hôm nay, Tháng này, Tháng trước dropped); reports have no Tất cả and default to 30 ngày qua; dashboard chart ranges are 7 ngày, 30 ngày and Tùy chọn (10.3, 10.9, 12.1, 12.5, 12.6). Doanh thu drops the by-category and by-payment-method reports: Theo thời gian, Theo sản phẩm, Theo khách hàng remain (12.6). The line above a report table shows only the period. Doanh thu shows its three tables on one page, each with its own Bộ lọc and Xuất Excel; the other report pages keep the dropdown, with Xuất Excel beside it; a thin rule separates the Doanh thu sections; the revenue chart can switch between columns and a line with hover tooltip. Tồn kho gets a header “Nhập thêm hàng” button that opens the stock-in dialog empty with a product search, adding products one at a time (12.4). Kho & nhập hàng drops Chênh lệch kiểm kho and Hàng ký gửi, which repeat the Kiểm kho and Ký gửi screens; Hàng bán chậm becomes the Chưa bán trong filter on Tồn kho; Kho & nhập hàng and Thuế & kiểm toán now show their three reports on one page like Doanh thu; the report dropdown is gone (12.1, 12.6). **3 Nov (R2a):** the province/ward picker shows the old district in brackets only beside a ward name that occurs twice in the province (10.3). Channel profiles (FR-SOC-01) are a “Kênh bán” tab of Cài đặt, shown with `online.manage`; there is no Kênh bán button on Giao hàng (Appendix A). Pre-orders: a “Đặt trước” button in the POS header opens the new pre-order form (customer – an existing customer found by phone or name, or “Khách mới” with phone and name; the cart’s customer is picked by default –, products, deposit); the list is the “Đơn đặt trước” tab of Đơn hàng (tabs Đơn bán · Đơn đặt trước; columns Mã phiếu, Khách hàng, Sản phẩm, Tổng tiền, Đã cọc, Trạng thái, Ngày đặt; Bộ lọc Trạng thái); a row opens the pre-order with “Nhận hàng tại quầy” (opens the POS with the pre-order in the cart), “Đã đặt NCC” and “Hủy phiếu”; a pre-order holds one or more products (added from a product search, each with its quantity) and the form has no Kênh field; “Nhận hàng” loads all its products into the cart with the agreed prices and locked quantities, and the payment screen shows the deposit already paid; the Đặt trước menu item and special orders are removed (13.1, 11.2, 12.8, Appendix A). The “Cần liên hệ” worklist is removed (12.8, 11.2, 12.2, Appendix A): the pre-order record shows the phone as a call link and a “Đã liên hệ” action; Đơn đặt trước filters by status (Đã về = chờ liên hệ). Library (SRS 3 Nov): copy statuses Còn · Đã giữ · Đang mượn · Mất · Hỏng, Quá hạn only on loans (§15); library code and book labels (13.8, 16.5 replaces the member card); borrowers found as customers, loan fee per copy shown at check-out and collected at the POS from a banner under the customer (13.1, 13.8); loan lists with call links; the library reminder emails and the Thành viên, đặt cọc & phí phạt menu item are removed (§17, Appendix A); no reference-only chip (§15); the borrow step shows the buyer loan-fee discount (13.8). Library counts (4 Nov): a Kiểm kê thư viện menu item and count screens modelled on Stock count, with scanning (13.8, Appendix A). Library desk payments: a Thanh toán step in Cho mượn and Gia hạn, “Thu phí” for owed charges, a Sổ thu thư viện page, no library banner on the POS (13.1, 13.8, Appendix A). Library overview: four clickable figures on Mượn / trả and a Tổng quan thư viện card on the dashboard; Mượn / trả lists use the Lọc button instead of tabs (12.5, 13.8). Reservations on the borrow form (4 Nov): “Hết bản” titles become “Đặt giữ” lines, a reservations-only form is “Phiếu giữ sách” without payment, held copies are offered first (13.8). Customer list: “Mua gần nhất” becomes “Hoạt động gần nhất” (shop and library, date only), column and filter; new filter Dịch vụ sử dụng – Tất cả, Chỉ mua hàng, Chỉ thư viện (12.1). Phiếu mượn sách: the Thanh toán section lists Hạn trả, Số lượng, Phí mượn, Ưu đãi (manual % or ₫) and Tổng phí mượn (13.8). Mượn / trả: the four figures sit in one “Tổng quan thư viện” card like the dashboard's; “Tổng số bản sách” reads “Tổng” and “Còn trên kệ” becomes “Đã thu trong tuần” (period set in Cài đặt › Thư viện) (12.5, 13.8). Mượn / trả lists loan slips (Số phiếu, Khách, SĐT, Số sách, Số tiền, Hạn trả, Thời gian tạo, Người thu) with a slip dialog for per-copy actions and receipts; the Sổ thu thư viện page and menu item are removed (13.8, Appendix A). **5 Nov:** the dashboard’s three KPI tiles sit in one “Tổng quan cửa hàng” card with a “Số liệu hôm nay” subtext, on one row on phones too, with the shorter labels Doanh thu, Số đơn, Trung bình (amount followed by a small “/đơn”) and smaller type; the revenue trend covers shop and library – stacked Bán hàng / Thư viện bars, Đơn bán and Phiếu mượn lines, and a “Lọc” button to show some or all series and pick the time range; the tiles of both cards are always equal width, with type that scales to the tile; Tổng quan thư viện moves up under it and matches it – subtext “Số liệu tuần này” (follows the period setting), three tiles Doanh thu, Đang mượn, Quá hạn with a small “cuốn” unit, no Tổng tile (12.5). **5 Nov (later):** the dashboard’s Doanh thu theo kênh card is replaced by a Sản phẩm hiện có donut (units on hand: Sách, Văn phòng phẩm, Khác); sales by channel moves to Báo cáo › Doanh thu as a Theo kênh table (12.5, 12.6). On desktop Sản phẩm hiện có, Bán chạy tháng này and Sắp hết hàng share one row and the two lists drop the SKU column there (12.5). The stock donut card is retitled “Tổng quan tồn kho” without a subtext, and its header button is a round icon-only “Chi tiết” arrow (`ArrowUpRight`) on the title’s row (12.5). The bestsellers card is titled “Sản phẩm bán chạy” (still this month’s sales) (12.5). Overview tiles get a 1 px navy border at 30 % opacity (12.5). The Tổng quan menu item uses the House icon (Appendix A). The Bán hàng menu item uses the ShoppingCart icon (Appendix A). **5 Nov (orders):** Đơn hàng becomes one list of every order (counter sales, pre-orders, online orders) with a Loại filter and “Xác nhận đơn” for website orders; Giao hàng holds only confirmed carrier orders, with “Tạo đơn giao” for social and phone orders and per-row “Tạo vận đơn”; sidebar badges split accordingly (12.1, 12.9, Appendix A). **5 Nov:** POS device registration asks only for the register; the device code is assigned automatically (13.2). The device registration screen is titled “Đăng ký quầy”, shows only the register select and confirms with “Xác nhận” (13.2). “Thoát POS” reads “Thoát”. **11 Nov:** Thêm sản phẩm mới gets a Tìm sách field with ISBN scanning that fills empty fields from Open Library (12.4, FR-CAT-16). **11 Nov (library):** titles show a call number (Dewey + Cutter, or “Chưa phân loại”) and copies a Mã cá biệt from the system; Thêm đầu sách gets Tìm sách, Ký hiệu xếp giá with a suggested Cutter and a Nhập bản section that saves and opens the labels; spine labels 30 × 45 mm stacked barcode / Dewey / Cutter (13.8, 16.5). **11 Nov:** Giao hàng drops the “Cập nhật …” line under its title (12.9). Tạo đơn giao: Nguồn đơn moves above Sản phẩm, and Khách hàng picks an existing customer by phone or name or takes a new one, like the pre-order form (12.9, 13.1). **12 Nov:** the POS header shows only the register code (Q1) and icon-only Đặt trước and Giỏ chờ buttons with count badges (13.1). POS totals: Mã giảm giá and Điểm become rows above TỔNG (add / show / remove), and Giữ giỏ sits beside Xác nhận (13.1). Shift close counts cash in rows – pick a note, type the number of notes, “+ Thêm mệnh giá” for more (13.6); shift open is unchanged. The app background is white everywhere (shell and POS); cards and table frames get `shadow-sm` with their border; summary boxes and read-only inputs use `paper-200`; no zebra rows (4.x, 6.3, 7.3). Disabled buttons keep their colours at 40 % opacity instead of a beige fill; the POS Giữ giỏ / Xác nhận row is 44 px (8, 10.1, 13.1). The POS scan button and “Thêm khách” are navy (`navy-700`, white) (13.1). Tạo đơn giao: the line discount opens from a “Giảm giá ›” row instead of a switch; Khách hàng is two fields with phone suggestions that fill the name and the latest delivery address (12.9). Tạo đơn giao line discount: a `Tag` button beside the quantity opens the amount, and the price shows struck through with the new price and a “−… ₫” chip (12.9). Tạo đơn giao has two main cards: “Thông tin đơn hàng” (source + products) and “Thông tin giao hàng” (recipient + delivery) (12.9). Every search or lookup field has a leading Search icon, the POS search and scan fields included (10.3, 13.1); Tạo đơn giao: full-width source fields and a “Sản phẩm” label over the product search (12.9). Tạo đơn giao drops the “Nhận tại cửa hàng” choice: the address is always required (12.9). Tạo đơn giao: no stock line (only “Hết hàng” when out of stock) and no per-item discount; “Giảm giá đơn” (₫ / %) joins “Mã giảm giá” in Thanh toán (12.9). “Giảm giá đơn” picks % (default) or ₫ from a select beside the field (12.9). POS line discount: amount field with a % (default) / ₫ select beside it (13.1). POS search finds products by Vietnamese or English title, accent-insensitive, and shows the Vietnamese title (13.1). POS: the manual discount moves from the line dialog to a “Giảm giá đơn” row in the totals, for the whole order (% by default or ₫) (13.1). Giảm giá: one control on the POS and Tạo đơn giao – pick a programme with a code or enter a manual discount, one per order; automatic promotions show apart as Khuyến mãi (12.9, 13.1). POS cart line: the stepper sits at the right of the unit price – smaller, the quantity in a box, bare `−` / `+` icons – and the line shows no line total; “Thêm khách” is a small 32 px pill on phones too, on its own row under the search field; an attached customer shows name and phone only, with an “Đủ điểm nhận ưu đãi” chip once the points reach the redemption minimum; the cart total is 22 px and the % / ₫ select 48 px wide; the Giảm giá row is “Giảm giá ›” with its amount on the row and the field opening below it; the discount is one field with a small % / ₫ switch inside on the left, not two boxes (POS and Tạo đơn giao); the POS “Xác nhận” button is navy (`primary`) instead of olive; the cart card has the title “Thông tin sản phẩm” (14 px 600) above the lines (13.1); “Giữ giỏ” and “Xác nhận” are the same width and “Xác nhận” has no icon (13.1); every scan button (POS, Tìm sách, library) is a navy icon without a circle (10.3, 12.4, 13.1, 13.8); a “Hủy đơn” button beside the cart title drops an unconfirmed sale after a confirmation (13.1); POS search results show the photo, the name and, online, the stock under the name, in a dropdown under the search field that leaves the cart as it is; the cart’s “Hủy đơn” is an ✕ icon (13.1); card payment asks for no approval code (13.4); Tạo đơn giao drops the hints under Phí giao hàng and Giảm giá (12.9); its note field is labelled “Ghi chú” (still internal, not shown to the customer) (12.9); its product lines look like the POS cart lines (name; price with − qty + at the right; − at 1 removes; no trash icon), on white; POS cart lines are always white – no sand highlight (12.9, 13.1); its save button reads “Xác nhận”, text only (the list page keeps “+ Tạo đơn giao”) (12.9); The POS customer button reads “Gắn khách” (13.1). Pre-order deposits by transfer show no payment reference either (12.8). The Phiếu đặt trước form has the sections Khách hàng then Thông tin sản phẩm,, a slip may not mix books on the shelf and books to order (the form warns and will not save), books not in the catalogue are added from the same product search (no second field), and the customer search drops down attached to the field (3 matches, name and phone; “Khách mới” only as the no-match option) (12.8). A bank transfer at the payment screen shows nothing more than the total – no reference, no tick box (13.4). Payment method tiles are text only, 44 px, under a “Phương thức thanh toán” label (13.4). The POS `Menu` button opens the main menu drawer – no shift menu, no “Thoát” needed to leave during a shift; no cash in/out; Đóng ca is an icon beside Giỏ chờ (6.x POS mode, 13.1, 13.6). The POS header loses its Đặt trước button – slips are taken only on the Đặt trước page (13.1, 12.8); pre-orders get their own page “Đặt trước” under Bán hàng – one list with Bộ lọc; an ISBN typed in the search finds the slips (no Theo sách view, no scan button), slip dialog with quote, accept, edit, extend, cancel; the POS shows a customer’s slips and who a copy is held for; held carts say they hold no stock; the Orders list drops pre-orders (12.1, 12.8, 13.1, Appendix A); Đối soát COD becomes its own menu item under Giao hàng with a difference badge, and Giao hàng keeps only “+ Tạo đơn giao” (12.9, Appendix A); Tạo đơn giao product matches show the name with the stock under it and the price at the right, no SKU (12.9); shift close: rows remove with an ✕, “+ Thêm” is plain text, the summary box is white, “Tiền mặt trong ca” with the hints inside the fields (no headings), one full-width “Đóng ca”; rows show the note at the left and Số tờ at the right, without a row amount (13.6); the completion sheet has no title bar and no e-invoice email button (the sale record keeps “Xuất hóa đơn”); the payment screen ends with one full-width “Xác nhận” (no icon, no Hủy button; the ✕ closes it) (13.4); the add-customer dialog is “Thông tin khách hàng” with a search field (icon, “Nhập SĐT/tên”) whose matches drop down as you type (up to 5, name and phone, no points), no Tìm button and no divider (13.1); payment screen: method tiles first, then a “Tổng giá trị đơn” row (label left, smaller amount right), no per-method amount field, no quick-amount chips, “Tiền thừa” on one row with a smaller amount, no split payment (13.4); the order discount is a percentage only – the % / ₫ switch is removed (POS and Tạo đơn giao); the POS discount field is a small 128 × 36 px field at the right; text fields, selects and text areas show focus by a navy border only, without the focus ring (4.6, 8); the `⋯` line menu (price override, note, remove) is removed (13.1). **13 Nov (later):** no coupon codes – promotions apply by themselves and the Khuyến mãi row names them; Giảm giá is only a manual discount typed in place (% / ₫), with no dialog, on the POS and Tạo đơn giao; the promotion list loses its Mã column and the editor its code field (12.1, 12.9, 13.1). **15 Nov:** pre-order slips show five statuses – Chờ xác nhận, Đang đặt hàng, Chờ nhận, Đã nhận, Đã hủy – as a chip only, set by hand with “Cập nhật”; the slip dialog lists Trạng thái, Khách hàng, Điện thoại, Tổng tiền, Đã cọc, Thời gian tạo phiếu as label/value rows and has only Hủy phiếu and Cập nhật (no quote, edit, contacted, extend or collect buttons); an order slip takes its deposit when it is taken (12.8). **15 Nov:** every dialog has a compact title bar and no divider lines under the title or above the buttons (10.9). **15 Nov:** “Quản lý đầu sách” is renamed “Quản lý thư viện” and moves above Mượn / trả in the menu; the Tổng quan thư viện card is on the dashboard only, not on either library page (13.8, Appendix A). **17 Nov:** Nhập thêm hàng scans: the search field has a scan button that opens the continuous camera scanner, and a handheld scanner works in the field; a code that matches no product is refused as a new product, to be created on Thêm sản phẩm mới (12.4; SRS FR-PUR-03). **17 Nov (later):** Tồn kho – ticking products serves only Điều chỉnh tồn: the bulk bar no longer has Nhập thêm hàng; stock is added from the header button or the product's stock page, both with scan and search; a secondary “Nhập từ Excel” beside Nhập thêm hàng opens the Phiếu nhập hàng import; the stock page's movement history no longer repeats the entry number as a note (12.1, 12.4). **17 Nov:** wizards show no step indicator – the import wizard (Nhập từ Excel, Nhập dữ liệu) and the first-run setup drop their numbered step chips; each step's own content and buttons show where staff are (10.14, 12.10). **17 Nov:** Nhập thêm hàng asks for the supplier only (no Số hóa đơn NCC, no Ghi chú), shows no money total or line count, and its Hủy and Xác nhận nhập hàng buttons are the same size (12.4). **17 Nov (later):** Nhập thêm hàng is its own page, `/stock/in`, not a dialog (12.1, 12.4). Its page has no card borders; each product is one bordered row with photo, name, SKU, a quantity stepper and a remove button – no cost or selling price (12.4; SRS FR-PUR-03). **18 Nov:** the stock-in row follows the POS cart line: nothing is cut off – the name wraps in full, the SKU and the quantity stepper share the row under it, a small cover sits at the left; no remove button – stepping below 1 asks to remove; tapping the row opens its cost price and selling price, prefilled and editable (12.4). **18 Nov (later):** the stock-in page is leaner – the supplier select has no label above it and reads “Nhà cung cấp” inside until one is chosen, the “Sản phẩm” heading is gone, the search reads “Nhập SKU/tên sản phẩm”, and the gaps are 16 px under the title and 12 px between the supplier, the search and the rows (12.4). **18 Nov:** its header is a back arrow (`navy-700`) and the title on one line, with no breadcrumb; the title is `heading-md` on phones and `heading-lg` from `sm`, the arrow 20 px (12.4). **18 Nov:** every page opened from another page uses that header – back arrow and title on one line, no breadcrumb: Kiểm kho and Kiểm kê thư viện sessions, customer, loan slip, library title, order, Tạo đơn giao, product, Thêm sản phẩm mới, sale, shift and product stock pages (6.3, page header row). **18 Nov:** Nhập thêm hàng with no product shows only an icon and “Chưa có sản phẩm nào được chọn”, centred on the screen (12.4). **18 Nov:** Nhập thêm hàng – the search row sits right under the title; on phones the supplier is chosen in a dialog that “Xác nhận nhập hàng” opens, from `sm` the supplier select sits at the right of the search row (12.4). **18 Nov (later):** Nhập thêm hàng fills the content area on wide screens; product rows go two across from `lg`, three from `2xl` (12.4). **18 Nov (later):** the product rows are one column on every screen, inside one box titled “Sản phẩm đã chọn” with dividers between rows (12.4). **18 Nov:** the confirm button on Nhập thêm hàng – the page, its phone supplier dialog and the product dialog – reads “Xác nhận” (12.1, 12.4). **18 Nov:** notification items have Vietnamese titles for every kind, including website orders to confirm, review or return and pre-orders past their holding period, and each opens its record (10.11). **18 Nov:** a new pre-order slip shows “Phiếu đặt trước mới {mã} · {khách}” to the other pre-order staff (10.11). **18 Nov:** delivery orders notify online staff – new, failed, returning, returned, delivered (10.11). **18 Nov:** on a product's stock page Nhập thêm hàng opens a dialog for that product only – quantity, cost, price, supplier (12.1); the Nhập thêm hàng page opens only from Tồn kho (12.4). **21 Nov:** POS cart totals are Thành tiền, Giảm giá (a dropdown holding promotions, the manual discount and points) and Tổng tiền; on phones they sit with Giữ giỏ / Xác nhận in a fixed bottom bar, on wide screens in a “Giá trị đơn hàng” card under “Thông tin sản phẩm” (13.1); the payment dialog's methods are round radio ticks centred in three equal boxes – Tiền mặt, CK, Thẻ; the dialog is titled “Phương thức thanh toán” (13.4). **21 Nov:** the notification panel fits the screen on phones (10.11). **21 Nov:** attaching a customer at the POS: no match offers “+ Khách mới” in the dropdown, then phone and name fields as in the pre-order form (13.1). **21 Nov:** Phiếu đặt trước: Thu cọc is a collapsible box showing “Có” / “Không”, and Ghi chú moves below it (12.8). **21 Nov:** payment dialog when a pre-order's deposit covers the price: no method, “Đã trả đủ bằng tiền cọc” or “Trả lại khách … tiền mặt” (13.4). **21 Nov:** Cấu hình gets a “Đặt trước” group (minimum deposit, holding days); the pre-order form follows the configured minimum (12.8). **21 Nov:** Cập nhật trạng thái: Nhận tại quầy / Giao hàng are round radio ticks and the button reads “Xác nhận” (12.8). **21 Nov:** Giao hàng on an order slip opens Tạo đơn giao filled from the slip (deposit counted as paid); holds are collected in store only (12.8, 12.9). **22 Nov:** bottom sheets sit above the on-screen keyboard on phones (10.9). **22 Nov:** Tạo đơn giao refuses a recipient phone that is not a Vietnamese mobile number, with a field error (12.9). **22 Nov:** the Giao hàng header button reads “Tạo đơn giao”; its payment method is a “Hình thức” row with a compact dropdown, Thu hộ (COD) by default; Hủy and Xác nhận sit at equal widths inside the Tổng cộng card instead of a bar fixed to the bottom; Giảm giá and Phí giao hàng are rows with their 36 px fields at the right, like Hình thức (12.9). **22 Nov:** every select field draws the same ChevronDown 12 px from its right edge instead of the browser's arrow (10.2). **22 Nov:** Tạo đơn giao labels its source field “Nguồn đơn” (was “Kênh”), and the Giao hàng list's column and filter group read “Nguồn đơn” too; its stage filter group reads “Trạng thái” (was “Giai đoạn”) (12.9). **22 Nov:** in the sidebar the THƯ VIỆN group comes after DANH MỤC & KHO (navigation table). **22 Nov:** the product import's info box explains that Tồn đầu kỳ is for goods already held, without a supplier (12.4). **22 Nov:** shelves (Kệ hàng in Cấu hình) – a product may sit on one shelf, chosen on Thêm sản phẩm mới and the product page; the shelf shows in POS and product searches, and as a column and filter on Sản phẩm and Tồn kho (12.1, 12.3, 12.4, 13.1). **22 Nov:** Thêm sản phẩm mới frames its two parts as two cards (the left one titled “Thông tin chi tiết”, with “Loại sản phẩm” at the left and its select at the right of one line; every field and select 40 px high, Tìm sách included; Tên sản phẩm full width, SKU + Danh mục and Nhà cung cấp + Nhà xuất bản side by side, Đơn vị plain text; the Loại sản phẩm select as wide as the fields below; Ảnh sản phẩm under Mô tả with the chosen photo shown in full; Thuế VAT sits with the prices in “Giá và thuế”, the stock fields under “Tồn kho”; a Kệ select sits in Tồn kho, under the stock fields; the save button reads “Xác nhận”; on wide screens the right column with the buttons stays in place while the details scroll; a Website section under Tồn kho has a “Hiển thị trên website” switch, off by default); on wide screens it has two columns – product details left (Loại first, then Tìm sách, Tên + SKU, Danh mục + Nhà cung cấp…), image, prices, stock and the buttons right (12.4). **22 Nov:** on wide screens the Phiếu đặt trước page uses the selling screen's two columns – search and customer at the left, the product card and buttons in a 420 px column at the right (12.8). **22 Nov:** “+ Thêm” (was “+ Tạo phiếu”) opens the Phiếu đặt trước form as its own page, not a dialog, without a card frame; on phones its save button is pinned to the bottom; its customer and products are laid out like the selling screen – a Gắn khách pill opening the POS customer dialog, and a Thông tin sản phẩm card; Thu cọc opens with a “+” (no deposit unless opened), its method is round radio ticks Tiền mặt · CK · Thẻ, no hint under the amount; the form has no Ghi chú; a bottom order bar holds Hủy / Xác nhận, Xác nhận opens a Thu cọc dialog (a Loại phiếu dropdown Không cọc / Có cọc; with Có cọc the method and the POS keypad for every method; Giá trị phiếu above the button) that saves the slip, like the POS payment dialog, and the product card fills the height with its lines scrolling inside it; the bar has no border or shadow (12.8). **22 Nov:** the Tồn kho header button reads “Nhập hàng”; the page it opens keeps the title Nhập thêm hàng (12.1, 12.4). **22 Nov:** the total stock value moves from the Tồn kho page header to the bottom of the dashboard’s Tổng quan tồn kho card (12.1, 12.5). **22 Nov:** Tạo phiếu kiểm kho – Loại sản phẩm is a multi-tick dropdown (all by default) at the right of its label; the Danh mục scope is removed (13.8). **22 Nov:** the stock count page is laid out like the library count – ⋮ Thao tác menu instead of header buttons, a Tiến độ box, no Phiếu đếm card and no CSV, “Danh sách kiểm kho” with a Bộ lọc instead of chips (13.8). **22 Nov:** stock counts scan – camera button beside Tiến độ and hand scanner, one per scan, quantity correctable on the result (13.8). **22 Nov:** Doanh thu, Kho & nhập hàng and Thuế & kiểm toán list report names; tapping one opens a dialog with Thời gian and Xuất Excel – no tables on screen (12.6). **23 Nov:** Báo cáo thư viện – three cards (Mượn trả trong kỳ, Tiền thu trong kỳ, Sách được mượn nhiều top 5) and a labelled period button; current loans and copies by status leave the page; Quản lý thư viện shows copies by status in one line under its title (12.6, 13.8). **23 Nov:** Thiết bị POS leaves the menu: Cấu hình › Quầy & máy bán hàng holds registers (renamable), devices with their last user and revoke, and sync exceptions only while unresolved; disabling an employee offers to revoke their devices (Appendix A, 13.x). **23 Nov:** the menu item Cấu hình is named “Cài đặt chung” (Appendix A). **23 Nov:** Nhật ký thao tác rebuilt: Vietnamese sentences with links, filters Người thực hiện / Loại thao tác / Thời gian, a before → after dialog; no codes or IP in the list (12.11). |
| **Based on** | SRS v1.1 Final and TDD v1.1 Final (both revised 24 Oct 2026) |
| **Applies to** | `apps/staff` (React PWA: back office + POS), `packages/ui` (tokens and components), browser print templates, system emails |
| **Not covered** | The public website interface (built by a separate front-end team, SRS §1.2, FR-WEB-23). This guide does not style the website. |
| **Stack assumed** | React 19, Tailwind CSS, shadcn/ui, lucide icons (TDD §2.1) |

## Table of Contents

- [1. How to use this guide](#1-how-to-use-this-guide)
- [2. Design principles](#2-design-principles)
- [3. Brand and logo](#3-brand-and-logo)
- [4. Colour](#4-colour)
- [5. Typography](#5-typography)
- [6. Layout, spacing and grid](#6-layout-spacing-and-grid)
- [7. Shape, elevation and motion](#7-shape-elevation-and-motion)
- [8. Iconography and imagery](#8-iconography-and-imagery)
- [9. Design tokens (code)](#9-design-tokens-code)
- [10. Components](#10-components)
- [11. Status system](#11-status-system)
- [12. Screen patterns](#12-screen-patterns)
- [13. POS and touch screens](#13-pos-and-touch-screens)
- [14. Content, voice and formatting](#14-content-voice-and-formatting)
- [15. Accessibility](#15-accessibility)
- [16. Print templates](#16-print-templates)
- [17. Email templates](#17-email-templates)
- [18. Hand-off checklist](#18-hand-off-checklist)
- [Appendix A. Navigation map with icons](#appendix-a-navigation-map-with-icons)
- [Appendix B. Contrast reference](#appendix-b-contrast-reference)

---

## 1. How to use this guide

- **Designers** use sections 2–8 and 10–14 to draw screens; every value has a token name.
- **Developers** copy the tokens in section 9 into `packages/ui` and build components to the specs in section 10. A screen that needs a value not in this guide should raise it, not invent it.
- **Reviewers** use the checklist in section 18.
- Requirement IDs (FR-…, NFR-…, BR-…) point back to the SRS where a design rule exists because of a requirement.
- Vietnamese UI copy is shown in quotes, for example “Tạo đơn” (Create order). The staff UI is **Vietnamese only** (NFR-USE-03); English labels in this guide are for the reader.

---

## 2. Design principles

| # | Principle | What it means on screen |
| --- | --- | --- |
| 1 | **Calm, like a good bookshop** | Warm-white backgrounds, navy ink, generous line height. Colour is used for meaning, not decoration. One accent at a time. |
| 2 | **Fast at the counter** | The POS is a tool, not a page: scan → pay in three taps or fewer (NFR-USE-01). Large targets, no hover-only actions, the scan field always ready. |
| 3 | **Never lose the thread** | Show system state everywhere it matters: online/offline, sync queue, e-invoice status, draft vs published. Nothing fails silently (FR-POS-17, NFR-REL-03). |
| 4 | **Colour is never the only signal** | Every status chip has a text label; states that need attention also carry an icon (SRS §5.1, NFR-USE-04). |
| 5 | **Show only what you may use** | Menus, buttons and fields appear only with permission (FR-ADM-03). Do not show disabled controls for missing permissions; hide them. Use disabled only for “not yet possible” states. |
| 6 | **Explain, then guide** | Errors say what happened and what to do next, in plain Vietnamese (NFR-USE-05). |
| 7 | **One pattern per job** | Every list looks like every other list; every form behaves like every other form. Staff learn once. |

---

## 3. Brand and logo

### 3.1 The logo

The logo is the wordmark **THE BOOKSHELF HANOI**: “BOOKSHELF” set in a wide-tracked condensed sans, with “THE” arcing above-left and “HANOI” arcing below-right, white on navy `#22344F`.

> **Asset request:** the current file is a raster square. Please supply the logo as **SVG** (and the source font name for the wordmark) so it scales cleanly in the sidebar, prints sharply on labels and slips, and can be recoloured for the variants below.

### 3.2 Variants

| Variant | Use | Colours |
| --- | --- | --- |
| **Primary – reversed** (as supplied) | Sidebar header, login screen panel, email header, PWA splash | White wordmark on Navy `#22344F` |
| **Positive** | Printed documents (A4, slips), light surfaces, payslips | Navy `#22344F` wordmark on white / Warm white |
| **Mono black** | Thermal printers (80 mm slips), barcode labels, fax-quality copies | `#000000` on white |
| **Compact mark “TB”** | Collapsed sidebar (72 px rail), favicon, PWA icon, browser tab | White “TB” monogram or the word “BOOKSHELF” cropped, on Navy, square |

If no compact mark exists, use the square app icon described in 3.5 – do not shrink the full wordmark below its minimum size.

### 3.3 Clear space and minimum size

- **Clear space:** keep empty space around the wordmark equal to the cap height of the letter “B” in “BOOKSHELF” on all sides. Nothing (text, edge, icon) enters it.
- **Minimum width** of the full wordmark (measured across “BOOKSHELF”): **120 px** on screen, **30 mm** in print. Below this, “THE” and “HANOI” become illegible; switch to the compact mark.

### 3.4 Placement in the app

| Place | Variant | Size |
| --- | --- | --- |
| Sidebar header (expanded, 264 px) | Reversed, on the navy sidebar | Wordmark 168 px wide, 24 px padding left |
| Sidebar rail (collapsed, 72 px) | Compact mark | 40 × 40 px |
| Login / first-run wizard | Reversed, inside a navy panel | Wordmark 240 px wide |
| POS lock screen | Reversed on navy, centred | 200 px wide |
| Print header (A4) | Positive | 40 mm wide, top-left |
| 80 mm slip | Mono black | 48 mm wide, centred |

### 3.5 App icon and favicon

| Asset | Size | Spec |
| --- | --- | --- |
| `favicon.svg` / `favicon.ico` | 32, 16 | Compact mark, Navy background, white glyph |
| `apple-touch-icon.png` | 180 × 180 | Navy square, compact mark centred at 60 % width |
| PWA `icon-192.png`, `icon-512.png` | 192, 512 | Same as above, `purpose: any` |
| PWA maskable `icon-maskable-512.png` | 512 | Glyph inside the central 80 % safe zone |
| PWA manifest | — | `theme_color: #22344F`, `background_color: #F5F2EA`, `name: "The Bookshelf – Quản lý"`, `short_name: "Bookshelf"` |

### 3.6 Don’ts

- Don’t recolour the wordmark outside the variants above (no olive, sand or sky logos).
- Don’t place the reversed logo on Sand, Sky blue or photos – contrast drops below legibility.
- Don’t stretch, rotate, add shadows or outlines, or re-set “THE” / “HANOI” in a straight line.
- Don’t use the logo as a button or loading spinner.

---

## 4. Colour

### 4.1 Brand palette – “Olive you, navy”

| Swatch | Name | Hex | Token | Brand role |
| --- | --- | --- | --- | --- |
| ![](https://placehold.co/24x24/22344F/22344F.png) | **Navy** | `#22344F` | `navy-700` | Anchor: primary actions, sidebar, headings, the logo ground |
| ![](https://placehold.co/24x24/D8C7A6/D8C7A6.png) | **Sand** | `#D8C7A6` | `sand-300` | Warmth: highlights, selected rows, active nav indicator, dividers on navy |
| ![](https://placehold.co/24x24/A9C4D4/A9C4D4.png) | **Sky blue** | `#A9C4D4` | `sky-300` | Calm support: info surfaces, charts, illustrations |
| ![](https://placehold.co/24x24/F5F2EA/F5F2EA.png) | **Warm white** | `#F5F2EA` | `paper-100` | Base: app background, page canvas |
| ![](https://placehold.co/24x24/7FA3B8/7FA3B8.png) | **Sea blue** | `#7FA3B8` | `sea-500` | Supporting shade: charts, illustrations, hover tints. **Never for text.** |
| ![](https://placehold.co/24x24/5B6B3A/5B6B3A.png) | **Olive** | `#5B6B3A` | `olive-600` | The accent: the POS “Xác nhận” button, featured/accent highlights, tier badges |

(The small swatch images are placeholders for reading on GitHub; the hex value is the source of truth.)

### 4.2 Balance on screen

The palette sheet’s balance bar translates to the app like this:

| Share | Colour | Where |
| --- | --- | --- |
| ~60 % | Warm white + white | Page background (Warm white), cards and tables (White) |
| ~20 % | Navy | Sidebar, headings, primary buttons, text |
| ~10 % | Sand | Selection, highlights, dividers, active states |
| ~7 % | Sky / Sea blue | Info, charts, secondary surfaces |
| ~3 % | Olive | One accent per screen at most |

**Rule:** if a screen has more than one olive element visible at once, one of them is wrong.

### 4.3 Extended scales

Tints and shades derived from the brand colours. Use these, not ad-hoc opacity.

| Token | Hex | Use |
| --- | --- | --- |
| `navy-50` | `#EEF1F5` | Hover row, subtle brand surface |
| `navy-100` | `#DCE2EA` | Selected chip background, brand badge |
| `navy-700` | `#22344F` | **Brand Navy** – primary button, sidebar |
| `navy-800` | `#1A2A41` | Primary button hover |
| `navy-900` | `#142033` | Primary button pressed, sidebar active item |
| `sand-50` | `#FAF6EE` | Highlighted row (new order, unread) |
| `sand-100` | `#F0E8D8` | Selected table row, sticky header on warm pages |
| `sand-300` | `#D8C7A6` | **Brand Sand** – nav indicator, dividers on navy, focus halo on navy |
| `sand-700` | `#7A6640` | Text on sand surfaces when navy is too strong (≥ 4.5:1 on `sand-100` only) |
| `sky-50` | `#EEF4F8` | Info panel background |
| `sky-100` | `#DCE8EF` | Info chip background |
| `sky-300` | `#A9C4D4` | **Brand Sky** – chart series, illustration |
| `sea-500` | `#7FA3B8` | **Brand Sea** – chart series, decorative |
| `sea-700` | `#3E6680` | Sea-coloured text/icons on light backgrounds |
| `olive-50` | `#EEF1E6` | Accent surface (featured card, tier panel) |
| `olive-100` | `#DDE3CD` | Accent chip background |
| `olive-600` | `#5B6B3A` | **Brand Olive** – accent button |
| `olive-700` | `#4A5830` | Accent hover; olive text on light backgrounds |
| `gold-300` | `#F6D96B` | Gold tier badge background only |
| `gold-800` | `#5C4300` | Gold tier badge text and star icon only |

### 4.4 Neutrals (paper and ink)

Warm “paper” neutrals for surfaces and borders; cool navy-tinted “ink” for text, so text always relates to the brand Navy.

| Token | Hex | Use |
| --- | --- | --- |
| `white` | `#FFFFFF` | Cards, tables, inputs, dialogs |
| `paper-50` | `#FBFAF6` | Not used on screen since the app background became white (too close to white to read) |
| `paper-100` | `#F5F2EA` | **Warm white** – brand colour for print and marketing (3.x); on screen only small quiet fills (code blocks, disabled selects). Not the app background |
| `paper-200` | `#EDE9DF` | Subtle fills: table header, skeleton, read-only and disabled inputs, summary boxes inside cards |
| `paper-300` | `#D9D3C4` | Borders and dividers (cards, table lines) |
| `paper-500` | `#8C8574` | Input borders, strong dividers (≥ 3:1 on white – meets non-text contrast) |
| `ink-900` | `#1A2638` | Primary text |
| `ink-700` | `#3D4A5C` | Secondary text, labels |
| `ink-500` | `#5C6675` | Tertiary text: hints, placeholders, timestamps (≥ 4.5:1 on white, warm white and `paper-200`) |
| `ink-300` | `#A3A9B3` | Disabled text and icons only (intentionally low contrast) |

**Do not use** generic Tailwind grays (`gray-500` = `#6B7280` fails 4.5:1 on Warm white).

### 4.5 Semantic colours

The brand palette has no red or amber, so semantic colours are added, tuned to sit with the palette (earthy, slightly muted). Each has a **surface** (background), a **text/icon** colour and a **solid** (for filled buttons and strong indicators).

| Meaning | Surface | Text / icon | Solid | Use |
| --- | --- | --- | --- | --- |
| **Success** | `success-50` `#E7F1EA` | `success-700` `#2E6B45` | `success-700` `#2E6B45` | Completed, paid, available, in stock |
| **Warning** | `warning-50` `#FBF1DE` | `warning-700` `#8A5A12` | `warning-500` `#D99A2B` (icon/indicator fill only, never text) | Needs attention soon, pending payment, low stock |
| **Danger** | `danger-50` `#F8E9E6` | `danger-700` `#A63A2B` | `danger-700` `#A63A2B` | Errors, failed, overdue, destructive actions |
| **Info** | `info-50` `#E6EFF5` | `info-700` `#2F6385` | `info-700` `#2F6385` | Neutral information, in progress, scheduled |

Success is deliberately **greener than Olive** so that “success” is never confused with the brand accent.

### 4.6 Colour roles (what to use where)

| Role | Token | Notes |
| --- | --- | --- |
| App background | `white` | Every page canvas, the shell and the POS alike; cards are told apart by their border and `shadow-sm` |
| Surface (cards, tables, dialogs) | `white` | |
| Sidebar | `navy-700` | Text `white` at 100 % / 72 %; active item `navy-900` + 3 px `sand-300` left bar |
| Top bar | `white` with bottom border `paper-300` | |
| Primary action | `navy-700` / hover `navy-800` / pressed `navy-900`, text white | One per view |
| Accent action | `olive-600` / hover `olive-700`, text white | POS “Xác nhận” and at most one similar commit action |
| Secondary action | `white` + border `paper-500`, text `ink-900` | |
| Links | `navy-700`, underline on hover and always inside body text | |
| Focus ring | 2 px `navy-700` + 2 px offset `white`; on navy surfaces 2 px `sand-300` | Buttons, links, tabs, checkboxes and other controls. **Text fields, selects and text areas get no ring**: their border turns `navy-700` instead, so the field does not look doubled or heavier while typing |
| Selection (rows, chips) | `sand-100` background, `navy-700` 2 px left edge for rows | |
| New / unread highlight | `sand-50` background + `navy-700` dot | Order inbox (FR-ORD-03) |
| Destructive | `danger-700` | |

### 4.7 Data-visualisation palette

For charts in Overview and Reports (FR-RPT). Use series in this order; never more than six series in one chart (group the rest as “Khác” / Other).

| Order | Token | Hex | Typical use |
| --- | --- | --- | --- |
| 1 | `navy-700` | `#22344F` | Main series, current period |
| 2 | `sea-500` | `#7FA3B8` | Second series |
| 3 | `olive-600` | `#5B6B3A` | Third series |
| 4 | `chart-sand` | `#C9A15A` | Fourth series (deeper than Sand; as a filled bar/area it is distinguishable on white, but its contrast is 2.4:1, so always pair it with a direct label) |
| 5 | `sky-300` | `#A9C4D4` | Fifth series, previous period |
| 6 | `danger-700` | `#A63A2B` | Sixth series, or negative values only |

- **Comparison to previous period:** current = `navy-700` solid, previous = `sky-300` solid or `navy-700` dashed.
- **Sales by channel** (FR-SOC-02) keeps fixed colours so a channel is always the same colour: Counter `navy-700`, Website `sea-500`, Facebook `olive-600`, Zalo `chart-sand`, Instagram `sky-300`, TikTok `ink-700`, Phone/Other `paper-500`.
- Gridlines `paper-300`, axis labels `ink-500` 12 px, values in tooltips `ink-900`.
- Chart series colours sit next to each other on white; always add direct labels or a legend with text – never colour alone.

---

## 5. Typography

### 5.1 Families

| Role | Family | Weights | Why |
| --- | --- | --- | --- |
| **Display** | **Cormorant Garamond** | 500, 600 | The brand voice from the palette sheet. Elegant, bookish. Used large only. |
| **UI, body and codes** | **Be Vietnam Pro** | 400, 500, 600, 700 | Designed for Vietnamese: correct stacked diacritics (ễ, ặ, ở, ữ), excellent legibility at 13–16 px on screens. Replaces Figtree, which lacks full Vietnamese support. Also sets codes (see “code style” below). |

**Code style.** SKUs, ISBNs, barcodes, order/sale numbers, tracking numbers and API keys use Be Vietnam Pro at weight 500 (600 for `code-xl`) with tabular figures. Where this guide says “code style”, it means this treatment. Long codes are grouped in blocks of 4 with spaces so that 0/O and 1/l are easier to tell apart when read aloud or hand-written.

Loading (Google Fonts, with the Vietnamese subset; self-host the files in `apps/staff` for offline POS):

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700&family=Cormorant+Garamond:wght@500;600&display=swap&subset=vietnamese" rel="stylesheet">
```

> **Offline requirement:** the POS must render correctly with no network (FR-POS-23). Self-host the WOFF2 files and precache them in the service worker; the Google link above is for design tools and prototypes only.

Fallback stacks:

```css
--font-display: "Cormorant Garamond", "Times New Roman", serif;
--font-sans:    "Be Vietnam Pro", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
--font-code:    var(--font-sans);   /* code style = Be Vietnam Pro 500 + tabular-nums */
```

### 5.2 Type scale

Base size **14 px** for data-dense back-office screens; **16 px** for forms on phones and for POS. Line heights are generous for Vietnamese diacritics (minimum 1.4 for UI text, 1.5 for paragraphs).

| Token | Family | Size / line height | Weight | Use |
| --- | --- | --- | --- | --- |
| `display-lg` | Cormorant Garamond | 40 / 48 | 600 | Login and first-run wizard heading, empty-state hero |
| `display-md` | Be Vietnam Pro | 28 / 36 | 600 | Page title (H1) on desktop, dashboard greeting |
| `display-sm` | Be Vietnam Pro | 22 / 30 | 600 | Page title (H1) on phones, dialog hero titles |
| `heading-lg` | Be Vietnam Pro | 20 / 28 | 600 | Section heading (H2), card title on detail pages |
| `heading-md` | Be Vietnam Pro | 16 / 24 | 600 | Sub-section (H3), dialog title, card title |
| `heading-sm` | Be Vietnam Pro | 14 / 20 | 600 | Group label, table section title |
| `body-lg` | Be Vietnam Pro | 16 / 24 | 400 | Forms on phones, POS text, paragraphs |
| `body-md` | Be Vietnam Pro | 14 / 22 | 400 | **Default** – tables, forms, body |
| `body-sm` | Be Vietnam Pro | 13 / 20 | 400 | Dense tables, secondary info, helper text |
| `caption` | Be Vietnam Pro | 12 / 16 | 500 | Badges, timestamps, chart axes |
| `overline` | Be Vietnam Pro | 12 / 16 | 600, letter-spacing 0.08em, uppercase | Sidebar group labels (“CỬA HÀNG”) |
| `kpi` | Be Vietnam Pro | 24 / 32 | 600, tabular numbers | Dashboard KPI values |
| `pos-total` | Be Vietnam Pro | 28 / 36 | 700, tabular numbers, never wraps (`white-space: nowrap`) | POS cart total, amount due, change due – fits “99.999.999 ₫” on a 360 px phone |
| `code-md` | Be Vietnam Pro | 14 / 20 | 500, tabular numbers | SKU, ISBN, order code in tables |
| `code-xl` | Be Vietnam Pro | 24 / 32 | 600, tabular numbers, letter-spacing 0.04em | GHN tracking number (FR-ORD-10), pickup code, registration number |

**Rules**

- Cormorant Garamond is used only for `display-lg` (login, first-run wizard, empty-state hero). Page titles and the dashboard greeting use Be Vietnam Pro (27 Oct 2026). Cormorant is **never below 24 px**, never for body text, buttons, tables or form labels. It is thin at small sizes and slows reading.
- Uppercase is used only for `overline`. Vietnamese in all-caps loses readability of diacritics – avoid uppercase buttons and headings.
- Maximum line length for paragraphs: 72 characters (`max-w-prose`).
- Do not use weights below 400.

### 5.3 Numbers

- All money, quantities, percentages and counts use **tabular figures**: `font-variant-numeric: tabular-nums;` (Tailwind `tabular-nums`). Verify Be Vietnam Pro renders tabular figures in the build for every weight used.
- Numbers in tables are **right-aligned**; their column headers are right-aligned too.
- Codes (SKU, ISBN, order number) are left-aligned in code style.

---

## 6. Layout, spacing and grid

### 6.1 Spacing scale (4 px base)

| Token | px | Typical use |
| --- | --- | --- |
| `space-0.5` | 2 | Icon-to-text nudge |
| `space-1` | 4 | Chip padding (vertical), tight gaps |
| `space-2` | 8 | Gap between icon and label, inline elements |
| `space-3` | 12 | Input padding (horizontal), compact card padding |
| `space-4` | 16 | **Default gap**; phone page gutter; card padding on phones |
| `space-5` | 20 | Form field vertical gap |
| `space-6` | 24 | Card padding on desktop; gap between cards |
| `space-8` | 32 | Section gap on a page |
| `space-10` | 40 | Page top padding (desktop) |
| `space-12` | 48 | Large empty-state spacing |

These are Tailwind’s default spacing steps; use `p-4`, `gap-6`, etc.

### 6.2 Breakpoints

| Name | Min width | Device | Shell behaviour |
| --- | --- | --- | --- |
| (base) | 360 px | Phone (minimum supported, NFR-USE-02) | Sidebar as drawer; top bar with menu button; 16 px gutters |
| `sm` | 640 px | Large phone / small tablet portrait | As base, 2-column form layouts allowed |
| `md` | 768 px | Tablet portrait | Sidebar collapses to 72 px icon rail; 24 px gutters |
| `lg` | 1024 px | Tablet landscape, small laptop | Sidebar expanded (264 px), collapsible by user |
| `xl` | 1280 px | Desktop POS / office PC | Full layout; detail pages use 2 columns |
| `2xl` | 1536 px | Large monitor | Content max width 1440 px, centred |

### 6.3 App shell

```
┌──────────────┬───────────────────────────────────────────────────────┐
│              │ Top bar 56px: [≡]                      [🔔3] [Avatar]      │
│  SIDEBAR     ├───────────────────────────────────────────────────────┤
│  navy-700    │ Page header: Title (display-md)        [Primary action] │
│  264 px      │ Breadcrumb / tabs                                       │
│              ├───────────────────────────────────────────────────────┤
│  Logo        │                                                         │
│  Overview    │   Content (white background, bordered white cards)     │
│  CỬA HÀNG    │   max-width 1440, padding 24–40                        │
│   Bán hàng   │                                                         │
│   …          │                                                         │
│              │                                                         │
│  [User/role] │                                                         │
└──────────────┴───────────────────────────────────────────────────────┘
```

| Element | Spec |
| --- | --- |
| **Sidebar** | `navy-700`; 264 px expanded, 72 px rail, drawer (full height, 288 px, with scrim `ink-900` at 40 %) below `md`. Group labels `overline` in white 56 %. Items 40 px tall (44 px on touch devices), icon 20 px + `body-md` 500 label, white 80 %; hover `navy-800`; active `navy-900` + 3 px `sand-300` left bar + white 100 %. Count badges right-aligned (e.g. orders waiting). The group list follows SRS Appendix C (see Appendix A of this guide). **Sign out** is pinned to the bottom of the sidebar and drawer, below a 1 px `sidebar-border` divider: `LogOut` icon + “Đăng xuất”, same item style; on the 72 px rail the icon only, with a tooltip. |
| **Top bar** | 56 px, white, bottom border `paper-300`. Left: menu toggle (drawer breakpoints only). No global search in the top bar: each list page has its own search field. Right, in order: **connection status** (only when offline – a `warning` pill “Ngoại tuyến”; nothing while online, 13.2), **notification bell**, **user menu** (name, role, own roster/payslips). Sign out is not in the top bar; it sits at the bottom of the sidebar. **No red count badges in the top bar**: red counts appear only on their sidebar menu items or POS buttons (10.5). |
| **Page header** | Title `display-md` (Be Vietnam Pro) left; primary action top-right on desktop, under the title on phones (SRS §5.1), left-aligned and **as wide as its label** – header buttons never stretch across the screen. **Pages opened from another page** (detail pages, form pages such as Thêm sản phẩm mới, Tạo đơn giao, Nhập thêm hàng) have **no breadcrumb** (18 Nov 2026): the header starts with a **back arrow** and the title on one line – `ArrowLeft` 20 px in `navy-700` like the title, in a 40 px round hit area (`aria-label` “Quay lại”, tooltip “Quay lại {trang trước}”), centred on the title's first line, its left edge level with the content below; the title is `heading-md` (16 / 24) on phones and `heading-lg` (20 / 28) from `sm`, wrapping in full when long; 16 px under the header. The arrow goes back to the page the screen belongs to (the list, or the page it was opened from). Top-level list pages keep the `display` title without an arrow; the dashboard keeps its date line above the greeting. |
| **Content** | Background `white`; content in white cards with 1 px `paper-300` border, `shadow-sm` and radius `lg`. |
| **POS mode** | The selling screen hides the sidebar and uses its own full-screen layout (section 13). Its `Menu` button opens the **main menu as a drawer** (the same groups, items and badges as the sidebar), so a cashier goes to any page in one tap; the shift stays open and the selling screen comes back as it was. The registration and shift-open screens and full-screen messages keep a “Thoát” (`LogOut`) link to the shell. |

### 6.4 Page widths and columns

| Page type | Layout |
| --- | --- |
| List | Full content width; table fills the card |
| Detail | `xl+`: 2 columns – main 2/3 (tabs, lines, history) and side 1/3 (status, summary, actions, customer). Below `xl`: single column, summary first |
| Form (create/edit) | Single column max 720 px; long forms split into cards with `heading-lg` titles; sticky action bar at the bottom |
| Settings | Left sub-nav (240 px) + form column max 720 px; sub-nav becomes a select on phones. Cấu hình has a group **“Đặt trước”** after “Bán hàng tại quầy”: Cọc tối thiểu khi đặt sách (%, helper “0 là không bắt buộc cọc”), Giữ sách khi có cọc (ngày), Giữ sách khi không cọc (ngày) – BR-10 |
| Dashboard | 12-column grid, 24 px gap. From `xl` (≥ 1280 px): Tổng quan cửa hàng and Tổng quan thư viện stacked in the left 5 columns, the Doanh thu chart in the right 7 columns at the height of the two cards; below, Tổng quan tồn kho, Sản phẩm bán chạy and Sắp hết hàng on one row (4 + 4 + 4). Below `xl` every card spans 12, in page order (12.5) |

### 6.5 Density

| Mode | Row height | Where |
| --- | --- | --- |
| Comfortable (default) | 52 px table rows, 40 px inputs | Back office on desktop |
| Touch | 52 px rows, 44 px inputs and buttons | POS, check-in, stock count, any device with coarse pointer (`@media (pointer: coarse)`) |
| Compact (optional user setting) | 40 px rows, 36 px inputs | Reports and long lists for experienced staff, desktop only |

Touch targets are never smaller than **44 × 44 px** on touch devices (NFR-USE-02), POS included; POS actions (Giữ giỏ, Xác nhận, payment and dialog buttons) are `lg` 44 px; only the payment keypad keys (52 px) are larger. Buttons smaller than 44 px (`sm`, `md`) grow to 44 px under `pointer: coarse`. Keep sizes modest so phone screens do not feel cramped (27 Oct 2026).

---

## 7. Shape, elevation and motion

### 7.1 Radius

| Token | px | Use |
| --- | --- | --- |
| `radius-sm` | 4 | Badges, chips, checkboxes, table inner elements |
| `radius-md` | 6 | Inputs, select |
| `radius-lg` | 8 | Cards, dialogs, dropdown menus, toasts (matches the palette sheet cards) |
| `radius-xl` | 12 | POS tiles, large panels, bottom sheets (top corners) |
| `radius-full` | 9999 | All buttons (pills), avatars, count badges, status dots, toggles |

### 7.2 Borders

- Default: 1 px `paper-300` (cards, tables, dividers).
- Inputs: 1 px `paper-500`; hover `ink-500`; focus: the 1 px border turns `navy-700`, **no focus ring**; error `danger-700`.
- Never use borders and shadows together on the same resting card – pick the border.

### 7.3 Elevation

Shadows are warm-navy tinted, soft and rare.

| Token | Value | Use |
| --- | --- | --- |
| `shadow-none` | — | Tiles and boxes inside a card |
| `shadow-sm` | `0 1px 2px rgba(34, 52, 79, 0.06)` | Cards and table frames at rest (with their 1 px border, so they read on the white background), sticky table header, sticky action bar |
| `shadow-md` | `0 4px 12px rgba(34, 52, 79, 0.10)` | Dropdowns, popovers, tooltips, toasts |
| `shadow-lg` | `0 12px 32px rgba(34, 52, 79, 0.16)` | Dialogs, drawers, bottom sheets |

Scrim behind dialogs and drawers: `rgba(26, 38, 56, 0.45)`.

### 7.4 Motion

| Token | Duration | Easing | Use |
| --- | --- | --- | --- |
| `motion-fast` | 120 ms | `cubic-bezier(0.2, 0, 0, 1)` | Hover, press, checkbox, toggle |
| `motion-base` | 200 ms | `cubic-bezier(0.2, 0, 0, 1)` | Dropdowns, tooltips, tabs, accordion |
| `motion-slow` | 280 ms | `cubic-bezier(0.2, 0, 0, 1)` enter / `cubic-bezier(0.4, 0, 1, 1)` exit | Dialogs, drawers, bottom sheets, toasts |

- Respect `prefers-reduced-motion: reduce`: replace movement with a fade of ≤ 120 ms.
- **POS:** no animation may delay input. Cart line insertion uses a 600 ms `sand-50` background flash only (no slide).
- New orders in the inbox fade in a `sand-50` highlight that **stays** until the order is opened (FR-ORD-03).

---

## 8. Iconography and imagery

### 8.1 Icons

- Library: **lucide-react** (shadcn/ui default). Stroke 1.75 px, round caps.
- Sizes: 16 px (inline in tables, chips), 20 px (buttons, nav, inputs), 24 px (POS, empty states headers), 48 px (empty-state illustration icon in `ink-300`).
- Icons sit to the **left** of labels; icon-only buttons must have an `aria-label` and a tooltip.
- Icon colour follows the text colour of its context; status icons follow the status tone (section 11).

Key icon assignments (use consistently everywhere):

| Concept | Icon | Concept | Icon |
| --- | --- | --- | --- |
| Scan barcode | `ScanBarcode` | Camera scan | `Camera` |
| Add / create | `Plus` | Search | `Search` |
| Filter | `SlidersHorizontal` | Sort | `ArrowUpDown` |
| Edit | `Pencil` | Delete | `Trash2` |
| Copy | `Copy` → `Check` for 1.5 s after copying | Print | `Printer` |
| Export | `Download` | Import | `Upload` |
| Needs attention | `AlertTriangle` | Error / failed | `AlertOctagon` |
| Success / done | `CheckCircle2` | Info | `Info` |
| Pending / waiting | `Clock` | Scheduled | `CalendarClock` |
| Offline | `WifiOff` | Syncing | `RefreshCw` (rotating) |
| Approval / PIN | `ShieldCheck` | Locked | `Lock` |
| Phone / call the customer | `PhoneCall` | Customer | `User` |
| Money / cash | `Banknote` | Bank transfer | `QrCode` |
| Card terminal | `CreditCard` | E-invoice | `FileText` |
| Shipping | `Truck` | Pickup in store | `Store` |
| Draft | `PenLine` | Published | `Globe` |
| Preview | `Eye` | Revert | `Undo2` |

### 8.2 Imagery

| Item | Spec |
| --- | --- |
| **Book covers** | Aspect ratio **2 : 3**; object-fit `cover`; radius `radius-sm`; 1 px `paper-300` border (white covers disappear without it). Sizes: 40 × 60 (table thumbnail), 64 × 96 (POS search result), 160 × 240 (product detail). |
| **Stationery / other goods** | Square **1 : 1**, object-fit `contain` on white. |
| **Missing image** | `paper-200` box with a centred `BookOpen` (books) or `Package` (other) icon in `ink-300`. Never a broken-image icon. |
| **Event covers** | 16 : 9. |
| **Avatars** | Circle; initials on `navy-100` with `navy-700` text when no photo. Staff only – customers have no photos. |
| **Empty-state illustrations** | Optional simple line illustrations in Navy + Sand + Sky only. If none exist, use a 48 px lucide icon in `ink-300`. |

---

## 9. Design tokens (code)

Put these in `packages/ui/src/tokens.css` and import once in `apps/staff`. Written for **Tailwind CSS v4** (`@theme`) and **shadcn/ui** variable names.

```css
/* packages/ui/src/tokens.css */
@import "tailwindcss";

@theme {
  /* Brand */
  --color-navy-50:  #EEF1F5;
  --color-navy-100: #DCE2EA;
  --color-navy-700: #22344F;
  --color-navy-800: #1A2A41;
  --color-navy-900: #142033;

  --color-sand-50:  #FAF6EE;
  --color-sand-100: #F0E8D8;
  --color-sand-300: #D8C7A6;
  --color-sand-700: #7A6640;

  --color-sky-50:  #EEF4F8;
  --color-sky-100: #DCE8EF;
  --color-sky-300: #A9C4D4;
  --color-sea-500: #7FA3B8;
  --color-sea-700: #3E6680;

  --color-olive-50:  #EEF1E6;
  --color-olive-100: #DDE3CD;
  --color-olive-600: #5B6B3A;
  --color-olive-700: #4A5830;

  /* Neutrals */
  --color-paper-50:  #FBFAF6;
  --color-paper-100: #F5F2EA;
  --color-paper-200: #EDE9DF;
  --color-paper-300: #D9D3C4;
  --color-paper-500: #8C8574;
  --color-ink-300: #A3A9B3;
  --color-ink-500: #5C6675;
  --color-ink-700: #3D4A5C;
  --color-ink-900: #1A2638;

  /* Semantic */
  --color-success-50:  #E7F1EA;
  --color-success-700: #2E6B45;
  --color-warning-50:  #FBF1DE;
  --color-warning-500: #D99A2B;
  --color-warning-700: #8A5A12;
  --color-danger-50:   #F8E9E6;
  --color-danger-700:  #A63A2B;
  --color-info-50:     #E6EFF5;
  --color-info-700:    #2F6385;

  /* Charts */
  --color-chart-1: #22344F;
  --color-chart-2: #7FA3B8;
  --color-chart-3: #5B6B3A;
  --color-chart-4: #C9A15A;
  --color-chart-5: #A9C4D4;
  --color-chart-6: #A63A2B;

  /* Gold tier badge only */
  --color-gold-300: #F6D96B;
  --color-gold-800: #5C4300;

  /* Type */
  --font-display: "Cormorant Garamond", "Times New Roman", serif;
  --font-sans: "Be Vietnam Pro", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --font-code: var(--font-sans);   /* codes: Be Vietnam Pro 500 + tabular-nums */

  /* Radius */
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
  --radius-xl: 12px;

  /* Elevation */
  --shadow-sm: 0 1px 2px rgba(34, 52, 79, 0.06);
  --shadow-md: 0 4px 12px rgba(34, 52, 79, 0.10);
  --shadow-lg: 0 12px 32px rgba(34, 52, 79, 0.16);

  /* Motion */
  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --ease-exit: cubic-bezier(0.4, 0, 1, 1);
}

/* shadcn/ui semantic variables (light theme only in v1) */
:root {
  --background: #FFFFFF;
  --foreground: var(--color-ink-900);
  --card: #FFFFFF;
  --card-foreground: var(--color-ink-900);
  --popover: #FFFFFF;
  --popover-foreground: var(--color-ink-900);
  --primary: var(--color-navy-700);
  --primary-foreground: #FFFFFF;
  --secondary: var(--color-paper-200);
  --secondary-foreground: var(--color-ink-900);
  --muted: var(--color-paper-200);
  --muted-foreground: var(--color-ink-500);
  --accent: var(--color-navy-50);          /* shadcn "accent" = hover surface, NOT brand olive */
  --accent-foreground: var(--color-ink-900);
  --destructive: var(--color-danger-700);
  --destructive-foreground: #FFFFFF;
  --border: var(--color-paper-300);
  --input: var(--color-paper-500);
  --ring: var(--color-navy-700);
  --radius: 0.5rem;

  /* Brand accent – named explicitly to avoid the shadcn "accent" clash */
  --brand-accent: var(--color-olive-600);
  --brand-accent-hover: var(--color-olive-700);
  --brand-accent-foreground: #FFFFFF;

  --sidebar: var(--color-navy-700);
  --sidebar-foreground: rgba(255, 255, 255, 0.80);
  --sidebar-primary: var(--color-sand-300);
  --sidebar-primary-foreground: var(--color-navy-900);
  --sidebar-accent: var(--color-navy-800);
  --sidebar-accent-foreground: #FFFFFF;
  --sidebar-border: rgba(216, 199, 166, 0.20);
  --sidebar-ring: var(--color-sand-300);
}

html { font-family: var(--font-sans); color: var(--foreground); background: var(--background); }
```

> **Naming clash:** in shadcn/ui `accent` means the neutral hover background. The brand’s olive accent is exposed as `--brand-accent` and as a button variant `accent`. Never map shadcn `--accent` to olive.

> **Future dark mode:** v1 is light only. All components must read colours through the semantic variables above (never raw hex or `navy-700` utilities inside components), so a dark theme can later be added by redefining `:root` variables under `[data-theme="dark"]`.

---

## 10. Components

Build on shadcn/ui primitives; restyle with the tokens. Each component lists sizes, states and rules.

### 10.1 Buttons

| Variant | Background / text | Border | Use |
| --- | --- | --- | --- |
| `primary` | `navy-700` / white | — | The main action of a view (“Lưu”, “Tạo đơn”, “Xác nhận”). **One per view.** |
| `accent` | `olive-600` / white | — | Reserved; no screen uses it since 13 Nov 2026 (the POS “Xác nhận” is `primary` navy). |
| `tonal` | `navy-50` / `navy-700`; hover `navy-100` | — | Navigation-style actions that used to be text links (“Xem chi tiết”, “Xem đơn mới”), optional trailing `ChevronRight` |
| `secondary` | white / `ink-900` | 1 px `paper-500` | Other actions (“Hủy”, “Xuất Excel”) |
| `ghost` | transparent / `ink-700`; hover `navy-50` | — | Toolbar and row actions, icon buttons |
| `destructive` | `danger-700` / white | — | Confirm destructive action inside a confirmation dialog only |
| `destructive-outline` | white / `danger-700` | 1 px `danger-700` | Starting a destructive flow (“Hủy đơn”, “Hủy bán”) on a detail page |
**Shape:** every button is a **pill** (`radius-full`) at every size. Actions are never shown as underlined text links; text links are only for references inside running text (for example a requirement link in help copy).

| Size | Height | Padding x | Font | Icon |
| --- | --- | --- | --- | --- |
| `sm` | 32 px | 12 px | `body-sm` 500 | 16 |
| `md` (default) | 36 px | 16 px | `body-md` 500 | 18 |
| `lg` | 44 px | 20 px | `body-md` 600 | 20 |
| `xl` (POS) | 52 px | 24 px | 18 px 600 | 20 |

**States:** hover (one step darker), pressed (two steps darker), focus (ring), disabled (the button keeps its own colours at **40 % opacity** – a disabled “Xác nhận” is faded navy, a disabled secondary is a faded white pill – with no hover or pressed change and `cursor: not-allowed`; a loading button is not faded), loading (spinner replaces icon, label stays, button keeps its width, prevents double submit).

**Rules:** label is a verb (“Lưu sản phẩm”, not “OK”); sentence case; page-header buttons fit their label on every screen size (never stretched to the screen width); full-width buttons are kept only for form action bars, dialog footers on phones and the POS; button order in dialogs and action bars: secondary left, primary right.

### 10.2 Text inputs

| Property | Spec |
| --- | --- |
| Height | 40 px (desktop), 48 px (touch) |
| Text | `body-md` (desktop), `body-lg` 16 px on phones (prevents iOS zoom) |
| Label | Above the field, `body-sm` 500 `ink-700`; required fields marked with `*` in `danger-700` **and** the word “(bắt buộc)” in the accessible name |
| Helper | Below, `body-sm` `ink-500` |
| Error | Border `danger-700`, message below in `danger-700` with `AlertOctagon` 16 px; message replaces helper |
| Placeholder | `ink-500`; an example value, never a substitute for the label |
| Read-only | `paper-200` background, no border change, text selectable |
| Disabled | `paper-200` background, `ink-300` text (inputs and selects; buttons fade instead, 10.1) |
| Select arrow | Every dropdown field shows the same arrow: `ChevronDown` 16 px `ink-500`, **12 px from the right edge** (the browser's own arrow is hidden), text padded 36 px on the right – as on the Tỉnh/Thành phố and Phường/Xã fields and the compact Hình thức dropdown |

Validate on blur and on submit, not on every keystroke. On submit failure, scroll to and focus the first invalid field and show a summary at the top of long forms.

### 10.3 Specialised inputs

| Input | Spec |
| --- | --- |
| **Money (VND)** | Right-aligned, tabular, suffix “₫” in `ink-500` inside the field. Formats with dot thousands separators as you type: `1.234.567`. Integers only (BR-01); pasting “1,234,567” or “1234567đ” is normalised. Mobile keyboard `inputmode="numeric"`. |
| **Quantity stepper** | `[–] 12 [+]`; buttons 40 px (48 px touch), field 56 px wide centred. Long-press repeats. Minimum 1 on sales lines; reaching 0 asks to remove the line. |
| **Percentage** | Suffix “%”, one decimal max; shows the computed VND amount as helper (“= 12.000 ₫”). |
| **Phone** | `inputmode="tel"`; displays grouped `0912 345 678`; on blur, if the number matches a customer, show an inline match card (“Đã có khách hàng: Nguyễn Văn A”) (BR-16). |
| **Search** | **Every search or lookup field in the app has a leading `Search` icon** (20 px, `ink-500`, 12 px from the left edge; text starts at 40 px) – list search boxes, product search, customer search, copy lookup, scan fields and the POS search alike. Clear button `X`, 300 ms debounce. Placeholder names what can be searched. Helper text once per screen: “Tìm không dấu cũng được” (search ignores diacritics). |
| **Barcode / scan field** | Code-style text, the leading `Search` icon like every search field; a `ScanBarcode` icon button at the end of the field (icon only, `navy-700`, no circle or fill; 44 px tap area, hover `navy-50`) opens the camera scanner. Keyboard-wedge input auto-submits on Enter. (FR-POS-10). See 13.3. |
| **Province / ward** | Two linked comboboxes: Province (“Tỉnh/Thành phố”) then Ward (“Phường/Xã”). **No district field** (FR-ORD-06). Ward is disabled until a province is chosen. Both searchable without diacritics. A ward name that occurs twice in the province shows its old district in brackets (“Phường 1 (Quận 3)”) – the only place a district appears (3 Nov 2026). Then a free-text “Địa chỉ cụ thể” line. |
| **Date / date range** | Displays `dd/MM/yyyy`; calendar week starts Monday; Vietnamese month names; range picker presets: Tất cả (lists only), 7 ngày qua, 30 ngày qua, Tùy chọn. |
| **Time** | 24-hour `HH:mm`. |
| **Bilingual text (VI / EN)** | Website content fields have tabs “English” / “Tiếng Việt”, English first and selected by default. **The English description is required** (marked `*`, helper “Bắt buộc bằng tiếng Anh”); the Vietnamese tab is optional (“Không bắt buộc”). A dot on each tab shows whether it is filled. The public API falls back to English when Vietnamese is missing (SRS FR-WEB-22, v1.1). |
| **Slug** | Prefix shows the path (`/trang/`), code style, auto-generated from the EN title without diacritics, editable; inline error for duplicates and reserved slugs (FR-WEB-27). |
| **Rich text** | Minimal toolbar: bold, italic, heading 2/3, bulleted/numbered list, link, image (with required alt text). No colours or fonts (FR-WEB-23). |
| **Image upload** | Drop zone 160 px tall, dashed `paper-500` border, `Upload` icon, “Kéo thả ảnh hoặc chọn tệp”; shows thumbnail, file size, alt-text field (required for website content), remove action. |
| **Secret field** | Masked after save (`••••••••3f9a`), with “Thay đổi” to replace; never shows the full value again (FR-ADM-04). |

### 10.4 Selection controls

- **Checkbox:** 18 px box, radius 4, `paper-500` border; checked `navy-700` fill with white check. Touch hit area 44 px.
- **Radio:** 18 px; checked `navy-700` ring + dot. Use for 2–5 mutually exclusive options; above 5 use a select.
- **Toggle switch:** 40 × 24 track; on = `navy-700`, off = `paper-500`. Only for settings that apply immediately; label states the “on” meaning.
- **Segmented control:** for 2–4 view modes (e.g. Lịch tháng / Lịch tuần, FR-EVT-05). Selected segment white with `shadow-sm` on a `paper-200` track.
- **Select / combobox:** shadcn `Select` for ≤ 10 options, `Combobox` (searchable) above 10. Dropdown `shadow-md`, radius `lg`, option height 36 px (44 touch); selected option `navy-50` + check icon.

### 10.5 Badges and chips

| Type | Spec |
| --- | --- |
| **Status chip** | Height 24 px, radius `sm`, padding 0 8 px, `caption` 500. Tone surface + tone text (section 11). Leading icon 14 px for attention states. |
| **Count badge** | Pill, min-width 20 px, height 20 px, `caption` 600. Default `navy-700` / white; on the navy sidebar `sand-300` / `navy-900`; attention counts `danger-700` / white. Show “99+” above 99. |
| **Filter chip** | 32 px, radius `full`, border `paper-500`; selected `navy-100` background + `navy-700` text + check icon; removable chips show `X`. |
| **Tag** | Free tags (FR-CAT-06): `paper-200` background, `ink-700`, radius `sm`. |
| **Tier badge** | Standard: `paper-200` / `ink-700`; Silver (“Bạc”): `sky-100` / `info-700`; Gold (“Vàng”): **yellow** `gold-300` `#F6D96B` / `gold-800` `#5C4300` + `Star` icon (BR-08; contrast 6.67:1). Gold is used only for this tier badge; it is deliberately a saturated yellow so it never reads as the pale amber `warning` tone. |
| **Channel (order source)** | Source of order (FR-ORD-01) is shown as **plain text only** (“Facebook”, “Website”, “Zalo”) in `body-md` `ink-700`: no colour dot and no icon in tables or lists. The channel colours in 4.7 are for charts only. |

### 10.6 Tables and lists

| Property | Spec |
| --- | --- |
| Container | White card, border `paper-300`, radius `lg`, overflow hidden |
| Header row | `paper-200` background, `body-sm` 600 `ink-700`, 44 px tall, sticky on scroll with `shadow-sm`; header labels never wrap |
| Horizontal scroll | When the table is wider than the screen it scrolls sideways inside the card. The first column (the record code) stays pinned on the left with an **opaque** background (white, `navy-50` on row hover, `paper-200` in the header) and a 1 px `paper-300` right edge, so scrolled cells pass underneath it and never show through. Codes, dates and amounts do not wrap. |
| Body rows | 52 px (comfortable) / 56 (touch) / 40 (compact); divider 1 px `paper-300`; hover `navy-50`; whole row clickable to the detail page (SRS §5.1) with the cursor `pointer` |
| Selected row | `sand-100` + 2 px `navy-700` left edge |
| Unread row | `sand-50` background + 8 px `navy-700` dot before the first cell + text 600 |
| Numeric columns | Right-aligned, tabular |
| Code columns | Code style `code-md` |
| Row actions | Max 1 visible icon action + `MoreHorizontal` menu at the right; on touch always visible (no hover reveal) |
| Bulk actions | Checkbox column; selecting rows **adds** a `navy-50` bar between the search/filter row and the table – the search box and Bộ lọc stay visible so staff can keep finding and ticking rows (27 Oct 2026). The bar reads “Đã chọn 5 sản phẩm” with a `ChevronDown` toggle, the bulk actions and “Bỏ chọn tất cả”. The toggle expands the list of selected rows (name and code, one 44 px row each, at most 3 visible, the rest scroll) with an `X` button on each row to untick just that one (FR-ORD-13). |
| Pagination | 40 rows per page (SRS §5.1, FR-ORD-05); “1–40 trên 1.284” + previous/next + page select, bottom right |
| Phones | Table scrolls horizontally with the first column sticky (SRS §5.1). The Orders and Delivery lists stay tables on phones too. For event check-in and stock count, use a **card list** instead (see 12.2). |
| Empty | Empty state inside the card (10.12) |
| Loading | 8 skeleton rows; keep header visible |

### 10.7 Cards and KPI tiles

- **Card:** white, border `paper-300`, radius `lg`, padding 24 (16 on phones). Header: `heading-md` title left, optional action (ghost button / link) right.
- **KPI tile (dashboard, FR-RPT-01):** label `body-sm` `ink-500`; value `kpi`; delta chip below (“▲ 12 % so với tuần trước”) – positive `success-700`, negative `danger-700`, always with ▲/▼ and text, never colour alone. Optional 32 px sparkline in `navy-700`. Whole tile links to the report.
- **No alert tiles on the dashboard.** Orders waiting, failed e-invoices, pre-orders past their holding period and shift variances are **not** shown on the dashboard. They surface through sidebar count badges, the notification centre and their own lists. (SRS FR-RPT-01 and FR-ADM-08, v1.1.)

### 10.8 Tabs

Underline tabs: 44 px tall, `body-md` 500 `ink-500`; active `ink-900` + 2 px `navy-700` underline; counts in parentheses or as a count badge. Scroll horizontally on phones with fade edges. Use for sections of a detail page, never for steps of a process.

### 10.9 Dialogs, drawers and sheets

| Type | Spec |
| --- | --- |
| **Dialog** | Width 480 (sm), 640 (md), 880 (lg); radius `lg`; `shadow-lg`; padding 24; title `heading-md`; close `X` top-right; footer actions right-aligned (secondary, primary). **Compact title bar and no divider lines** (15 Nov 2026): 16 px above the title row and no padding under it, no rule under the title or above the footer, on every dialog and bottom sheet. Full-screen on phones. `Esc` closes unless there are unsaved changes. |
| **Confirmation (destructive)** | Title states the action as a question (“Hủy đơn #DH-10234?”); body states the consequence (“Tồn kho đã giữ sẽ được trả lại. Không thể hoàn tác.”); buttons “Không” (secondary) and “Hủy đơn” (`destructive`, never just “OK”). For posting/irreversible money actions, require a reason field when the SRS asks for one (voids FR-POS-14, waivers FR-LIB-10). |
| **Approval / supervisor PIN** (FR-ADM-09) | 400 px dialog with `ShieldCheck` icon in a `navy-100` circle; title “Cần quản lý duyệt”; the reason in plain words (“Giảm giá 15 % vượt hạn mức 10 % của bạn”); approver selector + 6-digit PIN pad (13.5) or “Đăng nhập bằng mật khẩu” link; shows lockout after 5 attempts. The approved state shows approver name for 1.5 s, then continues the action. |
| **Filter popover** (SRS §5.1) | Opened by the “Bộ lọc” button; anchored under it, 300 px (max screen width − 32 px), `shadow-md`, radius `lg`. **Each filter field is a dropdown** (accordion row, 44 px): field name left (“Thời gian”, “Trạng thái”, “Thanh toán”), the current choice summary in `ink-500` (“Tiền mặt, Thẻ” or “2 đã chọn”), `ChevronDown` that turns when open. Opening a field shows its options: **multi-select fields have a checkbox in front of each option** (18 px, `navy-700` when checked) so several values can be combined (e.g. Tiền mặt + Thẻ); the time field is single-choice (radio) with presets “Tất cả”, “7 ngày qua”, “30 ngày qua”, “Tùy chọn” (Từ ngày / Đến ngày, store timezone). Changes apply immediately; fields combine with AND, values inside a field with OR. Footer “Xóa bộ lọc” (ghost). Escape or a click outside closes it. |
| **Drawer** | Right side, 480 / 640 px, for quick views (customer preview, order preview from the inbox) without leaving the list. |
| **Bottom sheet** | Phones and tablet POS: radius `xl` top corners, drag handle 32 × 4 px `paper-300`, max height 90 %. **With the on-screen keyboard open** the sheet sits on top of the keyboard, never under it: its bottom edge follows the top of the keyboard and its height is capped at 90 % of the area still visible, so the focused field, the dropdown under it and the footer buttons stay in view (the content scrolls inside the sheet if it is taller). Android Chrome resizes the page with the keyboard (`interactive-widget=resizes-content`); iPhone Safari is followed through the visual viewport. |

### 10.10 Toasts and banners

| Type | Spec |
| --- | --- |
| **Toast** (SRS §5.1) | Bottom-right on desktop, bottom-centre above the action bar on phones; width 360; white, `shadow-md`, radius `lg`, 4 px left border in tone colour + tone icon. Success auto-dismiss 4 s; error stays until dismissed and includes the next step or a “Thử lại” action. Max 3 stacked. Never use a toast for something the user must act on later – use a banner or the notification centre. |
| **Inline alert** | Inside a page or form: tone surface, tone icon, `body-md` text, optional action link. For e.g. “Sản phẩm này đang bị ẩn trên website”. |
| **Page banner** | Full-width under the top bar for system states: offline (13.2), lease expiring, “Có 3 đơn mới” on the inbox (clicking scrolls to top and refreshes, FR-ORD-03), read-only POS tab (TDD §7.4). |

### 10.11 Notification centre

Bell in the top bar with a count badge. Panel 400 px under the bell, `shadow-md`; on phones (below `sm`) it spans the screen width less 16 px each side, 8 px under the top bar, so it never runs off the edge; grouped “Hôm nay / Trước đó”; each item: tone icon, title `body-md` 600, one-line detail, relative time (“5 phút trước”), unread dot; clicking opens the related record. Footer “Đánh dấu đã đọc tất cả”. In-app only (FR-ADM-08). **Items** (18 Nov 2026), each linking to its record: “Đơn {mã} chờ xác nhận” / “Đơn {mã} cần kiểm tra” / “Đơn {mã} yêu cầu trả hàng” (the order); “Phiếu đặt trước mới {mã} · {khách}” (Đặt trước, searched for the slip; info icon); delivery orders, each opening the order – “Đơn giao mới {mã}” (info icon), “Đơn {mã} giao thất bại” (warning), “Đơn {mã} đang hoàn về” (warning), “Đơn {mã} đã hoàn về cửa hàng” (warning), “Đơn {mã} đã giao thành công” (`CheckCircle2`, `success-700`); “Phiếu đặt trước {mã} đã quá hạn giữ” (Đặt trước, searched for the slip); “Ca {số} lệch tiền {số tiền}” (the shift); “Chưa xuất được hóa đơn {mã}” (the sale or order, `danger` icon); “Lô ký gửi {SKU} sắp đến hạn” (Ký gửi); the two backup alerts (Cấu hình); “Cần gọi nhắc trả sách: …” (Mượn / trả, its overdue or due-soon tab). A notification never shows a raw template code.

### 10.12 Empty, loading and error states

| State | Spec |
| --- | --- |
| **Empty – first use** | 48 px icon `ink-300`, title `heading-md` (“Chưa có sản phẩm nào”), one sentence of help, primary action (“Thêm sản phẩm”) and, if relevant, secondary (“Nhập từ Excel”). |
| **Empty – no results** | “Không tìm thấy kết quả cho ‘nguyen nhat anh’”, suggestion “Thử từ khóa khác hoặc xóa bộ lọc”, button “Xóa bộ lọc”. |
| **Loading** | Skeletons in `paper-200` with a gentle shimmer (disabled under reduced motion). Spinners only inside buttons and for actions under 1 s. Never block the whole screen except during sale completion. |
| **Error – page** | `AlertOctagon` in `danger-700`, “Không tải được dữ liệu”, cause in plain words, “Thử lại” button, request id in `caption` code style for support (TDD §3.5). |
| **No permission** | Shouldn’t be reachable from the UI; if a link is opened directly: `Lock` icon, “Bạn không có quyền xem trang này”, “Về trang chủ”. |

### 10.13 Copy-able code display

Used for GHN tracking numbers (FR-ORD-10), pickup codes, registration numbers, sale numbers, bank-transfer payment references and API keys.

```
┌───────────────────────────────────────────────┐
│  Mã vận đơn GHN                                │
│  GHN 5FT8 KQ2L 9X        [ ⧉ Sao chép ]        │
└───────────────────────────────────────────────┘
```

- Label `body-sm` `ink-500`; value `code-xl` (28 px) in `ink-900`, grouped in 4s for reading aloud and hand-writing.
- Copy button `secondary md` with `Copy` icon; after click shows `Check` + “Đã sao chép” for 1.5 s and announces it to screen readers.
- Background `paper-50`, border `paper-300`, radius `lg`, padding 16.

### 10.14 Steppers and timelines

- **Status timeline** (order, pre-order, event registration): vertical list; each entry has a 10 px dot in the status tone, status label 600, time `dd/MM/yyyy HH:mm`, actor and reason (FR-ORD-07). Current status at the top.
- **Wizards** (first-run wizard FR-ADM-02, import wizard FR-ADM-07/FR-CAT-11) show **no step indicator** (17 Nov 2026): no numbered step chips and no “Bước 2/4”. Each step shows only its own content, and its buttons say what comes next (for example “Kiểm tra tệp”, “Chọn tệp khác”, “Xác nhận nhập hàng”).

### 10.15 Calendar

Events calendar (FR-EVT-05) and roster (FR-HR-03): month and week views; today column `sand-50`; event blocks white with a 3 px left border by event type colour (author talk `navy-700`, launch `olive-600`, workshop/class `sea-500`, book club `chart-sand`, children `sky-300`); labels always show title + time. Overlap warnings in `warning-50` with `AlertTriangle`. Roster blocks show shift time and employee; leave shown as hatched `paper-200`.

---

## 11. Status system

Every status is a **chip** (10.5) with a fixed tone and, where marked ⚠, an attention icon. Use exactly these mappings so that a colour means the same thing across modules.

### 11.1 Tones

| Tone | Surface | Text / icon | Meaning |
| --- | --- | --- | --- |
| `neutral` | `paper-200` | `ink-700` | Inactive, finished without fuss, cancelled, draft |
| `brand` | `navy-100` | `navy-700` | Accepted / active in the store’s hands |
| `info` | `info-50` | `info-700` | In progress, scheduled, waiting on others |
| `success` | `success-50` | `success-700` | Completed, paid, available, live |
| `warning` | `warning-50` | `warning-700` | Needs attention soon |
| `danger` | `danger-50` | `danger-700` | Failed, overdue, blocked, lost |
| `accent` | `olive-100` | `olive-700` | Special: reserved for someone, featured |

**Waiting states show no time.** Chips for waiting states (“Chờ chuyển khoản”, “Chờ thanh toán”, “Chờ xuất”, “Chờ xử lý” …) carry only the label and icon: no clock time, no countdown, no elapsed time. Deadlines, when needed, appear in the record’s detail view.

### 11.2 Mappings

**Online / social order** (SRS B.1)

| Status (VI) | Tone | Icon |
| --- | --- | --- |
| New (“Mới”) | info | `CircleDot` + unread row highlight |
| Pending review (“Cần xem xét”) ⚠ | warning | `AlertTriangle`; reason shown beside the chip (FR-ORD-04) |
| Confirmed (“Đã xác nhận”) | brand | `CheckCircle` |
| Packing (“Đang đóng gói”) | info | `Package` |
| Shipping (“Đang giao”) | info | `Truck` |
| Done (“Hoàn tất”) | success | `CheckCircle2` |
| Return requested (“Yêu cầu trả”) ⚠ | warning | `Undo2` |
| Return approved (“Đã duyệt trả”) | info | `RotateCcw` |
| Returned (“Đã trả hàng”) | neutral | `ArchiveRestore` |
| Cancelled (“Đã hủy”) | neutral | `XCircle` |

**Payment** (orders, sales, registrations): Paid (“Đã thanh toán”) success · Unpaid (“Chưa thanh toán”) ⚠ warning · Awaiting transfer (“Chờ chuyển khoản”) ⚠ warning (auto-cancel after 24 h per BR-09; no countdown in the chip) · Unverified transfer (“Chưa xác minh”, offline) ⚠ warning · COD (“Thu hộ”) info · Refunded (“Đã hoàn tiền”) neutral.

**E-invoice** (SRS B.7): Pending (“Chờ xuất”) neutral `Clock` · Sent (“Đã gửi”) info `Send` · Issued (“Đã xuất”) success `FileCheck` · Failed (“Lỗi”) ⚠ danger `AlertOctagon` + “Thử lại” action (FR-POS-17) · Cancelled / Adjusted (“Đã hủy / Điều chỉnh”) neutral.

**Event** (B.2): Draft neutral · Published info · Registration open (“Đang nhận đăng ký”) success · Full – waiting list (“Hết chỗ”) ⚠ warning · Closed neutral · In progress (“Đang diễn ra”) brand · Completed (“Đã kết thúc”) neutral · Cancelled (“Đã hủy”) danger.

**Event registration** (B.3): Pending payment (“Chờ thanh toán”) ⚠ warning `Hourglass` · Confirmed success · Waiting list (“Danh sách chờ”) info `ListOrdered` · Checked in (“Đã check-in”) brand `CheckCheck` · No-show (“Vắng mặt”) neutral · Cancelled / Refunded neutral.

**Library copy and loan** (B.4): copy statuses Available (“Còn”) success · Reserved (“Đã giữ”) accent `BookmarkCheck` · On loan (“Đang mượn”) info · Lost (“Mất”) ⚠ danger · Damaged (“Hỏng”) ⚠ danger. Overdue (“Quá hạn”) ⚠ danger `AlertOctagon` marks a **loan**, never a copy. Language chips: “VN” / “EN” neutral.

**Pre-order** (B.5): Reserved (“Đã đặt”) neutral · Ordered (“Đã đặt NCC”) info · Arrived (“Đã về”) accent `PackageCheck` · Customer contacted (“Đã liên hệ”) info with holding-period countdown, turning ⚠ warning in the last 2 days · Collected (“Đã nhận”) success · Cancelled neutral.

**Website content** (B.6): Draft (“Bản nháp”) neutral `PenLine` · Scheduled (“Đã lên lịch”) info `CalendarClock` with date/time · Published (“Đã đăng”) success `Globe` · Superseded neutral `History` · Reverted (“Đã khôi phục”) warning `Undo2`. A content item with a pending draft over a published version shows both: “Đã đăng” + “Có thay đổi chưa đăng”.

**Promotion** (FR-PRM-04): Scheduled info · Running (“Đang chạy”) success · Paused (“Tạm dừng”) warning · Expired (“Hết hạn”) neutral.

**Stock level**: In stock success · Low stock (“Sắp hết”) ⚠ warning · Out of stock (“Hết hàng”) ⚠ danger · Negative stock (offline conflict) ⚠ danger · Upcoming (“Sắp phát hành”) accent `CalendarClock` (FR-CAT-15).

**Item publication** (FR-CAT-09): Active neutral-free (no chip) · Hidden (“Đang ẩn”) neutral `EyeOff` · Discontinued (“Ngừng kinh doanh”) neutral · Channel icons `Store` (POS) and `Globe` (website), filled when published, outline + strikethrough when not.

**Shift** (FR-POS-18/19): Open (“Đang mở”) success · Closed (“Đã đóng”) neutral · Variance above threshold ⚠ danger with amount (“Lệch −80.000 ₫”).



**Employee** (FR-HR-01): Active success · On hold warning · Left neutral. **Timesheet:** Pending approval warning · Approved success · Locked neutral `Lock`.

**Sync exceptions** (TDD §7.6): all ⚠ warning except `rejected_*` and `approval_revoked`, which are ⚠ danger. Label in Vietnamese, code in `caption` code style.

---

## 12. Screen patterns

### 12.1 List page (SRS §5.1)

```
Sản phẩm                                              [+ Thêm sản phẩm]
[🔍 Tìm theo tên, tác giả, SKU, ISBN…                       ] [≡ Lọc ③]
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ☐ │ SKU           │ Ảnh │ Tên sản phẩm        │ Tồn │ Giá bán  │ Giá nhập │ Trạng thái │ Cập nhật │
│ ☐ │ SACH-NNA-0012 │ ▯   │ Cho tôi xin một vé… │  14 │ 98.000 ₫ │ 61.000 ₫ │ ● Còn hàng │ 27/10/2026 │
└──────────────────────────────────────────────────────────────────────┘
                                         1–40 trên 1.253   ‹  1  2  3 … ›
```

- One search box and, directly beside it on the same row, one **Bộ lọc** button – on every screen size. **No filter chips are shown above the table** on any screen size (27 Oct 2026): every filter (status, payment method, …) lives inside the Bộ lọc button. The button is a secondary pill with the `ListFilter` icon and the label “Lọc” (icon only below 640 px), plus a count badge of active filters. It opens a filter popover (10.9) listing each filter group with its options (counts where the SRS asks, FR-ORD-05); choosing an option applies it at once; footer “Xóa bộ lọc”. Lists without a search box show the Bộ lọc button alone at the top left of the table. Secondary actions (Sắp xếp, the primary “Thêm …” / “Tạo đơn”) move to a second row under the title, each as wide as its label. Applies to every list, including the product list (stock-status chips) and the order inbox (order-status chips).
- **Missing image:** imported products without a photo show the `paper-200` placeholder (8.2) and a “Thiếu ảnh” chip (neutral, `ImageOff`); the product list has a “Thiếu ảnh” status chip/filter so staff can work through them (FR-CAT-11).
- **Product list (27 Oct 2026):** header actions “Nhập từ Excel” (opens the import wizard in a dialog on this page, 12.10; the template is downloaded from inside the wizard, so there is no separate “Tải file mẫu” button), “Thêm sản phẩm” – **“Thêm sản phẩm” opens its own page, “Thêm sản phẩm mới” (`/products/new`)**, a form page (12.4) – no detour through stock-in (FR-CAT-01). Fields are grouped in cards with plain titles (layout and field order: 12.4): **Thông tin chi tiết** (one card) – Loại sản phẩm, Tên sản phẩm, SKU, Danh mục, Nhà cung cấp (required select), Nhà xuất bản (books) or Mã vạch (other goods; empty = internal barcode), ISBN, Tác giả, Đơn vị (**plain free text, no suggestions**), Khối lượng, Mô tả; **Giá và thuế** – Giá nhập (required), Giá bán, Thuế VAT (the selling price includes it, BR-02), and once both prices are filled a line “Lãi mỗi sản phẩm: 25.000 ₫ (25%)” (selling price − cost, share of the selling price; `danger-700` when negative); **Tồn kho** – Số lượng nhập lần đầu (required, at least 1), Tồn tối thiểu; when the chosen supplier takes consignment a “Hàng ký gửi” tick appears and, ticked, Chiết khấu thỏa thuận (%) and Hạn đối soát / trả hàng – the opening quantity then enters as a consignment stock-in; **Ảnh sản phẩm**. Labels are short, with no notes in parentheses (hints go in helper text). Required (FR-PUR-02): SKU, Tên sản phẩm, Danh mục, Nhà cung cấp, Mô tả, Giá nhập, Giá bán, Khối lượng, Số lượng nhập lần đầu, Ảnh sản phẩm (one photo; the card says “Bắt buộc một ảnh (JPG, PNG hoặc WebP).”; FR-PUR-02). Sticky action bar: “Hủy” (back to the list) and **“Thêm sản phẩm mới”**; afterwards the product detail page opens. Saving creates the product and its first stock-in together (FR-PUR-02): one `SI` entry from the chosen supplier for Số lượng nhập lần đầu at Giá nhập (FR-PUR-04), or a consignment stock-in when “Hàng ký gửi” is ticked. The search box is the standard one (icon vertically centred, no hint line under it). **Bộ lọc** groups: Tồn kho (multi: Còn hàng, Sắp hết, Hết hàng), Loại (multi: Sách, Văn phòng phẩm, Sản phẩm khác, Combo), Phân loại (multi: the category tree, children indented under their parent; when Loại is set only categories holding items of those types are offered), Trạng thái (multi: Đang bán, Ẩn, Ngừng bán), Ảnh (Thiếu ảnh). **Columns:** checkbox, **SKU** (first, code style), Ảnh, Tên sản phẩm (with author/brand), **Kệ** (the shelf's name, “—” when none; Bộ lọc has a Kệ group), Tồn (on hand; bundles show what their components allow), Giá bán, Giá nhập (average cost – only with `catalog.view_cost`, otherwise the column is omitted), Trạng thái, Cập nhật (date of the last change to the product or its variant). **Bulk barcode printing (FR-CAT-13):** ticking rows (or the header checkbox for the page) shows the bulk bar (10.6) “Đã chọn 5 sản phẩm · [In mã vạch]”; “In mã vạch” opens the label dialog (Mẫu nhãn, Khổ giấy, Bắt đầu từ ô số, Số nhãn mỗi sản phẩm – default 1, editable per row) and prints one sheet for all selected products. Show the store’s own **SKU only**. SKU and ISBN are different fields: SKU is the code the store assigns to each sellable variant (e.g. `SACH-NNA-0012`, `VPP-0012`); ISBN is the publisher’s book identifier and appears on the product detail page and in search, never in the SKU column. There is **no channel (POS/website) column** in the list; publication channels are shown on the product detail page.
- **Customer list columns:** Khách hàng, Số điện thoại, Hạng, Điểm, Số đơn, Tổng mua, Hoạt động gần nhất (date only, `dd/MM/yyyy`; “—” when none; purchases and library use alike, FR-CRM-02) – short titles; Số đơn, Tổng mua and Điểm right-aligned. **Filters** (Bộ lọc beside the search box, FR-CRM-02): Hạng (multi: Thường, Bạc, Vàng), Hoạt động gần nhất (single: 30 ngày qua, 90 ngày qua, 6 tháng qua, Hơn 6 tháng không hoạt động, Chưa hoạt động lần nào), Dịch vụ sử dụng (single: Tất cả – the default, no filter –, Chỉ mua hàng, Chỉ thư viện), Số đơn (multi: 0, 1, 2–5, 6–10, Trên 10), Điểm (multi: 0, 1–99, 100–499, 500–999, Từ 1.000).
- **Stock list (“Tồn kho”, 27 Oct 2026):** one screen for stock and stock-in – there is no separate “Nhập hàng” menu item or stock-in entry list. Header: the page title only – the total stock value is on the dashboard’s Tồn kho card (22 Nov 2026, 12.5). Search box + **Bộ lọc** with Tình trạng (multi: Còn hàng, Sắp hết, Hết hàng) and Thay đổi gần nhất (single choice: Tất cả, 7 ngày qua, 30 ngày qua, Tùy chọn – products whose latest stock movement falls in the range, store timezone) and Chưa bán trong (single choice: Tất cả, 30 ngày, 60 ngày, 90 ngày – products still in stock with no sale in that time, never-sold included; FR-INV-10). Table like the product list: checkbox, SKU, Ảnh, Tên sản phẩm, Kệ (with a Kệ group in Bộ lọc), Tồn, Tối thiểu, Giá nhập (with `catalog.view_cost`), Tình trạng (chip), Thay đổi gần nhất (date and time of the latest stock movement). Header actions (with `purchasing.manage`): secondary pill **“Nhập từ Excel”** (`FileSpreadsheet` icon), which opens the import wizard for Phiếu nhập hàng in a dialog on this page (12.10, FR-PUR-14), then the primary **“Nhập hàng”** (22 Nov 2026), which opens the Nhập thêm hàng page (12.4). Ticking rows serves **only stock adjustment** (17 Nov 2026): the bulk bar (10.6) reads “Đã chọn n sản phẩm · [Điều chỉnh tồn]”, with the selected list expandable and each one removable; there is no Nhập thêm hàng in it. **Điều chỉnh tồn** opens one dialog listing the ticked products; **each row has its own +/− quantity and its own reason** (Hỏng, Mất, Tìm thấy, Sửa sai số liệu, Tặng/biếu – from the reason-code master data), plus one optional shared note and the write-off tick; there is **no location field** (one stock location, FR-INV-01). Lines over the approval threshold ask for a supervisor PIN one by one (FR-INV-07). Clicking a row opens the product’s **stock page** (`/stock/{product}?v={variant}`): on hand, held and available, average cost, minimum level, and the full movement history (receipts with entry number and supplier, sales, returns, adjustments, counts) with a type filter; actions “Nhập thêm hàng” and “Điều chỉnh tồn”. **Nhập thêm hàng on this page opens a dialog for this product only** (18 Nov 2026, SRS UC-05 1a), not the Nhập thêm hàng page: title “Nhập thêm hàng”, then the product (cover, name, SKU), **Số lượng** as a stepper `[–] n [+]` (minimum 1, starting at 1), **Giá nhập** (with `catalog.view_cost`) and **Giá bán** side by side, prefilled with the current average cost and price, and the **Nhà cung cấp** select (reading “Nhà cung cấp” inside; Hàng ký gửi and its terms for a consignor). Buttons **“Hủy”** and **“Xác nhận”**, exactly the same size: half each on phones, **128 px each from `sm`** (never stretched across the dialog). As on the page, only a changed cost or price is sent. Confirming closes the dialog, refreshes the stock page and shows the toast “Đã nhập kho phiếu {SI-…}.”, plus a `warning` toast when the new cost leaves too little margin. A movement's note is shown only when it is not the same as its document number (a stock-in's note is its entry number, already in Chứng từ).
- **Shift list (“Ca làm”):** search box (shift number or cashier name, accent-insensitive) + Bộ lọc beside it: Quầy (multi, one option per register, e.g. Quầy Q1, Quầy Q2) and Thời gian (single choice: Tất cả, 7 ngày qua, 30 ngày qua, Tùy chọn – by the day the shift opened, store timezone).
- **Promotion list (“Khuyến mãi”):** search box (name, accent-insensitive) + Bộ lọc beside it: Thời gian (single choice: Tất cả, 7 ngày qua, 30 ngày qua, Tùy chọn – shows programs whose run period overlaps the range) and Trạng thái (multi: Đã lên lịch, Đang chạy, Tạm dừng, Hết hạn). Columns: Chương trình (name), Ưu đãi, Áp dụng, Thời gian, Trạng thái. **No row actions:** the whole row opens the editor; “Tạm dừng” / “Chạy lại” live in the editor dialog, in a status row at the top (status chip + secondary pill), hidden for expired programs (FR-PRM-04). The editor has no coupon-code field: a programme applies by itself to the orders that meet its conditions, and to the customers of the tiers picked under Áp dụng › Hạng thành viên (FR-PRM-01/02).
- **POS sales list (“Đơn bán”) filters:** Thời gian (single choice, presets + custom range), Trạng thái (Hoàn tất, Đã hủy – multi), Thanh toán (Tiền mặt, Chuyển khoản, Thẻ – multi) (FR-POS-07).
- **POS sales list (“Đơn bán”) columns:** Mã đơn, Thời gian, Khách hàng, Thu ngân, Thanh toán, Tổng tiền, Trạng thái. Trạng thái shows the sale status only (Hoàn tất / Đã hủy); the e-invoice chip (“Chờ xuất”, “Đã xuất”, …) is **not** shown in the list – it appears on the sale record. Failed e-invoices still reach staff through the notification centre and the menu badge (FR-ADM-08).
- Rows needing action sort first where the SRS asks (website orders waiting for confirmation on Đơn hàng).
- **Orders list (“Đơn hàng”, FR-ORD-01, 5 Nov 2026):** one table of counter sales and online orders – pre-orders have their own page (12.8) and show here only once collected, as the sale – with no tabs. Columns: Mã đơn (code style, sticky), Loại (Tại quầy / Online), Kênh (Tại quầy, Website, Facebook, … – text, no colour dot), Khách hàng (name + phone), Tổng tiền, Thanh toán, Trạng thái (chip of that order’s own status), Thời gian. Search “Tìm mã đơn, khách hàng, SĐT, mã vận đơn…” with the **Bộ lọc** button: Loại, Kênh, Trạng thái, Thời gian (and Thu ngân, Thanh toán for counter sales). Website orders waiting for confirmation sort first, unread rows highlighted as in 12.9. A row opens the record of its kind: sale record or online order with a primary **“Xác nhận đơn”** button for a website order waiting for confirmation (shown with `online.confirm`). No “new sale” button: counter sales are made at the POS.
- Filters, sort and page persist in the URL so a link or back button restores the view.

### 12.2 Card list (phones and live lists)

For event check-in and stock count on phones. The Orders and Delivery lists are **not** card lists; they are tables (12.1, 12.9).

```
┌─────────────────────────────────────────┐
│ Trần Thị B             [Quá hạn ⚠]      │
│ 0912 345 678                            │
│ Pre-order về · DT-0081                  │
│ [Đã liên hệ]  [Không liên lạc được]     │
└─────────────────────────────────────────┘
```

Card 16 px padding, 12 px gap, whole card tappable; primary line name + status chip; secondary lines `body-sm` `ink-500`.

### 12.3 Detail page

- Header: back link, document code (code style) + status chip, key facts row (customer, total, date, channel), actions right (primary + `MoreHorizontal`). Destructive actions live in the overflow menu or as `destructive-outline`.
- **Phones (< 640 px):** the `MoreHorizontal` overflow button sits on the title row, at the right edge, level with the document code. The other header actions sit **side by side** in one row under the title, left-aligned, each as wide as its label (wrapping to a second row only if they do not fit), primary last. On `sm+` all actions sit at the right of the title with `⋯` last.
- **Sale record:** no action buttons in the header on any screen size – “In lại phiếu”, “Đổi / trả hàng” and “Hủy đơn” are all items of the `⋯` menu on the title row (each shown only with its permission and when allowed; “Hủy đơn” last, `destructive-outline`). The `⋯` button is hidden when no item applies.
- Main column: tabs (Chi tiết / Lịch sử / Thanh toán / Hóa đơn …). Side column: summary card, customer card, status timeline.
- **Responsive:** below `lg` the two columns stack into one column that is never wider than the screen; no card may push the page into horizontal scroll. Line tables inside cards (sale lines, stock-in lines, …) become a stacked list on phones: name and SKU, then “SL × đơn giá” left and the line total right, discount and notes below.
- **Product record:** header keeps “In nhãn” only. Under the title, beside the type/status chips, a **“Bán trên website” toggle switch** (on/off, per variant – prefixed with the SKU when there are several) saves at once; there is no “Tại quầy” control because every item is sold at the counter (FR-CAT-09). Beside it **Kệ** (`MapPin` 16 px) with a compact dropdown (12.8) showing the shelf's name or “Chưa xếp kệ”: it lists the active shelves (and the current one even if no longer used) and moving the item saves at once (FR-CAT-01). Cards top to bottom, each with its own “Sửa” (small tonal pill, `Pencil`) at the top-right: **Thông tin sản phẩm** – photo on the left (first image, thumbnails and “Thêm ảnh” under it; placeholder when none), on the right SKU, Tên sản phẩm, Tác giả, Danh mục, Trạng thái (plus Dịch giả, Năm xuất bản, Số trang, Đơn vị when set), and Mô tả below across the full width (stacked on phones); **Giá bán** – Giá bán, Giá vốn, Lãi mỗi sản phẩm (amount and %), Thuế VAT, with “Lịch sử giá”; “Sửa” opens the price change; **Tồn kho** – Tồn kho, Đang giữ, Có thể bán, Tồn tối thiểu, Mã vạch, Khối lượng; “Sửa” edits minimum stock, weight and barcodes. With several variants the price and stock cards repeat per SKU.
- **Customer record:** header = name with an icon-only “Sửa” button (`Pencil`, ghost, `aria-label` “Sửa”) placed directly beside the `⋯` button on the title row, on every screen size. **No tabs**: the main column is one card “Mua hàng” (purchases with totals, FR-CRM-03) followed by one card “Điểm” (points ledger, latest 50, with “Điều chỉnh điểm”); the side column is the “Hồ sơ” card (phone, email, birth date, tier, points). There is no store credit anywhere on the page.
- **Sale record – Hóa đơn điện tử card** (FR-POS-15..17): always shown on a completed sale. Facts: Trạng thái (chip, or “Chưa xuất” when there is no invoice yet), Số hóa đơn, Người mua, Gửi email. Actions: “Xuất hóa đơn” (primary pill, `FileText`) when there is no invoice yet or it is still pending – it opens a dialog for the buyer’s details (Tên người mua / đơn vị – required; Mã số thuế, Địa chỉ, Email – optional; with email the invoice is emailed, FR-POS-16) and queues the invoice; “Gửi lại cho khách” (secondary) on an issued invoice to add buyer details or email it; “Thử lại” on a failed one (with `einvoice.manage`). Hidden on voided sales and on cancelled/adjusted invoices.
- Sensitive values (cost, margin, payroll) are omitted entirely without permission – no “hidden” placeholders (TDD §10.3).

### 12.4 Forms

- Single column, grouped in cards; labels above fields; related short fields side by side on `sm+` (e.g. Cost / Selling price).
- **Sticky action bar** at the bottom (white, `shadow-sm` top, 64 px): “Hủy” secondary, primary right. On phones full-width primary.
- Unsaved-changes guard on navigation: dialog “Bỏ các thay đổi chưa lưu?” with “Tiếp tục chỉnh sửa” / “Bỏ thay đổi”.
- **Import from Excel** (FR-CAT-11, FR-PUR-14): the Products screen and the Stock-in screen each have a secondary pill button “Nhập từ Excel” next to the primary action, with a “Tải file mẫu” link. On the **product** import the wizard's info box adds one sentence about the optional **Tồn đầu kỳ** column: “Cột Tồn đầu kỳ chỉ dùng cho hàng cửa hàng đang có sẵn (không ghi nhà cung cấp). Hàng mới mua từ nhà cung cấp hãy nhập ở trang Tồn kho.” It opens the import wizard (12.10). The template has **separate columns for SKU and ISBN** (SKU required, ISBN optional); they are never merged. In the preview table and every list, only **SKU** is shown as the code column; ISBN appears only on the product detail page. Stock-in preview: one header card “1 phiếu nhập · 48 dòng · 6 sản phẩm mới · tổng giá nhập …”, rows tagged “Sản phẩm mới” (accent chip) or “Cộng tồn” (neutral), new products without an image tagged “Thiếu ảnh” (neutral, `ImageOff` icon – a reminder, not an error), error rows in `danger`, margin warnings in `warning`; “Xác nhận nhập hàng” posts the whole file as one entry.
- **Thêm sản phẩm mới:** its two parts are **framed so they read apart** – one white card (border `paper-300`, `shadow-sm`, radius `lg`, padding 24) titled **Thông tin chi tiết**, and one for **Giá và thuế and Tồn kho** (each under its title, `body-lg` 600, 32 px apart inside the card) (22 Nov 2026). **On wide screens (`lg`) it uses two columns like the selling screen:** at the left the product details in this order – **Loại sản phẩm** first, on one line: the label in the left half (`body-md` `ink-700`) and the select filling the right half, **as wide as the fields below it** (the same two-column grid), then **Tìm sách** under it when Loại is Sách, then **Tên sản phẩm on a line of its own** (full width), **SKU with Danh mục** beside it, **Nhà cung cấp with Nhà xuất bản** beside it (books; for other goods Mã vạch takes that place), ISBN with Tác giả (books), Đơn vị (plain text, no suggestions) with Khối lượng, Mô tả, and **Ảnh sản phẩm last, under Mô tả** – once a photo is chosen (or a cover comes from Tìm sách) it is **shown in full**: a preview up to 240 px high, its whole width visible (`object-contain`, border `paper-300`, radius `md`), with “Chọn ảnh khác” under it – **no helper line under Tác giả or Đơn vị** (their placeholders give an example instead: “VD: Tô Hoài, Nguyễn Nhật Ánh” and “VD: cuốn”); at the right a 400 px column with Giá và thuế (Giá nhập, Giá bán, Thuế VAT and the profit line), Tồn kho (Số lượng nhập lần đầu, Tồn tối thiểu, then **Kệ** – an optional select of the active shelves from Cấu hình › Kệ hàng, “—” for none – and Hàng ký gửi), then **Website** – one row with the text **“Hiển thị trên website”** (`Globe` 16 px, `body-md` `ink-700`) at the left and a **compact switch** at the right (36 × 20 track, 16 px knob, `success-700` when on; the whole 44 px row is the tap area), **off by default**; on, the product is published on the website as soon as it is created (FR-CAT-09) – and under that card the two buttons **Hủy** and **Xác nhận** (saves the product) side by side at equal widths; **the right column stays in place** (sticky, 24 px under the top bar) while the details scroll, so Xác nhận is always in view – there is no action bar fixed to the bottom. On phones and tablets one column in that same order (left column, then right), max 720 px, the two buttons at the end.
- **Book lookup** (FR-CAT-16) on **Thêm sản phẩm mới**, when Loại is Sách: the field right under Loại is **Tìm sách** – a search field (`Search` icon, placeholder “Nhập tên sách hoặc ISBN”; **40 px high like every other field of the form**, 44 px on touch screens, 10.2) with a 44 px `ScanBarcode` icon button at its end (icon only, `navy-700`, no circle, `aria-label` “Quét ISBN”) that opens the camera scanner used on the POS (13.3). Typing at least 3 characters and pausing 400 ms opens a dropdown (`shadow-md`, radius `lg`, full field width, at most 8 rows) – each row a 32 × 48 px cover (grey placeholder with `BookOpen` when none), the title (semibold, two lines at most), then “tác giả · NXB · năm” in `body-sm` `ink-500`; arrow keys and Enter pick a row. Typing or scanning a valid ISBN looks it up directly and fills the form when there is exactly one result. States: a small spinner in the field while searching; “Không tìm thấy sách. Nhập thông tin bên dưới.” in the dropdown; “Không tra cứu được lúc này. Nhập thông tin bên dưới.” (`warning-700`) when the service is unavailable. Picking a result fills **only empty fields** – Tên sản phẩm, ISBN, Tác giả, Nhà xuất bản, Mô tả, Ảnh sản phẩm – silently: no “Tự điền” chip, no “Dữ liệu từ Open Library” line and no helper under Mô tả (15 Nov 2026); the cover shows as “Ảnh bìa”. A publisher not yet on file shows in the Nhà xuất bản select as “NXB mới: Penguin” and is created on save. The cover is downloaded into the Ảnh sản phẩm card (replaceable as usual). Under the Tìm sách field a `caption` line “Dữ liệu từ Open Library” appears once something has been filled. Nothing else changes: the required fields, prices and stock stay the staff’s to enter.
- **Quick stock-in** (FR-PUR-03): “Nhập thêm hàng” is **its own page, `/stock/in`** (17 Nov 2026), not a dialog: a form page with a sticky action bar at the bottom that **uses the full width of the content area** (18 Nov 2026 – no 720 px cap): the search row stretches across it, and the product rows are **one column on every screen**, all inside **one box titled “Sản phẩm đã chọn”** (below). **Its header is one row** (18 Nov 2026): a back arrow and the title “Nhập thêm hàng”, nothing else – no breadcrumb text. The title is smaller than a page title: `heading-md` (16 / 24) on phones, `heading-lg` (20 / 28) from `sm`, `navy-700`. The arrow (`ArrowLeft`, 20 px, `navy-700` like the title, in a 40 px round hit area, `aria-label` “Quay lại”) and the title share one line, centred on each other, the arrow's left edge level with the content below; it goes back to Tồn kho. The page opens only from the primary **Nhập hàng** button in the Tồn kho page header (with `purchasing.manage`) it opens empty with a search field on top – placeholder **“Nhập SKU/tên sản phẩm”** (short enough never to be cut off, like the POS search), with a 48 px `ScanBarcode` icon button at its end, as tall as the field and level with it (icon only, `navy-700`, `aria-label` “Quét mã”) that opens the continuous camera scanner (13.8); a handheld scanner types into the field and ends with Enter. Each product picked or scanned adds one line (the same product again adds 1 to its quantity), so products are entered one at a time into one entry; the scanner's result card reads “Đã thêm · {tên} · SL {n}” (`success`). **A code that matches no product is not added**: the scanner's result card reads “Sản phẩm mới – không nhập được” (`warning`) with the code and “Tạo sản phẩm ở trang Thêm sản phẩm mới.”, and on the page an inline `warning` alert under the search field reads “Mã {code} chưa có trong danh mục. Đây là sản phẩm mới – hãy để riêng và tạo ở trang Thêm sản phẩm mới.” until the next scan. Nothing else is recorded and the Tồn kho page has no other control for it. Neither way has new-product lines (a new product is created on “Thêm sản phẩm mới”, optionally with an opening quantity, 12.1); **each product row follows the POS cart line (13.2) and nothing on it is ever cut off** (18 Nov 2026): a small photo at the left (32 × 48 px cover for a book, 32 px square otherwise, grey placeholder when none); beside it the name in full (`body-md` 600, wrapping onto as many lines as it needs, never truncated or ellipsised), and under the name one row with the SKU at the left (`body-sm` `ink-500`, wrapping if long) and the quantity stepper at the right – bare `Minus` / `Plus` icons 16 px `ink-700` around a 40 × 32 px numeric field, the same as the POS cart. There is **no remove button**: pressing `Minus` at 1 asks “Bỏ {tên} khỏi phiếu?” (“Bỏ” / “Không”). **Tapping the row** (anywhere but the stepper) opens it below, with a `ChevronDown` that turns up: **Giá nhập** and **Giá bán** side by side, prefilled with the current average cost and the current price; Giá nhập shows only with `catalog.view_cost`. Untouched values are not sent: the stock enters at the current average cost and the price stays. A changed Giá nhập puts this stock in at that cost (the average is recalculated); a changed Giá bán updates the price and its history. Margin warning inline (`warning-50`) under the two fields when the cost is not below the price. **All rows sit in one box** (18 Nov 2026): a thin `paper-300` border, radius `md`, its title **“Sản phẩm đã chọn”** (`heading-sm`, 14 / 20, `ink-900`) in a 12 px-padded header row with a divider under it; the rows inside have no border of their own – 12 px padding each, separated by 1 px `paper-300` dividers. The box shows only when there is at least one product (otherwise the empty state); the page has no card borders otherwise. **Lean layout** (18 Nov 2026): the **search row comes right under the title** (16 px), then the “Sản phẩm đã chọn” box 12 px below it; there is no separate heading above the search. The supplier select has **no label above it** – it reads “Nhà cung cấp” in `ink-500` inside until a supplier is chosen (the label stays for screen readers). **Where the supplier is chosen:** on **phones** (below `sm`) it is not on the page at all – “Xác nhận” first opens a dialog **“Chọn nhà cung cấp”** with the select (and Hàng ký gửi and its terms for a consignor) and the buttons “Quay lại” (secondary) and “Xác nhận” (primary), the same size; the supplier stays optional (SRS FR-PUR-04), so confirming with none chosen posts the entry without a supplier. **From `sm`** the supplier select sits **on the search row, at its right**, 240 px wide and 48 px tall like the search, after the scan button; Hàng ký gửi and its terms, for a consignor, sit under that row. The unknown-code alert sits right under the search row. **Empty state** (18 Nov 2026): with no product on the entry the page shows only a `PackageOpen` icon (48 px, `ink-300`) and “Chưa có sản phẩm nào được chọn” (`body-md`, `ink-500`) under it, centred on the screen – no other help text. The header asks only for **Nhà cung cấp** (plus Hàng ký gửi and its terms for a consignor): there is **no Số hóa đơn NCC and no Ghi chú** – the owner mostly buys in person (17 Nov 2026). The page shows **no money total and no line count**; the sticky action bar holds only **Hủy** (secondary) and **Xác nhận** (primary), **the same size**: each half the width on phones, both 128 px wide from `sm` (18 Nov 2026), as in the product dialog. After confirming, the page shows a result card “Đã nhập {SI-…}” that lists the lines added and any margin or price-change notes, with no total, and the buttons “Nhập tiếp” (secondary, an empty form) and “Xong” (primary, back to where the page was opened from).
- Optimistic concurrency conflict (TDD §3.6): inline alert “Bản ghi đã được người khác cập nhật” with “Tải lại” and a side-by-side diff where practical.

### 12.5 Dashboard (FR-RPT-01)

Order top to bottom: greeting `display-md` (“Chào buổi sáng, Lan”, Be Vietnam Pro) + date; the Tổng quan cửa hàng card; the Tổng quan thư viện card; the Doanh thu chart; Tổng quan tồn kho, Sản phẩm bán chạy and Sắp hết hàng; the other lists (bestsellers, low stock, upcoming events). Tiles the user has no permission for are not rendered – the grid reflows. **Desktop (`xl`, ≥ 1280 px):** a 5 : 7 split – the two overview cards stacked on the left (24 px apart), the Doanh thu chart on the right stretched to their combined height (the plot fills the card; axis text stays 11–12 px whatever the width); below them Tổng quan tồn kho, Sản phẩm bán chạy and Sắp hết hàng share one row (4 columns each, 16 px padding there so “Tổng quan tồn kho” and its button fit on one row; a card the user may not see leaves the others at 4 columns). In the left column the overview cards use 16 px padding and their tiles 12 px, so the three tiles still fit; without the library card the chart simply matches the store card’s height. Below `xl` all cards stack full width.

- **Tổng quan cửa hàng (today only):** one full-width white card titled “Tổng quan cửa hàng”, with a subtext line under the title (`body-sm`, `ink-500`) saying the figures are for today – “Số liệu hôm nay” (no update time; the figures refresh every minute). Inside, three summary tiles on **one row at every width, phones included** (3 **equal** columns at every width – gap 6 px, 12 px on `sm+`; below `sm` the card’s side padding is 8 px) – white, 1 px `navy-700` border at 30 % opacity (≈ #B5BDC8, a touch firmer than the card’s `paper-300` edge so the tiles stand out), radius `lg`, padding 10 × 6 px (16 px on `sm+`). Type scales with the tile (CSS container query units on the tile): label `ink-500` at 9.5 % of the tile’s inner width, clamped 11–14 px; value semibold at 13 %, clamped 11–20 px (about 12 px on a 375 px phone, 19–20 px on desktop), so “985.000 ₫/đơn” still fits on a phone. Labels are kept short so they fit: “Doanh thu”, “Số đơn”, “Trung bình” (today’s revenue ÷ today’s orders), whose amount is followed by a small “/đơn” (regular weight, `ink-500`, 0.7 × the value size, at least 10 px) so the unit sits with the number instead of in the label; if a label ever wraps, values stay aligned at the bottom of the tiles. Below `sm` money values use the compact form (“12,5 tr ₫”) with the full amount as the accessible name; from `sm` the full amount is shown. No week or month tiles; longer periods are read from the charts and reports.
- **Doanh thu (trend):** the whole business – shop and library. The card title “Doanh thu” has a subtext with the current range (“30 ngày qua”, “7 ngày qua”, or “dd/mm – dd/mm/yyyy” for a custom range). Default all series, 30 ngày. The plot area fills the card (at least 224 px high, 160 px from `xl` so the two overview cards set the row height; the cards share any extra height). **Stacked bars** per period: Bán hàng (shop sales, `navy-700`, bottom) and Thư viện (library cash-book receipts less refunds, `olive-600`, on top; 4 px rounded top on the topmost visible segment), left axis in ₫. **Lines** on the right axis (count): Đơn bán (sales orders, `sea-500`) and Phiếu mượn (library loan slips, `chart-4`), 2 px with dot markers up to 92 periods. Ranges up to 92 days group by day, longer ranges by month; every period is plotted, zero where nothing happened. First and last period labels on the x-axis. Legend under the chart lists only the visible series, with the same names: “Bán hàng · Thư viện · Đơn bán · Phiếu mượn”. Hovering a bar shows a tooltip with the period, each visible amount, the total and each count. **Lọc** button (secondary pill, `ListFilter` icon, label “Lọc”) in the card header opens a popover (`shadow-md`, radius `lg`, 280 px) with three groups: **Doanh thu** – checkboxes Tất cả, Bán hàng, Thư viện; **Số đơn** – Tất cả, Đơn bán, Phiếu mượn (“Tất cả” is ticked only when every item of its group is ticked, otherwise it is empty – no mixed state; ticking it ticks the whole group, unticking it clears the group); **Thời gian** – a radio group (round, one choice) – 7 ngày, 30 ngày, Tùy chọn; choosing 7 ngày or 30 ngày applies it at once, choosing Tùy chọn shows Từ ngày / Đến ngày pickers (12 px text, 6 px side padding and a small calendar icon so the full date is never cut off) and an “Áp dụng” primary pill, and the custom range applies on Áp dụng (store timezone, max 366 days, TDD §4.11). Ticking a box or applying a range takes effect at once and keeps the popover open; Escape or a click outside closes it. When any series is hidden the button shows a dot badge. With nothing ticked the chart area reads “Chọn ít nhất một mục để xem.” The choice is kept for the session.
- **Tổng quan tồn kho** (with `inventory.view`): a card titled “Tổng quan tồn kho” (no subtext) with a round icon-only tonal button in the header (32 px circle – 44 px on touch screens, keeping the 44 px touch target round –, `navy-50` / `navy-700`, `ArrowUpRight` 18 px with a 2.5 px stroke so it reads clearly in the circle, `aria-label` and tooltip “Chi tiết”) that opens Sản phẩm; the button always stays on the title’s row, on phones and desktop alike (the title is cut with an ellipsis rather than the button wrapping). Body: a **donut** (ring 16 px thick, 2 px white gaps between segments, rounded segment ends, about 168 px across, 144 px on phones) with the total units in the centre (`kpi` value, “sản phẩm” `caption` `ink-500` under it), and a legend beside it (below it on phones and in the narrow desktop column if it does not fit): a 10 px dot, the type name, then the units (`ink-500`) and the share in % (`ink-900`, semibold, right-aligned). Types and colours: Sách `chart-1` (navy-700), Văn phòng phẩm `chart-2` (sea-500), Khác `chart-3` (olive-600); bundles are not counted. Units are on hand now (not a date range, so no filter). Hovering a segment shows its type, units and share. With no stock: “Chưa có dữ liệu.” Under the body, with `catalog.view_cost` only (22 Nov 2026), a row above a `paper-300` rule: “Giá trị tồn kho” (`body-sm`, `ink-500`) left and the total stock value at cost right (`ink-900`, semibold, tabular).
- **Tổng quan thư viện** (FR-LIB-15a, with `library.lend`): sits right under Tổng quan cửa hàng and is built the same way – one full-width white card, the title with a subtext line under it, three equal bordered tiles on one row at every width (same padding, scaled type and compact-money rule as Tổng quan cửa hàng). The subtext follows the period setting (Cài đặt › Thư viện): “Số liệu hôm nay”, “Số liệu tuần này”, “Số liệu tháng này”. Tiles: **Doanh thu** (amount collected in that period, cash-book receipts less refunds; regular `ink-900`), **Đang mượn** and **Quá hạn** (copies; the number is followed by a small “cuốn” styled like “/đơn”; Quá hạn turns `danger-700` when above 0). Each tile is a link (border `navy-700` at 30 % like the store tiles, full `navy-700` on hover): Doanh thu → Mượn / trả showing all slips created in that period, Đang mượn → Mượn / trả, Quá hạn → Mượn / trả filtered Quá hạn. There is no Tổng (copies) tile on the dashboard. Below the tiles, when there are overdue loans, the table “Sách mượn quá hạn” (Sách, Người mượn, Trễ) and a “Xem chi tiết” pill. Mượn / trả keeps its own four-figure card at the top (13.8): Tổng (copies, all but lost) → Quản lý đầu sách, Đã thu trong tuần (`success-700`; the label follows the period setting – “Đã thu hôm nay”, “Đã thu trong tuần”, “Đã thu trong tháng”), Đang mượn, Quá hạn, in a 2 × 2 grid (4 across on `xl`), without the table.
- **Lists** have a column header row (`caption`, `ink-500`): Sản phẩm bán chạy (top 10 by units sold this month, from the 1st) – “#”, “Sản phẩm”, “SKU”, “Đã bán”; Sắp hết hàng – “Sản phẩm”, “SKU”, “Còn / Tối thiểu”. On `xl`, where the two lists sit in narrow cards beside Tổng quan tồn kho, the SKU column is hidden; long product names are cut with an ellipsis and shown in full on hover. Below the Sắp hết hàng table, right-aligned, a tonal pill button “Xem chi tiết” opens the product list filtered to low stock.

### 12.6 Reports

- One page per report area, each its own sidebar item under BÁO CÁO (Appendix A): **Doanh thu** (`/reports/sales`: revenue over time, by product, by customer), **Kho & nhập hàng** (`/reports/inventory`: stock on hand, movements, stock-ins – count variances live on each stock count, consignment stock on Ký gửi, slow-moving stock is the Chưa bán trong filter on Tồn kho), **Thuế & kiểm toán** (`/reports/tax`: output VAT, e-invoice register, shifts and cash variance). `/reports` opens Doanh thu (named so it is not confused with the POS item “Bán hàng”). Event, library, customer and HR report pages are added with those modules.
- **Report pages list report names, not tables** (22 Nov 2026). Each page shows its reports as rows in one white bordered box, parted by hairlines: the report name (`body-md` 600, `ink-900`) with a one-line description under it (`body-sm`, `ink-500`), a `Download` icon (18 px, `ink-500`) at the right; the whole row is the target (min 56 px, `navy-50` on hover). Doanh thu: Theo thời gian, Theo sản phẩm, Theo khách hàng, Theo kênh (FR-RPT-02, FR-SOC-02); Kho & nhập hàng: Tồn kho hiện tại, Nhập – xuất – tồn, Phiếu nhập hàng; Thuế & kiểm toán: Thuế GTGT đầu ra, Hóa đơn điện tử, Ca làm và chênh lệch tiền. No table, chart or totals on screen.
- **Tapping a report opens a small dialog** titled with the report name: the description, then a **Thời gian** field – the list time options (7 ngày qua, 30 ngày qua, Tùy chọn with a date range; no “Tất cả”), default 30 ngày qua – and, at the bottom, **Hủy** and **Xuất Excel** (primary, same size). Snapshot reports (Tồn kho hiện tại) have no Thời gian field and say the file holds stock at the time of export. Xuất Excel downloads the file and closes the dialog; an error shows in the dialog. Without the export permission the rows are not shown and the page says “Bạn chưa có quyền xuất báo cáo.” (FR-RPT-10).
- The Excel file keeps what the on-screen table used to show: the report title and period, the columns, the totals row (bold) and, for Theo thời gian, rows per day – or per month when the range is longer than 92 days. Rows about a product keep SKU and product name as two columns. Margin and profit columns appear only with the profit permission. There is no CSV export for reports. PDF uses the print layout in section 16 when built.
- Báo cáo ca làm (the shift list) keeps its own layout.
- **Báo cáo thư viện** (`/reports/library`, 23 Nov 2026): period figures only, in **three cards** – no tile grid. The header row has the title and, at its right, a labelled period button (“30 ngày qua” with `ChevronDown`, the 36 px outline style of CompactSelect) that opens the list time options (7 ngày qua, 30 ngày qua, Tùy chọn; no “Tất cả”). Cards, stacked on phones, side by side from `lg` (Mượn trả and Tiền thu in one row, Sách được mượn nhiều under them at full width):
  - **Mượn trả trong kỳ** – Lượt mượn as the large figure (`kpi`), then one `body-sm` `ink-500` line “Gia hạn 0 · Trả 12 · Người mượn 3”.
  - **Tiền thu trong kỳ** – the total collected (loan fees + late fees + loss/damage charges) as the large figure, then rows label left / amount right: Phí mượn, Phí trễ, Phí mất, hỏng, and Đã miễn (`ink-500`, not part of the total).
  - **Sách được mượn nhiều** – top 5: rank, title (one line, ellipsis), loans at the right; no call number.
  Not on this page: Đang cho mượn / Đang quá hạn (dashboard Tổng quan thư viện and Mượn / trả) and copies by status (Quản lý thư viện).

### 12.7 Website content management (FR-WEB-23..45)

- Every content list shows a status chip (11.2) and “Cập nhật bởi … lúc …”.
- Editing screens have a top bar: status chip, “Xem trước” (secondary, `Eye`), “Lưu nháp” (secondary), and – with publish permission – “Đăng” split button (Đăng ngay / Lên lịch…). Without `web.content.publish` the “Đăng” button is not shown and the user saves drafts only (FR-WEB-43); there is no separate “send for approval” step in the SRS.
- **Collection rule builder** (FR-WEB-29/31): rows of “[Danh mục ▾] [là ▾] [Thiếu nhi ▾] [+ gồm danh mục con]” joined by an AND/OR segmented control; a live preview card on the right: “Khớp 128 sản phẩm” + 6 cover thumbnails, refreshed as rules change; empty match shows a warning.
- **Home sections** (FR-WEB-33/34): ordered list of section cards with drag handle **and** up/down buttons (keyboard and touch accessible); each card shows type icon, title, source, item count and a show/hide toggle. Range errors inline (“Từ 4 đến 16 sản phẩm”).
- **Menu editor** (FR-WEB-35): two-level tree with the same reorder controls; counters “6/8 mục cấp 1”.
- **Publish queue** (UC-29): list of draft changes with checks; blocking problems as `danger` rows that disable publishing, warnings as `warning` rows with “Bỏ qua kèm ghi chú”. Broken/empty targets flagged with `AlertTriangle` (FR-WEB-36).
- There is deliberately **no visual page designer**; previews open the front end’s preview mode in a new tab.

### 12.8 Pre-orders (“Đặt trước”, FR-ORD-14, FR-ORD-16, FR-POS-09)

- **Menu:** its own item under Bán hàng (`CalendarClock`), shown to everyone who sells (`sale.create`). Badge: order slips Chờ nhận plus overdue holds.
- **List page:** title “Đặt trước”, header button “+ Thêm” – the only place a slip is taken (the selling screen has no Đặt trước button). One list, no tabs or view switch. Search “Tìm mã phiếu, khách, SĐT, tên sách, ISBN…” (typing a book’s ISBN or barcode finds its slips; **no scan button** on this page) and the **Bộ lọc** button on the same row: Trạng thái (multi: Chờ xác nhận, Đang đặt hàng, Chờ nhận, Đã nhận, Đã hủy; by default the three open ones). Columns: Mã phiếu (code), Khách hàng (name + phone), Sách (first title “+ n”), Đã cọc, Trạng thái (chip only; no separate Giữ đến column). **Slip statuses (15 Nov 2026, SRS B.5):** **Chờ xác nhận** (warning), **Đang đặt hàng** (info), **Chờ nhận** (success; a hold is Chờ nhận as soon as it is taken), **Đã nhận**, **Đã hủy** (neutral). No next-step text under the chip. A row opens the slip.
- **Slip dialog:** a compact title bar without a divider line, then a label/value list – Trạng thái (chip), Khách hàng, Điện thoại (call link), Tổng tiền (— while a free-text book is not linked), Đã cọc (amount, with the method under it in 13 px `ink-500`; — when none), Thời gian (when the slip was taken), then Hạn giữ (`danger-700` when past) and Ghi chú when they apply – labels left, values right; then the lines (title with “x1” quantity under it, the line amount at the right or — while it has no price; a free-text line in italics). An empty value is always an em dash, never words. **Only two actions**, side by side, text only (no icons): **Hủy phiếu** (`destructive-outline`; with a deposit: `preorder.manage`, reason and Hoàn cọc / Giữ cọc) and **Cập nhật** (`primary`), both only on an open slip; a slip is never edited (no Sửa, Báo giá, Đã liên hệ, Gia hạn or Nhận hàng buttons). **Cập nhật** opens a small dialog “Cập nhật trạng thái”: a **Trạng thái dropdown** (select) with Chờ xác nhận, Đang đặt hàng, Chờ nhận, Đã nhận (a hold offers only Chờ nhận and Đã nhận); with **Chờ nhận**, on an **order** slip and for users with `online.manage`, two **round radio ticks** (18 px, `navy-700` when checked) **Nhận tại quầy** (default) and **Giao hàng** – a hold shows no choice, it is collected in store; with Giao hàng, “Xác nhận” sets the slip Chờ nhận if needed and opens **Tạo đơn giao** filled from the slip (12.9); choosing Chờ nhận or Đã nhận on a slip with free-text books shows, under each one, a product search to link it (no explanatory line; the line then shows the product's selling price); the footer button **“Xác nhận”** saves, and for Đã nhận it reads “Nhận hàng tại quầy” and opens the POS with the slip in the cart (the sale marks it Đã nhận). Once a slip has been handed to delivery, the slip dialog shows a **Đơn giao** row with the order code as a link to the order.
- **Form “Phiếu đặt trước”** – “+ Thêm” on this page opens it as **its own page** (`/preorders/new`, not a dialog): back-arrow header “Phiếu đặt trước” returning to Đặt trước, the form straight on the page, **no card frame** (max 720 px wide below `lg`), laid out like the selling screen: **on wide screens (`lg`) it uses the selling screen's two columns** – at the left the product search and the customer row, at the right a 420 px column with the Thông tin sản phẩm card filling the height and the Hủy / Xác nhận row under it, the page exactly the window height; on phones the page is exactly the screen height and never scrolls: the **Thông tin sản phẩm** card stretches to fill the space left and its lines scroll **inside the card**, so nothing ever passes under the buttons; at the bottom, 12 px under the card, the **order bar** – **no top border, no shadow**, on the page's white like everything else; from `sm` it sits at the foot of the form – holding only two buttons at equal widths: **“Hủy”** (secondary) and **“Xác nhận”** (primary). Xác nhận first checks the customer and the books (errors show on the page, above the bar, and clear as soon as the customer or a book is added), then opens the **Thu cọc** dialog, which saves the slip – as Xác nhận opens the payment dialog on the selling screen (13.4). Hủy drops the slip being written and returns to the list, asking “Hủy phiếu đang tạo?” first when anything was entered; saving or the back arrow also returns to the list. The top of the form is laid out **like the selling screen (13.1)**: the product search field first (placeholder “Nhập SKU / tên sách / ISBN”), under it the customer row – a **“Gắn khách”** pill (small `primary`, `User` 16 px) that opens the same **“Thông tin khách hàng”** dialog as the POS (search by phone or name as you type; no match offers “+ Khách mới với SĐT …” in the dropdown, then Số điện thoại and Tên khách and “Xác nhận”); here a new customer is **not created at once** but with the slip when it is saved, so any cashier can take one; once chosen the row shows the `User` icon, the name 600, the phone under it in `ink-500` (“Khách mới” after the name for a new one) and an ✕ to change – and under it the **“Thông tin sản phẩm”** card (white, bordered, title 14 px 600, filling the height left) holding the lines, or “Chưa có sách nào” centred when empty. The product search: when nothing in the catalogue matches, its dropdown offers “+ Thêm “…” – sách chưa có, cần đặt” (Enter does the same), which adds the typed title or ISBN as a free-text line; there is no second field for books not in the catalogue, and “Thêm sách chưa có” for a free-text line (title or ISBN) – each with quantity and a line hint “Có sẵn – giữ ngay” or “Cần đặt”; then the order bar (Hủy · Xác nhận); there is **no Ghi chú** on the form. **A slip is all on the shelf or all to order:** with both, a warning “Một phiếu chỉ gồm sách có sẵn (giữ sách) hoặc sách cần đặt. Bỏ bớt sách rồi tạo từng phiếu riêng.” sits above the order bar and “Xác nhận” stays disabled. **Thu cọc dialog** (title “Thu cọc”), top to bottom: a row **“Loại phiếu”** (`body-md` `ink-700`) at the left with a **compact dropdown** at the right – a 36 px button (`body-md` 500, border `paper-500`, radius `md`, `ChevronDown` 16 px; tap area extended to 44 px) that opens a small menu under it (`shadow-md`, radius `md`, 44 px rows, the current choice with a `Check`) – **Không cọc** (default) or **Có cọc**; it is a button, not a native select, so it stays at `body-md` on phones without the iPhone zoom; with Có cọc, the label **“Phương thức thanh toán”** (13 px 500 `ink-700`) and the method as round radio ticks centred in three equal boxes – Tiền mặt (default), CK, Thẻ – as on the payment dialog (13.4), then for **every method** the amount keyed as on the selling screen's cash payment: a **Tiền cọc** box (48 px, amount right-aligned, “— ₫” while empty) and the **numeric keypad** (52 px keys, side by side from `sm`); no hint line; then, just above the button, the row **“Giá trị phiếu”** with the value of the catalogue books at the right (20 / 28 px 700 tabular; an em dash “—” when every book is free text); one full-width primary **“Xác nhận”** saves the slip, the ✕ closes the dialog and returns to the form. When every book is on the shelf the deposit is optional and the slip is saved as a hold (“Giữ đến …”). When every book is to order and the minimum (Cấu hình › Đặt trước, counting catalogue books only) is above 0, the deposit is required: the Loại phiếu dropdown is fixed to Có cọc (disabled), the deposit fields show at once and a line **“Tối thiểu {số tiền}”** (`ink-700`) sits under Giá trị phiếu; saving below it shows the error in the dialog. Cash deposits need an open shift.

### 12.9 Delivery (“Giao hàng”) and live website orders (FR-ORD-01..03)

- **Giao hàng** holds only confirmed online orders shipped by carrier (no store pickup, no counter sales or pre-orders). Status chips in the Bộ lọc, under a group named **“Trạng thái”**: Chờ tạo vận đơn, Đang giao, Đã giao, Giao thất bại / Hoàn về. Header: primary **“Tạo đơn giao”** (`Plus`) for social-media and phone orders – one form that saves the order as confirmed and creates the GHN shipment in the same step (FR-ORD-02). **From a pre-order** (FR-ORD-14) the same form opens filled from the slip: an `info` line at the top “Tạo từ phiếu đặt trước {mã} – sách và giá theo phiếu”, the recipient set to the slip's customer (name and phone editable, the customer stays linked), the product lines without the search field and without the − / + steppers, no Giảm giá field, and in Tổng cộng two more rows under Tổng: **Đã đặt cọc** (−amount) and **Còn phải thu** (700) – the amount COD collects or the transfer to confirm. Saving opens the new order as usual and the slip becomes Đã nhận. **Recipient phone:** for a carrier delivery it must be a Vietnamese mobile number (10 digits, 03 / 05 / 07 / 08 / 09); otherwise saving stops with the field error “Số điện thoại người nhận cần là số di động 10 số, bắt đầu bằng 03, 05, 07, 08 hoặc 09.” under Số điện thoại. Cards top to bottom: **Thông tin đơn hàng** – **Nguồn đơn** (the order's source channel; labelled “Nguồn đơn”, not “Kênh”) and Trang / tài khoản stacked, each as wide as the product search (full card width on phones and desktop), then, 20 px below with no divider line, the label “Sản phẩm” over the product search and the lines (each match in the search dropdown shows the **name** with **Tồn N** under it and the **price** at the right – no SKU); **Thông tin giao hàng** – Số điện thoại and Tên người nhận, then, 20 px below with no divider line, the delivery address (Tỉnh/Thành phố, Phường/Xã, Địa chỉ cụ thể – always shown and required: an order made here is always delivered by carrier, so there is no “Giao tận nơi / Nhận tại cửa hàng” choice; a chat customer who wants to collect in store is served at the POS – Đặt trước when the goods must be kept, otherwise a counter sale; FR-ORD-02); then fee, payment and note in the side column. The **Thanh toán** card starts with a row **“Hình thức”** (`body-md` `ink-700`) at the left and a **compact dropdown** at the right (the same 36 px button and small menu as Loại phiếu, 12.8) – **Thu hộ (COD)** (default) or **Chuyển khoản** – instead of two tiles. **Sản phẩm** lines: name and price; on the right the quantity field and the delete button. Stock is not shown; only an out-of-stock product (nothing available) shows a `danger` chip “Hết hàng” under the price. **No per-item discount.** The manual discount applies to the whole order and lives in the **Thanh toán** card as a **“Giảm giá”** row laid out like Hình thức – the label (`body-md` `ink-700`) at the left and the same single percent-only field at the right, **36 × 144 px like the Hình thức dropdown** – and the amount it takes off under it, right-aligned (“= 9.900 ₫”), once one is typed – no standing hint (going over the limit asks a manager at saving, BR-05; shown only with `sale.discount`). **Phí giao hàng** is a row too – the label at the left and a compact money field at the right, **36 × 144 px like the Hình thức dropdown and the Giảm giá field** (all three the same size), amount right-aligned with “₫” after it. The shipping fee field has no standing hint either: only “Đang tính phí GHN…”, a GHN error or “Phí nhập tay.” appear under it. There is no coupon code and no dialog: running promotions apply by themselves (13.1). The Tổng cộng card lists Tạm tính, Khuyến mãi (when any), Giảm giá (when set), Phí giao hàng and Tổng, and ends with the form's two buttons, **“Hủy”** (secondary) and **“Xác nhận”** (primary), side by side at **equal widths** (`lg`, 44 px) – there is no action bar fixed to the bottom of the page. **Khách hàng** shows two fields by default, **Số điện thoại** and **Tên người nhận** (both required, side by side from `sm`). From 4 digits typed in the phone field a dropdown under it lists up to 6 customers whose phone matches (name, phone, tier · points); nothing is listed when none match, and staff carry on as for a new customer. Picking one fills the phone and the name, links the order to that customer and – when they have an earlier delivery order – fills Tỉnh/Thành phố, Phường/Xã and Địa chỉ cụ thể from the most recent one (FR-SOC-03; staff can change them); a customer with no such order leaves the address empty for staff to enter. A line under the fields shows “Khách cũ · tier · points” with “✕ Bỏ liên kết”; changing the phone afterwards unlinks the customer (changing the name does not – the recipient may differ from the buyer). Without a pick the order is saved for a new customer and the server still links a known phone (BR-16). The pre-order form keeps its own customer picker (13.1). The page header has only “+ Tạo đơn giao” – COD reconciliation is its own menu item, **Đối soát COD** (`/orders/cod`, tabs Chờ đối soát · Chênh lệch · Đã khớp, no breadcrumb), whose sidebar badge counts remittances with a difference (FR-ORD-11). Each row of Chờ tạo vận đơn has “Tạo vận đơn”. The sidebar badge on “Giao hàng” counts orders waiting for a shipment.
- **Website orders** arrive in **Đơn hàng** (12.1), live, as described below; the sidebar badge on “Đơn hàng” counts website orders waiting for confirmation. The rules below apply to that list.

- **Layout:** a table (10.6) on every screen size, never a card list. Columns: Mã đơn (code style, sticky first column), Khách hàng (name + phone), **Nguồn đơn** (name only, no colour dot; the Bộ lọc group of the same name), SP (count), Tổng tiền, Thanh toán (chip), Trạng thái (chip + review reason), Thời gian. Above the table: search box (“Tìm mã đơn, người nhận, SĐT, mã vận đơn…”) with the **Bộ lọc** button beside it; on phones the order-status chips (Mới, Cần xem xét, Đã xác nhận, Đang giao …) live inside that filter (12.1). On phones the table scrolls sideways with Mã đơn fixed. Unread rows: `sand-50` + navy dot + bold until opened; rows needing action sort first (FR-ORD-05).
- New arrivals: page banner “Có 3 đơn mới” with a `tonal sm` pill button “Xem đơn mới” (info tone) rather than shifting rows under the user’s cursor; clicking inserts them at the top with `sand-50` highlight.
- Sidebar count badge on “Đơn hàng” for website orders waiting for confirmation plus failed e-invoices (as before), and on “Giao hàng” for orders waiting for a shipment.
- No auto-refresh indicator: nothing is shown under the page title; the list still refreshes in the background.

### 12.10 Import wizard (FR-CAT-11, FR-ADM-07)

Steps: Tải tệp → Kiểm tra → Xem trước → Nhập, with no step indicator on screen (10.14). Download template link on the first step. **On the Products page the wizard opens in a large dialog** (“Nhập sản phẩm từ Excel”, full-screen on phones) with the data type fixed to products – staff never leave the Products page; closing the dialog after a successful import refreshes the list. The standalone “Nhập dữ liệu” page remains for stock-in files and customers. Validation table shows row number, column, value and message; filter “Chỉ hiện dòng lỗi”; “Tải báo cáo lỗi” button. Commit step shows a progress bar and a summary (imported / skipped / errors); rollback action where allowed.

---

### 12.11 Audit log (“Nhật ký thao tác”, FR-ADM-05)

Kept in the menu (CÀI ĐẶT › Nhật ký), rebuilt for the owner, not for a developer (23 Nov 2026):
- **Each row is a Vietnamese sentence**: the person in bold, the action as a verb phrase, the object by its name or number – “**Lan** hủy đơn **HD-2026-00012**”, “**Minh** đổi giá **SACH-NNA-0012 · Normal People**”, “**Lan** đăng nhập” – with the time under it (`body-sm`, `ink-500`, “10:32 · 23/11/2026”). The object is a link when it has a page (sale, online order, product, customer, stock count, library title, library count); other objects are plain text. No codes, ids or IP in the list. Phones and desktop show the same one-column list inside one bordered box, parted by hairlines, 40 rows a page with “Trang trước” / “Trang sau”.
- **Search and filter** like other lists (12.1): the filter button only (nothing to type), with **Người thực hiện** (single choice among staff, “Hệ thống” for actions without a person), **Loại thao tác** (single choice: Bán hàng & đơn, Sản phẩm & giá, Kho & nhập hàng, Khách hàng, Thư viện, Nhân viên & phân quyền, Đăng nhập, Cài đặt & thiết bị, Xuất dữ liệu) and **Thời gian** (the list presets and Tùy chọn). Default: everything, newest first.
- **Tapping a row** opens a dialog titled with the sentence: a table **Thông tin · Trước · Sau** with Vietnamese field names (Giá bán, Trạng thái, Vai trò, Kệ…), money in ₫, rates in %, yes/no as Có/Không, dates as dd/mm/yyyy; only fields that changed when both sides exist; internal fields (search text, version, ids, timestamps) hidden. Under it, small and `ink-500`: “Mã thao tác sale.void · IP 192.168.1.5”.
- An action without a Vietnamese text yet shows “thực hiện `code`” so nothing is hidden.

## 13. POS and touch screens

The POS is the most-used screen. It runs full-screen without the sidebar, on a counter PC (keyboard + scanner), a tablet or a phone (FR-POS-01, FR-POS-10/11).

### 13.1 Selling screen layout

**Desktop / tablet landscape (≥ 1024 px):**

```
┌──────────────────────────────────────────────────────────────────────────┐
│ [≡] Q1                                                  [📅] [🧺 2]     │  56px navy-700
├──────────────────────────────────────────┬───────────────────────────────┤
│ [Nhập SKUs/tên sản phẩm        ] (▥)    │ Khách: [+ Thêm khách]         │
│                                          │ ─────────────────────────────  │
│  Search results / quick tiles            │ Cho tôi xin một vé…            │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐             │ 98.000 ₫         [–] 1 [+]     │
│  │cover│ │cover│ │ Vé │ │Phạt│            │ Bút bi Thiên Long xanh         │
│  │    │ │    │ │sự kiện│ │TV │            │ 6.000 ₫          [–] 3 [+]     │
│  └────┘ └────┘ └────┘ └────┘             │ ─────────────────────────────  │
│                                          │ Thành tiền          116.000 ₫  │
│                                          │ Giảm giá ⌄           −10.000 ₫ │  dropdown
│                                          │ Tổng tiền           106.000 ₫  │  body-md 700
│                                          │ [Giữ giỏ] (    Xác nhận     )  │  primary lg pill
└──────────────────────────────────────────┴───────────────────────────────┘
       left: flexible                            right: cart 400–440 px
```

**Tablet portrait / phone:** one screen, no bottom sheet. Under the search field the white card **“Thông tin sản phẩm”** (the cart lines) fills the remaining height and scrolls. Under it, **fixed to the bottom of the screen**, is the **order bar** – full width, no card frame, white with a `paper-300` top border and `shadow-md` upward, bottom padding for the phone's safe area – so the cart lines get most of the screen and the cashier never opens a second panel. The bar holds the totals list (below) – Thành tiền, Giảm giá, Tổng tiền – and the “Giữ giỏ” / “Xác nhận” row, about 160 px tall. **Wide screens (`lg`)** keep the cart column with two cards, 12 px apart: “Thông tin sản phẩm” and “Giá trị đơn hàng” (the same totals list and buttons). While a search is active the card is replaced by the results; picking a result brings the cart back.

**Totals (cart footer):** three rows, each `body-md` with the label at the left and the amount at the right, then the buttons:

1. **Thành tiền** – the sum of the lines before any discount.
2. **Giảm giá** – a dropdown row: the label is a button “Giảm giá” with a `ChevronDown` 16 px after it (turning up when open), and the total taken off – promotions, the manual discount and points together – at the right (“−9.900 ₫”, `success-700`; empty when nothing is taken off). Tapping it opens, under the row, the discount details; tapping again closes them and keeps every discount: **Khuyến mãi** (when any: automatic promotions, the amount in `success-700` and the name of each running promotion under it in `caption` `ink-500` – there is no coupon code, promotions apply by themselves); **Giảm thêm** – shown with `sale.discount`: **one** small 36 px field, 128 px wide, right-aligned, the percentage with “%” in `ink-500` after it – **percent only**, no ₫ option; typing applies it at once, clearing the field removes it; it applies to the whole order after promotions and going over the limit asks a manager at payment (BR-05); **Điểm** – shown only when a customer is chosen, labelled “Điểm (có 150)”, a tonal sm pill “+ Dùng điểm” that opens the points dialog, or once used “100 điểm” with the amount taken off and an ✕.
3. **Tổng tiền** – label and amount 700, same size as the rows above. For a pre-order two rows follow: Đã đặt cọc and **Còn phải trả** (700).

Then one row with “Giữ giỏ” (secondary) and the primary “Xác nhận” at equal widths. The payment method is **not** in the cart: it is chosen in the payment dialog (13.4). Same on every screen size.

**Area under the search field:** the results (or “Không có sản phẩm phù hợp.”) open as a **dropdown** attached under the search field (shadow, up to 420 px or 60 % of the height, scrolling), over the screen; the cart card under it **does not change** – on tablet portrait / phone it stays where it is, on desktop it is on the right. Picking a result, clearing the field or Escape closes the dropdown. An empty cart, in either place, shows an empty state in the lines area – `ShoppingCart` icon 48 px `ink-300` and “Chưa có sản phẩm nào được chọn” (`body-md`, `ink-500`), centred.

| Element | Spec |
| --- | --- |
| POS header | `navy-700`, 56 px, white text: the register code only (“Q1”, “Q2”; no cashier name, no “Quầy” – the shift number is on the shift report), on phones and desktop alike so it is never cut off; connection pill only when syncing, offline or in error (13.2; no “Trực tuyến” pill while online); two round icon-only buttons (40 px, 44 px on touch screens; `aria-label` and tooltip): **Giỏ chờ** (`ShoppingBasket`) with a count badge of held carts when there are any, and beside it **Đóng ca** (`Wallet`), which opens the shift close (13.6). There is no shift menu and no cash in/out (FR-POS-20 withdrawn); when there are held carts, their list starts with the line “Giỏ chờ không giữ hàng trong kho. Muốn giữ sách cho khách, tạo phiếu Đặt trước.” (an empty list shows only “Chưa có giỏ nào đang giữ.”) **No lock button and no “test offline” button**; the POS still auto-locks after `pos.lock_minutes` (13.5), and the offline state appears only when the connection is actually lost (13.2). |
| Search field | 48 px tall, `body-lg`, placeholder **“Nhập SKUs/tên sản phẩm”**, leading `Search` icon (10.3). It matches SKU, barcode, author and the Vietnamese or English title, without accents (“cho toi” finds “Cho tôi xin một vé đi tuổi thơ”), offline too; results and cart lines show the Vietnamese title when the item has one. A separate 48 px `ScanBarcode` icon button – the icon only, 26 px `navy-700`, no circle or fill (hover `navy-50`) – sits **beside** the field on its right, 8 px gap, not inside it, and opens the camera scanner (13.3). The field stays **focused** after every action so a keyboard-wedge scanner works without clicking (TDD §8.7). Results appear below as a list of 72 px rows showing **only the product photo and name**: the first photo 40 × 60 (cover, `object-cover` for books, `object-contain` for other goods; the `BookOpen` / `Package` placeholder when there is none or it cannot load, e.g. offline) and the name `body-md` 500, two lines max, with the **available stock** under it in `body-sm` – followed, when the item has a shelf, by “· Kệ A3 · Văn học Việt Nam” (the shelf's name, `ink-500`) so staff know where to fetch it – and, when copies are held for pre-orders, “Đang giữ 1 cho Trần Thị B · đến 18/11” in `body-sm` `ink-500` (“Tồn: 12” `ink-500`; “Hết hàng” `danger-700` at 0 or below). The stock is read live while online; offline the stock line is hidden. No author, SKU or price in the list. |
| Quick tiles | 120 × 120 px, radius `xl`, for service items only (event tickets – FR-POS-08). Library fees are not taken at the POS (FR-LIB-09a). No merchandise tiles (e.g. tote bags); goods are added by search or scan. |
| Cart card | Titled **“Thông tin sản phẩm”** (14 px 600 `ink-900`, 12 px top padding) with an icon-only **✕** button (`X` 18 px `ink-700`, `aria-label` “Hủy đơn”) at the right of the same row: it asks “Hủy đơn này?” (buttons “Giữ đơn” and destructive “Hủy đơn”; the cart’s products, customer and discount are cleared; nothing was saved, so nothing is refunded) and then empties the cart. Disabled while the cart is empty, then the lines, then the totals. Same on every screen size. |
| Cart line | Two rows: title `body-md` 600 (2 lines max); unit price `body-sm` `ink-700` below it, with a small stepper at the right of the same row – bare `Minus` / `Plus` icons 16 px `ink-700` (no circle) either side of the quantity in a 32 × 28 px box (`paper-500` border, `radius-sm`, `body-sm` 600 tabular). **No line total** on the line; the order total is in the totals. Each icon button is 32 px wide and 44 px tall (NFR-USE-02); `−` at quantity 1 removes the line. Promotion saving below in `success-700` (“Giảm 10.000 ₫ – Mua 2 tặng 1”, FR-POS-05). **No line menu (`⋯`)**: the price cannot be changed at the POS and there is no per-item discount or line note (FR-POS-02). |
| Customer | Sits on its own row **under the search field**, outside the cart card, on every screen size. “Gắn khách” (small `primary` navy pill, 32 px, `User` 16 px; on touch screens its tap area is extended to 44 px without growing the pill, NFR-USE-02) opens a small dialog titled **“Thông tin khách hàng”** (no divider under the title) with one search field and no label above it: leading `Search` icon, grey placeholder **“Nhập SĐT/tên”** (FR-POS-04). It searches **as you type** (250 ms pause): digits only (≥ 9) look up the exact phone; otherwise, from 2 characters, names without accents. The matches drop down **under the field**, attached to it (**up to 5**; name and phone as 56 px rows, **no points**); tapping one attaches it, Enter takes a single match. There is no “Tìm” button. With no match the dropdown itself offers a new customer, as in the pre-order form (12.8) – one row “+ Khách mới với SĐT {số}” (or “+ Khách mới” after a name), `navy-700` 500, with `customer.manage` and online; there is no notice box. Tapping it replaces the search with **Số điện thoại** (filled from the search) and **Tên khách** (filled when a name was typed), both required, side by side from `sm`, and one full-width primary “Xác nhận” that creates the customer and attaches it. If the phone typed there belongs to a known customer, a line “SĐT này thuộc khách {tên} – Chọn khách này” attaches that profile instead (BR-16). Without the permission, or offline, the dropdown row reads “Không tìm thấy khách hàng” (`ink-500`, not a button). Offline, the search runs on the cached customer list (TDD §7.1). Once attached the row shows only the **name and phone** (`User` icon, name 600 on the first line, phone `body-sm` `ink-500` tabular on the line below) and an ✕ to remove – **no points balance**. When the balance reaches the redemption minimum (FR-CRM-04) a `success` chip “Đủ điểm nhận ưu đãi” (`Gift` 14 px) sits under the name, telling the cashier to offer the customer a reward; the totals then show the **Điểm** row with “+ Dùng điểm” (no balance in the label; the points dialog shows what is left). Below the minimum there is no chip and no Điểm row. A customer with open pre-orders gets a line under the name: “Có phiếu đặt trước DT-… · 2 sách · Đang giữ đến 18/11” (`info` tone, `CalendarClock`), with **“Đưa vào giỏ”** when the slip is ready (Cần báo khách or Đang giữ). |
| Totals | Every row `body-md`, label at the left and amount at the right; the **Tổng tiền** row is the same size, set 700 for label and amount (`pos-total` stays for the payment screen), on the same row, right-aligned, never wrapping; points to earn shown under the customer when attached. |
| Confirm button | Label **“Xác nhận”**, text only (no icon); `primary` (navy) `lg` pill (44 px), in the tone of the rest of the screen, **half** of the row beside “Giữ giỏ” (secondary `lg`, the same size), no shortcut label. Opens the payment dialog (13.4). Disabled with reason when the cart is empty or shift is closed. |

### 13.2 Connection and sync indicator (FR-POS-23..26)

Shown in the shell top bar and the POS header only when not plainly online (syncing, offline, error); while online there is no indicator.

| State | Pill | Extra |
| --- | --- | --- |
| Online, nothing queued | **Nothing is shown** in the shell top bar or the POS header; a pill appears only when something needs attention (syncing, offline, sync error). | — |
| Syncing | `info-50` / `info-700`, `RefreshCw` rotating, “Đang đồng bộ 3/12” | — |
| Offline | `warning-50` / `warning-700`, `WifiOff`, “Ngoại tuyến · 3 đơn chờ” | Page banner: “Mất kết nối. Vẫn bán được bình thường; hóa đơn điện tử và xác nhận chuyển khoản sẽ thực hiện khi có mạng.” |
| Sync error | `danger-50` / `danger-700`, `AlertOctagon`, “Lỗi đồng bộ” | Button “Đồng bộ ngay”; manager link to exceptions |
| Offline lease expiring (< 12 h) | warning banner | “Cần kết nối mạng trong 8 giờ nữa để tiếp tục bán” (TDD §7.2) |
| Read-only tab | info banner | “POS đang mở ở tab khác. Tab này chỉ để xem.” (TDD §7.4) |

Features unavailable offline (TDD §7.1) stay visible but disabled with an inline reason: “Cần kết nối mạng”. Never hide them – the cashier must know why.

**Quầy & máy bán hàng** (23 Nov 2026; a tab of Cấu hình, replacing the Thiết bị POS page; shown with `settings.manage` or `pos.offline.manage`). Top to bottom:
- **Ngoại lệ đồng bộ** – only while some are unresolved: an amber card “n đơn bán ngoại tuyến cần xem” with the table (Nhận lúc, Máy, Chứng từ, Ngoại lệ chips, Xử lý); resolved ones are not listed. A new exception also sends the notification “Máy Q1B có n ngoại lệ đồng bộ cần xem”, which opens this tab.
- **Quầy** – card with “Thêm quầy” (secondary, header): rows Mã (code style) and Tên; tapping a row opens “Sửa quầy” with the name only (the code is fixed – device codes derive from it).
- **Máy bán hàng** – card: Mã máy, Quầy, **Người dùng gần nhất**, Hoạt động gần nhất, Trạng thái (Đang dùng · Quá hạn kết nối · Đã thu hồi) and “Thu hồi” (destructive-outline). The revoke confirmation says the phone or tablet will stop selling and its stored data is erased at its next contact, and – in a warning box when its last contact is more than 10 minutes ago – “Máy liên lạc lần cuối …; đơn bán ngoại tuyến sau thời điểm này chưa gửi lên sẽ mất.”
- On Nhân viên, setting an employee to Ngừng hoạt động shows, when they used a device last, a tick (on by default) “Thu hồi máy bán hàng người này dùng gần nhất: Q1B, Q2” under the status field.

**Device registration (“Đăng ký quầy”, TDD §7.2):** shown when this browser is not yet a POS device. The POS header reads “Đăng ký quầy”. One white card: the title “Đăng ký quầy” (`heading-sm`), the register select (code · name, no visible label – its accessible name is “Quầy”) and the primary pill “Xác nhận”. There is no device-code field: the code is assigned from the register (Q1, then Q1B, Q1C… when Q1 is taken) and shown afterwards on Thiết bị POS and in offline sale numbers.

### 13.3 Scanning

- **Hardware scanner:** successful add → line flashes `sand-50` 600 ms + short beep (setting, default on). Unknown barcode → field shakes 2 px (or border flash under reduced motion), `danger` inline message “Không tìm thấy mã 8934…”, with “Tìm theo tên” and (with permission) “Tạo sản phẩm”.
- **Camera scanner:** opened by the `ScanBarcode` button beside the search field; full-screen overlay, dark scrim `rgba(20, 32, 51, 0.85)`, a 280 × 160 px rounded frame with `sand-300` corners, hint “Đưa mã vạch vào khung”, torch toggle, close button 48 px. Continuous mode for stock counts (shows running count), single mode for POS. **Works on iPhone and Android** (17 Nov 2026): where the browser has a built-in barcode reader (Chrome on Android) it is used; otherwise (Safari and every browser on iPhone) the app reads the codes itself with a bundled decoder (zxing-wasm, self-hosted with the app, no CDN), reading EAN-13 (ISBN), Code 128 and Code 39 (labels) and QR at about 8 frames a second. On a phone without a built-in reader the decoder is fetched in the background after the app loads, so the camera also works offline. The camera needs HTTPS on iPhone.

### 13.4 Payment screen

“Xác nhận” in the cart opens the **payment dialog** titled **“Phương thức thanh toán”**:

- At the top, with no label of their own (the dialog title names them), the **round radio ticks** (18 px, `navy-700` when checked, 44 px tall touch rows) – **always on one row** in **three equal-width boxes** (each option – tick and text – **centred in its box**, whatever the length of its text, so the three sit evenly), even on a 360 px phone; **text only, no icon**, `body-md`, always on one line: Tiền mặt (default), **CK** (bank transfer, abbreviated so the three boxes fit a 360 px phone; read out as “Chuyển khoản”), Thẻ. There is no store-credit option (store credit removed 27 Oct 2026).
- Under them one row: **“Tổng giá trị đơn”** `body-md` `ink-700` at the left and the amount due at the right, 20 / 28 px 700 tabular (for a pre-order: the amount left after the deposit, with “Tổng … · Đã đặt cọc …” under it). There is **no per-method amount field**: the chosen method takes the whole amount.
- **Cash:** the “Khách đưa” field and the numeric keypad (52 px keys); **no quick-amount chips**. “Tiền thừa” is one row like the total: label at the left, change at the right, 20 / 28 px 700 `success-700`.
- **Bank transfer:** the store uses its **printed QR code** at the counter; the dialog shows **no QR, no payment reference and no tick box** – only the total. The cashier presses “Xác nhận” once the money is seen in the account; pressing it is the confirmation (FR-POS-06). Offline: a one-line warning that the transfer is recorded as unverified until a manager confirms it.
- **Card:** no field – the cashier takes the payment on the terminal and presses “Xác nhận”; **no approval code** is asked for (FR-POS-06).
- **Deposit covers it (pre-order, FR-POS-09):** when the amount left after the deposit is 0 or less, the dialog shows no methods, no field and no keypad – only “Tổng giá trị đơn” with “Tổng … · Đã đặt cọc …” under it and one line: **“Đã trả đủ bằng tiền cọc.”** (`success-700`), or when the deposit is more than the price **“Trả lại khách {chênh lệch} tiền mặt.”** (`warning-700`, 600). “Xác nhận” completes the sale; the completion sheet then shows “Trả lại khách” with that amount where change is normally shown.
- **No split payment** (FR-POS-06): one method pays the whole amount.
- **Footer:** one full-width primary `lg` button **“Xác nhận”**, text only (no icon), for every method; no “Hủy” button – the dialog closes with the ✕ in its header.
- **Completion:** **no title bar** – the sheet starts with the checkmark in a `success-50` circle, then the sale number `code-xl`, change due, and actions: “Đơn mới” (primary) and “In” only if a slip is wanted. There is **no “Gửi hóa đơn điện tử qua email”** button here: a customer who asks for the e-invoice by email is served from the sale record (“Xuất hóa đơn”, 12.3, FR-POS-16). No receipt is printed by default (FR-POS-07).

### 13.5 Lock screen and PIN pad (FR-ADM-01, NFR-SEC-07)

- Auto-lock after `pos.lock_minutes` (default 5). Navy full-screen, logo (reversed), cashier name + avatar, 6 PIN dots, keypad of 72 × 72 px keys in a 3 × 4 grid (white 10 % on navy, white digits 28 px), “Đổi người dùng” link.
- Wrong PIN: dots shake, message “Mã PIN không đúng (còn 3 lần)”; lockout message after 5.
- Same keypad component (light variant: white keys with `paper-300` border) is used in the approval dialog.

### 13.6 Shift open and close (FR-POS-18..20)

- Open: one field “Tiền đầu ca” (money input) + optional denomination counter.
- Close: **cash counted by denomination rows**, not a table of every note. Titled **“Tiền mặt trong ca”**, with **no column headings** – the field hints sit inside the fields in small grey text. It opens with one empty row; each row is a **Mệnh giá** select (placeholder “Mệnh giá”, shown in the field but not offered in the list) (500.000 → 1.000 ₫; a note already used in another row is not offered), at the left, then at the right of the row a 96 px **Số tờ** number field (placeholder “Số tờ”; numeric keypad on phones, no −/+ steppers; picking a note moves focus to it), and an `X` icon button to remove the row; **no row amount** (the counted total is in the summary). A plain text button **“+ Thêm”** (`Plus` 18 px then “Thêm”, `navy-700`, no pill or fill) adds a row and is hidden once all notes are used. The counted total updates as rows change. Then a summary card (**white**, 1 px `paper-300` border): Expected / Counted / **Variance** (variance `danger-700` if negative, `warning-700` if positive, `success-700` with “Khớp” if zero). A non-zero variance requires “Lý do chênh lệch”. Footer: one full-width primary “Đóng ca”, no “Hủy” (the ✕ in the header closes the dialog). **The close button is never disabled for variance** – only for a missing reason (BR-06).

### 13.7 Event check-in (FR-EVT-10)

Phone/tablet card list with a large search field (name or phone), live counter at the top “Đã check-in 86 / 120” with a progress bar (`navy-700` on `paper-200`). Each attendee card: name, phone, ticket type, payment chip, registration number in code style; actions “Check-in” (primary lg) and, for unpaid, “Thu tiền & check-in”. Already checked-in → card turns `success-50` with time; a second attempt shows “Đã check-in lúc 18:42”. Walk-in: “+ Khách vãng lai”. “Chuẩn bị check-in ngoại tuyến” downloads the list (TDD §7.8) and shows when it was downloaded.

### 13.8 Stock count (FR-INV-06) and library desk (FR-LIB-07/08)

- **Staff (“Nhân viên”, 27 Oct 2026):** search box above the table (“Tìm tên hoặc tên đăng nhập…”, accent-insensitive). In “Thêm nhân viên” the **Mật khẩu tạm** is generated automatically when the dialog opens (12 characters, letters and digits without look-alikes such as 0/O, 1/l/I) and shown in plain text, read-only, in code style, with a “Sao chép” button (copies it so the owner can pass it to the employee; toast “Đã sao chép mật khẩu tạm.”) and a “Tạo mã khác” button. The employee still changes it on first login (FR-ADM-01).
- **Consignment (27 Oct 2026):** tab “Lô hàng ký gửi” has a search box above the table (“Tìm sản phẩm, SKU hoặc bên ký gửi…”) matching the product name, SKU or consignor name, accent-insensitive.
- **Suppliers (27 Oct 2026):** one list, no tabs – there is **no “Công nợ”** (supplier payables were removed, FR-PUR-06) and the supplier form has no “Theo dõi công nợ” tick and no “Hạn thanh toán” field (no column in the list either). **Supplier form** fields, in this order: Tên (required), Điện thoại (required), Email, Mã số thuế, “Nhận hàng ký gửi” tick, Ghi chú – no Loại, no Người liên hệ, no bank account. **List columns:** Nhà cung cấp, Điện thoại, Email, Mã số thuế, and a “Ký gửi” chip. A search box above the table (“Tìm tên hoặc số điện thoại…”) matches the name (accent-insensitive) or the phone (digits only). On the consignment statement the approve action reads “Duyệt quyết toán” and its confirmation states the amount due to the consignor (paid outside the system).
- **Stock count (27 Oct 2026; scanning since 22 Nov 2026):** *List:* search box above the table (số phiếu or người tạo) with the filter button beside it – Thời gian (created date, same presets and custom range as Đơn hàng) and Trạng thái (multi: Đang đếm, Chờ duyệt, Đã duyệt, Đã hủy). *Create:* one row with the label “Loại sản phẩm” left and a dropdown right (22 Nov 2026) – a 36 px button that opens a menu of square ticks (multi: Sách, Văn phòng phẩm, Sản phẩm khác), all ticked by default; the button reads “Tất cả” when all are ticked, otherwise the ticked names, and at least one must stay ticked to start. No category scope (SRS FR-INV-06). Then the “Đếm mù” tick with a helper line. *Count page* (22 Nov 2026, laid out like the library count): the slip number as title with a vertical `⋮` (ghost) at the right of the same row, opening a small “Thao tác” dialog with Gửi duyệt, Tải phiếu đếm (Excel) and Tải lên phiếu đã đếm (while counting; no CSV), Duyệt và ghi chênh lệch (approvers, once submitted) and Hủy phiếu – no buttons under the title; no status chip while counting (a submitted, approved or cancelled count shows its chip) and no “Đếm mù” chip; one white bordered **Tiến độ** box – “Tiến độ” and the percentage counted on one row, the bar under them; while counting, the navy camera scan button (`ScanBarcode`, no circle) sits at the right of the box on the same row and opens the **continuous scan session** of the library count; a hand scanner works anywhere on the page (no search field). Each read adds one to its product: the result card says “Đã đếm” with SKU – name and “Số đếm: 7” (never the system quantity) and a small quantity field to correct that product at once (“Sửa”), then “Tiếp tục” / “Xong”; a product outside the count is a warning “Không có trong phiếu”, an unknown code an error. With a hand scanner the same result shows under the Tiến độ box, with the quantity field. Books are scanned by ISBN, other goods by the barcode the system printed (or any barcode recorded on the product); no “Phiếu đếm” card – counters can print or fill the sheet away from the screen and upload it back from the ⋮ menu, and the result (how many quantities were set, invalid rows) shows under the Tiến độ box. Above the table a “Danh sách kiểm kho” title (14 px 600) with the round Bộ lọc button at the right of the same row, whose single Trạng thái filter is Tất cả · Chưa đếm · Có chênh lệch (with counts; Có chênh lệch only when expected quantities are shown); no chips. The line table: SKU, Sản phẩm, Hệ thống – hidden when blind –, Đếm được, Chênh lệch. For counts of **up to 50 products** “Đếm được” is an editable number per row (saved on blur); **above 50 products** the table is read-only and an info line under the Tiến độ box says to scan or use the sheet from the ⋮ menu. “Hủy phiếu” is offered until the count is approved, with confirmation. Blind mode hides expected quantities entirely (TDD §4.2).
- **Confirmation dialogs** (“Gửi phiếu kiểm để duyệt?”, “Hủy phiếu kiểm?” and the like) have **no divider lines** between title, body and buttons – one plain block. The submit text reads “Sau khi gửi, không thể thay đổi.”
- **Library borrow:** opened from the “Phiếu mượn” header button on Mượn / trả (beside “Nhận trả”); dialog title “Phiếu mượn sách”; all three sections are shown as soon as the form opens, in any order of filling (copies can be scanned before the borrower is chosen; the fee and due date show “—” until a borrower is chosen): sections “1. Thông tin người mượn” (15 Nov 2026: the pre-order customer search of 12.8 – one search field, phone or name, matches dropping down attached to it, “Khách mới” only as the no-match option and no separate button; a new customer shows Số điện thoại and Tên khách only and is created when the form is confirmed, borrowing meanwhile on the default terms; the same picker is used to reserve a title), “2. Thông tin sách mượn” (field and camera button only; each copy shows the title, then the copy code with its loan fee right-aligned on the same line – Enter or a scan adds the copy; no Thêm button), “3. Thanh toán” (label-left / value-right rows Hạn trả, Số lượng (copies lent), Phí mượn (loan fees before discount), Ưu đãi, Tổng phí mượn (bold); the Ưu đãi row works like the POS “Giảm giá ›” (13.1, 15 Nov 2026): the label “Ưu đãi” with a `ChevronRight` that turns down when open, the amount taken off on the right (`success-700`, “—” when none); opening it shows, below the row at the right, the POS discount field – a percentage only, 128 × 36 px, “%” after the number, whole percentages; the buyer discount, when the borrower has one, is prefilled; no “Chưa có sách nào.” line under the book search; then the payment methods). Step 1 find the borrower with the POS customer dialog (phone or name; “Tạo khách hàng” if new) → eligibility card (loans “1/3”, overdue loans, unpaid charges) with green check or red block reasons (UC-17); a borrower past the spend threshold also gets a success chip “Giảm 10% phí mượn” with the helper “Đã mua 6.200.000 ₫” (FR-LIB-18); step 2 field “Mã thư viện” (placeholder “Nhập mã thư viện/tên sách”, with the camera scan button beside it): a scanned or typed copy code (`VN-0123-2`) is added at once; a title code or title lists that title's copies on the shelf to pick, or adds the only one; a title with no copy on the shelf is listed with a neutral “Hết bản” chip and its earliest due date, and picking it (or Enter on its code) adds a **reservation line** – title, library code, accent chip “Đặt giữ”, and “Dự kiến có lại dd/MM/yyyy · thứ n trong hàng chờ” in `ink-500`, no fee; when the borrower has copies held for them, a “Sách đang giữ cho khách” list with a “Lấy sách” button per copy sits at the top of section 2; when nothing can be lent or reserved the field says why (the title has no copies yet) → list with title, library code, due date `dd/MM/yyyy` in `heading-md` and fee “50.000 ₫” per copy (when discounted: the list fee struck through in `ink-500` and the discounted fee “45.000 ₫” beside it), total below; “Xác nhận cho mượn” primary. The success state shows the check icon, the heading “Đã cho mượn”, then three rows with the label on the left and the value right-aligned – Số cuốn (number), Hạn trả (`dd/MM/yyyy`), Phí mượn (amount) – and offers “In phiếu” only when slips are on. A form with reservation lines only is titled “Phiếu giữ sách” and has no section 3 (no fee, no payment); its button still reads “Xác nhận”. The success state then reads “Đã đặt giữ” with one row per title and its place in the queue; a form with both kinds shows the loan rows, then an “Đặt giữ” group below a divider.
- **Library return:** field “Mã cá biệt” (placeholder “Nhập mã cá biệt/tên sách”) with a `ScanBarcode` icon button (icon only, `navy-700`, no circle) beside it that opens the camera scanner and fills the field with the scanned accession number; typing two characters or more lists the matching copies on loan (code, title, borrower) to pick. Below, “Tình trạng sách” as two radio ticks, Nguyên vẹn (default) and Hỏng; footer button “Xác nhận”. After confirming, a notice dialog titled “Nhận trả sách thành công” replaces the form: the success check icon, then label-left / value-right rows Tên sách, Mã cá biệt, Tên khách, Hạn trả, Tình trạng (“Trả đúng hạn” success or “Trễ n ngày” danger), and Phí trả trễ / Phí sách hỏng (danger) when charged; a “Thu phí” button when a fee is owed; if a reservation is waiting, “Giữ cho {tên} – gọi {sđt}” with the phone as a call link. Its only footer button, “Xác nhận”, closes the return flow (no “Nhận cuốn khác”).
- **No overview strip (15 Nov 2026):** neither Quản lý thư viện (formerly “Quản lý đầu sách”) nor Mượn / trả shows the Tổng quan thư viện figures; they are on the dashboard only (12.5). Quản lý thư viện has one plain line under its title (23 Nov 2026, `body-sm`, `ink-500`): the copies by status, “120 bản · Sẵn sàng 100 · Đang mượn 15 · …” (statuses with none left out) – no tiles.
- **Loan slips (Mượn / trả, FR-LIB-09a):** one row per loan slip (its check-out receipt), newest first – Số phiếu (`PT-…`), Khách, SĐT (`tel:` link), Số sách, Số tiền (paid charges of the slip net of refunds), Hạn trả (earliest due date of the copies still out, `danger-700` when past; “Đã trả hết” in `ink-500` when none is out), Thời gian tạo, Người thu. Search by slip number, customer name or phone, title or copy code. A “Lọc” button beside the search box: Trạng thái – Đang mượn (default: slips with a copy still out) · Sắp đến hạn · Quá hạn · Đã trả hết · Tất cả · Đang giữ (copies held for a reservation, a separate table with the borrower's call link and “Hủy giữ”), each with its count – and Thời gian (time the slip was created). The menu item carries the overdue count; the morning notification (FR-LIB-14) opens Sắp đến hạn or Quá hạn. Clicking a row opens the **slip page** (`/library/slips/{id}`, not a dialog), titled “Phiếu mượn {số phiếu}” with the breadcrumb “Mượn / trả”, in three cards: “Thông tin phiếu” – label-left rows Khách (name), SĐT (call link, on its own line), Thời gian tạo, Người thu; “Sách mượn” – one row per copy (title, copy code, status chip Đang mượn / Đã trả / Mất, due date, days late) with Gia hạn / Nhận trả / Báo mất on copies still out; “Thanh toán” – the slip's receipts and refunds (số phiếu, thời gian, khoản thu, phương thức, số tiền, người thu) with “Hoàn tiền” (with `library.fine_waive`, a reason) on receipts above 0 VND, owed charges with “Thu phí”, and the total.
- **Library count (“Kiểm kê thư viện”, FR-LIB-04):** same layout and statuses as Stock count. *List:* số phiếu or người tạo search, filters Thời gian and Trạng thái. *Create* (15 Nov 2026): **Kệ** only – a dropdown field (“Tất cả kệ” when nothing is ticked, else the ticked shelves, “A1, B2” or “3 kệ”) that opens a list of the shelves in use, each with a square checkbox (18 px, `navy-700` when ticked) and its copy count, several at a time; no helper line, no Ngôn ngữ or Thể loại; then the “Đếm mù” tick. *Count page* (15 Nov 2026): the slip number as title with a vertical `⋮` (`MoreVertical`, ghost) at the right of the same row, opening a small “Thao tác” dialog with Gửi duyệt, Duyệt (approvers), **Tải phiếu đếm (Excel)** and **Tải lên phiếu đã đếm** (while counting; no CSV) and Hủy phiếu – no buttons under the title; no status chip while counting (a submitted, approved or cancelled count shows its chip), no “Đã thấy”, shelf or “Đếm mù” texts; instead one white bordered **Tiến độ** box – “Tiến độ” and the overall percentage (“0%”) on one row, the bar under them; tapping the box opens, inside it, one row per shelf (shelf, its own small bar, counted/total); then (17 Nov 2026) **no search field**: the navy camera scan button (`ScanBarcode`, no circle) sits at the right of the Tiến độ box, on the same row, and opens a **continuous scan session**; a hand scanner (Bluetooth or USB, typing like a keyboard) works anywhere on the page – its code and Enter are recorded at once, the result shown under the Tiến độ box. The scan session (16 Nov 2026): a full-screen camera that stays open; each code read pauses reading, records the copy and shows a result card over the camera – “Đã đếm” (success: accession number, title, shelf, and the overall “13/40 · 32%”), “Ngoài phạm vi / sai kệ” (warning) or the error (danger) – with a short beep or vibration; a large “Tiếp tục” resumes reading at once (the copy just read is ignored until a different code is seen or it leaves the frame, so a book left in view is not counted twice), and “Xong” or ✕ closes the session back to the refreshed count; **no “Ghi nhận” button** – a scanner's Enter or a camera read records the copy at once and empties the field for the next one; it marks the scanned copy Có – an ISBN marks the next not yet counted copy of that title, and asks for the accession barcode when none is left; no “Phiếu đếm” card – the Excel count sheet (column “Có mặt”, 1 or 0) is downloaded and uploaded from the ⋮ menu, and the upload result shows under the scan field; the line table (Mã bản, Tên sách, Kệ, Trạng thái hệ thống – hidden when blind –, Kết quả). The table is **read-only**: Kết quả is a chip (Có / Không thấy / Chưa kiểm) – copies are counted only by scanning or by the Excel count sheet, never marked by hand. Above the table a “Danh sách kiểm kê” title (14 px 600) with the round Bộ lọc button at the right of the same row, whose single Trạng thái filter is Tất cả · Chưa kiểm · Không thấy · Ngoài phạm vi (with counts); no chips. Actions “Gửi duyệt”, “Hủy phiếu” and, for approvers, “Duyệt” sit in the `⋮` menu. The approval confirmation says no copy will be changed.
- **Library payment step (FR-LIB-09a):** a “Thanh toán” block – total to collect, two radio ticks Tiền mặt (default) · Chuyển khoản, no card and no reference field. In Cho mượn it is step 3 and the button reads “Xác nhận”; in Gia hạn it sits in the confirmation dialog (“Thu tiền và gia hạn”). After a return with a late or damage fee, after Báo mất, and wherever a borrower owes charges (eligibility card, customer library section), a “Thu phí” button opens the same block in a dialog listing the owed charges (all ticked).
- **Library catalogue:** list columns Ký hiệu xếp giá (code style, two lines “891.733” / “D67c”; a neutral chip “Chưa phân loại” when there is none), Kệ (the shelves of its copies, “A1, B2”; — when none), Tên sách, Tác giả, Ngôn ngữ chip, Số lượng (copies available/total, e.g. “4/4”); filters Ngôn ngữ, Trạng thái, Thể loại and Phân loại (Đã phân loại / Chưa phân loại). **Thêm đầu sách** opens a wide dialog (720 px; full screen on phones) in three sections: **Tìm sách** – the book lookup of 12.4 (FR-LIB-02a), filling empty fields silently (no chips or source line; a text field, so no browser clear “×”); no helper lines under Tác giả, Dewey, Cutter or Số cuốn (15 Nov 2026); **Thông tin sách** – Tên sách (required), Tác giả, ISBN, Nhà xuất bản, Năm xuất bản, Ngôn ngữ (required; sets the VN/EN prefix), Thể loại (suggested from the Dewey main class: 000 Tổng loại, 100 Triết học, 200 Tôn giáo, 300 Khoa học xã hội, 400 Ngôn ngữ, 500 Khoa học tự nhiên, 600 Công nghệ, 700 Nghệ thuật, 800 Văn học, 900 Lịch sử & địa lý); **Ký hiệu xếp giá** – Dewey (`inputMode="decimal"`) and Cutter (filled by the system from the first author and the title, re-suggested while untouched) with a live preview of the label lines beside them; **Nhập bản** (new titles only; no heading on screen – the fields follow the call number) – Ngày nhập (default today), Số cuốn (default 1, 0 allowed to save the title alone), Giá trị (₫), Nguồn (Mua / Tặng / Chuyển từ kho bán – recorded only, no stock movement), **Kệ** (required when Số cuốn > 0: a field whose dropdown, attached to the field’s bottom edge like the customer search (no gap, shared border), lists the shelves in use with their copy counts, filtered as you type, and “+ Kệ mới: B3” when the typed shelf is not in use; pre-filled with the shelf suggested for the Dewey class until staff change it; shown and saved in capitals). The primary button always reads “Lưu” (no print icon); saving opens the title's page – labels are printed later by ticking copies and “In tem” (15 Nov 2026). Copies are a table inside the title (Mã cá biệt, Ngày nhập, Tình trạng, Giá trị, Nguồn, Trạng thái) with “Thêm bản” – the Nhập bản fields (Kệ included) in a small dialog saved with “Thêm” (no print step); a copy's own dialog uses the same Kệ field – and “In tem” for ticked copies, which opens a dialog titled just “In tem gáy” with only the Khổ giấy select (no count in the title, no explanatory line) and “In”. Editing a title shows the same form without Tìm sách and Nhập bản. **Title page** (15 Nov 2026), like the other record pages (12.3): a back link “← Quản lý thư viện” above the title, an icon-only **Sửa** (`Pencil`, ghost) on the title row, the call number and language chip under it; the Thông tin card lists Tác giả, ISBN, Nhà xuất bản, Năm, Thể loại, Ký hiệu xếp giá (Dewey and Cutter on two lines, right-aligned, as on the spine label) and **Kệ** (the shelves of its copies, “A1, B2”; — when none); the copies card has its title “Số lượng: n” (the number of copies) with “Thêm bản” on the same row as a bare navy `Plus` icon (28 px, no circle or pill, 44 px tap area, label in its tooltip) – no “Chuyển từ kho bán” button: a copy from the shop is added with Nguồn “Chuyển từ kho bán” and sale stock is not changed – and once copies are ticked a white bordered bar “Đã chọn n bản” with a 32 px “In tem” pill (no count; tap area 44 px on touch) appears above the table.

### 13.9 No keyboard shortcuts

The POS uses **no keyboard shortcuts** and shows no shortcut hints on buttons. Every action is a visible button. The only keyboard input the POS relies on is the barcode scanner typing into the focused search field (and standard browser behaviour such as Tab and Esc for accessibility).

---

## 14. Content, voice and formatting

### 14.1 Voice

- **Staff UI:** clear, short, neutral Vietnamese. Imperative verbs for actions (“Lưu”, “Tạo đơn”). Address the user directly only when needed (“Bạn không có quyền…”). No jargon or English loanwords where a common Vietnamese word exists; keep accepted terms (“SKU”, “ISBN”, “COD”, “check-in”).
- **Customer emails:** warm and polite, using “bạn” and signing as “The Bookshelf Hanoi”. (Change to “Quý khách” if the store prefers a more formal tone – one setting across all templates.)
- Sentence case everywhere. No exclamation marks in errors.

### 14.2 Error messages (NFR-USE-05)

Pattern: **What happened. Why (if known). What to do.**

| Bad | Good |
| --- | --- |
| “Lỗi 409” | “Không thể lưu sản phẩm. Mã SKU ‘VPP-0012’ đã được dùng cho ‘Bút bi xanh’. Hãy đổi mã SKU hoặc mở sản phẩm đã có.” |
| “Không đủ hàng” | “Chỉ còn 2 cuốn có thể bán (5 cuốn đang được giữ cho đơn online). Giảm số lượng hoặc chuyển thành đơn đặt trước.” |
| “Thất bại” | “Chưa xuất được hóa đơn điện tử vì không kết nối được MISA. Đơn bán đã lưu; hệ thống sẽ tự thử lại. Bạn cũng có thể bấm ‘Thử lại’.” |

### 14.3 Formatting

| Item | Format | Example |
| --- | --- | --- |
| Money | Dot thousands, no decimals, space + “₫” after | `1.234.567 ₫` (TDD §3.6) |
| Negative money | Minus sign before the number | `−50.000 ₫` |
| Compact money (charts, KPI) | `tr` (triệu) / `tỷ`, 1 decimal with comma | `12,5 tr ₫`, `1,2 tỷ ₫` |
| Percentage | Comma decimal, no space | `12,5%` |
| Quantity | Dot thousands | `1.204` |
| Date | `dd/MM/yyyy` | `24/10/2026` |
| Date + time | `dd/MM/yyyy HH:mm` | `24/10/2026 18:30` |
| Relative time (≤ 7 days) | Vietnamese relative | “5 phút trước”, “Hôm qua 14:20” |
| Weekday | Full Vietnamese | “Thứ Bảy, 24/10/2026” |
| Phone | Groups 4-3-3 | `0912 345 678` |
| Document numbers | Code style, prefix + number | `DH-10234`, `SI-2026-00451`, `Q1-000123` |
| ISBN | Code style, 13 digits with hyphens when known | `978-604-1-23456-7` |
| Timezone | Always store time (Asia/Ho_Chi_Minh); no timezone label needed in UI | |

Use `Intl.NumberFormat('vi-VN')` and `Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })` through one shared helper.

### 14.4 Core label glossary

| VI label | EN meaning | VI label | EN meaning |
| --- | --- | --- | --- |
| Lưu | Save | Hủy | Cancel |
| Xóa | Delete | Đóng | Close |
| Thêm … | Add … | Chỉnh sửa | Edit |
| Tìm kiếm | Search | Bộ lọc | Filters |
| Xóa bộ lọc | Clear filters | Áp dụng | Apply |
| Xác nhận | Confirm | Quay lại | Back |
| Xem trước | Preview | Đăng | Publish |
| Lên lịch | Schedule | Khôi phục | Revert / restore |
| Xuất | Export | Nhập | Import |
| Tạo đơn | Create order | Thanh toán | Pay / checkout |
| Giữ giỏ | Hold cart | Gọi lại giỏ | Recall cart |
| Mở ca / Đóng ca | Open / close shift | Tiền đầu ca | Opening float |
| Nhập hàng | Stock-in | Kiểm kho | Stock count |
| Tồn kho | Stock | Có thể bán | Available |
| Đang giữ | Reserved | Đặt trước | Pre-order |
| Đã liên hệ | Contacted | Chờ báo giá | Awaiting quote |
| Cần báo khách | Ready to notify | Gia hạn | Extend |
| Thử lại | Retry | Sao chép | Copy |
| Cần quản lý duyệt | Supervisor approval needed | Lý do | Reason |

Maintain the full string set in the externalised locale file (`vi.json`); this table seeds it.

---

## 15. Accessibility

Target **WCAG 2.2 AA** for all staff screens (tested with axe-core, TDD §2.1).

- **Contrast:** body text ≥ 4.5:1, large text (≥ 24 px or ≥ 19 px bold) and UI component boundaries ≥ 3:1. All token pairings in this guide are checked (Appendix B). Sea blue and Sky blue are **never** text colours; white text is **never** placed on Sand, Sky or Sea.
- **Not colour alone:** status chips carry text; attention states carry icons; charts carry labels; form errors carry an icon and text.
- **Keyboard:** every action reachable by keyboard in a logical order; visible focus ring (4.6); dialogs trap focus and return it on close; reorder lists have up/down buttons, not drag only.
- **Touch:** ≥ 44 × 44 px targets, ≥ 8 px between adjacent targets; no hover-only controls.
- **Screen readers:** icon buttons have `aria-label`; live regions announce toasts, “Đã thêm vào giỏ”, sync state changes and new orders (`aria-live="polite"`; errors `assertive`); tables use real `<table>` markup with header cells.
- **Language:** `<html lang="vi">`; English website-content fields get `lang="en"`.
- **Text resize:** layouts work at 200 % zoom without horizontal scrolling of the page (tables may scroll inside their card).
- **Motion:** honour `prefers-reduced-motion`.
- **Timeouts:** warn 60 s before session idle timeout with “Tiếp tục làm việc”; POS lock does not discard the cart.

---

## 16. Print templates

All printing is from the browser (TDD §8.7) with print-specific CSS. Nothing in delivery orders is printable (BR-28).

### 16.1 Global print rules

```css
@media print {
  @page { margin: 12mm; }
  body { background: #FFFFFF; color: #000000; font: 10pt/1.4 var(--font-sans); }
  .no-print, nav, header.app, .toast, button { display: none !important; }
  a { color: inherit; text-decoration: none; }
  table { border-collapse: collapse; page-break-inside: auto; }
  tr { page-break-inside: avoid; }
  thead { display: table-header-group; }   /* repeat header on each page */
}
```

- Black text on white; Navy is allowed for the logo and headings on A4 laser/inkjet prints; thermal prints are **black only**.
- Fonts: Be Vietnam Pro for everything, with tabular figures for codes and amount columns. PDFs generated by pdfkit embed the same fonts (TDD §2.1).
- Every printed document shows: store name, address, tax code (from Settings), document title, document number (code style), date/time, printed-by and page `x/y` on A4.

### 16.2 Sales slip – 80 mm thermal (optional, FR-POS-07)

Printed only when `pos.print_sales_slip` is on. Printable width **72 mm**; `@page { size: 80mm auto; margin: 4mm; }`.

```
        THE BOOKSHELF HANOI          ← logo, mono black, 48 mm
   12 Phố Sách, Hoàn Kiếm, Hà Nội
   MST: 0123456789 · 024 1234 5678
--------------------------------------
PHIẾU BÁN HÀNG          Q1-000123
24/10/2026 18:30     Thu ngân: Lan
--------------------------------------
Cho tôi xin một vé đi tuổi thơ
  1 x 98.000                98.000
Bút bi Thiên Long xanh
  3 x 6.000                 18.000
  KM Mua 2 tặng 1          −6.000
--------------------------------------
Tạm tính                   110.000
Giảm giá                   −10.000
TỔNG CỘNG                  100.000 ₫
Tiền mặt                   200.000
Tiền thừa                  100.000
--------------------------------------
Khách hàng: Trần Thị B · Hạng Bạc
Điểm cộng: +10 · Tổng điểm: 1.240
--------------------------------------
   Đây không phải hóa đơn GTGT.
 Tra cứu hóa đơn điện tử theo mã đơn.
   Đổi trả trong 7 ngày (BR-04).
     Cảm ơn bạn đã ghé tiệm sách!
```

- Body 9 pt; item names wrap; amounts right-aligned with tabular figures; total 12 pt bold.
- Separator lines `-` repeated or 1 px solid black.
- Footer text editable in Settings (sales-slip template, FR-ADM-04).

### 16.3 E-invoice copy – A4 (on request, FR-POS-16)

- **Print the PDF returned by MISA meInvoice unchanged** whenever it is available – it is the legal document (Decree 123/2020/ND-CP) and its layout must not be altered.
- The in-app “copy” template is used only as a cover/preview while the MISA PDF is pending, clearly titled “BẢN THỂ HIỆN – CHƯA PHẢI HÓA ĐƠN” (preview – not an invoice) with a diagonal light-gray watermark.

### 16.4 Shelf and price labels (FR-CAT-13)

| Template | Size | Content | Type |
| --- | --- | --- | --- |
| **Shelf/price label** | 50 × 30 mm | Title (2 lines max, 9 pt 600), author (7 pt), price (16 pt bold, tabular), barcode EAN-13 / Code 128 (≥ 22 mm wide, 10 mm tall), SKU 6 pt 500 | Label printer or A4 sheet (e.g. 4 × 10 = 40-up on 52.5 × 29.7 mm) |
| **Barcode sticker** | 38 × 21 mm (A4 65-up) or 40 × 25 mm roll | Barcode + SKU/ISBN 500 + short name 6 pt + price 9 pt bold | Label printer / A4 |
| **Sale price overlay** | 30 × 20 mm | Old price struck through 7 pt, new price 14 pt bold | Optional |

- Barcodes: pure black on white, quiet zone ≥ 2.5 mm each side, human-readable digits underneath (Be Vietnam Pro, tabular).
- Batch print preview shows the sheet layout with a “start at position” selector to reuse partly used A4 sheets.
- No colour on labels; the logo is optional (mono, ≤ 20 mm) on shelf labels only.

### 16.5 Library book label (FR-LIB-17)

- Size **30 × 45 mm**, portrait, roll or A4 sheet; one label per copy, stuck on the spine (on a thin spine, the barcode part wraps onto the back cover).
- Content, stacked and centred: Code 128 of the accession number (≥ 26 mm wide, 8 mm tall) with the number in 7 pt 500 underneath (“EN-000125”); a 2 mm gap; the **Dewey number 14 pt bold** (“891.733”; a number with more than three decimals breaks after the third); the **Cutter line 14 pt bold** (“D67c”). A title without a call number prints its title shortened to two lines in 8 pt instead of the two call-number lines. No date, price or logo; black only.

### 16.6 Library slip (optional, FR-LIB-07)

80 mm thermal like 16.2: borrower name and phone, list of titles with copy barcode and loan fee, **due date in 12 pt bold** (“Hạn trả: 07/11/2026”), late-fee reminder line (“Trả trễ: 2.000 ₫/ngày/cuốn”).

### 16.7 Payslip – A4 (FR-HR-11)

- Header: logo (positive), “PHIẾU LƯƠNG THÁNG 10/2026”, employee name, code, role, bank account (masked except last 4 digits).
- Sections in tables: Giờ làm (regular hours, overtime by multiplier 150/200/300 %, BR-18) → Thu nhập (hourly pay, allowances, sales bonus) → Khấu trừ (advances, penalties, manual statutory lines) → **Thực nhận (trước thuế & bảo hiểm)** in a bordered box, 14 pt bold.
- Footer: note that statutory insurance and PIT are calculated outside the system (BR-26); generated date; “Bảo mật” (confidential) marker.

### 16.8 Consignment statement – A4 (FR-PUR-10)

Header with store and supplier details, period, statement number. Table columns: Sản phẩm · SKU · Nhận · Đã bán · Đã trả · Còn lại · Giá bán · Chiết khấu · Thành tiền phải trả. Totals row bold; amount due in a bordered box; signature blocks for “Bên giao hàng” and “Bên nhận hàng” with date lines. Landscape orientation when there are more than 8 columns.

### 16.9 Other A4 exports

Reports exported to PDF (FR-RPT-10) use the same header block, a filter summary line (“Từ 01/10/2026 đến 24/10/2026 · Kênh: Tất cả”), tables per 16.1, and charts in the data-viz palette (they print acceptably in grayscale because the series differ in lightness).

---

## 17. Email templates

Emails are limited to: event reminder, email verification and password reset (FR-ADM-08, BR-25). Library due-soon and overdue loans reach staff as an in-app notification (FR-LIB-14), and staff call the borrower. E-invoice emails are sent **by MISA meInvoice**, not by this system, so they are not styled here.

### 17.1 Layout

```
┌──────────────── 600 px ────────────────┐
│  Navy #22344F header, 72 px            │
│      [THE BOOKSHELF HANOI logo 160px]  │
├────────────────────────────────────────┤
│  Warm white #F5F2EA outer background   │
│  ┌──────── white card ─────────────┐   │
│  │ Heading (Cormorant 28px)        │   │
│  │ Greeting + message (16px)       │   │
│  │ ┌ details box (paper-50) ─────┐ │   │
│  │ │ Key info rows               │ │   │
│  │ └─────────────────────────────┘ │   │
│  │ [  Primary button (navy)  ]     │   │
│  │ Secondary text, 14px ink-500    │   │
│  └─────────────────────────────────┘   │
│  Footer: address · phone · hours       │
│  Social links (text) · why you got it  │
└────────────────────────────────────────┘
```

| Property | Spec |
| --- | --- |
| Structure | Table-based, 600 px max, fluid down to 320 px; inline CSS (generated from a template tool, e.g. MJML or React Email) |
| Fonts | `"Be Vietnam Pro", Arial, sans-serif` (body 16/24); heading `"Cormorant Garamond", Georgia, serif` 28/34 600 – many mail clients fall back to Georgia/Arial, which is acceptable |
| Colours | Header `#22344F`; outer `#F5F2EA`; card `#FFFFFF`; text `#1A2638`; secondary `#5C6675`; button `#22344F` with white text; details box `#FBFAF6` with `#D9D3C4` border |
| Button | “Bulletproof” table button, 48 px tall, pill (radius 24), padding 0 28 px, 16 px 600; the URL also shown as text below for clients that block buttons |
| Images | Logo only (PNG @2x, with `alt="The Bookshelf Hanoi"`); no tracking pixels |
| Dark-mode clients | Logo PNG has the navy background baked in so it stays legible when clients invert colours |
| Language | Vietnamese; subject lines ≤ 60 characters; preheader text ≤ 90 characters |
| Footer | Store address, phone, opening hours, “Bạn nhận email này vì …” explaining the reason (Decree 13/2023 transparency) |

### 17.2 Templates

| Template | Subject | Body essentials | Button |
| --- | --- | --- | --- |
| **Event reminder** (FR-EVT-12) | “Nhắc lịch: {Tên sự kiện} – {Thứ, dd/MM HH:mm}” | Greeting; event title; details box: date/time, venue, registration number, number of attendees, payment status if unpaid (“Vui lòng thanh toán tại quầy”); how to get there | “Xem chỉ đường” (map link) |
| **Email verification** (FR-WEB-07) | “Xác nhận email của bạn” | One sentence; link valid 24 h (TDD §4.6); “Nếu không phải bạn, hãy bỏ qua email này.” | “Xác nhận email” |
| **Password reset** (TDD §10.2) | “Đặt lại mật khẩu” | Link valid 1 hour, single use; no account details revealed (no user enumeration) | “Đặt lại mật khẩu” |

Sample – event reminder copy:

> **Hẹn gặp bạn tối mai**
> Chào Lan, cảm ơn bạn đã đăng ký **Giao lưu tác giả Nguyễn Nhật Ánh**.
> Thời gian: Thứ Bảy, 31/10/2026, 18:30 · Địa điểm: Tầng 2, The Bookshelf Hanoi · Mã đăng ký: `SK-0042` · Số người: 2
> Hẹn gặp bạn tại tiệm sách!

---

## 18. Hand-off checklist

Before a screen is considered done:

- [ ] Uses only tokens from section 9 (no raw hex, no Tailwind gray scale).
- [ ] One primary button; at most one olive element visible.
- [ ] Page titles, greeting and everything else, codes included, in Be Vietnam Pro; Cormorant Garamond only for `display-lg` heroes.
- [ ] Money as `1.234.567 ₫`, dates `dd/MM/yyyy`, numbers tabular and right-aligned.
- [ ] Every status uses the mapping in section 11, with text and (if attention) an icon.
- [ ] Works at 360 px wide; touch targets ≥ 44 px (POS included); POS totals do not wrap.
- [ ] Controls the user lacks permission for are hidden, not disabled; restricted fields omitted.
- [ ] Empty, loading, error and offline states designed.
- [ ] Error messages follow “what – why – what to do”.
- [ ] Keyboard path, focus ring and screen-reader labels checked; axe-core passes.
- [ ] All UI strings externalised in `vi.json`.
- [ ] Print view (if any) checked in Chrome print preview at the target paper size.

---

## Appendix A. Navigation map with icons

Following SRS Appendix C. Items appear only with permission (FR-ADM-03).

| Group (overline) | Item (VI) | EN | Icon |
| --- | --- | --- | --- |
| — | Tổng quan | Overview | `House` |
| CỬA HÀNG | Bán hàng | Selling (POS) | `ShoppingCart` |
| | Đặt trước | Pre-orders and holds (badge: to act on) | `CalendarClock` |
| | Giao hàng | Delivery (carrier orders only) | `Truck` |
| | Đối soát COD | COD reconciliation (badge: remittances with a difference) | `HandCoins` |
| | Đơn hàng | Orders (every order) | `Receipt` |
| | Khách hàng | Customers | `Users` |
| | Khuyến mãi | Promotions | `BadgePercent` |
| SỰ KIỆN | Lịch & danh sách sự kiện | Event calendar and list | `CalendarDays` |
| | Đăng ký & check-in | Registrations and check-in | `ClipboardCheck` |
| | Chương trình định kỳ | Programmes | `Repeat` |
| DANH MỤC & KHO | Sản phẩm | Products | `BookOpen` |
| | Tồn kho | Stock | `Boxes` |
| | Kiểm kho | Stock count | `ClipboardList` |
| | Nhà cung cấp | Suppliers | `Building2` |
| | Ký gửi | Consignment | `Handshake` |
| THƯ VIỆN | Quản lý thư viện | Library management: titles and copies | `Library` |
| | Mượn / trả | Borrow / return | `ArrowLeftRight` |
| | Kiểm kê thư viện | Library counts | `ClipboardList` |
| NHÂN SỰ | Nhân viên | Staff list | `UserRound` |
| | Phân quyền | Roles | `ShieldCheck` |
| | Lịch làm việc | Rosters | `CalendarRange` |
| | Chấm công | Attendance | `Fingerprint` |
| | Nghỉ phép | Leave | `Plane` |
| | Bảng lương | Payroll | `HandCoins` |
| | Hoạt động | Activity | `Activity` |
| WEBSITE | Trang & tin tức | Pages & news | `FileText` |
| | Banner | Banners | `Image` |
| | Bộ sưu tập | Collections | `LayoutGrid` |
| | Trang chủ | Home page sections | `Home` |
| | Menu & chân trang | Menu & footer | `Menu` |
| | Hàng chờ đăng & lịch sử | Publish queue and history | `Send` |
| | Tích hợp | Integration (API keys, webhooks) | `Plug` |
| BÁO CÁO | Báo cáo ca làm | Shift report | `Wallet` |
| | Doanh thu | Sales reports | `TrendingUp` |
| | Kho & nhập hàng | Inventory and stock-in reports | `Boxes` |
| | Thuế & kiểm toán | Tax and audit reports | `Landmark` |
| | Sự kiện · Thư viện · Khách hàng · Nhân sự | Added with those modules | `BarChart3` |
| CÀI ĐẶT | **Cài đặt chung** (the menu label, 23 Nov 2026 – formerly “Cấu hình”, still the name of its first tab; with a Kênh bán tab and a **Quầy & máy bán hàng** tab; its Danh mục list includes **Kệ hàng**: code, name such as “A3 · Văn học Việt Nam”, order, Đang dùng) · Nhập dữ liệu · Sao lưu & dữ liệu · Nhật ký – no “Thiết bị POS” item (23 Nov 2026; `/devices` opens that tab) | Settings | `Settings` |

Group headers in the expanded sidebar are collapsible; the open state is remembered per user. In the 72 px rail, groups become icon flyouts.

---

## Appendix B. Contrast reference

WCAG 2.x contrast ratios computed for the token pairs used in this guide. AA requires 4.5:1 for normal text, 3:1 for large text and UI boundaries.

| Foreground | Background | Ratio | Verdict |
| --- | --- | --- | --- |
| `ink-900` #1A2638 | white | 15.24 | AAA |
| `ink-900` #1A2638 | `paper-100` #F5F2EA | 13.62 | AAA |
| `navy-700` #22344F | `paper-100` | 11.23 | AAA |
| `ink-700` #3D4A5C | `paper-100` | 8.05 | AAA |
| `ink-500` #5C6675 | white | 5.81 | AA |
| `ink-500` #5C6675 | `paper-100` | 5.20 | AA |
| `ink-500` #5C6675 | `paper-200` #EDE9DF | 4.80 | AA |
| white | `navy-700` | 12.56 | AAA |
| white | `navy-800` #1A2A41 | 14.47 | AAA |
| white | `olive-600` #5B6B3A | 5.82 | AA |
| white | `olive-700` #4A5830 | 7.69 | AAA |
| `sand-300` #D8C7A6 | `navy-700` | 7.56 | AAA (nav indicator, focus on navy) |
| `navy-700` | `sand-300` | 7.56 | AAA |
| `navy-700` | `sky-300` #A9C4D4 | 6.90 | AA |
| `navy-700` | `sea-500` #7FA3B8 | 4.68 | AA (navy text on sea only) |
| `success-700` #2E6B45 | `success-50` #E7F1EA | 5.50 | AA |
| `warning-700` #8A5A12 | `warning-50` #FBF1DE | 5.28 | AA |
| `danger-700` #A63A2B | `danger-50` #F8E9E6 | 5.45 | AA |
| `info-700` #2F6385 | `info-50` #E6EFF5 | 5.56 | AA |
| `navy-700` | `navy-100` #DCE2EA | 9.63 | AAA |
| `olive-700` | `olive-100` #DDE3CD | 5.84 | AA |
| `gold-800` #5C4300 | `gold-300` #F6D96B | 6.67 | AA |
| `info-700` | `sky-100` #DCE8EF | 5.19 | AA |
| `sand-700` #7A6640 | `sand-100` #F0E8D8 | 4.53 | AA (minimum – use sparingly) |
| white | `danger-700` | 6.44 | AA |
| white | `success-700` | 6.35 | AA |
| `paper-500` #8C8574 (input border) | white | 3.67 | Meets 3:1 non-text |
| `chart-sand` #C9A15A | `navy-700` | 5.22 | AA |
| **Avoid:** white on `sea-500` | — | 2.68 | Fails |
| **Avoid:** white on `sky-300` | — | 1.82 | Fails |
| **Avoid:** `sea-500` text on `paper-100` | — | 2.40 | Fails |
| **Avoid:** Tailwind `gray-500` #6B7280 on `paper-100` | — | 4.32 | Fails |
| **Avoid:** `warning-500` #D99A2B as text on white | — | 2.44 | Fails (icon fill only) |
