import { useQuery } from '@tanstack/react-query';
import { Building2, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { DataTable, SearchBox, TextArea, toast, useParam, type Column } from '../components/data';
import { Button, Field, InlineAlert, PageHeader, StatusChip } from '../components/ui';
import { get, patch, post } from '../lib/api';
import { Dialog } from '../pos/widgets';
import { useSuppliers } from './stockin';

/** Suppliers (FR-PUR-01, Design §13.8); no payables (FR-PUR-06 removed). */

type Supplier = NonNullable<ReturnType<typeof useSuppliers>['data']>['items'][number];

export function SuppliersPage() {
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null);
  const [q, setQ] = useParam('q');
  // Own query so the search does not narrow the shared supplier list used by stock-in.
  const list = useQuery({ queryKey: ['suppliers', 'list', q], queryFn: () => get<{ items: Supplier[] }>('/api/v1/purchasing/suppliers', { q: q || undefined }) });
  const all = useSuppliers();
  const columns: Column<Supplier>[] = [
    { header: 'Nhà cung cấp', cell: (s) => <span className="font-medium">{s.name}</span> },
    { header: 'Điện thoại', className: 'whitespace-nowrap', cell: (s) => s.phone ?? '—' },
    { header: 'Email', cell: (s) => s.email ?? '—' },
    { header: 'Mã số thuế', cell: (s) => (s.taxCode ? <span className="code">{s.taxCode}</span> : '—') },
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
      <div className="mb-4">
        <SearchBox value={q} onChange={setQ} placeholder="Tìm tên hoặc số điện thoại…" />
      </div>
      <DataTable
        columns={columns}
        rows={list.data?.items}
        rowKey={(s) => s.id}
        onRow={(s) => setEditing(s)}
        error={list.error}
        onRetry={() => list.refetch()}
        empty={q ? { icon: Search, title: 'Không có nhà cung cấp phù hợp', help: 'Thử đổi từ khóa.' } : { icon: Building2, title: 'Chưa có nhà cung cấp' }}
      />
      {editing && <SupplierForm supplier={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => (list.refetch(), all.refetch())} />}
    </>
  );
}

function SupplierForm({ supplier, onClose, onSaved }: { supplier: Supplier | null; onClose: () => void; onSaved: () => void }) {
  const s = supplier;
  const [f, setF] = useState({
    name: s?.name ?? '',
    phone: s?.phone ?? '',
    email: s?.email ?? '',
    taxCode: s?.taxCode ?? '',
    isConsignor: s?.isConsignor ?? false,
    note: s?.note ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = {
        name: f.name.trim(),
        phone: f.phone.trim(),
        email: f.email.trim() || null,
        taxCode: f.taxCode.trim() || null,
        isConsignor: f.isConsignor,
        note: f.note,
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
          <Button variant="primary" loading={busy} disabled={!f.name.trim() || !f.phone.trim()} onClick={save}>
            Lưu
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Tên" required value={f.name} onChange={set('name')} className="sm:col-span-2" autoFocus />
        <Field label="Điện thoại" required inputMode="tel" value={f.phone} onChange={set('phone')} />
        <Field label="Email" type="email" value={f.email} onChange={set('email')} />
        <Field label="Mã số thuế" className="code sm:col-span-2" value={f.taxCode} onChange={set('taxCode')} />
        <label className="inline-flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" className="size-5" checked={f.isConsignor} onChange={(e) => setF({ ...f, isConsignor: e.target.checked })} />
          Nhận hàng ký gửi
        </label>
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
