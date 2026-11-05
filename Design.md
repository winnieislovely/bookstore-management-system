# Design Guide – Bookstore Management System (Staff Web App)

**The Bookshelf Hanoi · Back office, POS and staff tools**

|  |  |
| --- | --- |
| **Document version** | 1.1 – Draft for review |
| **Date** | 24 October 2026 |
| **Changes in 1.1** | Lists: on phones status chips fold into the filter button beside search; product list shows SKU only (no ISBN, no channel column); order source shown as text without colour dot; gold tier badge is yellow. Codes set in Be Vietnam Pro (IBM Plex Mono dropped); all buttons are pills, text links for actions became tonal pill buttons; website descriptions required in English; waiting states show no time; order inbox is a table; dashboard alert tiles removed; POS: no lock or offline-test buttons, search reads “Nhập SKUs/tên sản phẩm” with the scan button at the end, confirm button reads “Xác nhận”, no keyboard shortcuts. **25 Oct 2026:** bank transfer at the POS shows the amount and payment reference only; the customer uses the store’s printed QR code, and no QR is generated (13.4); store credit tile on the payment screen (13.4); “Thiếu ảnh” chip and filter for imported products without a photo (12.1, 12.4). **27 Oct 2026:** no global search in the top bar; sign out moved to the bottom of the sidebar (“Đăng xuất”); page titles and the dashboard greeting use Be Vietnam Pro; dashboard KPI tiles are today’s revenue, order count and average order value; revenue trend (bars + order-count line) and sales-by-channel cards have a range filter button (`ListFilter` icon) that opens a range popover; dashboard lists have column headers; “Xem chi tiết” pill under Sắp hết hàng (5.2, 6.3, 12.5). POS cart line: compact stepper (28 px circles) under the unit price; neither the POS header nor the shell top bar shows a “Trực tuyến” pill while online (6.3, 13.1, 13.2); payment method tiles always on one row, 72 px (13.4). Lists: no filter chips above tables on any screen size – all filters sit in the Bộ lọc button beside the search box, which opens a filter popover; pinned first table column is opaque so scrolled cells no longer overlap it; codes, dates and amounts do not wrap (10.6, 10.9, 12.1). Product list: “Thêm sản phẩm” is a separate grouped form page with required cost and a per-unit profit line (12.1, 12.4); Excel import wizard opens in a dialog on the Products page (12.10); create-product dialog on the page, fixed search icon, Bộ lọc (Tồn kho, Loại, Phân loại, Trạng thái, Ảnh), columns SKU, Ảnh, Tên, Tồn, Giá bán, Giá nhập, Trạng thái, Cập nhật, and bulk barcode printing (12.1). Shift list: search and Bộ lọc (Quầy, Thời gian) (12.1). Promotion list: search, Bộ lọc (Thời gian, Trạng thái), separate Mã and Chương trình columns, pause/resume moved into the editor (12.1). Supplier orders removed (no “Đặt hàng NCC” screen or menu item, FR-PUR-07/08). Supplier payables removed: no “Công nợ” tab on Suppliers, no payables report (FR-PUR-06). Supplier form: Tên, Điện thoại (required), Email, Mã số thuế, Nhận hàng ký gửi, Ghi chú; no type, contact person, terms or bank; list search by name or phone. Stock count list: search and Thời gian / Trạng thái filters. Consignment lots and Nhân viên lists have a search box; “Thêm nhân viên” generates the temporary password with “Sao chép” / “Tạo mã khác”. Thêm sản phẩm mới: one “Thông tin sản phẩm” card with Nhà cung cấp after Danh mục; Nhà cung cấp and Số lượng nhập lần đầu are required and saving posts the first stock-in (FR-PUR-02); the opening quantity can enter as consignment (13.8). Stock count: scope by product type and category, Excel/CSV count sheet download/upload (required above 50 products), no scanning, cancel until approved; confirmation dialogs without divider lines (13.8, 10.9). Stock adjustment: quantity and reason per product, no location anywhere (one stock location; also removed from stock counts, the stock page and master data), reasons “Hết hạn sử dụng” and “Hoàn tác nhập dữ liệu” dropped (12.1). Stock list: the “Nhập thêm hàng” form only edits the ticked products (no search, no new product) (12.1). Stock list: stock value under the title; Bộ lọc adds “Thay đổi gần nhất” (time of the latest stock change) (12.1). Bulk bar sits under the search/filter row (they stay visible), expands to list the selected rows (3 visible, scroll) with an X per row (10.6). Stock and stock-in merged into one “Tồn kho” page with a product-style table, search, stock-state filter, bulk “Nhập thêm hàng” / “Điều chỉnh tồn” and a per-product stock page; “Nhập hàng” menu item and stock-in entry list removed (12.1, Appendix A). Product record: “Thông tin sản phẩm” first (photo left, details right, description below), then separate “Giá bán” and “Tồn kho” cards each with its own “Sửa”, and a “Bán trên website” toggle instead of POS/website flags (12.3, FR-CAT-09). Store credit removed everywhere (no payment tile, refund choice, customer tab or field) (13.4, 12.3). Customer record: icon-only Sửa beside ⋯, purchases and points on one page without tabs (12.3). Customer list: Số đơn, Tổng mua, Mua gần nhất columns and a Bộ lọc with Hạng, Mua gần nhất, Số đơn, Điểm (12.1). Page-header buttons fit their label on phones instead of stretching full width (6.3, 10.1, 12.1, 12.3). Sale record: Print and Return moved into the ⋯ menu on every screen size (12.3). Detail pages: overflow ⋯ on the title row and actions side by side on phones; single-column stacking never wider than the screen; line tables become stacked lists on phones; sale record e-invoice card with “Xuất hóa đơn” (12.3). Filter popover: each field is a dropdown with checkboxes for multi-select; sales list filters by time (10.9, 12.1). POS sales list (“Đơn bán”) shows no e-invoice chip in the status column; the e-invoice state is on the sale record (12.1). POS customer lookup by phone or name (FR-POS-04); smaller type and buttons: page titles 28/22 px, `pos-total` 28 px without wrapping, button heights 32/36/44/52 px, POS touch targets 44 px (5.2, 6.5, 10.1, 13). POS header shows cashier and register only; scan button sits beside the search field; empty-cart state “Chưa có sản phẩm nào được chọn”; on tablet portrait / phone the whole cart (customer, lines, totals, Xác nhận) is on the selling screen with no bottom sheet (13.1, 13.3). **27 Oct:** Reports split into separate pages per area – Doanh thu, Kho & nhập hàng (purchasing merged in, only stock-ins remain), Thuế & kiểm toán; each page switches its reports with tabs and uses the list time filter (12.6, Appendix A). Later the same day: the reports of a page are chosen from a “Báo cáo” dropdown instead of tabs; Doanh thu has no by-cashier report and one “Theo thời gian” report (by day, by month above 92 days) defaulting to the last 30 days; no CSV button on reports; product rows show SKU and product name as separate columns; no summary tiles above the table (12.6). **3 Nov:** Báo cáo ca làm moves from CỬA HÀNG to the top of BÁO CÁO, before Doanh thu (Appendix A). Time filters keep four presets only – Tất cả, 7 ngày qua, 30 ngày qua, Tùy chọn (Hôm nay, Tháng này, Tháng trước dropped); reports have no Tất cả and default to 30 ngày qua; dashboard chart ranges are 7 ngày, 30 ngày and Tùy chọn (10.3, 10.9, 12.1, 12.5, 12.6). Doanh thu drops the by-category and by-payment-method reports: Theo thời gian, Theo sản phẩm, Theo khách hàng remain (12.6). The line above a report table shows only the period. Doanh thu shows its three tables on one page, each with its own Bộ lọc and Xuất Excel; the other report pages keep the dropdown, with Xuất Excel beside it; a thin rule separates the Doanh thu sections; the revenue chart can switch between columns and a line with hover tooltip. Tồn kho gets a header “Nhập thêm hàng” button that opens the stock-in dialog empty with a product search, adding products one at a time (12.4). Kho & nhập hàng drops Chênh lệch kiểm kho and Hàng ký gửi, which repeat the Kiểm kho and Ký gửi screens; Hàng bán chậm becomes the Chưa bán trong filter on Tồn kho; Kho & nhập hàng and Thuế & kiểm toán now show their three reports on one page like Doanh thu; the report dropdown is gone (12.1, 12.6). **3 Nov (R2a):** the province/ward picker shows the old district in brackets only beside a ward name that occurs twice in the province (10.3). Channel profiles (FR-SOC-01) are a “Kênh bán” tab of Cài đặt, shown with `online.manage`; there is no Kênh bán button on Giao hàng (Appendix A). Pre-orders: a “Đặt trước” button in the POS header opens the new pre-order form (customer – an existing customer found by phone or name, or “Khách mới” with phone and name; the cart’s customer is picked by default –, products, deposit); the list is the “Đơn đặt trước” tab of Đơn hàng (tabs Đơn bán · Đơn đặt trước; columns Mã phiếu, Khách hàng, Sản phẩm, Tổng tiền, Đã cọc, Trạng thái, Ngày đặt; Bộ lọc Trạng thái); a row opens the pre-order with “Nhận hàng tại quầy” (opens the POS with the pre-order in the cart), “Đã đặt NCC” and “Hủy phiếu”; a pre-order holds one or more products (added from a product search, each with its quantity) and the form has no Kênh field; “Nhận hàng” loads all its products into the cart with the agreed prices and locked quantities, and the payment screen shows the deposit already paid; the Đặt trước menu item and special orders are removed (13.1, 11.2, 12.8, Appendix A). The “Cần liên hệ” worklist is removed (12.8, 11.2, 12.2, Appendix A): the pre-order record shows the phone as a call link and a “Đã liên hệ” action; Đơn đặt trước filters by status (Đã về = chờ liên hệ). Library (SRS 3 Nov): copy statuses Còn · Đã giữ · Đang mượn · Mất · Hỏng, Quá hạn only on loans (§15); library code and book labels (13.8, 16.5 replaces the member card); borrowers found as customers, loan fee per copy shown at check-out and collected at the POS from a banner under the customer (13.1, 13.8); loan lists with call links; the library reminder emails and the Thành viên, đặt cọc & phí phạt menu item are removed (§17, Appendix A); no reference-only chip (§15); the borrow step shows the buyer loan-fee discount (13.8). Library counts (4 Nov): a Kiểm kê thư viện menu item and count screens modelled on Stock count, with scanning (13.8, Appendix A). Library desk payments: a Thanh toán step in Cho mượn and Gia hạn, “Thu phí” for owed charges, a Sổ thu thư viện page, no library banner on the POS (13.1, 13.8, Appendix A). Library overview: four clickable figures on Mượn / trả and a Tổng quan thư viện card on the dashboard; Mượn / trả lists use the Lọc button instead of tabs (12.5, 13.8). Reservations on the borrow form (4 Nov): “Hết bản” titles become “Đặt giữ” lines, a reservations-only form is “Phiếu giữ sách” without payment, held copies are offered first (13.8). Customer list: “Mua gần nhất” becomes “Hoạt động gần nhất” (shop and library, date only), column and filter; new filter Dịch vụ sử dụng – Tất cả, Chỉ mua hàng, Chỉ thư viện (12.1). Phiếu mượn sách: the Thanh toán section lists Hạn trả, Số lượng, Phí mượn, Ưu đãi (manual % or ₫) and Tổng phí mượn (13.8). Mượn / trả: the four figures sit in one “Tổng quan thư viện” card like the dashboard's; “Tổng số bản sách” reads “Tổng” and “Còn trên kệ” becomes “Đã thu trong tuần” (period set in Cài đặt › Thư viện) (12.5, 13.8). Mượn / trả lists loan slips (Số phiếu, Khách, SĐT, Số sách, Số tiền, Hạn trả, Thời gian tạo, Người thu) with a slip dialog for per-copy actions and receipts; the Sổ thu thư viện page and menu item are removed (13.8, Appendix A). **5 Nov:** the dashboard’s three KPI tiles sit in one “Tổng quan cửa hàng” card with a “Số liệu hôm nay” subtext, on one row on phones too, with the shorter labels Doanh thu, Số đơn, Trung bình (amount followed by a small “/đơn”) and smaller type; the tiles of both cards are always equal width, with type that scales to the tile; Tổng quan thư viện moves up under it and matches it – subtext “Số liệu tuần này” (follows the period setting), three tiles Doanh thu, Đang mượn, Quá hạn with a small “cuốn” unit, no Tổng tile (12.5). |
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
| `paper-50` | `#FBFAF6` | Alternate table row (optional zebra), input read-only |
| `paper-100` | `#F5F2EA` | **Warm white** – app background |
| `paper-200` | `#EDE9DF` | Subtle fills: table header, secondary button, skeleton |
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
| App background | `paper-100` | Every page canvas |
| Surface (cards, tables, dialogs) | `white` | |
| Sidebar | `navy-700` | Text `white` at 100 % / 72 %; active item `navy-900` + 3 px `sand-300` left bar |
| Top bar | `white` with bottom border `paper-300` | |
| Primary action | `navy-700` / hover `navy-800` / pressed `navy-900`, text white | One per view |
| Accent action | `olive-600` / hover `olive-700`, text white | POS “Xác nhận” and at most one similar commit action |
| Secondary action | `white` + border `paper-500`, text `ink-900` | |
| Links | `navy-700`, underline on hover and always inside body text | |
| Focus ring | 2 px `navy-700` + 2 px offset `white`; on navy surfaces 2 px `sand-300` | Visible on every interactive element |
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
│  Overview    │   Content (paper-100 background, white cards)          │
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
| **Page header** | Title `display-md` (Be Vietnam Pro) left; primary action top-right on desktop, under the title on phones (SRS §5.1), left-aligned and **as wide as its label** – header buttons never stretch across the screen. Optional breadcrumb above the title (`body-sm`, `ink-500`). |
| **Content** | Background `paper-100`; content in white cards with 1 px `paper-300` border, radius `lg`. |
| **POS mode** | The selling screen hides the sidebar and uses its own full-screen layout (section 13). A “Thoát POS” (Exit POS) control returns to the shell. |

### 6.4 Page widths and columns

| Page type | Layout |
| --- | --- |
| List | Full content width; table fills the card |
| Detail | `xl+`: 2 columns – main 2/3 (tabs, lines, history) and side 1/3 (status, summary, actions, customer). Below `xl`: single column, summary first |
| Form (create/edit) | Single column max 720 px; long forms split into cards with `heading-lg` titles; sticky action bar at the bottom |
| Settings | Left sub-nav (240 px) + form column max 720 px; sub-nav becomes a select on phones |
| Dashboard | 12-column grid, 24 px gap; the Tổng quan cửa hàng card spans 12 columns, its three tiles always on one row (12.5) |

### 6.5 Density

| Mode | Row height | Where |
| --- | --- | --- |
| Comfortable (default) | 52 px table rows, 40 px inputs | Back office on desktop |
| Touch | 52 px rows, 44 px inputs and buttons | POS, check-in, stock count, any device with coarse pointer (`@media (pointer: coarse)`) |
| Compact (optional user setting) | 40 px rows, 36 px inputs | Reports and long lists for experienced staff, desktop only |

Touch targets are never smaller than **44 × 44 px** on touch devices (NFR-USE-02), POS included; primary POS actions are 52 px. Buttons smaller than 44 px (`sm`, `md`) grow to 44 px under `pointer: coarse`. Keep sizes modest so phone screens do not feel cramped (27 Oct 2026).

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
- Inputs: 1 px `paper-500`; hover `ink-500`; focus `navy-700` + focus ring; error `danger-700`.
- Never use borders and shadows together on the same resting card – pick the border.

### 7.3 Elevation

Shadows are warm-navy tinted, soft and rare.

| Token | Value | Use |
| --- | --- | --- |
| `shadow-none` | — | Cards at rest (use border) |
| `shadow-sm` | `0 1px 2px rgba(34, 52, 79, 0.06)` | Sticky table header, sticky action bar |
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
  --background: var(--color-paper-100);
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
| `accent` | `olive-600` / white | — | Commit action on POS (“Xác nhận”). Max one on screen. |
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

**States:** hover (one step darker), pressed (two steps darker), focus (ring), disabled (`paper-200` background, `ink-300` text, no shadow, `cursor: not-allowed`), loading (spinner replaces icon, label stays, button keeps its width, prevents double submit).

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
| Read-only | `paper-50` background, no border change, text selectable |
| Disabled | `paper-200` background, `ink-300` text |

Validate on blur and on submit, not on every keystroke. On submit failure, scroll to and focus the first invalid field and show a summary at the top of long forms.

### 10.3 Specialised inputs

| Input | Spec |
| --- | --- |
| **Money (VND)** | Right-aligned, tabular, suffix “₫” in `ink-500` inside the field. Formats with dot thousands separators as you type: `1.234.567`. Integers only (BR-01); pasting “1,234,567” or “1234567đ” is normalised. Mobile keyboard `inputmode="numeric"`. |
| **Quantity stepper** | `[–] 12 [+]`; buttons 40 px (48 px touch), field 56 px wide centred. Long-press repeats. Minimum 1 on sales lines; reaching 0 asks to remove the line. |
| **Percentage** | Suffix “%”, one decimal max; shows the computed VND amount as helper (“= 12.000 ₫”). |
| **Phone** | `inputmode="tel"`; displays grouped `0912 345 678`; on blur, if the number matches a customer, show an inline match card (“Đã có khách hàng: Nguyễn Văn A”) (BR-16). |
| **Search** | Leading `Search` icon, clear button `X`, 300 ms debounce. Placeholder names what can be searched. Helper text once per screen: “Tìm không dấu cũng được” (search ignores diacritics). |
| **Barcode / scan field** | Code-style text, no leading icon; a round `ScanBarcode` button at the end of the field opens the camera scanner. Keyboard-wedge input auto-submits on Enter. (FR-POS-10). See 13.3. |
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
| Phones | Table scrolls horizontally with the first column sticky (SRS §5.1). The order inbox stays a table on phones too. For event check-in and stock count, use a **card list** instead (see 12.2). |
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
| **Dialog** | Width 480 (sm), 640 (md), 880 (lg); radius `lg`; `shadow-lg`; padding 24; title `heading-md`; close `X` top-right; footer actions right-aligned (secondary, primary). Full-screen on phones. `Esc` closes unless there are unsaved changes. |
| **Confirmation (destructive)** | Title states the action as a question (“Hủy đơn #DH-10234?”); body states the consequence (“Tồn kho đã giữ sẽ được trả lại. Không thể hoàn tác.”); buttons “Không” (secondary) and “Hủy đơn” (`destructive`, never just “OK”). For posting/irreversible money actions, require a reason field when the SRS asks for one (voids FR-POS-14, waivers FR-LIB-10). |
| **Approval / supervisor PIN** (FR-ADM-09) | 400 px dialog with `ShieldCheck` icon in a `navy-100` circle; title “Cần quản lý duyệt”; the reason in plain words (“Giảm giá 15 % vượt hạn mức 10 % của bạn”); approver selector + 6-digit PIN pad (13.5) or “Đăng nhập bằng mật khẩu” link; shows lockout after 5 attempts. The approved state shows approver name for 1.5 s, then continues the action. |
| **Filter popover** (SRS §5.1) | Opened by the “Bộ lọc” button; anchored under it, 300 px (max screen width − 32 px), `shadow-md`, radius `lg`. **Each filter field is a dropdown** (accordion row, 44 px): field name left (“Thời gian”, “Trạng thái”, “Thanh toán”), the current choice summary in `ink-500` (“Tiền mặt, Thẻ” or “2 đã chọn”), `ChevronDown` that turns when open. Opening a field shows its options: **multi-select fields have a checkbox in front of each option** (18 px, `navy-700` when checked) so several values can be combined (e.g. Tiền mặt + Thẻ); the time field is single-choice (radio) with presets “Tất cả”, “7 ngày qua”, “30 ngày qua”, “Tùy chọn” (Từ ngày / Đến ngày, store timezone). Changes apply immediately; fields combine with AND, values inside a field with OR. Footer “Xóa bộ lọc” (ghost). Escape or a click outside closes it. |
| **Drawer** | Right side, 480 / 640 px, for quick views (customer preview, order preview from the inbox) without leaving the list. |
| **Bottom sheet** | Phones and tablet POS: radius `xl` top corners, drag handle 32 × 4 px `paper-300`, max height 90 %. |

### 10.10 Toasts and banners

| Type | Spec |
| --- | --- |
| **Toast** (SRS §5.1) | Bottom-right on desktop, bottom-centre above the action bar on phones; width 360; white, `shadow-md`, radius `lg`, 4 px left border in tone colour + tone icon. Success auto-dismiss 4 s; error stays until dismissed and includes the next step or a “Thử lại” action. Max 3 stacked. Never use a toast for something the user must act on later – use a banner or the notification centre. |
| **Inline alert** | Inside a page or form: tone surface, tone icon, `body-md` text, optional action link. For e.g. “Sản phẩm này đang bị ẩn trên website”. |
| **Page banner** | Full-width under the top bar for system states: offline (13.2), lease expiring, “Có 3 đơn mới” on the inbox (clicking scrolls to top and refreshes, FR-ORD-03), read-only POS tab (TDD §7.4). |

### 10.11 Notification centre

Bell in the top bar with a count badge. Panel 400 px, `shadow-md`, grouped “Hôm nay / Trước đó”; each item: tone icon, title `body-md` 600, one-line detail, relative time (“5 phút trước”), unread dot; clicking opens the related record. Footer “Đánh dấu đã đọc tất cả”. In-app only (FR-ADM-08).

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
- **Wizard stepper** (first-run wizard FR-ADM-02, import wizard FR-ADM-07/FR-CAT-11): horizontal numbered steps on desktop (“1 Tải tệp · 2 Kiểm tra · 3 Xem trước · 4 Nhập”), compact “Bước 2/4” on phones. Completed = `navy-700` check, current = navy outline, upcoming = `paper-500`.

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
- **Product list (27 Oct 2026):** header actions “Nhập từ Excel” (opens the import wizard in a dialog on this page, 12.10; the template is downloaded from inside the wizard, so there is no separate “Tải file mẫu” button), “Thêm sản phẩm” – **“Thêm sản phẩm” opens its own page, “Thêm sản phẩm mới” (`/products/new`)**, a form page (12.4) – no detour through stock-in (FR-CAT-01). Fields are grouped in cards with plain titles, in this order: **Thông tin sản phẩm** (one card) – Loại, SKU, Tên sản phẩm, Danh mục, Nhà cung cấp (required select), Mô tả, ISBN, Tác giả, Nhà xuất bản (books) or Mã vạch (other goods; empty = internal barcode), Đơn vị (free text with suggestions from the master-data units: cuốn, cái, hộp, bộ…), Khối lượng; **Giá** – Giá nhập (required), Giá bán, and once both are filled a line “Lãi mỗi sản phẩm: 25.000 ₫ (25%)” (selling price − cost, share of the selling price; `danger-700` when negative); **Tồn kho và thuế** – Số lượng nhập lần đầu (required, at least 1), Tồn tối thiểu, Thuế VAT; when the chosen supplier takes consignment a “Hàng ký gửi” tick appears and, ticked, Chiết khấu thỏa thuận (%) and Hạn đối soát / trả hàng – the opening quantity then enters as a consignment stock-in; **Ảnh sản phẩm**. Labels are short, with no notes in parentheses (hints go in helper text). Required (FR-PUR-02): SKU, Tên sản phẩm, Danh mục, Nhà cung cấp, Mô tả, Giá nhập, Giá bán, Khối lượng, Số lượng nhập lần đầu, Ảnh sản phẩm (one photo; the card says “Bắt buộc một ảnh (JPG, PNG hoặc WebP).”; FR-PUR-02). Sticky action bar: “Hủy” (back to the list) and **“Thêm sản phẩm mới”**; afterwards the product detail page opens. Saving creates the product and its first stock-in together (FR-PUR-02): one `SI` entry from the chosen supplier for Số lượng nhập lần đầu at Giá nhập (FR-PUR-04), or a consignment stock-in when “Hàng ký gửi” is ticked. The search box is the standard one (icon vertically centred, no hint line under it). **Bộ lọc** groups: Tồn kho (multi: Còn hàng, Sắp hết, Hết hàng), Loại (multi: Sách, Văn phòng phẩm, Sản phẩm khác, Combo), Phân loại (multi: the category tree, children indented under their parent; when Loại is set only categories holding items of those types are offered), Trạng thái (multi: Đang bán, Ẩn, Ngừng bán), Ảnh (Thiếu ảnh). **Columns:** checkbox, **SKU** (first, code style), Ảnh, Tên sản phẩm (with author/brand), Tồn (on hand; bundles show what their components allow), Giá bán, Giá nhập (average cost – only with `catalog.view_cost`, otherwise the column is omitted), Trạng thái, Cập nhật (date of the last change to the product or its variant). **Bulk barcode printing (FR-CAT-13):** ticking rows (or the header checkbox for the page) shows the bulk bar (10.6) “Đã chọn 5 sản phẩm · [In mã vạch]”; “In mã vạch” opens the label dialog (Mẫu nhãn, Khổ giấy, Bắt đầu từ ô số, Số nhãn mỗi sản phẩm – default 1, editable per row) and prints one sheet for all selected products. Show the store’s own **SKU only**. SKU and ISBN are different fields: SKU is the code the store assigns to each sellable variant (e.g. `SACH-NNA-0012`, `VPP-0012`); ISBN is the publisher’s book identifier and appears on the product detail page and in search, never in the SKU column. There is **no channel (POS/website) column** in the list; publication channels are shown on the product detail page.
- **Customer list columns:** Khách hàng, Số điện thoại, Hạng, Điểm, Số đơn, Tổng mua, Hoạt động gần nhất (date only, `dd/MM/yyyy`; “—” when none; purchases and library use alike, FR-CRM-02) – short titles; Số đơn, Tổng mua and Điểm right-aligned. **Filters** (Bộ lọc beside the search box, FR-CRM-02): Hạng (multi: Thường, Bạc, Vàng), Hoạt động gần nhất (single: 30 ngày qua, 90 ngày qua, 6 tháng qua, Hơn 6 tháng không hoạt động, Chưa hoạt động lần nào), Dịch vụ sử dụng (single: Tất cả – the default, no filter –, Chỉ mua hàng, Chỉ thư viện), Số đơn (multi: 0, 1, 2–5, 6–10, Trên 10), Điểm (multi: 0, 1–99, 100–499, 500–999, Từ 1.000).
- **Stock list (“Tồn kho”, 27 Oct 2026):** one screen for stock and stock-in – there is no separate “Nhập hàng” menu item or stock-in entry list. Header: total stock value “Giá trị tồn kho: 1.485.298 ₫” (`catalog.view_cost` only) on a line **under** the page title (`body-md`, `ink-500`, amount 600). Search box + **Bộ lọc** with Tình trạng (multi: Còn hàng, Sắp hết, Hết hàng) and Thay đổi gần nhất (single choice: Tất cả, 7 ngày qua, 30 ngày qua, Tùy chọn – products whose latest stock movement falls in the range, store timezone) and Chưa bán trong (single choice: Tất cả, 30 ngày, 60 ngày, 90 ngày – products still in stock with no sale in that time, never-sold included; FR-INV-10). Table like the product list: checkbox, SKU, Ảnh, Tên sản phẩm, Tồn, Tối thiểu, Giá nhập (with `catalog.view_cost`), Tình trạng (chip), Thay đổi gần nhất (date and time of the latest stock movement). Ticking rows shows the bulk bar (10.6) “Đã chọn n sản phẩm · [Nhập thêm hàng] [Điều chỉnh tồn]”, with the selected list expandable and each one removable. **Nhập thêm hàng** opens the stock-in form (12.4) with exactly the ticked products – no product search and no “Sản phẩm mới” in it (new products are created on the Products page; untick or add rows on the Stock page instead) – quantity and cost per product, supplier, supplier invoice number and consignment for the whole receipt; it still posts one stock-in entry (FR-PUR-01..06). **Điều chỉnh tồn** opens one dialog listing the ticked products; **each row has its own +/− quantity and its own reason** (Hỏng, Mất, Tìm thấy, Sửa sai số liệu, Tặng/biếu – from the reason-code master data), plus one optional shared note and the write-off tick; there is **no location field** (one stock location, FR-INV-01). Lines over the approval threshold ask for a supervisor PIN one by one (FR-INV-07). Clicking a row opens the product’s **stock page** (`/stock/{product}?v={variant}`): on hand, held and available, average cost, minimum level, and the full movement history (receipts with entry number and supplier, sales, returns, adjustments, counts) with a type filter; actions “Nhập thêm hàng” and “Điều chỉnh tồn”.
- **Shift list (“Ca làm”):** search box (shift number or cashier name, accent-insensitive) + Bộ lọc beside it: Quầy (multi, one option per register, e.g. Quầy Q1, Quầy Q2) and Thời gian (single choice: Tất cả, 7 ngày qua, 30 ngày qua, Tùy chọn – by the day the shift opened, store timezone).
- **Promotion list (“Khuyến mãi”):** search box (name or code, accent-insensitive) + Bộ lọc beside it: Thời gian (single choice: Tất cả, 7 ngày qua, 30 ngày qua, Tùy chọn – shows programs whose run period overlaps the range) and Trạng thái (multi: Đã lên lịch, Đang chạy, Tạm dừng, Hết hạn). Columns: Mã (code style, “—” when the program has no code), Chương trình (name), Ưu đãi, Áp dụng, Thời gian, Trạng thái. **No row actions:** the whole row opens the editor; “Tạm dừng” / “Chạy lại” live in the editor dialog, in a status row at the top (status chip + secondary pill), hidden for expired programs (FR-PRM-04).
- **POS sales list (“Đơn bán”) filters:** Thời gian (single choice, presets + custom range), Trạng thái (Hoàn tất, Đã hủy – multi), Thanh toán (Tiền mặt, Chuyển khoản, Thẻ – multi) (FR-POS-07).
- **POS sales list (“Đơn bán”) columns:** Mã đơn, Thời gian, Khách hàng, Thu ngân, Thanh toán, Tổng tiền, Trạng thái. Trạng thái shows the sale status only (Hoàn tất / Đã hủy); the e-invoice chip (“Chờ xuất”, “Đã xuất”, …) is **not** shown in the list – it appears on the sale record. Failed e-invoices still reach staff through the notification centre and the menu badge (FR-ADM-08).
- Rows needing action sort first where the SRS asks (order inbox).
- Filters, sort and page persist in the URL so a link or back button restores the view.

### 12.2 Card list (phones and live lists)

For event check-in and stock count on phones. The order inbox is **not** a card list; it is a table (12.9).

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
- **Product record:** header keeps “In nhãn” only. Under the title, beside the type/status chips, a **“Bán trên website” toggle switch** (on/off, per variant – prefixed with the SKU when there are several) saves at once; there is no “Tại quầy” control because every item is sold at the counter (FR-CAT-09). Cards top to bottom, each with its own “Sửa” (small tonal pill, `Pencil`) at the top-right: **Thông tin sản phẩm** – photo on the left (first image, thumbnails and “Thêm ảnh” under it; placeholder when none), on the right SKU, Tên sản phẩm, Tác giả, Danh mục, Trạng thái (plus Dịch giả, Năm xuất bản, Số trang, Đơn vị when set), and Mô tả below across the full width (stacked on phones); **Giá bán** – Giá bán, Giá vốn, Lãi mỗi sản phẩm (amount and %), Thuế VAT, with “Lịch sử giá”; “Sửa” opens the price change; **Tồn kho** – Tồn kho, Đang giữ, Có thể bán, Tồn tối thiểu, Mã vạch, Khối lượng; “Sửa” edits minimum stock, weight and barcodes. With several variants the price and stock cards repeat per SKU.
- **Customer record:** header = name with an icon-only “Sửa” button (`Pencil`, ghost, `aria-label` “Sửa”) placed directly beside the `⋯` button on the title row, on every screen size. **No tabs**: the main column is one card “Mua hàng” (purchases with totals, FR-CRM-03) followed by one card “Điểm” (points ledger, latest 50, with “Điều chỉnh điểm”); the side column is the “Hồ sơ” card (phone, email, birth date, tier, points). There is no store credit anywhere on the page.
- **Sale record – Hóa đơn điện tử card** (FR-POS-15..17): always shown on a completed sale. Facts: Trạng thái (chip, or “Chưa xuất” when there is no invoice yet), Số hóa đơn, Người mua, Gửi email. Actions: “Xuất hóa đơn” (primary pill, `FileText`) when there is no invoice yet or it is still pending – it opens a dialog for the buyer’s details (Tên người mua / đơn vị – required; Mã số thuế, Địa chỉ, Email – optional; with email the invoice is emailed, FR-POS-16) and queues the invoice; “Gửi lại cho khách” (secondary) on an issued invoice to add buyer details or email it; “Thử lại” on a failed one (with `einvoice.manage`). Hidden on voided sales and on cancelled/adjusted invoices.
- Sensitive values (cost, margin, payroll) are omitted entirely without permission – no “hidden” placeholders (TDD §10.3).

### 12.4 Forms

- Single column, grouped in cards; labels above fields; related short fields side by side on `sm+` (e.g. Cost / Selling price).
- **Sticky action bar** at the bottom (white, `shadow-sm` top, 64 px): “Hủy” secondary, primary right. On phones full-width primary.
- Unsaved-changes guard on navigation: dialog “Bỏ các thay đổi chưa lưu?” with “Tiếp tục chỉnh sửa” / “Bỏ thay đổi”.
- **Import from Excel** (FR-CAT-11, FR-PUR-14): the Products screen and the Stock-in screen each have a secondary pill button “Nhập từ Excel” next to the primary action, with a “Tải file mẫu” link. It opens the import wizard (12.10). The template has **separate columns for SKU and ISBN** (SKU required, ISBN optional); they are never merged. In the preview table and every list, only **SKU** is shown as the code column; ISBN appears only on the product detail page. Stock-in preview: one header card “1 phiếu nhập · 48 dòng · 6 sản phẩm mới · tổng giá nhập …”, rows tagged “Sản phẩm mới” (accent chip) or “Cộng tồn” (neutral), new products without an image tagged “Thiếu ảnh” (neutral, `ImageOff` icon – a reminder, not an error), error rows in `danger`, margin warnings in `warning`; “Xác nhận nhập hàng” posts the whole file as one entry.
- **Quick stock-in** (FR-PUR-03): the “Nhập thêm hàng” dialog on Tồn kho opens two ways. From the bulk bar it holds only the ticked products – no scan or search field. From the primary **Nhập thêm hàng** button in the page header (with `purchasing.manage`) it opens empty with a search field on top – placeholder “Tìm SKU, tên sản phẩm”, no scan icon; each pick adds one line (picking the same product again adds 1 to its quantity), so products are entered one at a time into one entry. Neither way has new-product lines (a new product is created on “Thêm sản phẩm mới”, optionally with an opening quantity, 12.1); each line is a compact card with cover, name and only Cost / Selling price / Quantity. Margin warning inline (`warning-50`) when below `purchasing.min_margin_bp` (FR-PUR-05).
- Optimistic concurrency conflict (TDD §3.6): inline alert “Bản ghi đã được người khác cập nhật” with “Tải lại” and a side-by-side diff where practical.

### 12.5 Dashboard (FR-RPT-01)

Order top to bottom: greeting `display-md` (“Chào buổi sáng, Lan”, Be Vietnam Pro) + date; the Tổng quan cửa hàng card; the Tổng quan thư viện card; charts (revenue trend, sales by channel); lists (bestsellers, low stock, upcoming events). Tiles the user has no permission for are not rendered – the grid reflows.

- **Tổng quan cửa hàng (today only):** one full-width white card titled “Tổng quan cửa hàng”, with a subtext line under the title (`body-sm`, `ink-500`) saying the figures are for today – “Số liệu hôm nay” (no update time; the figures refresh every minute). Inside, three summary tiles on **one row at every width, phones included** (3 **equal** columns at every width – gap 6 px, 12 px on `sm+`; below `sm` the card’s side padding is 8 px) – white, 1 px `paper-300` border, radius `lg`, padding 10 × 6 px (16 px on `sm+`). Type scales with the tile (CSS container query units on the tile): label `ink-500` at 9.5 % of the tile’s inner width, clamped 11–14 px; value semibold at 13 %, clamped 11–20 px (about 12 px on a 375 px phone, 19–20 px on desktop), so “985.000 ₫/đơn” still fits on a phone. Labels are kept short so they fit: “Doanh thu”, “Số đơn”, “Trung bình” (today’s revenue ÷ today’s orders), whose amount is followed by a small “/đơn” (regular weight, `ink-500`, 0.7 × the value size, at least 10 px) so the unit sits with the number instead of in the label; if a label ever wraps, values stay aligned at the bottom of the tiles. Below `sm` money values use the compact form (“12,5 tr ₫”) with the full amount as the accessible name; from `sm` the full amount is shown. No week or month tiles; longer periods are read from the charts and reports.
- **Range filter:** each chart card has a secondary pill button in its header (right side) with the `ListFilter` icon and the current range as its label (e.g. “7 ngày”). Clicking it opens a popover (`shadow-md`, radius `lg`, 280 px) listing the presets “7 ngày”, “30 ngày” (selected one checked) and a “Tùy chọn” section with Từ ngày / Đến ngày pickers and an “Áp dụng” primary pill (store timezone, max 366 days, TDD §4.11). Picking a preset applies it and closes the popover; Escape or a click outside closes it without change. The custom range shows on the button as “dd/mm – dd/mm/yyyy”. The choice is per card and kept for the session.
- **Doanh thu (trend):** default 30 ngày. Bars = revenue (left axis, `navy-700`); line = number of orders (right axis, `sea-500`, 2 px, dot markers), with a legend “Doanh thu · Số đơn”. Ranges up to 92 days group by day, longer ranges by month. First and last period labels on the x-axis; the latest revenue labelled directly.
- **Doanh thu theo kênh:** default 30 ngày; one bar per channel with amount and share.
- **Tổng quan thư viện** (FR-LIB-15a, with `library.lend`): sits right under Tổng quan cửa hàng and is built the same way – one full-width white card, the title with a subtext line under it, three equal bordered tiles on one row at every width (same padding, scaled type and compact-money rule as Tổng quan cửa hàng). The subtext follows the period setting (Cài đặt › Thư viện): “Số liệu hôm nay”, “Số liệu tuần này”, “Số liệu tháng này”. Tiles: **Doanh thu** (amount collected in that period, cash-book receipts less refunds; regular `ink-900`), **Đang mượn** and **Quá hạn** (copies; the number is followed by a small “cuốn” styled like “/đơn”; Quá hạn turns `danger-700` when above 0). Each tile is a link (hover border `navy-700`): Doanh thu → Mượn / trả showing all slips created in that period, Đang mượn → Mượn / trả, Quá hạn → Mượn / trả filtered Quá hạn. There is no Tổng (copies) tile on the dashboard. Below the tiles, when there are overdue loans, the table “Sách mượn quá hạn” (Sách, Người mượn, Trễ) and a “Xem chi tiết” pill. Mượn / trả keeps its own four-figure card at the top (13.8): Tổng (copies, all but lost) → Quản lý đầu sách, Đã thu trong tuần (`success-700`; the label follows the period setting – “Đã thu hôm nay”, “Đã thu trong tuần”, “Đã thu trong tháng”), Đang mượn, Quá hạn, in a 2 × 2 grid (4 across on `xl`), without the table.
- **Lists** have a column header row (`caption`, `ink-500`): Bán chạy tháng này – “#”, “Sản phẩm”, “SKU”, “Đã bán”; Sắp hết hàng – “Sản phẩm”, “SKU”, “Còn / Tối thiểu”. Below the Sắp hết hàng table, right-aligned, a tonal pill button “Xem chi tiết” opens the product list filtered to low stock.

### 12.6 Reports

- One page per report area, each its own sidebar item under BÁO CÁO (Appendix A): **Doanh thu** (`/reports/sales`: revenue over time, by product, by customer), **Kho & nhập hàng** (`/reports/inventory`: stock on hand, movements, stock-ins – count variances live on each stock count, consignment stock on Ký gửi, slow-moving stock is the Chưa bán trong filter on Tồn kho), **Thuế & kiểm toán** (`/reports/tax`: output VAT, e-invoice register, shifts and cash variance). `/reports` opens Doanh thu (named so it is not confused with the POS item “Bán hàng”). Event, library, customer and HR report pages are added with those modules.
- Every report page shows all its reports on one page, one after another (no dropdown, no tabs) – Doanh thu: Theo thời gian, Theo sản phẩm, Theo khách hàng; Kho & nhập hàng: Tồn kho hiện tại, Nhập – xuất – tồn, Phiếu nhập hàng; Thuế & kiểm toán: Thuế GTGT đầu ra, Hóa đơn điện tử, Ca làm và chênh lệch tiền. Each is a section with its title on the left and its own toolbar on the right – Bộ lọc (time) and Xuất Excel – so each table keeps its own range (URL params `time-period`, `time-item`, `time-customer`, `time-movements`, `time-stockins`, `time-vat`, `time-einvoices`, `time-shifts`) and exports on its own; a snapshot report (Tồn kho hiện tại) has only Xuất Excel. Sections are parted by a thin 1 px `paper-300` rule with 32 px space above and below – no boxes around them.
- Date range uses the list filter button (12.1) with one “Thời gian” group: 7 ngày qua, 30 ngày qua, Tùy chọn – no “Tất cả”. Default: 30 ngày qua on every report page. Reports that are a snapshot (stock on hand) hide it.
- Doanh thu “Theo thời gian” is one report for by-day and by-month: rows per day, or per month when the range is longer than 92 days (same rule as the dashboard chart). Its revenue chart has a two-option toggle in the chart header, **Cột | Đường** (default Cột, kept in the `chart` URL param). Both plot every day (or month) of the range, zero where nothing sold. Cột: navy-700 bars, at most 24 px wide, 4 px rounded tops. Đường: one 2 px navy-700 line with a faint navy area under it, hairline solid gridlines with compact ₫ labels on the left, first / middle / last period labels below; hovering or arrow keys move a vertical crosshair that snaps to the nearest period, a dot (r 4, 2 px white ring) and a dark tooltip with the amount (bold) over the date. The table below stays the accessible view.
- Rows about a product show SKU and product name as two columns, never joined in one cell.
- “Xuất Excel” button shown only with the export permission (FR-RPT-10); there is no CSV export for reports. PDF uses the print layout in section 16 when built.
- Above the table only the period is shown (“Từ 05/10/2026 đến 03/11/2026”), not the report name, which the section title already shows; snapshot reports show no line.
- No summary tiles: the chart (Theo thời gian only) comes first, then the table; the totals row carries the sums. Totals row bold, `paper-200` background. Totals drill down to documents (FR-RPT-11): underlined numbers on hover with `ChevronRight`.
- Margin and profit columns appear only with the profit permission.

### 12.7 Website content management (FR-WEB-23..45)

- Every content list shows a status chip (11.2) and “Cập nhật bởi … lúc …”.
- Editing screens have a top bar: status chip, “Xem trước” (secondary, `Eye`), “Lưu nháp” (secondary), and – with publish permission – “Đăng” split button (Đăng ngay / Lên lịch…). Without `web.content.publish` the “Đăng” button is not shown and the user saves drafts only (FR-WEB-43); there is no separate “send for approval” step in the SRS.
- **Collection rule builder** (FR-WEB-29/31): rows of “[Danh mục ▾] [là ▾] [Thiếu nhi ▾] [+ gồm danh mục con]” joined by an AND/OR segmented control; a live preview card on the right: “Khớp 128 sản phẩm” + 6 cover thumbnails, refreshed as rules change; empty match shows a warning.
- **Home sections** (FR-WEB-33/34): ordered list of section cards with drag handle **and** up/down buttons (keyboard and touch accessible); each card shows type icon, title, source, item count and a show/hide toggle. Range errors inline (“Từ 4 đến 16 sản phẩm”).
- **Menu editor** (FR-WEB-35): two-level tree with the same reorder controls; counters “6/8 mục cấp 1”.
- **Publish queue** (UC-29): list of draft changes with checks; blocking problems as `danger` rows that disable publishing, warnings as `warning` rows with “Bỏ qua kèm ghi chú”. Broken/empty targets flagged with `AlertTriangle` (FR-WEB-36).
- There is deliberately **no visual page designer**; previews open the front end’s preview mode in a new tab.

### 12.9 Live order inbox (FR-ORD-03)

- **Layout:** a table (10.6) on every screen size, never a card list. Columns: Mã đơn (code style, sticky first column), Khách hàng (name + phone), Kênh (name only, no colour dot), SP (count), Tổng tiền, Thanh toán (chip), Trạng thái (chip + review reason), Thời gian. Above the table: search box (“Tìm mã đơn, người nhận, SĐT, mã vận đơn…”) with the **Bộ lọc** button beside it; on phones the order-status chips (Mới, Cần xem xét, Đã xác nhận, Đang giao …) live inside that filter (12.1). On phones the table scrolls sideways with Mã đơn fixed. Unread rows: `sand-50` + navy dot + bold until opened; rows needing action sort first (FR-ORD-05).
- New arrivals: page banner “Có 3 đơn mới” with a `tonal sm` pill button “Xem đơn mới” (info tone) rather than shifting rows under the user’s cursor; clicking inserts them at the top with `sand-50` highlight.
- Sidebar count badge on “Giao hàng” for orders needing action.
- Auto-refresh indicator in the page header: “Cập nhật 10 giây trước” with `RefreshCw`.

### 12.10 Import wizard (FR-CAT-11, FR-ADM-07)

Stepper: Tải tệp → Kiểm tra → Xem trước → Nhập. Download template link on step 1. **On the Products page the wizard opens in a large dialog** (“Nhập sản phẩm từ Excel”, full-screen on phones) with the data type fixed to products – staff never leave the Products page; closing the dialog after a successful import refreshes the list. The standalone “Nhập dữ liệu” page remains for stock-in files and customers. Validation table shows row number, column, value and message; filter “Chỉ hiện dòng lỗi”; “Tải báo cáo lỗi” button. Commit step shows a progress bar and a summary (imported / skipped / errors); rollback action where allowed.

---

## 13. POS and touch screens

The POS is the most-used screen. It runs full-screen without the sidebar, on a counter PC (keyboard + scanner), a tablet or a phone (FR-POS-01, FR-POS-10/11).

### 13.1 Selling screen layout

**Desktop / tablet landscape (≥ 1024 px):**

```
┌──────────────────────────────────────────────────────────────────────────┐
│ [≡] Lan · Quầy Q1                                           [Giỏ chờ 2]  │  56px navy-700
├──────────────────────────────────────────┬───────────────────────────────┤
│ [Nhập SKUs/tên sản phẩm        ] (▥)    │ Khách: [+ Thêm khách]         │
│                                          │ ─────────────────────────────  │
│  Search results / quick tiles            │ Cho tôi xin một vé…            │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐             │ 98.000 ₫     [–] 1 [+]   ⋯     │
│  │cover│ │cover│ │ Vé │ │Phạt│            │ Bút bi Thiên Long xanh         │
│  │    │ │    │ │sự kiện│ │TV │            │ 6.000 ₫      [–] 3 [+]   ⋯     │
│  └────┘ └────┘ └────┘ └────┘             │ ─────────────────────────────  │
│                                          │ Tạm tính            116.000 ₫  │
│                                          │ Khuyến mãi           −10.000 ₫ │
│                                          │ TỔNG                106.000 ₫  │  pos-total
│                                          │ [Giữ giỏ] [Mã giảm giá] [Điểm] │
│                                          │ (         Xác nhận           ) │  accent xl pill
└──────────────────────────────────────────┴───────────────────────────────┘
       left: flexible                            right: cart 400–440 px
```

**Tablet portrait / phone:** one screen, no bottom sheet. Under the search field the whole cart sits in one white card that fills the remaining height: customer row at the top, cart lines in the middle (scrolls), and totals, “Giữ giỏ / Mã giảm giá / Điểm” and the “Xác nhận” button pinned at the bottom of the card – the cashier never opens a second panel. While a search is active the card is replaced by the results; picking a result brings the cart back.

**Area under the search field:** while a search is active it shows the results (or “Không có sản phẩm phù hợp.”). Otherwise it shows the cart card on tablet portrait / phone and nothing on desktop (the cart is already on the right). An empty cart, in either place, shows an empty state in the lines area – `ShoppingCart` icon 48 px `ink-300` and “Chưa có sản phẩm nào được chọn” (`body-md`, `ink-500`), centred.

| Element | Spec |
| --- | --- |
| POS header | `navy-700`, 56 px, white text: cashier and register only (“Lan · Quầy Q1”; the shift number is not shown – it is in the shift menu and on the shift report); connection pill only when syncing, offline or in error (13.2; no “Trực tuyến” pill while online); held carts count and a “Đặt trước” button (with the count of pre-orders past their holding period) that opens the new pre-order form (FR-POS-09). **No lock button and no “test offline” button**; the POS still auto-locks after `pos.lock_minutes` (13.5), and the offline state appears only when the connection is actually lost (13.2). |
| Search field | 48 px tall, `body-lg`, placeholder **“Nhập SKUs/tên sản phẩm”**, **no leading icon**. A separate round 48 px `ScanBarcode` icon button (`navy-50` / `navy-700`) sits **beside** the field on its right, 8 px gap, not inside it, and opens the camera scanner (13.3). The field stays **focused** after every action so a keyboard-wedge scanner works without clicking (TDD §8.7). Results appear below as a list of 72 px rows (cover 40 × 60, title, author, SKU in code style, price, available stock). |
| Quick tiles | 120 × 120 px, radius `xl`, for service items only (event tickets – FR-POS-08). Library fees are not taken at the POS (FR-LIB-09a). No merchandise tiles (e.g. tote bags); goods are added by search or scan. |
| Cart line | Three rows: title `body-md` 600 (2 lines max) with `⋯` at the right; unit price `body-sm` `ink-700` below it; then a compact stepper on the left – 28 px outlined circles (`paper-500`, `Minus` / `Plus` 14 px) around the quantity `body-md` 600, 32 px wide – and the line total right-aligned tabular on the same row. Each stepper circle keeps a 44 px touch area (NFR-USE-02) with the extra space invisible; promotion saving below in `success-700` (“Giảm 10.000 ₫ – Mua 2 tặng 1”, FR-POS-05); swipe-left or `⋯` for discount/price override/note/remove. |
| Customer | “Thêm khách” opens a small dialog with one field “Số điện thoại hoặc tên” (FR-POS-04). Digits only (≥ 9) look up the exact phone; otherwise, from 2 characters, it searches names without accents and lists up to 8 matches (name, phone, points) as 56 px rows; tapping one attaches it. No match by phone offers “Tạo khách hàng” (with `customer.manage`, online). Offline, the search runs on the cached customer list (TDD §7.1). |
| Totals | Subtotal and discounts `body-md`; label “TỔNG” `heading-md`; total `pos-total` on the same row, right-aligned, never wrapping; points to earn shown under the customer when attached. |
| Confirm button | Label **“Xác nhận”** with `Check` icon; `accent` (olive) `xl` pill, full cart width, no shortcut label. Opens the payment screen (13.4). Disabled with reason when the cart is empty or shift is closed. |

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

### 13.3 Scanning

- **Hardware scanner:** successful add → line flashes `sand-50` 600 ms + short beep (setting, default on). Unknown barcode → field shakes 2 px (or border flash under reduced motion), `danger` inline message “Không tìm thấy mã 8934…”, with “Tìm theo tên” and (with permission) “Tạo sản phẩm”.
- **Camera scanner:** opened by the `ScanBarcode` button beside the search field; full-screen overlay, dark scrim `rgba(20, 32, 51, 0.85)`, a 280 × 160 px rounded frame with `sand-300` corners, hint “Đưa mã vạch vào khung”, torch toggle, close button 48 px. Continuous mode for stock counts (shows running count), single mode for POS.

### 13.4 Payment screen

Full-width sheet/dialog over the cart:

- Amount due in `pos-total` at the top.
- Method tiles – **always on one row**, equal widths, 3 tiles even on a 360 px phone; 72 px tall, radius `xl`, icon 24 px, label `body-sm` 500 centred: Tiền mặt (`Banknote`), Chuyển khoản (`QrCode`), Thẻ (`CreditCard`). There is no store-credit tile (store credit removed 27 Oct 2026). Selected tile: `navy-700` border 2 px + `navy-50` fill.
- **Cash:** numeric keypad (52 px keys) + quick-amount chips (exact, 50.000, 100.000, 200.000, 500.000 ₫); “Tiền thừa” (change) in `pos-total` `success-700`.
- **Bank transfer:** the store uses its **printed QR code** at the counter; the screen shows **no QR**. It shows the amount and the payment reference in `code-xl` (copy-able code display, 10.13) with the hint “Khách quét mã QR in sẵn tại quầy và ghi mã tham chiếu vào nội dung chuyển khoản”; buttons “Đã nhận tiền” (primary, pressed after checking amount and reference) and “Hủy” (FR-POS-06). Offline: recorded as unverified with a warning chip.
- **Card:** field for approval code (code style, required).
- **Split payment:** list of tenders with remaining amount shown prominently until it reaches 0.
- **Completion:** checkmark in a `success-50` circle, sale number `code-xl`, change due, and actions: “Đơn mới” (primary), “Gửi hóa đơn điện tử qua email” (opens buyer details form, FR-POS-16), “In” only if a slip is wanted. No receipt is printed by default (FR-POS-07).

### 13.5 Lock screen and PIN pad (FR-ADM-01, NFR-SEC-07)

- Auto-lock after `pos.lock_minutes` (default 5). Navy full-screen, logo (reversed), cashier name + avatar, 6 PIN dots, keypad of 72 × 72 px keys in a 3 × 4 grid (white 10 % on navy, white digits 28 px), “Đổi người dùng” link.
- Wrong PIN: dots shake, message “Mã PIN không đúng (còn 3 lần)”; lockout message after 5.
- Same keypad component (light variant: white keys with `paper-300` border) is used in the approval dialog.

### 13.6 Shift open and close (FR-POS-18..20)

- Open: one field “Tiền đầu ca” (money input) + optional denomination counter.
- Close: denomination table (500.000 → 1.000 ₫ notes, quantity steppers, running total), then a summary card: Expected / Counted / **Variance** (variance `danger-700` if negative, `warning-700` if positive, `success-700` with “Khớp” if zero). A non-zero variance requires “Lý do chênh lệch”. **The close button is never disabled for variance** – only for a missing reason (BR-06).

### 13.7 Event check-in (FR-EVT-10)

Phone/tablet card list with a large search field (name or phone), live counter at the top “Đã check-in 86 / 120” with a progress bar (`navy-700` on `paper-200`). Each attendee card: name, phone, ticket type, payment chip, registration number in code style; actions “Check-in” (primary lg) and, for unpaid, “Thu tiền & check-in”. Already checked-in → card turns `success-50` with time; a second attempt shows “Đã check-in lúc 18:42”. Walk-in: “+ Khách vãng lai”. “Chuẩn bị check-in ngoại tuyến” downloads the list (TDD §7.8) and shows when it was downloaded.

### 13.8 Stock count (FR-INV-06) and library desk (FR-LIB-07/08)

- **Staff (“Nhân viên”, 27 Oct 2026):** search box above the table (“Tìm tên hoặc tên đăng nhập…”, accent-insensitive). In “Thêm nhân viên” the **Mật khẩu tạm** is generated automatically when the dialog opens (12 characters, letters and digits without look-alikes such as 0/O, 1/l/I) and shown in plain text, read-only, in code style, with a “Sao chép” button (copies it so the owner can pass it to the employee; toast “Đã sao chép mật khẩu tạm.”) and a “Tạo mã khác” button. The employee still changes it on first login (FR-ADM-01).
- **Consignment (27 Oct 2026):** tab “Lô hàng ký gửi” has a search box above the table (“Tìm sản phẩm, SKU hoặc bên ký gửi…”) matching the product name, SKU or consignor name, accent-insensitive.
- **Suppliers (27 Oct 2026):** one list, no tabs – there is **no “Công nợ”** (supplier payables were removed, FR-PUR-06) and the supplier form has no “Theo dõi công nợ” tick and no “Hạn thanh toán” field (no column in the list either). **Supplier form** fields, in this order: Tên (required), Điện thoại (required), Email, Mã số thuế, “Nhận hàng ký gửi” tick, Ghi chú – no Loại, no Người liên hệ, no bank account. **List columns:** Nhà cung cấp, Điện thoại, Email, Mã số thuế, and a “Ký gửi” chip. A search box above the table (“Tìm tên hoặc số điện thoại…”) matches the name (accent-insensitive) or the phone (digits only). On the consignment statement the approve action reads “Duyệt quyết toán” and its confirmation states the amount due to the consignor (paid outside the system).
- **Stock count (27 Oct 2026):** **no scanning.** *List:* search box above the table (số phiếu or người tạo) with the filter button beside it – Thời gian (created date, same presets and custom range as Đơn hàng) and Trạng thái (multi: Đang đếm, Chờ duyệt, Đã duyệt, Đã hủy). *Create:* Phạm vi = Loại sản phẩm (multi: Sách, Văn phòng phẩm, Sản phẩm khác) and, optionally, Danh mục limited to the chosen types (categories holding items of those types); “Đếm mù” tick with a helper line. *Count page:* status chip, progress “Đã đếm 12/40”, then a card “Phiếu đếm” with “Tải phiếu đếm (Excel)” / “CSV” and “Tải lên phiếu đã đếm” – counters can print or fill the sheet away from the screen and upload it back; the result reports how many quantities were set and lists invalid rows. Below, the line table (SKU, Sản phẩm, Hệ thống – hidden when blind –, Đếm được, Chênh lệch) with the existing view chips. For counts of **up to 50 products** “Đếm được” is an editable number per row (saved on blur); **above 50 products** the table is read-only and an info line says the sheet is required. Header actions: “Gửi duyệt” (primary) and, until the count is approved, “Hủy phiếu” (destructive-outline, with confirmation). Blind mode hides expected quantities entirely (TDD §4.2).
- **Confirmation dialogs** (“Gửi phiếu kiểm để duyệt?”, “Hủy phiếu kiểm?” and the like) have **no divider lines** between title, body and buttons – one plain block. The submit text reads “Sau khi gửi, không thể thay đổi.”
- **Library borrow:** opened from the “Phiếu mượn” header button on Mượn / trả (beside “Nhận trả”); dialog title “Phiếu mượn sách”; all three sections are shown as soon as the form opens, in any order of filling (copies can be scanned before the borrower is chosen; the fee and due date show “—” until a borrower is chosen): sections “1. Thông tin người mượn” (one search field without a label, placeholder “Nhập số điện thoại/tên khách”, and a “Khách mới” button), “2. Thông tin sách mượn” (field and camera button only; each copy shows the title, then the copy code with its loan fee right-aligned on the same line – Enter or a scan adds the copy; no Thêm button), “3. Thanh toán” (label-left / value-right rows Hạn trả, Số lượng (copies lent), Phí mượn (loan fees before discount), Ưu đãi, Tổng phí mượn (bold); the Ưu đãi row is a toggle with a `ChevronDown` arrow showing the amount taken off (`success-700`, “—” when none); clicking it opens, below the row, a dropdown on the left – “Giảm theo số tiền (₫)” (default) or “Giảm theo phần trăm (%)” – and the value input on the right with its unit as a suffix; the buyer discount, when the borrower has one, is prefilled as a percentage; then the payment methods). Step 1 find the borrower with the POS customer dialog (phone or name; “Tạo khách hàng” if new) → eligibility card (loans “1/3”, overdue loans, unpaid charges) with green check or red block reasons (UC-17); a borrower past the spend threshold also gets a success chip “Giảm 10% phí mượn” with the helper “Đã mua 6.200.000 ₫” (FR-LIB-18); step 2 field “Mã thư viện” (placeholder “Nhập mã thư viện/tên sách”, with the camera scan button beside it): a scanned or typed copy code (`VN-0123-2`) is added at once; a title code or title lists that title's copies on the shelf to pick, or adds the only one; a title with no copy on the shelf is listed with a neutral “Hết bản” chip and its earliest due date, and picking it (or Enter on its code) adds a **reservation line** – title, library code, accent chip “Đặt giữ”, and “Dự kiến có lại dd/MM/yyyy · thứ n trong hàng chờ” in `ink-500`, no fee; when the borrower has copies held for them, a “Sách đang giữ cho khách” list with a “Lấy sách” button per copy sits at the top of section 2; when nothing can be lent or reserved the field says why (the title has no copies yet) → list with title, library code, due date `dd/MM/yyyy` in `heading-md` and fee “50.000 ₫” per copy (when discounted: the list fee struck through in `ink-500` and the discounted fee “45.000 ₫” beside it), total below; “Xác nhận cho mượn” primary. The success state shows the check icon, the heading “Đã cho mượn”, then three rows with the label on the left and the value right-aligned – Số cuốn (number), Hạn trả (`dd/MM/yyyy`), Phí mượn (amount) – and offers “In phiếu” only when slips are on. A form with reservation lines only is titled “Phiếu giữ sách” and has no section 3 (no fee, no payment); its button still reads “Xác nhận”. The success state then reads “Đã đặt giữ” with one row per title and its place in the queue; a form with both kinds shows the loan rows, then an “Đặt giữ” group below a divider.
- **Library return:** field “Mã thư viện” (placeholder “Nhập mã thư viện/tên sách”) with a round `ScanBarcode` button beside it that opens the camera scanner and fills the field with the scanned copy code; typing two characters or more lists the matching copies on loan (code, title, borrower) to pick. Below, “Tình trạng sách” as two radio ticks, Nguyên vẹn (default) and Hỏng; footer button “Xác nhận”. After confirming, a notice dialog titled “Nhận trả sách thành công” replaces the form: the success check icon, then label-left / value-right rows Tên sách, Mã thư viện, Tên khách, Hạn trả, Tình trạng (“Trả đúng hạn” success or “Trễ n ngày” danger), and Phí trả trễ / Phí sách hỏng (danger) when charged; a “Thu phí” button when a fee is owed; if a reservation is waiting, “Giữ cho {tên} – gọi {sđt}” with the phone as a call link. Its only footer button, “Xác nhận”, closes the return flow (no “Nhận cuốn khác”).
- **Overview strip (Mượn / trả):** under the page title, the four Tổng quan thư viện figures as clickable tiles (12.5).
- **Loan slips (Mượn / trả, FR-LIB-09a):** one row per loan slip (its check-out receipt), newest first – Số phiếu (`PT-…`), Khách, SĐT (`tel:` link), Số sách, Số tiền (paid charges of the slip net of refunds), Hạn trả (earliest due date of the copies still out, `danger-700` when past; “Đã trả hết” in `ink-500` when none is out), Thời gian tạo, Người thu. Search by slip number, customer name or phone, title or copy code. A “Lọc” button beside the search box: Trạng thái – Đang mượn (default: slips with a copy still out) · Sắp đến hạn · Quá hạn · Đã trả hết · Tất cả · Đang giữ (copies held for a reservation, a separate table with the borrower's call link and “Hủy giữ”), each with its count – and Thời gian (time the slip was created). The menu item carries the overdue count; the morning notification (FR-LIB-14) opens Sắp đến hạn or Quá hạn. Clicking a row opens the **slip page** (`/library/slips/{id}`, not a dialog), titled “Phiếu mượn {số phiếu}” with the breadcrumb “Mượn / trả”, in three cards: “Thông tin phiếu” – label-left rows Khách (name), SĐT (call link, on its own line), Thời gian tạo, Người thu; “Sách mượn” – one row per copy (title, copy code, status chip Đang mượn / Đã trả / Mất, due date, days late) with Gia hạn / Nhận trả / Báo mất on copies still out; “Thanh toán” – the slip's receipts and refunds (số phiếu, thời gian, khoản thu, phương thức, số tiền, người thu) with “Hoàn tiền” (with `library.fine_waive`, a reason) on receipts above 0 VND, owed charges with “Thu phí”, and the total.
- **Library count (“Kiểm kê thư viện”, FR-LIB-04):** same layout and statuses as Stock count. *List:* số phiếu or người tạo search, filters Thời gian and Trạng thái. *Create:* Kệ (multi-select chips of the shelves in use), optional Ngôn ngữ and Thể loại, “Đếm mù” tick. *Count page:* status chip and progress “Đã thấy 12/40”; a focused scan field (“Quét mã bản sách”) marks the scanned copy Có; card “Phiếu đếm” with Excel/CSV download and upload (column “Có mặt”, 1 or 0); the line table (Mã bản, Tên sách, Kệ, Trạng thái hệ thống – hidden when blind –, Kết quả). Up to 50 copies, Kết quả is two small toggle buttons Có / Không thấy per row; above 50 the table is read-only apart from scanning. View chips Tất cả · Chưa kiểm · Không thấy · Ngoài phạm vi. Header actions “Gửi duyệt”, “Hủy phiếu” and, for approvers, “Duyệt”. The approval confirmation says no copy will be changed.
- **Library payment step (FR-LIB-09a):** a “Thanh toán” block – total to collect, two radio ticks Tiền mặt (default) · Chuyển khoản, no card and no reference field. In Cho mượn it is step 3 and the button reads “Xác nhận”; in Gia hạn it sits in the confirmation dialog (“Thu tiền và gia hạn”). After a return with a late or damage fee, after Báo mất, and wherever a borrower owes charges (eligibility card, customer library section), a “Thu phí” button opens the same block in a dialog listing the owed charges (all ticked).
- **Library catalogue:** list columns Mã thư viện (code style), Tên sách, Tác giả, Ngôn ngữ chip, Số bản (còn/tổng); filters Ngôn ngữ, Trạng thái, Thể loại. The title form puts **Mã thư viện** first, prefilled with the next free code for the chosen language (“VN-0124”), editable, checked for duplicates on blur. Copies are a table inside the title (Mã bản, Tình trạng, Giá trị, Nguồn, Trạng thái) with “Thêm bản” and “In tem” for ticked copies.

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
| Đã liên hệ | Contacted | | |
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

- Size **40 × 25 mm** roll, or A4 sheet 65-up like the barcode sticker (16.4); stuck on the spine or inside the back cover.
- Content: library code **14 pt bold** (“VN-0123”), Code 128 of the copy barcode (≥ 25 mm wide, 8 mm tall) with the copy barcode in 7 pt 500 underneath (“VN-0123-2”), shortened title 6 pt (1 line), language “VN”/“EN” 7 pt 600 at the top right. No price, no logo, black only.

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
| — | Tổng quan | Overview | `LayoutDashboard` |
| CỬA HÀNG | Bán hàng | Selling (POS) | `ScanBarcode` |
| | Giao hàng | Orders & delivery | `Truck` |
| | Đơn hàng | Sales | `Receipt` |
| | Khách hàng | Customers | `Users` |
| | Khuyến mãi | Promotions | `BadgePercent` |
| SỰ KIỆN | Lịch & danh sách sự kiện | Event calendar and list | `CalendarDays` |
| | Đăng ký & check-in | Registrations and check-in | `ClipboardCheck` |
| | Chương trình định kỳ | Programmes | `Repeat` |
| THƯ VIỆN | Mượn / trả | Borrow / return | `ArrowLeftRight` |
| | Quản lý đầu sách | Titles and copies | `Library` |
| | Kiểm kê thư viện | Library counts | `ClipboardList` |
| DANH MỤC & KHO | Sản phẩm | Products | `BookOpen` |
| | Tồn kho | Stock | `Boxes` |
| | Kiểm kho | Stock count | `ClipboardList` |
| | Nhà cung cấp | Suppliers | `Building2` |
| | Ký gửi | Consignment | `Handshake` |
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
| CÀI ĐẶT | Cấu hình (with a Kênh bán tab) · Nhập dữ liệu · Sao lưu & dữ liệu · Nhật ký | Settings | `Settings` |

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
