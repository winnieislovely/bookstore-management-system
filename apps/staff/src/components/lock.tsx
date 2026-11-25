import { useQueryClient } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import { useEffect, useState } from 'react';
import { post, put } from '../lib/api';
import { useSignOut, type Me } from '../lib/session';
import { Dialog, PinPad } from '../pos/widgets';
import { errText, toast } from './data';
import { Wordmark } from './logo';
import { Button, Field, InlineAlert } from './ui';

/**
 * Lock screen (FR-ADM-01, NFR-SEC-07, Design §13.5): replaces any page while the session is locked.
 * Navy full screen, the user's name, six PIN dots and the keypad; “Đổi người dùng” signs out.
 */
export function LockScreen({ me }: { me: Me }) {
  const qc = useQueryClient();
  const signOut = useSignOut();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);

  const submit = async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      await post('/api/v1/auth/unlock', { pin: value });
      await qc.refetchQueries({ queryKey: ['me'] });
      // Queries that failed while locked load again.
      void qc.invalidateQueries();
    } catch (e) {
      setError(errText(e));
      setPin('');
      setShake(true);
      setTimeout(() => setShake(false), 400);
    } finally {
      setBusy(false);
    }
  };

  // The PIN is checked as soon as the sixth digit is in.
  useEffect(() => {
    if (pin.length === 6 && !busy) void submit(pin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  // A hardware keyboard works too: digits and Backspace.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) setPin((p) => (p.length < 6 ? p + e.key : p));
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="on-navy fixed inset-0 z-[60] flex flex-col items-center justify-center gap-6 overflow-y-auto bg-navy-700 px-4 py-8 text-white" role="dialog" aria-modal="true" aria-label="Màn hình đang khóa">
      <Wordmark width={160} />
      <div className="flex flex-col items-center gap-2">
        <span className="flex size-14 items-center justify-center rounded-full bg-white/15 text-lg font-semibold" aria-hidden>
          {initialsOf(me.displayName)}
        </span>
        <span className="text-lg font-semibold">{me.displayName}</span>
        <span className="text-sm text-white/70">Nhập mã PIN để tiếp tục</span>
      </div>
      <div className={shake ? 'animate-[shake_0.4s]' : undefined}>
        <PinPad value={pin} onChange={(v) => !busy && setPin(v)} dark />
      </div>
      <p className="min-h-5 text-center text-sm text-sand-300" role="alert">
        {error}
      </p>
      <button type="button" className="inline-flex items-center gap-2 text-sm text-white/80 underline-offset-4 hover:underline" onClick={() => void signOut()}>
        <LogOut size={16} aria-hidden /> Đổi người dùng
      </button>
    </div>
  );
}

export const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(-2)
    .join('')
    .toUpperCase();

/** “Đặt mã PIN” / “Đổi mã PIN” from the user menu: the password is confirmed first (Design §13.5). */
export function PinDialog({ me, onClose }: { me: Me; onClose: () => void }) {
  const qc = useQueryClient();
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 6);
  const mismatch = again.length === 6 && pin !== again;
  return (
    <Dialog
      title={me.hasPin ? 'Đổi mã PIN' : 'Đặt mã PIN'}
      size="sm"
      onClose={onClose}
      footer={
        <Button
          variant="primary"
          loading={busy}
          disabled={!password || pin.length !== 6 || pin !== again}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await put('/api/v1/me/pin', { pin, currentPassword: password });
              await qc.refetchQueries({ queryKey: ['me'] });
              toast.success('Đã lưu mã PIN.');
              onClose();
            } catch (e) {
              setError(errText(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Lưu mã PIN
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-700">Mã PIN gồm 6 chữ số, dùng để mở khóa màn hình và duyệt thao tác cho nhân viên khác.</p>
        <Field label="Mật khẩu hiện tại" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        <Field label="Mã PIN mới" type="password" inputMode="numeric" autoComplete="off" required value={pin} onChange={(e) => setPin(digits(e.target.value))} helper="6 chữ số." />
        <Field label="Nhập lại mã PIN" type="password" inputMode="numeric" autoComplete="off" required value={again} onChange={(e) => setAgain(digits(e.target.value))} error={mismatch ? 'Hai mã PIN không khớp.' : undefined} />
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      </div>
    </Dialog>
  );
}

/**
 * POS auto-lock (Design §13.5): after `minutes` without a tap or key the session is locked – only for
 * a user with a PIN, and only online (the server keeps the lock).
 */
export function useAutoLock(me: Me, minutes: number | null | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!me.hasPin || !minutes || minutes <= 0) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const lockNow = async () => {
      if (!navigator.onLine) return arm();
      try {
        await post('/api/v1/auth/lock');
        await qc.refetchQueries({ queryKey: ['me'] });
      } catch {
        arm();
      }
    };
    const arm = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void lockNow(), minutes * 60_000);
    };
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    events.forEach((e) => window.addEventListener(e, arm, { passive: true }));
    arm();
    return () => {
      if (timer) clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, arm));
    };
  }, [me.hasPin, minutes, qc]);
}
