import { useQuery } from '@tanstack/react-query';
import { Building2, Plus, Wallet } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog, DataTable, SelectField, Tabs, TextArea, toast, type Column } from '../components/data';
import { Button, Field, InlineAlert, PageHeader, StatusChip, type Tone } from '../components/ui';
import { get, patch, post } from '../lib/api';
import { formatDate, formatVnd } from '../lib/format';
import { can, useMe } from '../lib/session';
import { Dialog } from '../pos/widgets';
import { useSuppliers } from './stockin';

/** Suppliers and payables (FR-PUR-01, FR-PUR-06): payables only with `purchasing.payables`. */

type Supplier = NonNullable<ReturnType<typeof useSuppliers>['data']>['items'][number];
const KIND: Record<string, string> = { publisher: 'Nhà xuất bản', distributor: 'Nhà phân phối', vendor: 'Nhà cung cấp', individual: 'Cá nhân' };

export function SuppliersPage() {
  const { data: me } = useMe();
  const [tab, setTab] = useState<'suppliers' | 'payables'>('suppliers');
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null);
  const list = useSuppliers();
  const columns: Column<Supplier>[] = [
    { header: 'Nhà cung cấp', cell: (s) => <span className="font-medium">{s.name}</span> },
    { header: 'Loại', cell: (s) => KIND[s.kind] ?? s.kind },
    { header: 'Mã số thuế', cell: (s) => (s.taxCode ? <span className="code">{s.taxCode}</span> : '—') },
    { header: 'Liên hệ', cell: (s) => s.contacts[0] ? `${s.contacts[0].name}${s.contacts[0].phone ? ` · ${s.contacts[0].phone}` : ''}` : '—' },
    { header: 'Hạn thanh toán', align: 'right', cell: (s) => (s.termsDays == null ? '—' : `${s.termsDays} ngày`) },
    {
      header: '',
      cell: (s) => (
        <div className="flex flex-wrap gap-1">
          {s.isConsignor && <StatusChip tone="accent">Ký gửi</StatusChip>}
          {s.tracksPayables && <StatusChip tone="brand">Theo dõi công nợ</StatusChip>}
        </div>
      ),
    },
  ];
  return (
    <>
      <PageHeader
        title="Nhà cung cấp"
        actions={
          tab === 'suppliers' && (
            <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>
              Thêm nhà cung cấp
            </Button>
          )
        }
      />
      {can(me, 'purchasing.payables') && (
        <Tabs
          tabs={[
            { key: 'suppliers', label: 'Danh sách' },
            { key: 'payables', label: 'Công nợ' },
          ]}
          value={tab}
          onChange={setTab}
        />
      )}
      {tab === 'suppliers' ? (
        <DataTable columns={columns} rows={list.data?.items} rowKey={(s) => s.id} onRow={(s) => setEditing(s)} error={list.error} onRetry={() => list.refetch()} empty={{ icon: Building2, title: 'Chưa có nhà cung cấp' }} />
      ) : (
        <Payables />
      )}
      {editing && <SupplierForm supplier={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => list.refetch()} />}
    </>
  );
}

function SupplierForm({ supplier, onClose, onSaved }: { supplier: Supplier | null; onClose: () => void; onSaved: () => void }) {
  const s = supplier;
  const [f, setF] = useState({
    name: s?.name ?? '',
    kind: s?.kind ?? 'vendor',
    taxCode: s?.taxCode ?? '',
    termsDays: s?.termsDays == null ? '' : String(s.termsDays),
    contactName: s?.contacts[0]?.name ?? '',
    contactPhone: s?.contacts[0]?.phone ?? '',
    contactEmail: s?.contacts[0]?.email ?? '',
    note: s?.note ?? '',
    isConsignor: s?.isConsignor ?? false,
    tracksPayables: s?.tracksPayables ?? false,
  });
  const [bank, setBank] = useState({ bankName: '', accountNo: '', accountName: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = {
        name: f.name.trim(),
        kind: f.kind,
        taxCode: f.taxCode.trim() || null,
        termsDays: f.termsDays ? Number(f.termsDays) : null,
        contacts: f.contactName.trim() ? [{ name: f.contactName.trim(), ...(f.contactPhone && { phone: f.contactPhone }), ...(f.contactEmail && { email: f.contactEmail }) }] : [],
        note: f.note,
        isConsignor: f.isConsignor,
        tracksPayables: f.tracksPayables,
        ...(bank.accountNo && { bank }),
      };
      if (s) await patch(`/api/v1/purchasing/suppliers/${s.id}`, { ...body, version: s.version });
      else await post('/api/v1/purchasing/suppliers', body);
      toast.success('Đã lưu nhà cung cấp.');
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={s ? s.name : 'Thêm nhà cung cấp'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button variant="primary" loading={busy} disabled={!f.name.trim()} onClick={save}>
            Lưu
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Tên" required value={f.name} onChange={set('name')} className="sm:col-span-2" autoFocus />
        <SelectField label="Loại" value={f.kind} onChange={set('kind')}>
          {Object.entries(KIND).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </SelectField>
        <Field label="Mã số thuế" className="code" value={f.taxCode} onChange={set('taxCode')} />
        <Field label="Người liên hệ" value={f.contactName} onChange={set('contactName')} />
        <Field label="Điện thoại" inputMode="tel" value={f.contactPhone} onChange={set('contactPhone')} />
        <Field label="Email" type="email" value={f.contactEmail} onChange={set('contactEmail')} />
        <Field label="Hạn thanh toán (ngày)" inputMode="numeric" value={f.termsDays} onChange={(e) => setF({ ...f, termsDays: e.target.value.replace(/\D/g, '') })} />
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-5" checked={f.isConsignor} onChange={(e) => setF({ ...f, isConsignor: e.target.checked })} />
          Nhận hàng ký gửi
        </label>
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-5" checked={f.tracksPayables} onChange={(e) => setF({ ...f, tracksPayables: e.target.checked })} />
          Theo dõi công nợ
        </label>
        <fieldset className="grid grid-cols-1 gap-4 sm:col-span-2 sm:grid-cols-3">
          <legend className="mb-1 text-[13px] font-medium text-ink-700">Tài khoản ngân hàng {s?.hasBank && '(đã lưu – nhập lại để thay)'}</legend>
          <Field label="Ngân hàng" value={bank.bankName} onChange={(e) => setBank({ ...bank, bankName: e.target.value })} />
          <Field label="Số tài khoản" inputMode="numeric" value={bank.accountNo} onChange={(e) => setBank({ ...bank, accountNo: e.target.value })} />
          <Field label="Chủ tài khoản" value={bank.accountName} onChange={(e) => setBank({ ...bank, accountName: e.target.value.toUpperCase() })} />
        </fieldset>
        <TextArea label="Ghi chú" value={f.note} onChange={set('note')} className="sm:col-span-2" />
        {error && (
          <div className="sm:col-span-2">
            <InlineAlert tone="danger">{error}</InlineAlert>
          </div>
        )}
      </div>
    </Dialog>
  );
}

interface Payable {
  id: string;
  supplierName: string;
  source: string;
  amountVnd: number;
  paidVnd: number;
  balanceVnd: number;
  dueAt: string | null;
  status: string;
  overdueDays: number;
  ageingBucket: string;
  createdAt: string;
}
const BUCKET: Record<string, { tone: Tone; label: string }> = {
  paid: { tone: 'success', label: 'Đã trả' },
  current: { tone: 'info', label: 'Trong hạn' },
  '1-30': { tone: 'warning', label: 'Quá hạn 1–30 ngày' },
  '31-60': { tone: 'danger', label: 'Quá hạn 31–60 ngày' },
  '61-90': { tone: 'danger', label: 'Quá hạn 61–90 ngày' },
  '90+': { tone: 'danger', label: 'Quá hạn trên 90 ngày' },
};

function Payables() {
  const list = useQuery({ queryKey: ['payables'], queryFn: () => get<{ items: Payable[]; totalBalanceVnd: number }>('/api/v1/purchasing/payables') });
  const [paying, setPaying] = useState<Payable | null>(null);
  return (
    <>
      {list.data && (
        <p className="mb-4 text-lg num">
          Tổng còn nợ: <span className="font-semibold">{formatVnd(list.data.totalBalanceVnd)}</span>
        </p>
      )}
      <DataTable
        columns={[
          { header: 'Nhà cung cấp', cell: (p: Payable) => p.supplierName },
          { header: 'Nguồn', cell: (p) => (p.source === 'consignment' ? 'Đối soát ký gửi' : 'Phiếu nhập') },
          { header: 'Ngày', cell: (p) => formatDate(p.createdAt) },
          { header: 'Hạn trả', cell: (p) => (p.dueAt ? formatDate(p.dueAt) : '—') },
          { header: 'Số tiền', align: 'right', cell: (p) => formatVnd(p.amountVnd) },
          { header: 'Còn nợ', align: 'right', cell: (p) => <span className="font-semibold">{formatVnd(p.balanceVnd)}</span> },
          { header: 'Tình trạng', cell: (p) => <StatusChip tone={BUCKET[p.ageingBucket]?.tone ?? 'neutral'}>{p.status === 'cancelled' ? 'Đã hủy' : (BUCKET[p.ageingBucket]?.label ?? p.ageingBucket)}</StatusChip> },
          {
            header: '',
            align: 'right',
            cell: (p) =>
              p.balanceVnd > 0 && p.status !== 'cancelled' ? (
                <Button size="sm" variant="tonal" icon={Wallet} onClick={(e) => (e.stopPropagation(), setPaying(p))}>
                  Trả tiền
                </Button>
              ) : null,
          },
        ]}
        rows={list.data?.items}
        rowKey={(p) => p.id}
        error={list.error}
        empty={{ icon: Wallet, title: 'Không có công nợ' }}
      />
      {paying && <PayDialog payable={paying} onClose={() => setPaying(null)} onDone={() => list.refetch()} />}
    </>
  );
}

function PayDialog({ payable, onClose, onDone }: { payable: Payable; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(String(payable.balanceVnd));
  const [method, setMethod] = useState('transfer');
  const [note, setNote] = useState('');
  const value = Number(amount.replace(/\D/g, '') || 0);
  return (
    <ConfirmDialog
      title={`Trả tiền cho ${payable.supplierName}`}
      body={`Còn nợ ${formatVnd(payable.balanceVnd)}.`}
      confirm="Ghi thanh toán"
      onClose={onClose}
      onConfirm={async () => {
        await post(`/api/v1/purchasing/payables/${payable.id}/payments`, { amountVnd: value, method, ...(note && { note }) });
        toast.success(`Đã ghi trả ${formatVnd(value)}.`);
        onDone();
      }}
    >
      <Field label="Số tiền" required suffix="₫" inputMode="numeric" value={value ? new Intl.NumberFormat('vi-VN').format(value) : ''} onChange={(e) => setAmount(e.target.value)} />
      <SelectField label="Hình thức" value={method} onChange={(e) => setMethod(e.target.value)}>
        <option value="transfer">Chuyển khoản</option>
        <option value="cash">Tiền mặt</option>
      </SelectField>
      <TextArea label="Ghi chú" value={note} onChange={(e) => setNote(e.target.value)} />
    </ConfirmDialog>
  );
}

