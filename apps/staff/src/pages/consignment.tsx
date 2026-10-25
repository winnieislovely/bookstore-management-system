import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, FileText, Handshake, Printer, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog, DataTable, SelectField, Tabs, TextArea, toast, type Column } from '../components/data';
import { Button, Field, PageHeader, Skeleton, StatusChip } from '../components/ui';
import { get, post } from '../lib/api';
import { formatDate, formatDateTime, formatNumber, formatVnd } from '../lib/format';
import { printHtml } from '../lib/print';
import { can, useMe } from '../lib/session';
import { Dialog } from '../pos/widgets';
import { useSuppliers } from './stockin';

/** Consignment lots, returns and monthly statements (FR-PUR-09..12, Design §16.8). */

interface Lot {
  id: string;
  supplier_name: string;
  sku: string;
  title: string;
  qty_received: number;
  qty_sold: number;
  qty_returned: number;
  remaining: number;
  discount_bp: number;
  deadline_at: string | null;
}

export function ConsignmentPage() {
  const { data: me } = useMe();
  const [tab, setTab] = useState<'lots' | 'statements'>(can(me, 'purchasing.manage') ? 'lots' : 'statements');
  return (
    <>
      <PageHeader title="Ký gửi" />
      <Tabs
        tabs={[...(can(me, 'purchasing.manage') ? [{ key: 'lots' as const, label: 'Lô hàng ký gửi' }] : []), ...(can(me, 'purchasing.payables') ? [{ key: 'statements' as const, label: 'Đối soát hàng tháng' }] : [])]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'lots' ? <Lots /> : <Statements />}
    </>
  );
}

function Lots() {
  const lots = useQuery({ queryKey: ['consignment-lots'], queryFn: () => get<{ items: Lot[] }>('/api/v1/purchasing/consignment/lots') });
  const [returning, setReturning] = useState<Lot | null>(null);
  const soon = Date.now() + 14 * 86_400_000;
  const columns: Column<Lot>[] = [
    { header: 'Sản phẩm', cell: (l) => <span>{l.title}<span className="code block text-[13px] text-ink-500">{l.sku}</span></span> },
    { header: 'Bên ký gửi', cell: (l) => l.supplier_name },
    { header: 'Nhận', align: 'right', cell: (l) => formatNumber(l.qty_received) },
    { header: 'Đã bán', align: 'right', cell: (l) => formatNumber(l.qty_sold) },
    { header: 'Đã trả', align: 'right', cell: (l) => formatNumber(l.qty_returned) },
    { header: 'Còn lại', align: 'right', cell: (l) => <span className="font-semibold">{formatNumber(l.remaining)}</span> },
    { header: 'Chiết khấu', align: 'right', cell: (l) => `${l.discount_bp / 100}%` },
    {
      header: 'Hạn',
      cell: (l) =>
        l.deadline_at ? (
          new Date(l.deadline_at).getTime() < soon && l.remaining > 0 ? (
            <StatusChip tone="warning">{formatDate(l.deadline_at)}</StatusChip>
          ) : (
            formatDate(l.deadline_at)
          )
        ) : (
          '—'
        ),
    },
    {
      header: '',
      align: 'right',
      cell: (l) =>
        l.remaining > 0 ? (
          <Button size="sm" variant="ghost" icon={Undo2} onClick={(e) => (e.stopPropagation(), setReturning(l))}>
            Trả hàng
          </Button>
        ) : null,
    },
  ];
  return (
    <>
      <DataTable columns={columns} rows={lots.data?.items} rowKey={(l) => l.id} error={lots.error} minWidth={880} empty={{ icon: Handshake, title: 'Chưa có hàng ký gửi', help: 'Hàng ký gửi được tạo khi nhập hàng từ bên ký gửi và chọn “Hàng ký gửi”.' }} />
      {returning && <ReturnLot lot={returning} onClose={() => setReturning(null)} onDone={() => lots.refetch()} />}
    </>
  );
}

function ReturnLot({ lot, onClose, onDone }: { lot: Lot; onClose: () => void; onDone: () => void }) {
  const [qty, setQty] = useState(String(lot.remaining));
  const [note, setNote] = useState('');
  return (
    <ConfirmDialog
      title={`Trả hàng ký gửi – ${lot.title}`}
      body={`Còn ${lot.remaining} chưa bán. Tồn kho giảm, giá vốn không đổi.`}
      confirm="Trả hàng"
      onClose={onClose}
      onConfirm={async () => {
        await post('/api/v1/purchasing/consignment/returns', { lotId: lot.id, qty: Number(qty), ...(note && { note }) });
        toast.success('Đã ghi trả hàng ký gửi.');
        onDone();
      }}
    >
      <Field label="Số lượng trả" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))} />
      <TextArea label="Ghi chú" value={note} onChange={(e) => setNote(e.target.value)} />
    </ConfirmDialog>
  );
}

interface StatementRow {
  id: string;
  docNo: string;
  supplierName: string;
  period: string;
  amountDueVnd: number;
  status: string;
  approvedAt: string | null;
}
interface StatementLine {
  variantId: string;
  sku: string;
  title: string;
  received: number;
  sold: number;
  returned: number;
  remaining: number;
  unitPriceVnd: number;
  discountBp: number;
  amountDueVnd: number;
}
interface Statement extends StatementRow {
  lines: StatementLine[];
  supplierTaxCode: string | null;
  createdAt: string;
  store: { name: string; address: string; taxCode: string; phone: string };
}

const lastMonth = () => {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7);
};

function Statements() {
  const list = useQuery({ queryKey: ['statements'], queryFn: () => get<{ items: StatementRow[] }>('/api/v1/purchasing/consignment/statements') });
  const suppliers = useSuppliers();
  const [gen, setGen] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [period, setPeriod] = useState(lastMonth());
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button variant="primary" icon={FileText} onClick={() => setGen(true)}>
          Lập bảng đối soát
        </Button>
      </div>
      <DataTable
        columns={[
          { header: 'Số', cell: (s: StatementRow) => <span className="code">{s.docNo}</span> },
          { header: 'Bên ký gửi', cell: (s) => s.supplierName },
          { header: 'Kỳ', cell: (s) => s.period },
          { header: 'Phải trả', align: 'right', cell: (s) => formatVnd(s.amountDueVnd) },
          { header: 'Trạng thái', cell: (s) => (s.status === 'approved' ? <StatusChip tone="success">Đã duyệt</StatusChip> : <StatusChip tone="neutral">Nháp</StatusChip>) },
        ]}
        rows={list.data?.items}
        rowKey={(s) => s.id}
        onRow={(s) => setOpen(s.id)}
        error={list.error}
        empty={{ icon: FileText, title: 'Chưa có bảng đối soát' }}
      />
      {gen && (
        <ConfirmDialog
          title="Lập bảng đối soát"
          body="Lập lại khi còn nháp sẽ thay số liệu cũ."
          confirm="Lập bảng"
          onClose={() => setGen(false)}
          onConfirm={async () => {
            const r = await post<{ id: string }>('/api/v1/purchasing/consignment/statements', { supplierId, period });
            await list.refetch();
            setOpen(r.id);
          }}
        >
          <SelectField label="Bên ký gửi" required value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">— Chọn —</option>
            {suppliers.data?.items
              .filter((s) => s.isConsignor)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </SelectField>
          <Field label="Kỳ (tháng)" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
        </ConfirmDialog>
      )}
      {open && <StatementDialog id={open} onClose={() => setOpen(null)} onChanged={() => list.refetch()} />}
    </>
  );
}

function StatementDialog({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const s = useQuery({ queryKey: ['statement', id], queryFn: () => get<Statement>(`/api/v1/purchasing/consignment/statements/${id}`) });
  const [approving, setApproving] = useState(false);
  const x = s.data;
  return (
    <Dialog
      title={x ? `${x.docNo} · ${x.supplierName} · ${x.period}` : 'Bảng đối soát'}
      size="lg"
      onClose={onClose}
      footer={
        x && (
          <>
            <Button variant="secondary" icon={Printer} onClick={() => printHtml(statementHtml(x))}>
              In
            </Button>
            {x.status !== 'approved' && (
              <Button variant="primary" icon={CheckCircle2} onClick={() => setApproving(true)}>
                Duyệt và tạo công nợ
              </Button>
            )}
          </>
        )
      }
    >
      {!x ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-[13px] text-ink-500">
              <tr className="h-9 border-b border-paper-300">
                <th className="text-left font-semibold">Sản phẩm</th>
                <th className="text-right font-semibold">Nhận</th>
                <th className="text-right font-semibold">Đã bán</th>
                <th className="text-right font-semibold">Đã trả</th>
                <th className="text-right font-semibold">Còn lại</th>
                <th className="text-right font-semibold">Giá bán</th>
                <th className="text-right font-semibold">CK</th>
                <th className="text-right font-semibold">Phải trả</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-paper-300">
              {x.lines.map((l) => (
                <tr key={l.variantId}>
                  <td className="py-2">
                    {l.title} <span className="code block text-[13px] text-ink-500">{l.sku}</span>
                  </td>
                  <td className="text-right num">{l.received}</td>
                  <td className="text-right num">{l.sold}</td>
                  <td className="text-right num">{l.returned}</td>
                  <td className="text-right num">{l.remaining}</td>
                  <td className="text-right num">{formatVnd(l.unitPriceVnd)}</td>
                  <td className="text-right num">{l.discountBp / 100}%</td>
                  <td className="text-right font-medium num">{formatVnd(l.amountDueVnd)}</td>
                </tr>
              ))}
              <tr className="bg-paper-200 font-semibold">
                <td className="py-2" colSpan={7}>
                  Tổng phải trả
                </td>
                <td className="text-right num">{formatVnd(x.amountDueVnd)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {approving && x && (
        <ConfirmDialog
          title="Duyệt bảng đối soát?"
          body={`Tạo công nợ ${formatVnd(x.amountDueVnd)} với ${x.supplierName}. Không sửa được sau khi duyệt.`}
          confirm="Duyệt"
          onClose={() => setApproving(false)}
          onConfirm={async () => {
            await post(`/api/v1/purchasing/consignment/statements/${x.id}/approve`);
            toast.success('Đã duyệt và tạo công nợ.');
            await s.refetch();
            onChanged();
          }}
        />
      )}
    </Dialog>
  );
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** A4 consignment statement (Design §16.8): store header, table, amount box, signature blocks. */
function statementHtml(x: Statement): string {
  const n = formatNumber;
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${esc(x.docNo)}</title><style>
@page { size: A4 landscape; margin: 12mm; }
body { font: 10pt/1.4 'Be Vietnam Pro', system-ui, sans-serif; color: #000; font-variant-numeric: tabular-nums; }
h1 { font-size: 16pt; color: #1F3A5F; margin: 12px 0 4px; } .muted { color: #444; }
table { width: 100%; border-collapse: collapse; margin-top: 12px; } th, td { border: 1px solid #999; padding: 4px 6px; } th { background: #eee; text-align: left; }
td.r, th.r { text-align: right; } tr { page-break-inside: avoid; } thead { display: table-header-group; } .tot td { font-weight: 700; background: #eee; }
.box { display: inline-block; border: 2px solid #000; padding: 8px 16px; margin-top: 12px; font-size: 12pt; font-weight: 700; }
.sign { display: flex; justify-content: space-around; margin-top: 40px; text-align: center; } .sign div { width: 40%; } .sign p { margin-top: 64px; }
.head { display: flex; justify-content: space-between; }
</style></head><body>
<div class="head"><div><b>${esc(x.store.name)}</b><div class="muted">${esc(x.store.address)}</div><div class="muted">MST: ${esc(x.store.taxCode)} · ${esc(x.store.phone)}</div></div>
<div style="text-align:right">Số: <b>${esc(x.docNo)}</b><div class="muted">In lúc ${esc(formatDateTime(new Date()))}</div></div></div>
<h1>BẢNG ĐỐI SOÁT HÀNG KÝ GỬI</h1>
<div>Kỳ: <b>${esc(x.period)}</b> · Bên giao hàng: <b>${esc(x.supplierName)}</b>${x.supplierTaxCode ? ` · MST ${esc(x.supplierTaxCode)}` : ''}</div>
<table><thead><tr><th>Sản phẩm</th><th>SKU</th><th class="r">Nhận</th><th class="r">Đã bán</th><th class="r">Đã trả</th><th class="r">Còn lại</th><th class="r">Giá bán</th><th class="r">Chiết khấu</th><th class="r">Thành tiền phải trả</th></tr></thead><tbody>
${x.lines.map((l) => `<tr><td>${esc(l.title)}</td><td>${esc(l.sku)}</td><td class="r">${n(l.received)}</td><td class="r">${n(l.sold)}</td><td class="r">${n(l.returned)}</td><td class="r">${n(l.remaining)}</td><td class="r">${n(l.unitPriceVnd)}</td><td class="r">${l.discountBp / 100}%</td><td class="r">${n(l.amountDueVnd)}</td></tr>`).join('')}
<tr class="tot"><td colspan="8">Tổng cộng</td><td class="r">${n(x.amountDueVnd)}</td></tr></tbody></table>
<div class="box">Số tiền phải trả: ${n(x.amountDueVnd)} ₫</div>
<div class="sign"><div><b>Bên giao hàng</b><div>Ngày ..... tháng ..... năm ......</div><p>(Ký, ghi rõ họ tên)</p></div><div><b>Bên nhận hàng</b><div>Ngày ..... tháng ..... năm ......</div><p>(Ký, ghi rõ họ tên)</p></div></div>
</body></html>`;
}
