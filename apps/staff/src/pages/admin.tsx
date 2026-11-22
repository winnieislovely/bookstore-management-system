import { PERMISSIONS } from '@bookstore/domain';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Copy, Lock, Monitor, Plus, RefreshCw, Search, ShieldCheck, Unlock, UserRound } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog, DataTable, Facts, SearchBox, SelectField, TextArea, toast, useParam, type Column } from '../components/data';
import { Button, Card, Field, InlineAlert, PageHeader, StatusChip, type Tone } from '../components/ui';
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
  const { data: me } = useMe();
  // Disabling an employee: their phones still hold store data, so offer to revoke them (FR-ADM-04).
  const disabling = !!user && user.status !== 'disabled' && status === 'disabled';
  const devices = useQuery({ queryKey: ['devices'], queryFn: () => get<{ items: Device[] }>('/api/v1/pos/devices'), enabled: disabling && can(me, 'pos.offline.manage') });
  const theirs = (devices.data?.items ?? []).filter((d) => d.lastUserId === user?.id && !d.revokedAt);
  const [revokeDevices, setRevokeDevices] = useState(true);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (user) await patch(`/api/v1/admin/users/${user.id}`, { displayName, ...(roleId && { roleId }), status, ...(disabling && theirs.length > 0 && revokeDevices && { revokeDevices: true }), version: user.version });
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
        {disabling && theirs.length > 0 && (
          <label className="inline-flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 size-[18px] accent-navy-700" checked={revokeDevices} onChange={(e) => setRevokeDevices(e.target.checked)} />
            <span>
              Thu hồi máy bán hàng người này dùng gần nhất: <span className="code">{theirs.map((d) => d.deviceCode).join(', ')}</span>
              <span className="block text-[13px] text-ink-500">Dữ liệu cửa hàng trên máy bị xóa ở lần kết nối tới.</span>
            </span>
          </label>
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
  lastUserId: string | null;
  lastUserName: string | null;
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

type Register = { id: string; code: string; name: string };

/** More than this since the last contact: offline sales may be waiting on the device (Design, Quầy & máy bán hàng). */
const QUIET_MS = 10 * 60_000;

/**
 * Cấu hình › Quầy & máy bán hàng (FR-ADM-04, TDD §7.2, §7.6): sync exceptions while unresolved, registers
 * (add, rename) and devices with their last user and revoke. Replaces the Thiết bị POS page.
 */
export function PosDevicesPanel() {
  const { data: me } = useMe();
  const manageDevices = can(me, 'pos.offline.manage');
  const manageRegisters = can(me, 'settings.manage');
  const devices = useQuery({ queryKey: ['devices'], queryFn: () => get<{ items: Device[] }>('/api/v1/pos/devices'), enabled: manageDevices });
  const exceptions = useQuery({ queryKey: ['sync-exceptions', false], queryFn: () => get<{ items: SyncException[] }>('/api/v1/pos/sync/exceptions', { all: 'false' }), enabled: manageDevices });
  const registers = useQuery({ queryKey: ['registers'], queryFn: () => get<{ items: Register[] }>('/api/v1/pos/registers') });
  const [revoking, setRevoking] = useState<Device | null>(null);
  const [resolving, setResolving] = useState<SyncException | null>(null);
  const [editing, setEditing] = useState<Register | 'new' | null>(null);
  const open = exceptions.data?.items ?? [];
  const quiet = revoking?.lastSeenAt && Date.now() - Date.parse(revoking.lastSeenAt) > QUIET_MS ? revoking.lastSeenAt : null;
  return (
    <div className="flex flex-col gap-6">
      {/* Only while something needs a look; a notification says so too (FR-POS-26). */}
      {open.length > 0 && (
        <Card title={`${open.length} đơn bán ngoại tuyến cần xem`} className="border-warning-700/40">
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
              { header: '', align: 'right', cell: (x) => <Button size="sm" variant="tonal" onClick={(e) => (e.stopPropagation(), setResolving(x))}>Xử lý</Button> },
            ]}
            rows={open}
            rowKey={(x) => x.id}
            empty={{ icon: CheckCircle2, title: 'Không có ngoại lệ cần xem' }}
          />
        </Card>
      )}
      <Card
        title="Quầy"
        action={
          manageRegisters && (
            <Button variant="secondary" size="sm" icon={Plus} onClick={() => setEditing('new')}>
              Thêm quầy
            </Button>
          )
        }
      >
        <DataTable
          columns={[{ header: 'Mã', cell: (r: Register) => <span className="code">{r.code}</span> }, { header: 'Tên', cell: (r) => r.name }]}
          rows={registers.data?.items}
          rowKey={(r) => r.id}
          {...(manageRegisters && { onRow: setEditing })}
          minWidth={320}
          empty={{ icon: Monitor, title: 'Chưa có quầy' }}
        />
      </Card>
      {manageDevices && (
        <Card title="Máy bán hàng">
          <DataTable
            columns={[
              { header: 'Mã máy', cell: (d: Device) => <span className="code">{d.deviceCode}</span> },
              { header: 'Quầy', cell: (d) => d.registerCode },
              { header: 'Người dùng gần nhất', cell: (d) => d.lastUserName ?? <span className="text-ink-500">—</span> },
              { header: 'Hoạt động gần nhất', cell: (d) => (d.lastSeenAt ? formatRelative(d.lastSeenAt) : '—') },
              { header: 'Trạng thái', cell: (d) => (d.revokedAt ? <StatusChip tone="neutral">Đã thu hồi</StatusChip> : d.leaseExpiresAt && new Date(d.leaseExpiresAt) < new Date() ? <StatusChip tone="warning">Quá hạn kết nối</StatusChip> : <StatusChip tone="success">Đang dùng</StatusChip>) },
              { header: '', align: 'right', cell: (d) => (!d.revokedAt ? <Button size="sm" variant="destructive-outline" onClick={(e) => (e.stopPropagation(), setRevoking(d))}>Thu hồi</Button> : null) },
            ]}
            rows={devices.data?.items}
            rowKey={(d) => d.id}
            error={devices.error}
            minWidth={640}
            empty={{ icon: Monitor, title: 'Chưa có máy bán hàng', help: 'Đăng ký máy bằng cách mở màn hình Bán hàng trên máy đó.' }}
          />
        </Card>
      )}
      {revoking && (
        <ConfirmDialog
          title={`Thu hồi máy ${revoking.deviceCode}?`}
          body="Máy sẽ không bán và không đồng bộ được nữa; dữ liệu cửa hàng lưu trên máy bị xóa ở lần kết nối tới."
          confirm="Thu hồi"
          destructive
          onClose={() => setRevoking(null)}
          onConfirm={async () => {
            await post(`/api/v1/pos/devices/${revoking.id}/revoke`);
            toast.success('Đã thu hồi máy.');
            await devices.refetch();
          }}
        >
          {quiet && <InlineAlert tone="warning">Máy liên lạc lần cuối {formatDateTime(quiet)}; đơn bán ngoại tuyến sau thời điểm này chưa gửi lên sẽ mất.</InlineAlert>}
        </ConfirmDialog>
      )}
      {resolving && <ResolveDialog x={resolving} onClose={() => setResolving(null)} onDone={() => exceptions.refetch()} />}
      {editing && <RegisterForm row={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={() => registers.refetch()} />}
    </div>
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

/** Add a register, or rename one – the code is fixed once made, device codes derive from it. */
function RegisterForm({ row, onClose, onDone }: { row: Register | null; onClose: () => void; onDone: () => void }) {
  const [code, setCode] = useState(row?.code ?? '');
  const [name, setName] = useState(row?.name ?? '');
  return (
    <ConfirmDialog
      title={row ? 'Sửa quầy' : 'Thêm quầy'}
      confirm={row ? 'Lưu' : 'Thêm'}
      onClose={onClose}
      onConfirm={async () => {
        if (row) await patch(`/api/v1/pos/registers/${row.id}`, { name: name.trim() });
        else await post('/api/v1/pos/registers', { code: code.trim().toUpperCase(), name: name.trim() });
        toast.success(row ? 'Đã lưu quầy.' : 'Đã thêm quầy.');
        onDone();
      }}
    >
      {row ? <Facts items={[['Mã quầy', <span className="code">{row.code}</span>]]} /> : <Field label="Mã quầy" required className="code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />}
      <Field label="Tên quầy" required value={name} onChange={(e) => setName(e.target.value)} />
    </ConfirmDialog>
  );
}

// The audit log page is in ./audit.tsx (Design §12.11).
