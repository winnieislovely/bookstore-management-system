import { PERMISSIONS } from '@bookstore/domain';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Copy, Lock, Monitor, Plus, RefreshCw, ScrollText, Search, ShieldCheck, Unlock, UserRound } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog, DataTable, Facts, SearchBox, SelectField, Tabs, TextArea, toast, useParam, type Column } from '../components/data';
import { Button, Field, InlineAlert, PageHeader, StatusChip, type Tone } from '../components/ui';
import { get, patch, post } from '../lib/api';
import { formatDateTime, formatRelative } from '../lib/format';
import { can, useMe } from '../lib/session';
import { Dialog } from '../pos/widgets';

/** Users, roles, POS devices and the audit log (FR-ADM-01..05, FR-ADM-09, TDD §7.2, §7.6). */

// =============================================================================================
// Users

interface User {
  id: string;
  username: string;
  displayName: string;
  roleId: string;
  roleName: string | null;
  status: string;
  mustChangePassword: boolean;
  hasPin: boolean;
  lastLoginAt: string | null;
  version: number;
}
interface Role {
  id: string;
  code: string;
  name: string;
  isOwner: boolean;
  version: number;
  permissions: string[];
}
const useRoles = (enabled = true) => useQuery({ queryKey: ['roles'], queryFn: () => get<{ items: Role[] }>('/api/v1/admin/roles'), enabled });

const USER_STATUS: Record<string, { tone: Tone; label: string }> = {
  active: { tone: 'success', label: 'Đang dùng' },
  locked: { tone: 'danger', label: 'Bị khóa' },
  disabled: { tone: 'neutral', label: 'Ngừng dùng' },
};

/** Temporary password: 12 characters without look-alikes (0/O, 1/l/I), from Web Crypto (Design §13.8). */
const PASSWORD_CHARS = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function tempPassword(length = 12): string {
  const bytes = crypto.getRandomValues(new Uint32Array(length));
  return Array.from(bytes, (b) => PASSWORD_CHARS[b % PASSWORD_CHARS.length]).join('');
}

export function UsersPage() {
  const { data: me } = useMe();
  const manage = can(me, 'user.manage');
  const [q, setQ] = useParam('q');
  const users = useQuery({ queryKey: ['users', q], queryFn: () => get<{ items: User[] }>('/api/v1/admin/users', { q: q || undefined }) });
  const roles = useRoles(manage && can(me, 'role.manage'));
  const [editing, setEditing] = useState<User | 'new' | null>(null);
  const [unlocking, setUnlocking] = useState<User | null>(null);
  const columns: Column<User>[] = [
    { header: 'Nhân viên', cell: (u) => <span><span className="font-medium">{u.displayName}</span><span className="block code text-[13px] text-ink-500">{u.username}</span></span> },
    { header: 'Vai trò', cell: (u) => u.roleName ?? '—' },
    { header: 'Đăng nhập gần nhất', cell: (u) => (u.lastLoginAt ? formatRelative(u.lastLoginAt) : 'Chưa đăng nhập') },
    { header: 'PIN', cell: (u) => (u.hasPin ? 'Đã đặt' : '—') },
    {
      header: 'Trạng thái',
      cell: (u) => (
        <div className="flex flex-wrap gap-1">
          <StatusChip tone={USER_STATUS[u.status]?.tone ?? 'neutral'} {...(u.status === 'locked' && { icon: Lock })}>
            {USER_STATUS[u.status]?.label ?? u.status}
          </StatusChip>
          {u.mustChangePassword && <StatusChip tone="info">Chờ đổi mật khẩu</StatusChip>}
        </div>
      ),
    },
    {
      header: '',
      align: 'right',
      cell: (u) =>
        u.status === 'locked' && can(me, 'user.unlock') ? (
          <Button size="sm" variant="tonal" icon={Unlock} onClick={(e) => (e.stopPropagation(), setUnlocking(u))}>
            Mở khóa
          </Button>
        ) : null,
    },
  ];
  return (
    <>
      <PageHeader
        title="Nhân viên"
        actions={
          manage && (
            <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>
              Thêm nhân viên
            </Button>
          )
        }
      />
      {/* Search (Design §13.8) */}
      <div className="mb-4">
        <SearchBox value={q} onChange={setQ} placeholder="Tìm tên hoặc tên đăng nhập…" />
      </div>
      <DataTable
        columns={columns}
        rows={users.data?.items}
        rowKey={(u) => u.id}
        onRow={manage ? (u) => setEditing(u) : undefined}
        error={users.error}
        onRetry={() => users.refetch()}
        empty={q ? { icon: Search, title: 'Không có nhân viên phù hợp', help: 'Thử đổi từ khóa.' } : { icon: UserRound, title: 'Chưa có nhân viên' }}
      />
      {editing && <UserForm user={editing === 'new' ? null : editing} roles={roles.data?.items ?? []} onClose={() => setEditing(null)} onSaved={() => users.refetch()} />}
      {unlocking && (
        <ConfirmDialog
          title={`Mở khóa tài khoản ${unlocking.displayName}?`}
          body="Tài khoản bị khóa sau nhiều lần nhập sai. Hãy chắc chắn đúng người đang cần đăng nhập."
          confirm="Mở khóa"
          onClose={() => setUnlocking(null)}
          onConfirm={async () => {
            await post(`/api/v1/admin/users/${unlocking.id}/unlock`);
            toast.success('Đã mở khóa tài khoản.');
            await users.refetch();
          }}
        />
      )}
    </>
  );
}

function UserForm({ user, roles, onClose, onSaved }: { user: User | null; roles: Role[]; onClose: () => void; onSaved: () => void }) {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [roleId, setRoleId] = useState(user?.roleId ?? '');
  const [password, setPassword] = useState(() => (user ? '' : tempPassword()));
  const [status, setStatus] = useState(user?.status === 'disabled' ? 'disabled' : 'active');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (user) await patch(`/api/v1/admin/users/${user.id}`, { displayName, ...(roleId && { roleId }), status, version: user.version });
      else await post('/api/v1/admin/users', { username: username.trim(), displayName: displayName.trim(), roleId, password });
      toast.success(user ? 'Đã lưu nhân viên.' : 'Đã thêm nhân viên. Họ sẽ đổi mật khẩu khi đăng nhập lần đầu.');
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
      title={user ? user.displayName : 'Thêm nhân viên'}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button variant="primary" loading={busy} disabled={!displayName.trim() || (!user && (!username.trim() || !roleId || password.length < 8))} onClick={save}>
            Lưu
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {!user && <Field label="Tên đăng nhập" required autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} />}
        <Field label="Tên hiển thị" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        {roles.length > 0 ? (
          <SelectField label="Vai trò" required value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            <option value="">— Chọn —</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </SelectField>
        ) : (
          user && <Facts items={[['Vai trò', user.roleName]]} />
        )}
        {!user && (
          <div>
            <Field label="Mật khẩu tạm" readOnly className="code" autoComplete="off" value={password} helper="Gửi mật khẩu này cho nhân viên. Họ sẽ đổi khi đăng nhập lần đầu." />
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="tonal"
                icon={Copy}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(password);
                    toast.success('Đã sao chép mật khẩu tạm.');
                  } catch {
                    toast.error('Không sao chép được. Hãy chọn và sao chép thủ công.');
                  }
                }}
              >
                Sao chép
              </Button>
              <Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => setPassword(tempPassword())}>
                Tạo mã khác
              </Button>
            </div>
          </div>
        )}
        {user && (
          <SelectField label="Trạng thái" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">Đang dùng</option>
            <option value="disabled">Ngừng dùng</option>
          </SelectField>
        )}
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      </div>
    </Dialog>
  );
}

// =============================================================================================
// Roles

/** Permission groups by key prefix, in the order of SRS Appendix A. */
const GROUPS: [string, string[]][] = [
  ['Bán hàng', ['sale', 'return', 'shift', 'einvoice', 'pos']],
  ['Sản phẩm và kho', ['catalog', 'inventory', 'purchasing', 'data']],
  ['Khách hàng và khuyến mãi', ['customer', 'promotion']],
  ['Đơn online, sự kiện, thư viện, website', ['order', 'event', 'library', 'web', 'payment']],
  ['Nhân sự', ['hr', 'payroll', 'staff']],
  ['Báo cáo và quản trị', ['report', 'audit', 'user', 'role', 'settings']],
];
const ALL = Object.keys(PERMISSIONS) as (keyof typeof PERMISSIONS)[];
const grouped = GROUPS.map(([label, prefixes]) => [label, ALL.filter((p) => prefixes.includes(p.split('.')[0]!))] as const);
const rest = ALL.filter((p) => !grouped.some(([, ps]) => ps.includes(p)));
if (rest.length) grouped.push(['Khác', rest] as const);

export function RolesPage() {
  const roles = useRoles();
  const [editing, setEditing] = useState<Role | 'new' | null>(null);
  return (
    <>
      <PageHeader
        title="Vai trò"
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>
            Thêm vai trò
          </Button>
        }
      />
      <DataTable
        columns={[
          { header: 'Vai trò', cell: (r: Role) => <span className="font-medium">{r.name}</span> },
          { header: 'Số quyền', align: 'right', cell: (r) => (r.isOwner ? 'Tất cả' : r.permissions.length) },
          { header: '', cell: (r) => (r.isOwner ? <StatusChip tone="brand" icon={ShieldCheck}>Chủ cửa hàng</StatusChip> : null) },
        ]}
        rows={roles.data?.items}
        rowKey={(r) => r.id}
        onRow={(r) => !r.isOwner && setEditing(r)}
        error={roles.error}
        minWidth={480}
        empty={{ icon: ShieldCheck, title: 'Chưa có vai trò' }}
      />
      {editing && <RoleForm role={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => roles.refetch()} />}
    </>
  );
}

function RoleForm({ role, onClose, onSaved }: { role: Role | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(role?.name ?? '');
  const [perms, setPerms] = useState<Set<string>>(new Set(role?.permissions ?? []));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toggle = (p: string, on: boolean) => {
    const next = new Set(perms);
    if (on) next.add(p);
    else next.delete(p);
    setPerms(next);
  };
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = { name: name.trim(), permissions: [...perms] };
      if (role) await patch(`/api/v1/admin/roles/${role.id}`, { ...body, version: role.version });
      else await post('/api/v1/admin/roles', body);
      toast.success('Đã lưu vai trò. Quyền mới có hiệu lực ngay.');
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
      title={role ? `Vai trò: ${role.name}` : 'Thêm vai trò'}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto self-center text-sm">{perms.size} quyền</span>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={save}>
            Lưu
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        <Field label="Tên vai trò" required value={name} onChange={(e) => setName(e.target.value)} />
        {grouped.map(([label, ps]) => (
          <fieldset key={label}>
            <legend className="mb-2 flex items-center gap-3 text-sm font-semibold">
              {label}
              <button type="button" className="text-[13px] font-normal text-navy-700 underline" onClick={() => setPerms(new Set([...perms, ...ps]))}>
                Chọn tất cả
              </button>
            </legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {ps.map((p) => (
                <label key={p} className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-0.5 size-5 shrink-0" checked={perms.has(p)} onChange={(e) => toggle(p, e.target.checked)} />
                  <span>
                    {PERMISSIONS[p]}
                    <span className="block code text-xs text-ink-500">{p}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      </div>
    </Dialog>
  );
}

// =============================================================================================
// POS devices and sync exceptions (TDD §7.2, §7.6)

interface Device {
  id: string;
  deviceCode: string;
  registerCode: string;
  lastSeenAt: string | null;
  leaseExpiresAt: string | null;
  revokedAt: string | null;
}
interface SyncException {
  id: string;
  deviceCode: string;
  type: string;
  exceptions: string[];
  result: unknown;
  payload: { docNo?: string; totalVnd?: number } | null;
  receivedAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
}
const EXCEPTION_LABEL: Record<string, string> = {
  price_drift: 'Giá khác giá hiện hành',
  negative_stock: 'Tồn kho âm',
  points_overdrawn: 'Điểm vượt số dư',
  unverified_transfer: 'Chuyển khoản chưa xác minh',
  offline_approval: 'Duyệt ngoại tuyến',
  approval_revoked: 'Người duyệt đã bị thu quyền',
  clock_skew: 'Lệch giờ máy',
  shift_conflict: 'Xung đột ca',
};
const dangerous = (code: string) => code.startsWith('rejected') || code === 'approval_revoked';

export function DevicesPage() {
  const { data: me } = useMe();
  const [tab, setTab] = useState<'exceptions' | 'devices' | 'registers'>('exceptions');
  const [showAll, setShowAll] = useState(false);
  const devices = useQuery({ queryKey: ['devices'], queryFn: () => get<{ items: Device[] }>('/api/v1/pos/devices'), enabled: tab === 'devices' });
  const exceptions = useQuery({ queryKey: ['sync-exceptions', showAll], queryFn: () => get<{ items: SyncException[] }>('/api/v1/pos/sync/exceptions', { all: String(showAll) }) });
  const registers = useQuery({ queryKey: ['registers'], queryFn: () => get<{ items: { id: string; code: string; name: string }[] }>('/api/v1/pos/registers'), enabled: tab === 'registers' });
  const [revoking, setRevoking] = useState<Device | null>(null);
  const [resolving, setResolving] = useState<SyncException | null>(null);
  const [addingRegister, setAddingRegister] = useState(false);
  const open = exceptions.data?.items.filter((x) => !x.resolvedAt).length ?? 0;
  return (
    <>
      <PageHeader title="Thiết bị POS" />
      <Tabs
        tabs={[
          { key: 'exceptions', label: 'Ngoại lệ đồng bộ', ...(open && { count: open }) },
          { key: 'devices', label: 'Thiết bị' },
          { key: 'registers', label: 'Quầy' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'exceptions' && (
        <>
          <label className="mb-3 inline-flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-5" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            Hiện cả mục đã xử lý
          </label>
          <DataTable
            columns={[
              { header: 'Nhận lúc', cell: (x: SyncException) => formatDateTime(x.receivedAt) },
              { header: 'Máy', cell: (x) => <span className="code">{x.deviceCode}</span> },
              { header: 'Chứng từ', cell: (x) => (x.payload?.docNo ? <span className="code">{x.payload.docNo}</span> : x.type) },
              {
                header: 'Ngoại lệ',
                cell: (x) => (
                  <div className="flex flex-wrap gap-1">
                    {x.exceptions.map((e) => (
                      <StatusChip key={e} tone={dangerous(e) ? 'danger' : 'warning'} icon={AlertTriangle}>
                        {EXCEPTION_LABEL[e] ?? e}
                      </StatusChip>
                    ))}
                  </div>
                ),
              },
              { header: 'Xử lý', cell: (x) => (x.resolvedAt ? <span className="text-[13px]"><StatusChip tone="success" icon={CheckCircle2}>Đã xử lý</StatusChip><span className="block text-ink-500">{x.resolutionNote}</span></span> : <Button size="sm" variant="tonal" onClick={(e) => (e.stopPropagation(), setResolving(x))}>Xử lý</Button>) },
            ]}
            rows={exceptions.data?.items}
            rowKey={(x) => x.id}
            error={exceptions.error}
            empty={{ icon: CheckCircle2, title: 'Không có ngoại lệ cần xem', help: 'Đơn bán ngoại tuyến có giá lệch, tồn âm hay chuyển khoản chưa xác minh sẽ hiện ở đây.' }}
          />
        </>
      )}
      {tab === 'devices' && (
        <DataTable
          columns={[
            { header: 'Mã máy', cell: (d: Device) => <span className="code">{d.deviceCode}</span> },
            { header: 'Quầy', cell: (d) => d.registerCode },
            { header: 'Hoạt động gần nhất', cell: (d) => (d.lastSeenAt ? formatRelative(d.lastSeenAt) : '—') },
            { header: 'Hạn bán ngoại tuyến', cell: (d) => (d.leaseExpiresAt ? formatDateTime(d.leaseExpiresAt) : '—') },
            { header: 'Trạng thái', cell: (d) => (d.revokedAt ? <StatusChip tone="neutral">Đã thu hồi</StatusChip> : d.leaseExpiresAt && new Date(d.leaseExpiresAt) < new Date() ? <StatusChip tone="warning">Quá hạn kết nối</StatusChip> : <StatusChip tone="success">Đang dùng</StatusChip>) },
            { header: '', align: 'right', cell: (d) => (!d.revokedAt ? <Button size="sm" variant="destructive-outline" onClick={(e) => (e.stopPropagation(), setRevoking(d))}>Thu hồi</Button> : null) },
          ]}
          rows={devices.data?.items}
          rowKey={(d) => d.id}
          error={devices.error}
          empty={{ icon: Monitor, title: 'Chưa có máy bán hàng', help: 'Đăng ký máy bằng cách mở màn hình Bán hàng trên máy đó.' }}
        />
      )}
      {tab === 'registers' && (
        <>
          {can(me, 'settings.manage') && (
            <div className="mb-3 flex justify-end">
              <Button variant="primary" icon={Plus} onClick={() => setAddingRegister(true)}>
                Thêm quầy
              </Button>
            </div>
          )}
          <DataTable columns={[{ header: 'Mã', cell: (r: { id: string; code: string; name: string }) => <span className="code">{r.code}</span> }, { header: 'Tên', cell: (r) => r.name }]} rows={registers.data?.items} rowKey={(r) => r.id} minWidth={360} empty={{ icon: Monitor, title: 'Chưa có quầy' }} />
        </>
      )}
      {revoking && (
        <ConfirmDialog
          title={`Thu hồi máy ${revoking.deviceCode}?`}
          body="Máy sẽ không bán và không đồng bộ được nữa; dữ liệu đã lưu trên máy bị xóa ở lần kết nối tới. Đơn chưa đồng bộ trên máy đó sẽ mất."
          confirm="Thu hồi"
          destructive
          onClose={() => setRevoking(null)}
          onConfirm={async () => {
            await post(`/api/v1/pos/devices/${revoking.id}/revoke`);
            toast.success('Đã thu hồi máy.');
            await devices.refetch();
          }}
        />
      )}
      {resolving && <ResolveDialog x={resolving} onClose={() => setResolving(null)} onDone={() => exceptions.refetch()} />}
      {addingRegister && <AddRegister onClose={() => setAddingRegister(false)} onDone={() => registers.refetch()} />}
    </>
  );
}

function ResolveDialog({ x, onClose, onDone }: { x: SyncException; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const transfer = x.exceptions.includes('unverified_transfer');
  return (
    <ConfirmDialog
      title={`Xử lý ${x.payload?.docNo ?? 'ngoại lệ'}`}
      {...(transfer && { body: 'Xác nhận đã nhận đủ tiền chuyển khoản trong sao kê ngân hàng trước khi đánh dấu đã xử lý.' })}
      confirm={transfer ? 'Đã nhận tiền – xử lý xong' : 'Đánh dấu đã xử lý'}
      onClose={onClose}
      onConfirm={async () => {
        await post(`/api/v1/pos/sync/exceptions/${x.id}/resolve`, { note });
        toast.success('Đã xử lý ngoại lệ.');
        onDone();
      }}
    >
      <div className="flex flex-wrap gap-1">
        {x.exceptions.map((e) => (
          <StatusChip key={e} tone={dangerous(e) ? 'danger' : 'warning'}>
            {EXCEPTION_LABEL[e] ?? e}
          </StatusChip>
        ))}
      </div>
      <TextArea label="Ghi chú cách xử lý" required value={note} onChange={(e) => setNote(e.target.value)} />
    </ConfirmDialog>
  );
}

function AddRegister({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  return (
    <ConfirmDialog
      title="Thêm quầy"
      confirm="Thêm"
      onClose={onClose}
      onConfirm={async () => {
        await post('/api/v1/pos/registers', { code: code.trim().toUpperCase(), name: name.trim() });
        toast.success('Đã thêm quầy.');
        onDone();
      }}
    >
      <Field label="Mã quầy" required className="code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
      <Field label="Tên quầy" required value={name} onChange={(e) => setName(e.target.value)} />
    </ConfirmDialog>
  );
}

// =============================================================================================
// Audit log (FR-ADM-05)

interface AuditEntry {
  id: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  at: string;
  ip: string | null;
  requestId: string | null;
}

export function AuditPage() {
  const [action, setAction] = useState('');
  const [entity, setEntity] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [pages, setPages] = useState<string[]>(['']);
  const [open, setOpen] = useState<AuditEntry | null>(null);
  const cursor = pages[pages.length - 1];
  const q = { action: action || undefined, entity: entity || undefined, from: from ? new Date(from).toISOString() : undefined, to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined, cursor: cursor || undefined, limit: 40 };
  const list = useQuery({ queryKey: ['audit', q], queryFn: () => get<{ items: AuditEntry[]; nextCursor: string | null }>('/api/v1/admin/audit', q) });
  const reset = () => setPages(['']);
  return (
    <>
      <PageHeader title="Nhật ký thao tác" />
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Field label="Thao tác (bắt đầu bằng)" placeholder="vd. sale.void" value={action} onChange={(e) => (setAction(e.target.value), reset())} />
        <Field label="Đối tượng" placeholder="vd. customer" value={entity} onChange={(e) => (setEntity(e.target.value), reset())} />
        <Field label="Từ ngày" type="date" value={from} onChange={(e) => (setFrom(e.target.value), reset())} />
        <Field label="Đến ngày" type="date" value={to} onChange={(e) => (setTo(e.target.value), reset())} />
      </div>
      <DataTable
        columns={[
          { header: 'Thời gian', cell: (a: AuditEntry) => formatDateTime(a.at) },
          { header: 'Người thực hiện', cell: (a) => a.actorName ?? 'Hệ thống' },
          { header: 'Thao tác', cell: (a) => <span className="code">{a.action}</span> },
          { header: 'Đối tượng', cell: (a) => <span>{a.entity}{a.entityId && <span className="ml-1 code text-[13px] text-ink-500">{a.entityId.slice(0, 13)}</span>}</span> },
          { header: 'IP', cell: (a) => <span className="code text-[13px]">{a.ip ?? ''}</span> },
        ]}
        rows={list.data?.items}
        rowKey={(a) => a.id}
        onRow={setOpen}
        error={list.error}
        empty={{ icon: ScrollText, title: 'Không có mục phù hợp' }}
      />
      <div className="mt-4 flex justify-end gap-2">
        <Button size="sm" variant="ghost" disabled={pages.length <= 1} onClick={() => setPages(pages.slice(0, -1))}>
          ‹ Mới hơn
        </Button>
        <Button size="sm" variant="ghost" disabled={!list.data?.nextCursor} onClick={() => setPages([...pages, list.data!.nextCursor!])}>
          Cũ hơn ›
        </Button>
      </div>
      {open && (
        <Dialog title={open.action} size="lg" onClose={() => setOpen(null)}>
          <div className="flex flex-col gap-4">
            <Facts items={[['Thời gian', formatDateTime(open.at)], ['Người thực hiện', open.actorName ?? 'Hệ thống'], ['Đối tượng', `${open.entity} ${open.entityId ?? ''}`], ['Mã yêu cầu', <span className="code">{open.requestId}</span>]]} />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {(['before', 'after'] as const).map((k) => (
                <div key={k}>
                  <p className="mb-1 text-[13px] font-semibold text-ink-700">{k === 'before' ? 'Trước' : 'Sau'}</p>
                  <pre className="max-h-80 overflow-auto rounded-md bg-paper-100 p-3 text-xs">{open[k] == null ? '—' : JSON.stringify(open[k], null, 2)}</pre>
                </div>
              ))}
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
