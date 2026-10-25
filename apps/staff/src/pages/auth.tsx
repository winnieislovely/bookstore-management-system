import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { Wordmark } from '../components/logo';
import { Button, Field, InlineAlert } from '../components/ui';
import { ApiError, patch, post } from '../lib/api';
import { t } from '../lib/i18n';
import { useSetupStatus } from '../lib/session';

/** Login, first-run wizard and forced password change (FR-ADM-01, FR-ADM-02, Design §3.4). */

function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(320px,40%)_1fr]">
      <aside className="on-navy flex items-center justify-center bg-navy-700 p-10 max-lg:py-8">
        <Wordmark width={240} />
      </aside>
      <main className="flex items-start justify-center px-4 py-10 sm:items-center">
        <div className="w-full max-w-[420px]">
          <h1 className="mb-6 font-display text-[32px] leading-10 font-semibold text-navy-700 sm:text-[40px] sm:leading-[48px]">{title}</h1>
          {children}
        </div>
      </main>
    </div>
  );
}

function errorMessage(e: unknown): string {
  if (e instanceof ApiError && e.code === 'validation_failed' && Array.isArray(e.details)) {
    return (e.details as { message: string }[]).map((d) => d.message).join(' ');
  }
  return e instanceof Error ? e.message : String(e);
}

export function LoginPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post('/api/v1/auth/login', { username, password });
      await qc.invalidateQueries({ queryKey: ['me'] });
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title={t('auth.title')}>
      <form className="flex flex-col gap-5" onSubmit={submit} noValidate>
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        <Field label={t('auth.username')} autoComplete="username" required value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        <Field label={t('auth.password')} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <Button type="submit" variant="primary" size="lg" full loading={busy} disabled={!username || !password}>
          {t('auth.signIn')}
        </Button>
      </form>
    </AuthLayout>
  );
}

export function SetupPage() {
  const status = useSetupStatus();
  if (status.data && !status.data.needsSetup) return <Navigate to="/" replace />;
  return <SetupForm />;
}

function SetupForm() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2>(1);
  const [store, setStore] = useState({ name: 'The Bookshelf Hanoi', address: '', taxCode: '', phone: '' });
  const [owner, setOwner] = useState({ displayName: '', username: '', password: '', confirm: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (owner.password !== owner.confirm) return setError(t('auth.mismatch'));
    setBusy(true);
    setError(null);
    try {
      await post('/api/v1/setup', { store, owner: { username: owner.username, displayName: owner.displayName, password: owner.password } });
      await post('/api/v1/auth/login', { username: owner.username, password: owner.password });
      qc.setQueryData(['setup'], { needsSetup: false });
      await qc.refetchQueries({ queryKey: ['me'] });
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title={t('setup.title')}>
      <p className="mb-4 text-ink-700">{t('setup.intro')}</p>
      <ol className="mb-6 flex gap-4 text-sm" aria-label="Các bước">
        {(['setup.step1', 'setup.step2'] as const).map((k, i) => (
          <li key={k} className={i + 1 === step ? 'font-semibold text-navy-700' : 'text-ink-500'} aria-current={i + 1 === step ? 'step' : undefined}>
            {i + 1}. {t(k)}
          </li>
        ))}
      </ol>
      {error && (
        <div className="mb-4">
          <InlineAlert tone="danger">{error}</InlineAlert>
        </div>
      )}
      {step === 1 ? (
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            setStep(2);
          }}
        >
          <Field label={t('setup.storeName')} required value={store.name} onChange={(e) => setStore({ ...store, name: e.target.value })} />
          <Field label={t('setup.address')} value={store.address} onChange={(e) => setStore({ ...store, address: e.target.value })} />
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={t('setup.taxCode')} inputMode="numeric" value={store.taxCode} onChange={(e) => setStore({ ...store, taxCode: e.target.value })} />
            <Field label={t('setup.phone')} inputMode="tel" value={store.phone} onChange={(e) => setStore({ ...store, phone: e.target.value })} />
          </div>
          <Button type="submit" variant="primary" size="lg" full disabled={!store.name.trim()}>
            {t('common.continue')}
          </Button>
        </form>
      ) : (
        <form className="flex flex-col gap-5" onSubmit={submit} noValidate>
          <Field label={t('setup.ownerName')} required value={owner.displayName} onChange={(e) => setOwner({ ...owner, displayName: e.target.value })} autoFocus />
          <Field label={t('auth.username')} required autoComplete="username" value={owner.username} onChange={(e) => setOwner({ ...owner, username: e.target.value })} />
          <Field label={t('auth.password')} type="password" required autoComplete="new-password" helper={t('auth.newPasswordHelp')} value={owner.password} onChange={(e) => setOwner({ ...owner, password: e.target.value })} />
          <Field
            label={t('auth.confirmPassword')}
            type="password"
            required
            autoComplete="new-password"
            value={owner.confirm}
            error={owner.confirm && owner.confirm !== owner.password ? t('auth.mismatch') : undefined}
            onChange={(e) => setOwner({ ...owner, confirm: e.target.value })}
          />
          <div className="flex gap-2">
            <Button type="button" variant="secondary" size="lg" onClick={() => setStep(1)}>
              {t('common.back')}
            </Button>
            <Button type="submit" variant="primary" size="lg" full loading={busy} disabled={!owner.displayName || !owner.username || owner.password.length < 10 || owner.password !== owner.confirm}>
              {t('setup.submit')}
            </Button>
          </div>
        </form>
      )}
    </AuthLayout>
  );
}

export function ChangePasswordPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (form.next !== form.confirm) return setError(t('auth.mismatch'));
    setBusy(true);
    setError(null);
    try {
      await patch('/api/v1/me/password', { currentPassword: form.current, newPassword: form.next });
      await qc.invalidateQueries({ queryKey: ['me'] });
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title={t('auth.changePassword')}>
      <p className="mb-4 text-ink-700">{t('auth.changePasswordHelp')}</p>
      <form className="flex flex-col gap-5" onSubmit={submit} noValidate>
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        <Field label={t('auth.currentPassword')} type="password" required autoComplete="current-password" value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} autoFocus />
        <Field label={t('auth.newPassword')} type="password" required autoComplete="new-password" helper={t('auth.newPasswordHelp')} value={form.next} onChange={(e) => setForm({ ...form, next: e.target.value })} />
        <Field
          label={t('auth.confirmPassword')}
          type="password"
          required
          autoComplete="new-password"
          value={form.confirm}
          error={form.confirm && form.confirm !== form.next ? t('auth.mismatch') : undefined}
          onChange={(e) => setForm({ ...form, confirm: e.target.value })}
        />
        <Button type="submit" variant="primary" size="lg" full loading={busy} disabled={!form.current || form.next.length < 10 || form.next !== form.confirm}>
          {t('common.save')}
        </Button>
      </form>
    </AuthLayout>
  );
}
