import { startTestDb, type TestDb } from '@bookstore/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** Database-level integrity rules (TDD §5.4, §13.2). Uses raw SQL to bypass any service logic. */
let t: TestDb;

beforeAll(async () => {
  t = await startTestDb();
}, 180_000);

afterAll(async () => {
  await t?.stop();
});

async function seedVariant(sku: string) {
  const [item] = await t.sql`
    insert into catalog.item (kind, i18n, slug) values ('book', ${JSON.stringify({ en: { title: sku } })}::jsonb, ${sku.toLowerCase()})
    returning id`;
  const [v] = await t.sql`
    insert into catalog.item_variant (item_id, sku, weight_g, price_vnd) values (${item!.id}, ${sku}, 300, 98000)
    returning id`;
  return v!.id as string;
}

async function seedShift() {
  const [role] = await t.sql`insert into platform.role (code, name) values (${'r' + Math.random()}, 'R') returning id`;
  const [user] = await t.sql`
    insert into platform.app_user (username, display_name, password_hash, role_id)
    values (${'u' + Math.random()}, 'Lan', 'x', ${role!.id}) returning id`;
  const [reg] = await t.sql`insert into sales.register (code, name) values (${'Q' + Math.random()}, 'Quầy') returning id`;
  const [shift] = await t.sql`
    insert into sales.shift (shift_no, register_id, opened_by, float_vnd)
    values (${Math.floor(Math.random() * 1e9)}, ${reg!.id}, ${user!.id}, 1000000) returning id`;
  return { userId: user!.id as string, registerId: reg!.id as string, shiftId: shift!.id as string };
}

describe('catalogue constraints', () => {
  it('rejects a duplicate SKU and a zero weight (FR-CAT-04/05)', async () => {
    await seedVariant('SACH-0001');
    await expect(seedVariant('SACH-0001')).rejects.toThrow(/unique/i);
    const [item] = await t.sql`insert into catalog.item (kind, i18n, slug) values ('book', '{"en":{"title":"x"}}', 'x-w') returning id`;
    await expect(
      t.sql`insert into catalog.item_variant (item_id, sku, weight_g, price_vnd) values (${item!.id}, 'W-0', 0, 1000)`,
    ).rejects.toThrow(/item_variant_weight_ck/);
  });
});

describe('immutable stock ledger (FR-INV-02)', () => {
  it('forbids UPDATE and DELETE on stock movements', async () => {
    const v = await seedVariant('SACH-LEDGER');
    const [m] = await t.sql`
      insert into inventory.stock_movement (variant_id, type, qty_delta, ref_type, ref_id)
      values (${v}, 'stock_in', 5, 'stock_in', uuidv7()) returning id`;
    await expect(t.sql`update inventory.stock_movement set qty_delta = 6 where id = ${m!.id}`).rejects.toThrow(/append-only/);
    await expect(t.sql`delete from inventory.stock_movement where id = ${m!.id}`).rejects.toThrow(/append-only/);
  });
});

describe('shifts (FR-POS-18/19, BR-06)', () => {
  it('allows only one open shift per register', async () => {
    const s = await seedShift();
    await expect(
      t.sql`insert into sales.shift (shift_no, register_id, opened_by, float_vnd) values (${Math.floor(Math.random() * 1e9)}, ${s.registerId}, ${s.userId}, 0)`,
    ).rejects.toThrow(/shift_one_open_per_register_uq/);
  });

  it('rejects closing with a non-zero variance and no reason; accepts it with a reason', async () => {
    const s = await seedShift();
    await expect(
      t.sql`update sales.shift set closed_at = now(), counted_vnd = 920000, expected_vnd = 1000000, variance_vnd = -80000 where id = ${s.shiftId}`,
    ).rejects.toThrow(/shift_variance_reason_ck/);
    await t.sql`update sales.shift set closed_at = now(), counted_vnd = 920000, expected_vnd = 1000000, variance_vnd = -80000, variance_reason = 'Thối nhầm' where id = ${s.shiftId}`;
  });
});

describe('sale payments must equal the total at commit (TDD §5.4)', () => {
  async function insertSale(s: { shiftId: string; userId: string }, total: number, isDeposit: boolean, payments: number[]) {
    await t.sql.begin(async (tx) => {
      const [sale] = await tx`
        insert into sales.sale (doc_no, shift_id, cashier_id, subtotal_vnd, discount_vnd, total_vnd, vat_vnd, is_deposit)
        values (${'HD-' + Math.random()}, ${s.shiftId}, ${s.userId}, ${total}, 0, ${total}, 0, ${isDeposit}) returning id`;
      for (const p of payments) {
        await tx`insert into sales.sale_payment (sale_id, method, amount_vnd) values (${sale!.id}, 'cash', ${p})`;
      }
    });
  }

  it('accepts split payments that add up', async () => {
    const s = await seedShift();
    await insertSale(s, 106000, false, [56000, 50000]);
  });

  it('rejects an under-paid sale', async () => {
    const s = await seedShift();
    await expect(insertSale(s, 106000, false, [100000])).rejects.toThrow(/do not match sale total/);
  });

  it('allows part-payment on a deposit sale but not over-payment', async () => {
    const s = await seedShift();
    await insertSale(s, 300000, true, [90000]);
    await expect(insertSale(s, 300000, true, [400000])).rejects.toThrow(/do not match sale total/);
  });
});

describe('points ledger (FR-CRM-06)', () => {
  it('is append-only and the balance cannot go negative', async () => {
    const [c] = await t.sql`insert into crm.customer (name, phone_e164) values ('Trần Thị B', '+84912345678') returning id`;
    const [row] = await t.sql`insert into crm.points_ledger (customer_id, delta, reason) values (${c!.id}, 10, 'earn') returning id`;
    await expect(t.sql`delete from crm.points_ledger where id = ${row!.id}`).rejects.toThrow(/append-only/);
    await expect(t.sql`update crm.customer set points_balance = -1 where id = ${c!.id}`).rejects.toThrow(/customer_points_ck/);
    await expect(t.sql`insert into crm.customer (name, phone_e164) values ('Dup', '+84912345678')`).rejects.toThrow(/customer_phone_uq/);
  });
});
