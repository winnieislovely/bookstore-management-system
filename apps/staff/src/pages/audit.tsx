import { AUDIT_GROUPS } from '@bookstore/domain';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, ScrollText } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { FilterMenu, TimeFilter, timeLabel, timeRange, useParam } from '../components/data';
import { Button, EmptyState, ErrorState, PageHeader, Skeleton } from '../components/ui';
import { get } from '../lib/api';
import { formatDate, formatDateTime, formatVnd } from '../lib/format';
import { Dialog } from '../pos/widgets';
import { SETTING_LABEL } from './settings';

/**
 * Audit log (“Nhật ký thao tác”, FR-ADM-05, Design §12.11): every entry as a Vietnamese sentence, filters by
 * person, kind of action and time, and a before → after dialog. Codes and IP only in the dialog footnote.
 */

interface AuditEntry {
  id: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  label: string | null;
  refId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  at: string;
  ip: string | null;
}

/** The verb phrase of each action; `self` = the object is the person themself (no object shown). */
const ACTIONS: Record<string, { verb: string; self?: boolean }> = {
  'auth.login': { verb: 'đăng nhập', self: true },
  'auth.lockout': { verb: 'bị khóa tài khoản do nhập sai mật khẩu nhiều lần', self: true },
  'auth.password_change': { verb: 'đổi mật khẩu', self: true },
  'auth.pin_set': { verb: 'đặt mã PIN', self: true },
  'auth.approval_granted': { verb: 'duyệt bằng mã PIN' },
  'setup.completed': { verb: 'hoàn tất cài đặt ban đầu', self: true },
  'user.create': { verb: 'thêm nhân viên' },
  'user.update': { verb: 'sửa thông tin nhân viên' },
  'user.role_change': { verb: 'đổi vai trò của nhân viên' },
  'user.unlock': { verb: 'mở khóa tài khoản' },
  'role.create': { verb: 'tạo vai trò' },
  'role.update': { verb: 'sửa vai trò' },
  'role.permissions_change': { verb: 'đổi quyền của vai trò' },
  'sale.void': { verb: 'hủy đơn' },
  'sale.return': { verb: 'nhận trả hàng của đơn' },
  'sale.reprint': { verb: 'in lại đơn' },
  'order.create': { verb: 'tạo đơn' },
  'order.cancel': { verb: 'hủy đơn' },
  'order.done': { verb: 'hoàn tất đơn' },
  'order.confirm_payment': { verb: 'xác nhận thanh toán đơn' },
  'order.return_received': { verb: 'nhận hàng hoàn của đơn' },
  'order.status_changed': { verb: 'đổi trạng thái đơn' },
  'preorder.create': { verb: 'tạo phiếu đặt trước' },
  'preorder.status': { verb: 'cập nhật phiếu đặt trước' },
  'preorder.cancel': { verb: 'hủy phiếu đặt trước' },
  'preorder.to_delivery': { verb: 'chuyển phiếu đặt trước sang giao hàng' },
  'promotion.create': { verb: 'tạo khuyến mãi' },
  'promotion.update': { verb: 'sửa khuyến mãi' },
  'promotion.pause': { verb: 'tạm dừng khuyến mãi' },
  'promotion.resume': { verb: 'chạy lại khuyến mãi' },
  'points.adjust': { verb: 'điều chỉnh điểm của khách' },
  'cash.movement': { verb: 'ghi thu chi tiền mặt' },
  'item.create': { verb: 'thêm sản phẩm' },
  'item.update': { verb: 'sửa sản phẩm' },
  'variant.create': { verb: 'thêm phiên bản sản phẩm' },
  'variant.update': { verb: 'sửa sản phẩm' },
  'price.change': { verb: 'đổi giá' },
  'bundle.components': { verb: 'sửa thành phần combo' },
  'category.create': { verb: 'thêm danh mục' },
  'catalog.export': { verb: 'xuất danh sách sản phẩm' },
  'import.commit': { verb: 'nhập dữ liệu từ tệp' },
  'import.rollback': { verb: 'hoàn tác lần nhập dữ liệu' },
  'master_data.upsert': { verb: 'sửa danh mục dùng chung' },
  'stock_in.post': { verb: 'nhập hàng, phiếu' },
  'stock.adjust': { verb: 'điều chỉnh tồn' },
  'stock_count.approve': { verb: 'duyệt phiếu kiểm kho' },
  'stock_count.cancel': { verb: 'hủy phiếu kiểm kho' },
  'consignment.return': { verb: 'trả hàng ký gửi' },
  'consignment_statement.approve': { verb: 'duyệt bảng đối soát ký gửi' },
  'supplier.create': { verb: 'thêm nhà cung cấp' },
  'supplier.update': { verb: 'sửa nhà cung cấp' },
  'customer.create': { verb: 'thêm khách hàng' },
  'customer.update': { verb: 'sửa khách hàng' },
  'customer.merge': { verb: 'gộp khách hàng' },
  'customer.erase': { verb: 'xóa dữ liệu cá nhân của khách' },
  'customer.export': { verb: 'xuất dữ liệu khách hàng' },
  'report.export': { verb: 'xuất' },
  'library.title.create': { verb: 'thêm đầu sách thư viện' },
  'library.title.update': { verb: 'sửa đầu sách thư viện' },
  'library.copy.add': { verb: 'thêm bản sách cho' },
  'library.copy.update': { verb: 'sửa bản sách' },
  'library.copy.found': { verb: 'tìm thấy bản sách' },
  'library.checkout': { verb: 'cho mượn sách, người mượn' },
  'library.checkin': { verb: 'nhận trả sách' },
  'library.renew': { verb: 'gia hạn sách' },
  'library.lost': { verb: 'ghi mất sách' },
  'library.reserve': { verb: 'giữ sách cho khách' },
  'library.reservation.cancel': { verb: 'hủy giữ sách' },
  'library.charge.waive': { verb: 'miễn phí thư viện' },
  'library.payment': { verb: 'thu tiền thư viện, phiếu' },
  'library.payment.refund': { verb: 'hoàn tiền thư viện, phiếu' },
  'library.count.create': { verb: 'tạo phiếu kiểm kê thư viện' },
  'library.count.approve': { verb: 'duyệt phiếu kiểm kê thư viện' },
  'library.count.cancel': { verb: 'hủy phiếu kiểm kê thư viện' },
  'setting.update': { verb: 'đổi cài đặt' },
  'register.create': { verb: 'thêm quầy' },
  'register.update': { verb: 'sửa quầy' },
  'pos_device.register': { verb: 'đăng ký máy bán hàng' },
  'pos_device.revoke': { verb: 'thu hồi máy bán hàng' },
  'pos_sync.resolve': { verb: 'xử lý ngoại lệ đồng bộ' },
  'backup.request': { verb: 'yêu cầu sao lưu dữ liệu' },
  'channel.create': { verb: 'thêm kênh bán' },
  'channel.update': { verb: 'sửa kênh bán' },
};

const REPORT_NAME: Record<string, string> = { sales: 'báo cáo doanh thu', inventory: 'báo cáo kho', tax: 'báo cáo thuế', purchasing: 'báo cáo nhập hàng' };

/** The page an object opens, when it has one. */
function hrefOf(e: AuditEntry): string | null {
  const id = e.refId;
  if (!id) return null;
  switch (e.entity) {
    case 'sale':
      return `/sales/${id}`;
    case 'web_order':
      return `/orders/${id}`;
    case 'item':
    case 'item_variant':
      return `/products/${id}`;
    case 'customer':
      return `/customers/${id}`;
    case 'stock_count':
      return `/counts/${id}`;
    case 'lib_title':
      return `/library/titles/${id}`;
    case 'lib_count':
      return `/library/counts/${id}`;
    case 'preorder':
      return e.label ? `/preorders?q=${encodeURIComponent(e.label)}` : null;
    default:
      return null;
  }
}

/** The object's words: its name or number, a setting's label, a report's name. */
function objectOf(e: AuditEntry): string | null {
  if (ACTIONS[e.action]?.self) return null;
  if (e.action === 'report.export') return REPORT_NAME[e.entityId ?? ''] ?? 'báo cáo';
  if (e.entity === 'setting') return SETTING_LABEL[e.entityId ?? ''] ?? e.entityId;
  return e.label;
}

function Sentence({ e, link = true }: { e: AuditEntry; link?: boolean }) {
  const verb = ACTIONS[e.action]?.verb;
  const obj = objectOf(e);
  const href = link ? hrefOf(e) : null;
  return (
    <>
      <b className="font-semibold text-ink-900">{e.actorName ?? 'Hệ thống'}</b> {verb ?? <>thực hiện <span className="code">{e.action}</span></>}
      {obj && (
        <>
          {' '}
          {href ? (
            <Link to={href} className="font-semibold text-navy-700 underline decoration-navy-700/40 underline-offset-2 hover:decoration-navy-700" onClick={(ev) => ev.stopPropagation()}>
              {obj}
            </Link>
          ) : (
            <b className="font-semibold text-ink-900">{obj}</b>
          )}
        </>
      )}
    </>
  );
}

export function AuditPage() {
  const [actor, setActor] = useParam('actor');
  const [group, setGroup] = useParam('group');
  const [time, setTime] = useParam('time');
  const [pages, setPages] = useState<string[]>(['']);
  const [open, setOpen] = useState<AuditEntry | null>(null);
  const users = useQuery({ queryKey: ['users'], queryFn: () => get<{ items: { id: string; displayName: string }[] }>('/api/v1/admin/users') });
  const range = timeRange(time);
  const cursor = pages[pages.length - 1];
  const q = {
    actorId: actor || undefined,
    group: group || undefined,
    from: range.from,
    to: range.to,
    cursor: cursor || undefined,
    limit: 40,
  };
  const list = useQuery({ queryKey: ['audit', q], queryFn: () => get<{ items: AuditEntry[]; nextCursor: string | null }>('/api/v1/admin/audit', q) });
  // A new filter starts again from the newest entries.
  const reset = <T,>(set: (v: T) => void) => (v: T) => (set(v), setPages(['']));
  return (
    <>
      <PageHeader title="Nhật ký thao tác" />
      <div className="mb-4 flex justify-end">
        <FilterMenu
          groups={[
            { kind: 'single', label: 'Người thực hiện', options: [...(users.data?.items ?? []).map((u) => ({ key: u.id, label: u.displayName })), { key: 'system', label: 'Hệ thống' }], value: actor, onChange: reset(setActor) },
            { kind: 'single', label: 'Loại thao tác', options: AUDIT_GROUPS.map((g) => ({ key: g.key, label: g.label })), value: group, onChange: reset(setGroup) },
            { kind: 'custom', label: 'Thời gian', summary: timeLabel(time), active: !!time, onClear: () => reset(setTime)(''), content: <TimeFilter value={time} onChange={reset(setTime)} /> },
          ]}
        />
      </div>
      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data ? (
        <Skeleton className="h-64" />
      ) : list.data.items.length === 0 ? (
        <EmptyState icon={ScrollText} title="Không có thao tác phù hợp" />
      ) : (
        <ul className="divide-y divide-paper-300 overflow-hidden rounded-lg border border-paper-300 bg-white shadow-sm">
          {list.data.items.map((e) => (
            <li key={e.id}>
              {/* The row opens the detail; the object link inside opens its own page. */}
              <div role="button" tabIndex={0} onClick={() => setOpen(e)} onKeyDown={(k) => (k.key === 'Enter' || k.key === ' ') && setOpen(e)} className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-navy-50">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-ink-700">
                    <Sentence e={e} />
                  </span>
                  <span className="mt-0.5 block text-[13px] text-ink-500 num">{formatDateTime(e.at)}</span>
                </span>
                <ChevronRight size={18} className="shrink-0 text-ink-500" aria-hidden />
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button size="sm" variant="ghost" disabled={pages.length <= 1} onClick={() => setPages(pages.slice(0, -1))}>
          ‹ Trang trước
        </Button>
        <Button size="sm" variant="ghost" disabled={!list.data?.nextCursor} onClick={() => setPages([...pages, list.data!.nextCursor!])}>
          Trang sau ›
        </Button>
      </div>
      {open && <AuditDetail e={open} onClose={() => setOpen(null)} />}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Detail: Thông tin · Trước · Sau

const FIELD_LABEL: Record<string, string> = {
  name: 'Tên',
  displayName: 'Tên hiển thị',
  title: 'Tên',
  status: 'Trạng thái',
  roleId: 'Vai trò',
  priceVnd: 'Giá bán',
  listPriceVnd: 'Giá niêm yết',
  vatBp: 'Thuế GTGT',
  reason: 'Lý do',
  shelfCode: 'Kệ',
  publishedWeb: 'Hiện trên website',
  value: 'Giá trị',
  docNo: 'Số chứng từ',
  entryNo: 'Số phiếu',
  code: 'Mã',
  sku: 'SKU',
  qty: 'Số lượng',
  delta: 'Thay đổi',
  balance: 'Số dư',
  amountVnd: 'Số tiền',
  amountDueVnd: 'Phải trả',
  totalVnd: 'Tổng tiền',
  totalCostVnd: 'Tổng giá nhập',
  refundVnd: 'Tiền hoàn',
  refundMethod: 'Hình thức hoàn',
  depositVnd: 'Tiền cọc',
  feeVnd: 'Phí mượn',
  lateFeeVnd: 'Phí trễ',
  damageVnd: 'Phí hỏng',
  chargeVnd: 'Phí mất sách',
  method: 'Hình thức',
  dueAt: 'Hạn trả',
  daysLate: 'Số ngày trễ',
  condition: 'Tình trạng',
  barcodes: 'Mã bản sách',
  delivery: 'Giao hàng',
  deliveryNote: 'Ghi chú giao hàng',
  active: 'Đang dùng',
  sort: 'Thứ tự',
  isConsignor: 'Nhận ký gửi',
  consignment: 'Hàng ký gửi',
  deviceCode: 'Mã máy',
  startsAt: 'Bắt đầu',
  endsAt: 'Kết thúc',
  source: 'Nguồn đơn',
  blind: 'Đếm mù',
  kind: 'Loại',
  format: 'Định dạng',
  rows: 'Số dòng',
  year: 'Năm xuất bản',
  authors: 'Tác giả',
  publisher: 'Nhà xuất bản',
  category: 'Thể loại',
  language: 'Ngôn ngữ',
  isbn13: 'ISBN',
  callNo: 'Ký hiệu xếp giá',
  dewey: 'Mã Dewey',
};
/** Internal fields, never shown. */
const HIDDEN = new Set(['id', 'version', 'createdAt', 'updatedAt', 'searchText', 'payableId', 'tracksPayables', 'cutter', 'i18n', 'links']);

function show(key: string, v: unknown): ReactNode {
  if (v == null || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Có' : 'Không';
  if (typeof v === 'number' && /Vnd$/.test(key)) return formatVnd(v);
  if (typeof v === 'number' && /Bp$/.test(key)) return `${(v / 100).toLocaleString('vi-VN')}%`;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return formatDate(v);
  if (Array.isArray(v) && v.every((x) => typeof x !== 'object')) return v.join(', ');
  if (typeof v === 'object') return <span className="code text-[12px] break-all">{JSON.stringify(v)}</span>;
  return String(v);
}

function AuditDetail({ e, onClose }: { e: AuditEntry; onClose: () => void }) {
  const before = e.before ?? {};
  const after = e.after ?? {};
  const both = e.before != null && e.after != null;
  // With both sides, only what the change set (the after side) and what actually differs; the before side may carry the whole record.
  const keys = (both ? Object.keys(after) : [...Object.keys(before), ...Object.keys(after)]).filter((k) => !HIDDEN.has(k) && (!both || JSON.stringify(before[k]) !== JSON.stringify(after[k])));
  return (
    <Dialog title="Chi tiết thao tác" size="md" onClose={onClose}>
      <div className="flex flex-col gap-4 text-sm">
        <p className="text-ink-700">
          <Sentence e={e} link={false} />
          <span className="block text-[13px] text-ink-500 num">{formatDateTime(e.at)}</span>
        </p>
        {keys.length > 0 && (
          <div className="overflow-x-auto rounded-md border border-paper-300">
            <table className="w-full text-sm">
              <thead className="bg-paper-200 text-[13px] text-ink-700">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Thông tin</th>
                  {e.before != null && <th className="px-3 py-2 text-left font-semibold">Trước</th>}
                  <th className="px-3 py-2 text-left font-semibold">{e.before != null ? 'Sau' : 'Giá trị'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-paper-300">
                {keys.map((k) => (
                  <tr key={k}>
                    <td className="px-3 py-2 text-ink-700">{FIELD_LABEL[k] ?? k}</td>
                    {e.before != null && <td className="px-3 py-2">{show(k, before[k])}</td>}
                    <td className="px-3 py-2">{show(k, after[k])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[12px] text-ink-500">
          Mã thao tác <span className="code">{e.action}</span>
          {e.ip && <> · IP <span className="code">{e.ip}</span></>}
        </p>
      </div>
    </Dialog>
  );
}
