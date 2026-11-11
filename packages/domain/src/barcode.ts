import { makeEan13 } from './isbn.js';

/**
 * Barcode rendering for labels (FR-CAT-13, Design §16.4): EAN-13 for valid 13-digit codes (ISBN,
 * internal `20…`), otherwise Code 128 (set B). Pure functions returning module patterns and SVG;
 * pure black on white with quiet zones and human-readable digits underneath.
 */

const EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const EAN_R = EAN_L.map((p) => [...p].map((b) => (b === '0' ? '1' : '0')).join(''));
const EAN_G = EAN_R.map((p) => [...p].reverse().join(''));
const EAN_PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

export function isEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && makeEan13(code.slice(0, 12)) === code;
}

/** 95 modules: `1` = bar, `0` = space. */
export function ean13Modules(code: string): string {
  if (!isEan13(code)) throw new RangeError('Not a valid EAN-13');
  const d = [...code].map(Number);
  const parity = EAN_PARITY[d[0]!]!;
  let out = '101';
  for (let i = 1; i <= 6; i++) out += (parity[i - 1] === 'L' ? EAN_L : EAN_G)[d[i]!]!;
  out += '01010';
  for (let i = 7; i <= 12; i++) out += EAN_R[d[i]!]!;
  return out + '101';
}

/** Code 128 symbol widths (bar, space, bar, space, bar, space); 106 is the stop symbol. */
export const CODE128 = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
] as const;

const START_B = 104;
const CODE_C = 99;
const STOP = 106;

/**
 * Symbol values: start B and set B (printable ASCII 32–126), switching to set C for a trailing run
 * of at least four digits (two digits per symbol), so codes like `EN-000125` fit a 30 mm spine
 * label at 0.2 mm modules (Design §16.5).
 */
export function code128Values(text: string): number[] {
  if (!/^[\x20-\x7e]+$/.test(text)) throw new RangeError('Code 128 set B covers printable ASCII only');
  const run = /\d+$/.exec(text)?.[0] ?? '';
  // An odd run keeps its first digit in set B so set C takes whole pairs.
  const cLen = run.length >= 4 ? run.length - (run.length % 2) : 0;
  const head = text.slice(0, text.length - cLen);
  const tail = text.slice(text.length - cLen);
  const values = [START_B, ...[...head].map((ch) => ch.charCodeAt(0) - 32)];
  if (cLen) {
    values.push(CODE_C);
    for (let i = 0; i < tail.length; i += 2) values.push(Number(tail.slice(i, i + 2)));
  }
  return values;
}

/** Code 128 modules with the mod-103 check symbol. */
export function code128Modules(text: string): string {
  const values = code128Values(text);
  const check = values.reduce((sum, v, i) => sum + v * (i === 0 ? 1 : i), 0) % 103;
  let out = '';
  for (const v of [...values, check, STOP]) {
    const widths = CODE128[v]!;
    for (let i = 0; i < widths.length; i++) out += (i % 2 === 0 ? '1' : '0').repeat(Number(widths[i]));
  }
  return out;
}

export interface BarcodeSvgOptions {
  /** Width of one module in mm. */
  moduleMm?: number;
  heightMm?: number;
  /** Quiet zone each side in modules (≥ 2.5 mm per Design §16.4). */
  quietModules?: number;
  showText?: boolean;
}

/** SVG barcode sized in mm, black on white, with the code underneath. */
export function barcodeSvg(code: string, opts: BarcodeSvgOptions = {}): string {
  const modules = isEan13(code) ? ean13Modules(code) : code128Modules(code);
  const m = opts.moduleMm ?? 0.25;
  const h = opts.heightMm ?? 10;
  const quiet = opts.quietModules ?? Math.ceil(2.5 / m);
  const text = opts.showText ?? true;
  const width = (modules.length + quiet * 2) * m;
  const textH = text ? 2.6 : 0;
  let rects = '';
  let x = 0;
  while (x < modules.length) {
    if (modules[x] === '1') {
      let w = 1;
      while (modules[x + w] === '1') w++;
      rects += `<rect x="${((quiet + x) * m).toFixed(3)}" y="0" width="${(w * m).toFixed(3)}" height="${h}"/>`;
      x += w;
    } else x++;
  }
  const label = text
    ? `<text x="${(width / 2).toFixed(2)}" y="${(h + 2.2).toFixed(2)}" font-size="2.2" text-anchor="middle" font-family="Be Vietnam Pro, Arial, sans-serif" style="font-variant-numeric:tabular-nums">${escapeXml(code)}</text>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width.toFixed(2)}mm" height="${(h + textH).toFixed(2)}mm" viewBox="0 0 ${width.toFixed(3)} ${(h + textH).toFixed(3)}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${rects}</g>${label}</svg>`;
}

export function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
}
