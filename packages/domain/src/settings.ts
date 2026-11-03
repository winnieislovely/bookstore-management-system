import { z } from 'zod';

/**
 * Settings registry (TDD Appendix A, FR-ADM-04). Every business parameter has a Zod schema and a
 * default and lives in the `setting` table, never in code. Secrets are write-only and masked.
 */
const int = (min = 0, max = Number.MAX_SAFE_INTEGER) => z.number().int().min(min).max(max);

export const SETTINGS = {
  // Store profile (FR-ADM-04, printed headers Design §16.1)
  'store.name': { schema: z.string().min(1), default: 'The Bookshelf Hanoi' },
  'store.address': { schema: z.string(), default: '' },
  'store.tax_code': { schema: z.string(), default: '' },
  'store.phone': { schema: z.string(), default: '' },
  'store.logo_file_id': { schema: z.string().nullable(), default: null },

  // POS and sales
  'sale.return_window_days': { schema: int(0, 365), default: 7 },
  'sale.cashier_discount_max_bp': { schema: int(0, 10000), default: 1000 },
  'shift.variance_alert_vnd': { schema: int(0), default: 50000 },
  'pos.einvoice_mode': { schema: z.enum(['every_sale', 'on_request']), default: 'every_sale' },
  'pos.print_sales_slip': { schema: z.boolean(), default: false },
  'pos.sales_slip_footer': {
    schema: z.string(),
    default: 'Đây không phải hóa đơn GTGT.\nĐổi trả trong 7 ngày.\nCảm ơn bạn đã ghé tiệm sách!',
  },
  'pos.offline_lease_hours': { schema: int(1, 720), default: 72 },
  'pos.lock_minutes': { schema: int(1, 240), default: 5 },
  'session.idle_hours': { schema: int(1, 336), default: 12 },

  // Inventory and purchasing
  'inventory.allow_negative_pos': { schema: z.boolean(), default: false },
  'inventory.adjust_approval_vnd': { schema: int(0), default: 1000000 },
  'catalog.duplicate_mode': { schema: z.enum(['block', 'warn']), default: 'block' },
  'purchasing.min_margin_bp': { schema: int(0, 10000), default: 0 },
  'purchasing.consignment_alert_days': { schema: int(1, 90), default: 7 },

  // Loyalty and tiers
  'loyalty.earn_vnd_per_point': { schema: int(1), default: 10000 },
  'loyalty.point_value_vnd': { schema: int(1), default: 100 },
  'loyalty.min_redeem_points': { schema: int(0), default: 50 },
  'loyalty.expiry_months': { schema: int(1, 120), default: 12 },
  'loyalty.tier_silver_vnd': { schema: int(0), default: 3000000 },
  'loyalty.tier_gold_vnd': { schema: int(0), default: 10000000 },

  // Orders, events, pre-orders, library (later releases; defaults registered now)
  'order.transfer_timeout_h': { schema: int(1, 720), default: 24 },
  /** Review flags (BR-30): 0 turns the flag off. */
  'order.review_high_value_vnd': { schema: int(0), default: 2000000 },
  'order.review_failed_deliveries': { schema: int(0, 100), default: 2 },
  'event.hold_minutes': { schema: int(1, 1440), default: 60 },
  'event.waitlist_pay_hours': { schema: int(1, 168), default: 12 },
  'event.refund_cutoff_h': { schema: int(0, 720), default: 48 },
  'preorder.deposit_pct': { schema: int(0, 100), default: 30 },
  'preorder.hold_days': { schema: int(1, 90), default: 7 },
  // Library (BR-13, FR-LIB-06): a renewal adds another loan period and another loan fee.
  'library.loan_fee_vnd': { schema: int(0), default: 50000 },
  'library.loan_days': { schema: int(1, 365), default: 30 },
  'library.renewals': { schema: int(0, 20), default: 2 },
  'library.max_loans': { schema: int(1, 100), default: 3 },
  'library.fine_per_day_vnd': { schema: int(0), default: 2000 },
  'library.grace_days': { schema: int(0, 30), default: 0 },
  'library.lost_fee_vnd': { schema: int(0), default: 20000 },
  'library.remind_days': { schema: int(0, 30), default: 3 },
  'library.hold_days': { schema: int(1, 30), default: 3 },
  /** Loan-fee discount for buyers (FR-LIB-18); 0 % turns it off. */
  'library.fee_discount_spend_vnd': { schema: int(0), default: 5000000 },
  'library.fee_discount_pct': { schema: int(0, 100), default: 10 },
  /** VAT rate on library fees and charges (VAT-inclusive, BR-02). */
  'library.vat_bp': { schema: z.union([z.literal(0), z.literal(500), z.literal(800), z.literal(1000)]), default: 0 },
  /** No deposit (FR-LIB-09); the deposit ledger is built if the policy changes. */
  'library.deposit_vnd': { schema: int(0), default: 0 },
  'hr.ot_multiplier_weekday_bp': { schema: int(10000, 100000), default: 15000 },
  'hr.ot_multiplier_rest_bp': { schema: int(10000, 100000), default: 20000 },
  'hr.ot_multiplier_holiday_bp': { schema: int(10000, 100000), default: 30000 },

  // Website
  'web.stock_display': { schema: z.enum(['exact', 'few_left', 'in_out', 'hidden']), default: 'exact' },
  'web.stock_low_threshold': { schema: int(1, 1000), default: 5 },
  'web.bestseller_refresh_minutes': { schema: int(5, 1440), default: 60 },
  /** Product page on the website, with {slug}; used by the share card (FR-SOC-04). */
  'web.product_url': { schema: z.string().max(300), default: '' },

  // Integrations (secrets: write-only, masked, encrypted at rest – NFR-SEC-04)
  'einvoice.misa_username': { schema: z.string(), default: '', secret: true },
  'einvoice.misa_password': { schema: z.string(), default: '', secret: true },
  'einvoice.misa_tax_code': { schema: z.string(), default: '' },

  // Retention
  'retention.financial_years': { schema: int(10, 50), default: 10 },
} as const satisfies Record<string, { schema: z.ZodType; default: unknown; secret?: boolean }>;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]['schema']>;
export type SettingsSnapshot = { [K in SettingKey]: SettingValue<K> };

export function isSecretSetting(key: SettingKey): boolean {
  const def = SETTINGS[key] as { secret?: boolean };
  return def.secret === true;
}

export function defaultSettings(): SettingsSnapshot {
  const out: Record<string, unknown> = {};
  for (const [k, def] of Object.entries(SETTINGS)) out[k] = def.default;
  return out as SettingsSnapshot;
}

export function parseSetting<K extends SettingKey>(key: K, value: unknown): SettingValue<K> {
  return SETTINGS[key].schema.parse(value) as SettingValue<K>;
}

/** Mask a secret after entry: `••••••••3f9a` (Design §10.3). */
export function maskSecret(value: string): string {
  if (value === '') return '';
  return `••••••••${value.slice(-4)}`;
}
