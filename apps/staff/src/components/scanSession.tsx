import { clsx } from 'clsx';
import { AlertTriangle, CheckCircle2, X, XCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createFrameReader } from './barcodeReader';
import { Button } from './ui';

/** What one scan did, shown over the camera. */
export interface ScanOutcome {
  tone: 'success' | 'warning' | 'danger';
  title: string;
  lines?: string[];
  /** More on the card under the lines, such as a quantity to correct (stock count). */
  extra?: ReactNode;
}

/** A short beep and vibration when a code is read, where the device allows it. */
function signal() {
  try {
    navigator.vibrate?.(80);
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 1200;
    gain.gain.value = 0.08;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
    osc.onended = () => void ctx.close();
  } catch {
    // No sound or vibration: the result card still shows.
  }
}

/**
 * Continuous camera scanning (Design §13.8): the camera stays open; each code read pauses reading,
 * runs `onScan` and shows its result; “Tiếp tục” reads the next code at once, ignoring the code just
 * read until a different code is seen or it leaves the frame; “Xong” closes the session.
 */
export function ScanSession({
  onScan,
  progress,
  onClose,
  label = 'Quét mã sách',
  prompt = 'Đưa mã cá biệt hoặc ISBN vào khung',
}: {
  onScan: (code: string) => Promise<ScanOutcome>;
  progress?: string;
  onClose: () => void;
  /** Dialog name for screen readers. */
  label?: string;
  /** Hint under the camera while waiting for a code. */
  prompt?: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ScanOutcome | null>(null);
  const paused = useRef(false);
  const last = useRef<string | null>(null);
  const ignoreLast = useRef(false);
  const scanRef = useRef(onScan);
  scanRef.current = onScan;

  const handle = useCallback(async (code: string) => {
    paused.current = true;
    last.current = code;
    signal();
    setBusy(true);
    try {
      setResult(await scanRef.current(code));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    // Built-in reader on Android Chrome, the bundled decoder on iPhone (Design §13.3).
    Promise.all([createFrameReader(), navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })])
      .then(async ([reader, s]) => {
        stream = s;
        // A run already cleaned up (React re-mounting the screen) must not report an error.
        if (stopped || !video.current) return void s.getTracks().forEach((tr) => tr.stop());
        video.current.srcObject = s;
        try {
          await video.current.play();
        } catch (e) {
          if (stopped) return;
          throw e;
        }
        const tick = async () => {
          if (stopped || !video.current) return;
          if (!paused.current) {
            const code = await reader.read(video.current);
            // The copy just counted is skipped until another code is seen or it leaves the frame.
            if (ignoreLast.current && code !== last.current) ignoreLast.current = false;
            if (code && !ignoreLast.current && !paused.current) void handle(code);
          }
          timer = reader.intervalMs ? window.setTimeout(() => void tick(), reader.intervalMs) : requestAnimationFrame(() => void tick());
        };
        void tick();
      })
      .catch((e: unknown) => {
        if (stopped) return;
        setError(e instanceof DOMException && e.name === 'NotAllowedError' ? 'Không mở được camera. Hãy cho phép truy cập camera.' : 'Không mở được camera hoặc bộ đọc mã. Hãy thử lại, hoặc dùng máy quét / nhập mã.');
      });
    return () => {
      stopped = true;
      clearTimeout(timer);
      cancelAnimationFrame(timer);
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, [handle]);

  const next = () => {
    setResult(null);
    ignoreLast.current = true;
    paused.current = false;
  };

  const Icon = result?.tone === 'success' ? CheckCircle2 : result?.tone === 'warning' ? AlertTriangle : XCircle;
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[rgba(20,32,51,0.92)] text-white" role="dialog" aria-modal="true" aria-label={label}>
      <div className="flex items-center justify-between px-4 pt-4">
        <span className="text-sm text-white/80 num">{progress}</span>
        <button type="button" className="inline-flex size-12 items-center justify-center rounded-full bg-white/10" aria-label="Đóng" onClick={onClose}>
          <X size={24} aria-hidden />
        </button>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6">
        {error ? (
          <p className="max-w-sm text-center">{error}</p>
        ) : (
          <>
            <div className="relative h-[180px] w-full max-w-[320px] overflow-hidden rounded-xl border-2 border-sand-300">
              <video ref={video} className={clsx('h-full w-full object-cover', result && 'opacity-40')} muted playsInline />
            </div>
            {!result && <p>{busy ? 'Đang ghi nhận…' : prompt}</p>}
          </>
        )}
        {result && (
          <div
            role="status"
            className={clsx(
              'w-full max-w-sm rounded-lg bg-white p-4 text-ink-900',
              result.tone === 'success' ? 'border-l-4 border-success-700' : result.tone === 'warning' ? 'border-l-4 border-warning-700' : 'border-l-4 border-danger-700',
            )}
          >
            <p className={clsx('flex items-center gap-2 font-semibold', result.tone === 'success' ? 'text-success-700' : result.tone === 'warning' ? 'text-warning-700' : 'text-danger-700')}>
              <Icon size={20} aria-hidden /> {result.title}
            </p>
            {result.lines?.map((l) => (
              <p key={l} className="mt-1 text-sm text-ink-700">
                {l}
              </p>
            ))}
            {result.extra}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2 px-4 pb-6">
        {result && (
          <Button variant="primary" size="lg" full onClick={next} autoFocus>
            Tiếp tục
          </Button>
        )}
        <Button variant="secondary" size="lg" full onClick={onClose}>
          Xong
        </Button>
      </div>
    </div>
  );
}
