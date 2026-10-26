import { parseVnd } from '@bookstore/domain';
import { clsx } from 'clsx';
import { Delete, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { formatNumber } from '../lib/format';
import { t } from '../lib/i18n';

/** Touch-first POS widgets (Design §10.3, §10.9, §13). */

export function Dialog({ title, onClose, children, size = 'md', footer }: { title: string; onClose?: (() => void) | undefined; children: ReactNode; size?: 'sm' | 'md' | 'lg'; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input, button, [tabindex]')?.focus();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('keydown', esc);
      prev?.focus();
    };
  }, [onClose]);
  const w = { sm: 'sm:w-[480px]', md: 'sm:w-[640px]', lg: 'sm:w-[880px]' }[size];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-[rgba(26,38,56,0.45)]" onClick={onClose} />
      <div ref={ref} className={clsx('relative flex max-h-[90dvh] w-full flex-col rounded-t-xl bg-white shadow-lg sm:rounded-lg', w)}>
        <header className="flex items-center justify-between gap-2 border-b border-paper-300 px-6 py-4">
          <h2 className="text-base font-semibold">{title}</h2>
          {onClose && (
            <button type="button" className="inline-flex size-10 items-center justify-center rounded-full hover:bg-navy-50" aria-label={t('common.close')} onClick={onClose}>
              <X size={20} aria-hidden />
            </button>
          )}
        </header>
        <div className="overflow-y-auto px-6 py-4">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-paper-300 px-6 py-4 max-sm:[&>*]:flex-1">{footer}</footer>}
      </div>
    </div>
  );
}

/** Money input (Design §10.3): dot thousands as you type, integers only, “₫” suffix. */
export function MoneyInput({ label, value, onChange, autoFocus, id }: { label: string; value: number | null; onChange: (v: number | null) => void; autoFocus?: boolean; id?: string }) {
  const [text, setText] = useState(value === null ? '' : formatNumber(value));
  useEffect(() => setText(value === null ? '' : formatNumber(value)), [value]);
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[13px] font-medium text-ink-700">{label}</span>
      <span className="relative">
        <input
          id={id}
          inputMode="numeric"
          autoFocus={autoFocus}
          className="h-12 w-full rounded-md border border-paper-500 bg-white pr-8 pl-3 text-right text-lg num focus:border-navy-700"
          value={text}
          onChange={(e) => {
            const v = parseVnd(e.target.value);
            setText(v === null ? '' : formatNumber(v));
            onChange(v);
          }}
        />
        <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-ink-500">₫</span>
      </span>
    </label>
  );
}

/** Numeric keypad with 64 px keys (Design §13.4). */
export function Keypad({ onKey }: { onKey: (k: string) => void }) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '000', '0', 'del'];
  return (
    <div className="grid grid-cols-3 gap-2">
      {keys.map((k) => (
        <button key={k} type="button" className="h-13 rounded-xl border border-paper-300 bg-white text-lg font-semibold num hover:bg-navy-50" onClick={() => onKey(k)} aria-label={k === 'del' ? 'Xóa' : k}>
          {k === 'del' ? <Delete className="mx-auto" aria-hidden /> : k}
        </button>
      ))}
    </div>
  );
}

/** Six-dot PIN pad, light variant for approvals, navy for the lock screen (Design §13.5). */
export function PinPad({ value, onChange, dark, length = 6 }: { value: string; onChange: (v: string) => void; dark?: boolean; length?: number }) {
  const press = (k: string) => {
    if (k === 'del') onChange(value.slice(0, -1));
    else if (value.length < length) onChange(value + k);
  };
  return (
    <div className="flex flex-col items-center gap-5">
      <div className="flex gap-3" aria-label={`${value.length}/${length}`}>
        {Array.from({ length }, (_, i) => (
          <span key={i} className={clsx('size-3.5 rounded-full border-2', dark ? 'border-white' : 'border-navy-700', i < value.length && (dark ? 'bg-white' : 'bg-navy-700'))} />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map((k, i) =>
          k === '' ? (
            <span key={i} />
          ) : (
            <button
              key={k}
              type="button"
              aria-label={k === 'del' ? 'Xóa' : k}
              onClick={() => press(k)}
              className={clsx('flex size-[72px] items-center justify-center rounded-full text-[28px] num', dark ? 'bg-white/10 text-white hover:bg-white/20' : 'border border-paper-300 bg-white text-ink-900 hover:bg-navy-50')}
            >
              {k === 'del' ? <Delete aria-hidden /> : k}
            </button>
          ),
        )}
      </div>
    </div>
  );
}

/** Camera barcode scanner (FR-POS-10, Design §13.3) using BarcodeDetector where available. */
export function CameraScanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    const Detector = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
    if (!Detector) {
      setError('Trình duyệt này chưa hỗ trợ quét bằng camera. Hãy dùng máy quét hoặc nhập mã.');
      return;
    }
    const detector = new Detector({ formats: ['ean_13', 'code_128', 'qr_code'] });
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then(async (s) => {
        stream = s;
        if (!video.current) return;
        video.current.srcObject = s;
        await video.current.play();
        const tick = async () => {
          if (stopped || !video.current) return;
          const codes = await detector.detect(video.current).catch(() => []);
          if (codes[0]) return onCode(codes[0].rawValue);
          raf = requestAnimationFrame(() => void tick());
        };
        void tick();
      })
      .catch(() => setError('Không mở được camera. Hãy cho phép truy cập camera.'));
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, [onCode]);
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[rgba(20,32,51,0.85)] text-white" role="dialog" aria-modal="true" aria-label="Quét mã vạch">
      <button type="button" className="absolute top-4 right-4 inline-flex size-12 items-center justify-center rounded-full bg-white/10" aria-label={t('common.close')} onClick={onClose}>
        <X size={24} aria-hidden />
      </button>
      {error ? (
        <p className="max-w-sm px-6 text-center">{error}</p>
      ) : (
        <>
          <div className="relative h-[160px] w-[280px] overflow-hidden rounded-xl border-2 border-sand-300">
            <video ref={video} className="h-full w-full object-cover" muted playsInline />
          </div>
          <p className="mt-4">Đưa mã vạch vào khung</p>
        </>
      )}
    </div>
  );
}
