import { describe, expect, it } from 'vitest';
import { barcodeSvg, CODE128, code128Modules, code128Values, ean13Modules, isEan13 } from './barcode.js';

describe('Code 128 table', () => {
  it('every symbol is 11 modules wide (stop 13) and all patterns are distinct', () => {
    CODE128.forEach((p, i) => {
      const width = [...p].reduce((a, d) => a + Number(d), 0);
      expect(width, `symbol ${i}`).toBe(i === 106 ? 13 : 11);
    });
    expect(new Set(CODE128).size).toBe(107);
  });

  it('switches to set C for a trailing run of four or more digits', () => {
    // EN-000001: start B, E N -, Code C, 00 00 01.
    expect(code128Values('EN-000001')).toEqual([104, 37, 46, 13, 99, 0, 0, 1]);
    // An odd run keeps its first digit in set B.
    expect(code128Values('A12345')).toEqual([104, 33, 17, 99, 23, 45]);
    // Short runs stay in set B (old copy codes like VN-0123-2).
    expect(code128Values('VN-0123-2')).toEqual([104, 54, 46, 13, 16, 17, 18, 19, 13, 18]);
    // 8 symbols + check + stop; check = (104 + 37 + 46·2 + 13·3 + 99·4 + 0·5 + 0·6 + 1·7) mod 103 = 57.
    const m = code128Modules('EN-000001');
    expect(m.length).toBe(9 * 11 + 13);
    const bars = (v: number) => [...CODE128[v]!].map((w, i) => (i % 2 ? '0' : '1').repeat(Number(w))).join('');
    expect(m.slice(-24, -13)).toBe(bars(57));
  });

  it('encodes start B, data, mod-103 check and stop', () => {
    // "VPP-012": 7 data symbols (a 3-digit run stays in set B) + start + check + stop = 9 × 11 + 13 modules.
    const m = code128Modules('VPP-012');
    expect(m.length).toBe(9 * 11 + 13);
    expect(m.startsWith('11010010000')).toBe(true); // start B = 211214
    expect(m.endsWith('1100011101011')).toBe(true); // stop = 2331112
  });
});

describe('EAN-13', () => {
  it('validates and encodes 95 modules with guard bars', () => {
    expect(isEan13('9786041234567')).toBe(true);
    expect(isEan13('9786041234568')).toBe(false);
    const m = ean13Modules('9780306406157');
    expect(m).toHaveLength(95);
    expect(m.slice(0, 3)).toBe('101');
    expect(m.slice(45, 50)).toBe('01010');
    expect(m.slice(-3)).toBe('101');
    // Known first-half encoding for leading 9 (parity LGGLGL): digit 7 in L = 0111011.
    expect(m.slice(3, 10)).toBe('0111011');
  });

  it('renders SVG with the code underneath, falling back to Code 128', () => {
    expect(barcodeSvg('9780306406157')).toContain('>9780306406157</text>');
    expect(barcodeSvg('SACH-NNA-0012')).toContain('<rect');
    expect(barcodeSvg('A&B')).toContain('A&amp;B');
  });
});
