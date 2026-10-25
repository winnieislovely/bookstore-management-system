import { describe, expect, it } from 'vitest';
import { internalBarcode, normalizeIsbn } from './isbn.js';
import { foldText, groupCode, slugify } from './text.js';
import { formatPhone, normalizePhone } from './phone.js';
import { checkShiftClose, countDenominations, expectedCash } from './shift.js';
import { isMarginTooLow, movingAverageCost } from './inventory.js';
import { vnd } from './money.js';
import { paymentRefFromBytes, PAYMENT_REF_LENGTH, transferNoteMatches } from './payment-ref.js';
import { canTransition, WEB_ORDER } from './state-machines.js';
import { ALL_PERMISSIONS, DEFAULT_ROLES } from './permissions.js';
import { defaultSettings, maskSecret, parseSetting } from './settings.js';
import { defaultTiers, pointsToReverse, tierForSpend } from './loyalty.js';

describe('ISBN', () => {
  it('validates ISBN-13 and converts ISBN-10', () => {
    expect(normalizeIsbn('978-604-1-23456-7')).toBe('9786041234567'); // Design §14.3 sample
    expect(normalizeIsbn('9780306406157')).toBe('9780306406157');
    expect(normalizeIsbn('0-306-40615-2')).toBe('9780306406157');
    expect(normalizeIsbn('080442957X')).toBe('9780804429573');
    expect(normalizeIsbn('9780306406158')).toBeNull();
    expect(internalBarcode(1)).toBe("2000000000015");
  });
});

describe('text', () => {
  it('folds Vietnamese diacritics (SRS §2.5)', () => {
    expect(foldText('Nguyễn Nhật Ánh')).toBe('nguyen nhat anh');
    expect(foldText('Đường')).toBe('duong');
  });
  it('slugifies and groups codes', () => {
    expect(slugify('Cho tôi xin một vé đi tuổi thơ!')).toBe('cho-toi-xin-mot-ve-di-tuoi-tho');
    expect(groupCode('GHN5FT8KQ2L9X')).toBe('GHN5 FT8K Q2L9 X');
  });
});

describe('phone', () => {
  it('normalises Vietnamese numbers to E.164', () => {
    expect(normalizePhone('0912 345 678')).toBe('+84912345678');
    expect(normalizePhone('84912345678')).toBe('+84912345678');
    expect(normalizePhone('+84 912 345 678')).toBe('+84912345678');
    expect(normalizePhone('12')).toBeNull();
    expect(formatPhone('+84912345678')).toBe('0912 345 678');
  });
});

describe('shift close (BR-06)', () => {
  const expected = expectedCash({
    floatVnd: vnd(1_000_000),
    cashSalesVnd: vnd(2_500_000),
    cashRefundsVnd: vnd(100_000),
    cashInVnd: vnd(0),
    cashOutVnd: vnd(200_000),
  });
  it('computes expected cash', () => expect(expected).toBe(3_200_000));
  it('requires a reason for non-zero variance but never blocks otherwise', () => {
    expect(checkShiftClose(expected, vnd(3_120_000), '', 50_000)).toEqual({
      ok: false,
      code: 'variance_reason_required',
      varianceVnd: -80_000,
    });
    expect(checkShiftClose(expected, vnd(3_120_000), 'Thối nhầm', 50_000)).toEqual({ ok: true, varianceVnd: -80_000, alert: true });
    expect(checkShiftClose(expected, vnd(3_200_000), null, 50_000)).toEqual({ ok: true, varianceVnd: 0, alert: false });
    expect(checkShiftClose(expected, vnd(3_240_000), 'Dư', 50_000)).toMatchObject({ ok: true, alert: false });
  });
  it('counts denominations', () => {
    expect(countDenominations({ 500000: 2, 1000: 3 })).toBe(1_003_000);
  });
});

describe('inventory', () => {
  it('moving-average cost (FR-INV-08)', () => {
    expect(movingAverageCost(10, vnd(50000), 5, vnd(56000))).toBe(52000);
    expect(movingAverageCost(0, vnd(50000), 5, vnd(56000))).toBe(56000);
    expect(movingAverageCost(3, vnd(10001), 1, vnd(10000))).toBe(10001); // 10000.75 → 10001
  });
  it('margin flag (FR-PUR-05)', () => {
    expect(isMarginTooLow(vnd(100000), vnd(100000), 0)).toBe(true);
    expect(isMarginTooLow(vnd(100000), vnd(80000), 2500)).toBe(true);
    expect(isMarginTooLow(vnd(100000), vnd(70000), 2500)).toBe(false);
  });
});

describe('payment reference (TDD §8.4, printed QR)', () => {
  it('builds an unambiguous 8-character code', () => {
    const ref = paymentRefFromBytes(new Uint8Array([0, 1, 2, 3, 30, 31, 200, 255]));
    expect(ref).toHaveLength(PAYMENT_REF_LENGTH);
    expect(ref).toMatch(/^[2-9A-HJKMNP-Z]{8}$/);
  });
  it('matches the reference inside a typed transfer note', () => {
    expect(transferNoteMatches('Thanh toan don k7m2 x9pq', 'K7M2X9PQ')).toBe(true);
    expect(transferNoteMatches('Thanh toan don', 'K7M2X9PQ')).toBe(false);
  });
});

describe('state machines', () => {
  it('follows SRS B.1', () => {
    expect(canTransition(WEB_ORDER, 'new', 'confirmed')).toBe(true);
    expect(canTransition(WEB_ORDER, 'packing', 'cancelled')).toBe(false);
  });
});

describe('permissions (SRS Appendix A)', () => {
  it('owner has everything, manager lacks payroll and owner-only settings', () => {
    expect(DEFAULT_ROLES.owner.permissions).toEqual(ALL_PERMISSIONS);
    expect(DEFAULT_ROLES.manager.permissions).not.toContain('hr.payroll');
    expect(DEFAULT_ROLES.manager.permissions).not.toContain('settings.manage');
    expect(DEFAULT_ROLES.manager.permissions).toContain('sale.void_paid');
    expect(DEFAULT_ROLES.manager.permissions).toContain('user.unlock');
    expect(DEFAULT_ROLES.manager.permissions).not.toContain('user.manage');
  });
  it('website editor cannot touch prices, stock or settings (BR-23)', () => {
    const p = DEFAULT_ROLES.website_editor.permissions;
    expect(p).not.toContain('catalog.edit');
    expect(p).not.toContain('inventory.adjust');
    expect(p).toContain('web.content.publish');
  });
});

describe('settings registry', () => {
  it('has the TDD Appendix A defaults', () => {
    const s = defaultSettings();
    expect(s['sale.return_window_days']).toBe(7);
    expect(s['shift.variance_alert_vnd']).toBe(50000);
    expect(s['pos.einvoice_mode']).toBe('every_sale');
    expect(s['pos.print_sales_slip']).toBe(false);
  });
  it('validates values and masks secrets', () => {
    expect(() => parseSetting('sale.cashier_discount_max_bp', 20000)).toThrow();
    expect(maskSecret('abcdef3f9a')).toBe('••••••••3f9a');
  });
});

describe('loyalty', () => {
  const tiers = defaultTiers(3_000_000, 10_000_000);
  it('picks tiers by rolling spend (BR-08)', () => {
    expect(tierForSpend(0, tiers).code).toBe('standard');
    expect(tierForSpend(3_000_000, tiers).code).toBe('silver');
    expect(tierForSpend(12_000_000, tiers).code).toBe('gold');
  });
  it('reverses points proportionally (BR-19)', () => {
    expect(pointsToReverse(10, 100_000, 50_000)).toBe(5);
    expect(pointsToReverse(10, 100_000, 100_000)).toBe(10);
    expect(pointsToReverse(10, 100_000, 0)).toBe(0);
  });
});
