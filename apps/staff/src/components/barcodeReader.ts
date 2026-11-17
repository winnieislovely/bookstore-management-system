// The decoder's WebAssembly file ships with the app (hashed under /assets/, cached by the service
// worker) – never fetched from a CDN (Design §13.3).
import zxingWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

/**
 * Camera barcode reading on every phone (FR-POS-10, Design §13.3): the browser's own BarcodeDetector
 * where it exists (Chrome on Android), otherwise a bundled decoder (zxing-wasm) – Safari and every
 * other browser on iPhone. Reads ISBN (EAN-13), the label codes (Code 128 / 39) and QR.
 */

type NativeDetector = { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
type NativeDetectorClass = new (o: { formats: string[] }) => NativeDetector;

const nativeClass = () => (window as unknown as { BarcodeDetector?: NativeDetectorClass }).BarcodeDetector;

/** Whether the browser reads barcodes itself (no decoder to load). */
export const hasNativeReader = () => typeof window !== 'undefined' && !!nativeClass();

type Zxing = typeof import('zxing-wasm/reader');
let zxing: Promise<Zxing> | null = null;

/** Loads the decoder once: its JavaScript and its WebAssembly, both from this app's own files. */
function loadZxing(): Promise<Zxing> {
  zxing ??= import('zxing-wasm/reader')
    .then(async (m) => {
      await m.prepareZXingModule({
        overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? zxingWasmUrl : prefix + path) },
        fireImmediately: true,
      });
      return m;
    })
    .catch((e: unknown) => {
      zxing = null; // try again next time (e.g. offline before it was ever cached)
      throw e;
    });
  return zxing;
}

/**
 * Phones without a built-in reader fetch the decoder in the background after the app starts, so the
 * service worker has it and the camera also works offline.
 */
export function warmBarcodeReader() {
  if (hasNativeReader()) return;
  setTimeout(() => void loadZxing().catch(() => undefined), 3000);
}

export interface FrameReader {
  /** The first code in the current video frame, or null. */
  read: (video: HTMLVideoElement) => Promise<string | null>;
  /** Milliseconds to wait between reads (the bundled decoder runs at about 8 frames a second). */
  intervalMs: number;
}

/** A reader for camera frames: built-in where available, the bundled decoder otherwise. */
export async function createFrameReader(): Promise<FrameReader> {
  const Native = nativeClass();
  if (Native) {
    const d = new Native({ formats: ['ean_13', 'code_128', 'code_39', 'qr_code'] });
    return { intervalMs: 0, read: async (v) => (await d.detect(v).catch(() => []))[0]?.rawValue ?? null };
  }
  const m = await loadZxing();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas');
  return {
    intervalMs: 120,
    read: async (v) => {
      const w = v.videoWidth;
      const h = v.videoHeight;
      if (!w || !h) return null;
      // At most 960 px wide: enough for a spine label, light enough for an older iPhone.
      const scale = Math.min(1, 960 / w);
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      const results = await m
        .readBarcodes(ctx.getImageData(0, 0, canvas.width, canvas.height), { formats: ['EAN13', 'Code128', 'Code39', 'QRCode'], tryHarder: true, maxNumberOfSymbols: 1 })
        .catch(() => []);
      return results.find((r) => r.isValid)?.text || null;
    },
  };
}
