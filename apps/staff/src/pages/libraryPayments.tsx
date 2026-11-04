import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Wallet } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ConfirmDialog, DataTable, FilterMenu, TextArea, TimeFilter, timeDays, timeLabel, useParam, type Column } from '../components/data';
import { PageHeader, StatusChip } from '../components/ui';
import { get, post } from '../lib/api';
import { formatDateTime, formatVnd, storeToday } from '../lib/format';
import { can, useMe } from '../lib/session';
import { PAYMENT_METHOD, PAYMENT_METHOD_LABEL } from './library';

/**
 * Sổ thu thư viện (FR-LIB-09a, Design §13.8): receipts and refunds taken at the library desk, by
 * period and method, with totals to reconcile the desk. Library revenue, not shop sales (BR-14).
 */

interface Entry {
  id: string;
  docNo: string;
  kind: 'receipt' | 'refund';
  method: 'cash' | 'transfer' | 'card';
  amountVnd: number;
  ref: string | null;
  reason: string | null;
  receivedAt: string;
  customerId: string;
  customerName: string;
  receivedBy: string | null;
  refunded: boolean;
  refundOfNo: string | null;
  items: string | null;
}

export function LibraryPaymentsPage() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const today = storeToday();
  const [time, setTime] = useParam('time', `${today}..${today}`);
  const [method, setMethod] = useParam('method');
  const [refund, setRefund] = useState<Entry | null>(null);
  const [reason, setReason] = useState('');
  const days = timeDays(time) ?? [today, today];
  const book = useQuery({
    queryKey: ['library-payments', days[0], days[1], method],
    queryFn: () => get<{ items: Entry[]; totals: { cash: number; transfer: number; card: number; all: number } }>('/api/v1/library/payments', { from: days[0], to: days[1], method: method || undefined }),
  });
  const t = book.data?.totals;
  const tile = (label: string, value: number | undefined, strong?: boolean): ReactNode => (
    <div className="rounded-lg border border-paper-300 bg-white p-4">
      <p className="text-sm text-ink-500">{label}</p>
      <p className={strong ? 'mt-1 text-2xl leading-8 font-semibold num' : 'mt-1 text-xl font-semibold num'}>{value === undefined ? '…' : formatVnd(value)}</p>
    </div>
  );
  const columns: Column<Entry>[] = [
    { header: 'Thời gian', className: 'whitespace-nowrap', cell: (e) => formatDateTime(e.receivedAt) },
    { header: 'Số phiếu', className: 'whitespace-nowrap', cell: (e) => <span className="code">{e.docNo}</span> },
    {
      header: 'Khách',
      cell: (e) => (
        <Link to={`/customers/${e.customerId}`} className="hover:underline">
          {e.customerName}
        </Link>
      ),
    },
    {
      header: 'Khoản thu',
      cell: (e) =>
        e.kind === 'refund' ? (
          <span className="flex flex-col">
            <span>Hoàn phiếu {e.refundOfNo}</span>
            {e.reason && <span className="text-[13px] text-ink-500">{e.reason}</span>}
          </span>
        ) : (
          <span className="flex flex-col items-start gap-1">
            <span>{e.items ?? '—'}</span>
            {e.refunded && <StatusChip tone="neutral">Đã hoàn</StatusChip>}
          </span>
        ),
    },
    { header: 'Phương thức', cell: (e) => `${PAYMENT_METHOD_LABEL[e.method] ?? e.method}${e.ref ? ` · ${e.ref}` : ''}` },
    { header: 'Số tiền', align: 'right', cell: (e) => <span className={e.amountVnd < 0 ? 'text-danger-700' : ''}>{formatVnd(e.amountVnd)}</span> },
    { header: 'Người thu', cell: (e) => e.receivedBy ?? '—' },
    {
      header: '',
      cell: (e) =>
        e.kind === 'receipt' && !e.refunded && can(me, 'library.fine_waive') ? (
          <button type="button" className="text-sm text-danger-700 hover:underline" onClick={() => setRefund(e)}>
            Hoàn tiền
          </button>
        ) : null,
    },
  ];
  return (
    <>
      <PageHeader title="Sổ thu thư viện" />
      <div className="mb-4 flex">
        <FilterMenu
          groups={[
            { kind: 'custom', label: 'Thời gian', summary: time === `${today}..${today}` ? 'Hôm nay' : timeLabel(time), active: time !== `${today}..${today}`, onClear: () => setTime(`${today}..${today}`), content: <TimeFilter value={time} onChange={setTime} allowAll={false} /> },
            { kind: 'single', label: 'Phương thức', options: Object.entries(PAYMENT_METHOD).map(([key, label]) => ({ key, label })), value: method, onChange: setMethod },
          ]}
        />
      </div>
      {/* Totals for the period, to reconcile the desk (FR-LIB-09a). */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {tile('Tổng thu', t?.all, true)}
        {tile('Tiền mặt', t?.cash)}
        {tile('Chuyển khoản', t?.transfer)}
      </div>
      <DataTable
        columns={columns}
        rows={book.data?.items}
        rowKey={(e) => e.id}
        error={book.error}
        onRetry={() => book.refetch()}
        minWidth={900}
        empty={{ icon: Wallet, title: 'Chưa có khoản thu nào trong khoảng này' }}
      />
      {refund && (
        <ConfirmDialog
          title={`Hoàn phiếu ${refund.docNo} – ${formatVnd(refund.amountVnd)}?`}
          body="Trả lại tiền cho khách; các khoản của phiếu này chuyển về chưa thu."
          confirm="Hoàn tiền"
          destructive
          onConfirm={async () => {
            await post(`/api/v1/library/payments/${refund.id}/refund`, { reason });
            setReason('');
            void qc.invalidateQueries({ queryKey: ['library-payments'] });
            void qc.invalidateQueries({ queryKey: ['library-borrower'] });
          }}
          onClose={() => setRefund(null)}
        >
          <TextArea label="Lý do" required value={reason} onChange={(e) => setReason(e.target.value)} />
        </ConfirmDialog>
      )}
    </>
  );
}
