import { post } from './api';
import { formatDateTime, formatNumber } from './format';

/** Browser printing (TDD §8.7, Design §16): a hidden iframe with print-only HTML. */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const n = (v: number) => formatNumber(v);

const METHOD: Record<string, string> = { cash: 'Tiền mặt', transfer: 'Chuyển khoản', card: 'Thẻ' };

interface Slip {
  store: { name: string; address: string; taxCode: string; phone: string };
  docNo: string;
  soldAt: string;
  cashier: string;
  lines: { description: string; qty: number; unitPriceVnd: number; discountVnd: number; totalVnd: number }[];
  subtotalVnd: number;
  discountVnd: number;
  totalVnd: number;
  payments: { method: string; amountVnd: number; tenderedVnd: number | null }[];
  customer: { name: string; tierName: string | null; pointsEarned: number; pointsBalance: number } | null;
  footer: string;
}

export function printHtml(html: string) {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(html);
  doc.close();
  frame.contentWindow!.onafterprint = () => frame.remove();
  setTimeout(() => {
    frame.contentWindow!.focus();
    frame.contentWindow!.print();
    setTimeout(() => frame.remove(), 60_000);
  }, 250);
}

/** Sales slip, 80 mm thermal, black only (Design §16.2). */
export function slipHtml(s: Slip): string {
  const row = (l: string, r: string, cls = '') => `<div class="row ${cls}"><span>${l}</span><span>${r}</span></div>`;
  const change = s.payments.reduce((a, p) => a + (p.method === 'cash' && p.tenderedVnd ? p.tenderedVnd - p.amountVnd : 0), 0);
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${esc(s.docNo)}</title><style>
@page { size: 80mm auto; margin: 4mm; }
* { box-sizing: border-box; }
body { width: 72mm; margin: 0; color: #000; background: #fff; font: 9pt/1.35 'Be Vietnam Pro', system-ui, sans-serif; font-variant-numeric: tabular-nums; }
.c { text-align: center; } .b { font-weight: 700; } hr { border: 0; border-top: 1px dashed #000; margin: 4px 0; }
.row { display: flex; justify-content: space-between; gap: 8px; } .row span:last-child { text-align: right; white-space: nowrap; }
.total { font-size: 12pt; font-weight: 700; } .ind { padding-left: 8px; }
</style></head><body>
<div class="c b">${esc(s.store.name)}</div>
<div class="c">${esc(s.store.address)}</div>
<div class="c">MST: ${esc(s.store.taxCode)} · ${esc(s.store.phone)}</div><hr>
${row('<b>PHIẾU BÁN HÀNG</b>', esc(s.docNo))}
${row(esc(formatDateTime(s.soldAt)), `Thu ngân: ${esc(s.cashier)}`)}<hr>
${s.lines
  .map(
    (l) => `<div>${esc(l.description)}</div>${row(`<span class="ind">${l.qty} x ${n(l.unitPriceVnd)}</span>`, n(l.qty * l.unitPriceVnd))}${l.discountVnd ? row('<span class="ind">Giảm giá</span>', `−${n(l.discountVnd)}`) : ''}`,
  )
  .join('')}<hr>
${row('Tạm tính', n(s.subtotalVnd))}
${s.discountVnd ? row('Giảm giá', `−${n(s.discountVnd)}`) : ''}
${row('TỔNG CỘNG', `${n(s.totalVnd)} ₫`, 'total')}
${s.payments.map((p) => row(METHOD[p.method] ?? p.method, n(p.tenderedVnd ?? p.amountVnd))).join('')}
${change > 0 ? row('Tiền thừa', n(change)) : ''}
${s.customer ? `<hr><div>Khách hàng: ${esc(s.customer.name)}${s.customer.tierName ? ` · Hạng ${esc(s.customer.tierName)}` : ''}</div><div>Điểm cộng: +${n(s.customer.pointsEarned)} · Tổng điểm: ${n(s.customer.pointsBalance)}</div>` : ''}
<hr><div class="c">Đây không phải hóa đơn GTGT.</div><div class="c">Tra cứu hóa đơn điện tử theo mã đơn.</div>
${s.footer ? `<div class="c">${esc(s.footer).replace(/\n/g, '<br>')}</div>` : ''}
</body></html>`;
}

export async function printSlip(saleId: string) {
  const s = await post<Slip>(`/api/v1/pos/sales/${saleId}/print`);
  printHtml(slipHtml(s));
}
