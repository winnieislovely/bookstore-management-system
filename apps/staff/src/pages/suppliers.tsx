import { Building2, Plus } from 'lucide-react';
import { useState } from 'react';
import { DataTable, SelectField, TextArea, toast, type Column } from '../components/data';
import { Button, Field, InlineAlert, PageHeader, StatusChip } from '../components/ui';
import { patch, post } from '../lib/api';
import { Dialog } from '../pos/widgets';
import { useSuppliers } from './stockin';

/** Suppliers (FR-PUR-01, Design §13.8); no payables (FR-PUR-06 removed). */

type Supplier = NonNullable<ReturnType<typeof useSuppliers>['data']>['items'][number];
const KIND: Record<string, string> = { publisher: 'Nhà xuất bản', distributor: 'Nhà phân phối', vendor: 'Nhà cung cấp', individual: 'Cá nhân' };

export function SuppliersPage() {
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null);
  const list = useSuppliers();
  const columns: Column<Supplier>[] = [
    { header: 'Nhà cung cấp', cell: (s) => <span className="font-medium">{s.name}</span> },
    { header: 'Loại', cell: (s) => KIND[s.kind] ?? s.kind },
    { header: 'Mã số thuế', cell: (s) => (s.taxCode ? <span className="code">{s.taxCode}</span> : '—') },
    { header: 'Liên hệ', cell: (s) => s.contacts[0] ? `${s.contacts[0].name}${s.contacts[0].phone ? ` · ${s.contacts[0].phone}` : ''}` : '—' },
    {
      header: '',
      cell: (s) => (
        <div className="flex flex-wrap gap-1">{s.isConsignor && <StatusChip tone="accent">Ký gửi</StatusChip>}</div>
      ),
    },
  ];
  return (
    <>
      <PageHeader
        title="Nhà cung cấp"
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>
            Thêm nhà cung cấp
          </Button>
        }
      />
      <DataTable columns={columns} rows={list.data?.items} rowKey={(s) => s.id} onRow={(s) => setEditing(s)} error={list.error} onRetry={() => list.refetch()} empty={{ icon: Building2, title: 'Chưa có nhà cung cấp' }} />
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
    contactName: s?.contacts[0]?.name ?? '',
    contactPhone: s?.contacts[0]?.phone ?? '',
    contactEmail: s?.contacts[0]?.email ?? '',
    note: s?.note ?? '',
    isConsignor: s?.isConsignor ?? false,
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
        contacts: f.contactName.trim() ? [{ name: f.contactName.trim(), ...(f.contactPhone && { phone: f.contactPhone }), ...(f.contactEmail && { email: f.contactEmail }) }] : [],
        note: f.note,
        isConsignor: f.isConsignor,
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
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-5" checked={f.isConsignor} onChange={(e) => setF({ ...f, isConsignor: e.target.checked })} />
          Nhận hàng ký gửi
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
