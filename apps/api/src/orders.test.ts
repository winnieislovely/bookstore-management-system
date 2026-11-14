import { schema } from '@bookstore/db';
import * as jobs from '@bookstore/modules/jobs';
import * as orders from '@bookstore/modules/orders';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OWNER_PW, startHarness, WEBHOOK_SECRET, type Harness } from './testing.js';

/** Online and social orders worked by staff (FR-ORD-01..13, FR-SOC-01/03, BR-29, BR-30, UC-09). */
let h: Harness;
let owner: string;
let online: string;
let cashier: string;
let book: string;
let pen: string;

const HN = 201;
const ward = (code: string) => ({ provinceId: HN, wardCode: code, line: '12 Phố Huế' });

async function level(variantId: string) {
  const [r] = await h.t.sql`select on_hand, reserved from inventory.stock_level where variant_id = ${variantId}`;
  return { onHand: r!.on_hand, reserved: r!.reserved };
}

async function create(body: Record<string, unknown>, cookie = online) {
  const r = await h.call('POST', '/api/v1/orders', {
    cookie,
    body: { source: 'website', recipient: { name: 'Nguyễn Văn An', phone: '0912345678' }, delivery: 'ship', address: ward('1A0101'), paymentMethod: 'cod', lines: [{ variantId: book, qty: 1 }], ...body },
  });
  return r;
}

beforeAll(async () => {
  h = await startHarness();
  let roles: Record<string, string>;
  ({ owner, roles } = await h.setupOwner());
  online = await h.staff(owner, 'online', roles.online_staff!);
  cashier = await h.staff(owner, 'thu', roles.cashier!);

  const cat = (await h.call('POST', '/api/v1/catalog/categories', { cookie: owner, body: { i18n: { en: { name: 'Books' } } } })).body.id;
  const supplier = (await h.call('POST', '/api/v1/purchasing/suppliers', { cookie: owner, body: { name: 'Fahasa', phone: '0900000000' } })).body.id;
  const mk = async (sku: string, title: string, price: number, qty: number) => {
    const r = await h.call('POST', '/api/v1/purchasing/stock-in/new-product', {
      cookie: owner,
      body: {
        supplierId: supplier,
        line: {
          item: { kind: 'book', i18n: { en: { title, description: title } }, categoryIds: [cat] },
          variant: { sku, weightG: 200, vatBp: 0 },
          imageFileIds: ['00000000-0000-7000-8000-00000000000a'],
          costVnd: Math.round(price / 2),
          sellingPriceVnd: price,
          qty,
        },
      },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.lines[0].variantId as string;
  };
  book = await mk('SACH-0001', 'Cho toi xin mot ve', 100000, 10);
  pen = await mk('VPP-0001', 'Blue pen', 1000000, 5);

  await h.t.db.insert(schema.geoProvince).values({ id: HN, name: 'Hà Nội', searchText: 'ha noi' });
  await h.t.db.insert(schema.geoWard).values([
    { code: '1A0101', name: 'Phường Hàng Bài', provinceId: HN, districtId: 1488, districtName: 'Quận Hoàn Kiếm', searchText: 'phuong hang bai' },
    { code: '1A0201', name: 'Phường 1', provinceId: HN, districtId: 1489, districtName: 'Quận A', searchText: 'phuong 1' },
    { code: '1A0301', name: 'Phường 1', provinceId: HN, districtId: 1490, districtName: 'Quận B', searchText: 'phuong 1' },
  ]);
}, 240_000);

afterAll(async () => {
  await h?.t.stop();
});

describe('address data and channels', () => {
  it('lists wards of a province, naming the district only for duplicate names', async () => {
    const r = await h.call('GET', `/api/v1/geo/provinces/${HN}/wards`, { cookie: online });
    expect(r.status).toBe(200);
    const labels = r.body.items.map((w: { label: string }) => w.label);
    expect(labels).toContain('Phường Hàng Bài');
    expect(labels).toContain('Phường 1 (Quận A)');
    expect(labels).toContain('Phường 1 (Quận B)');
  });

  it('keeps channel profiles that feed the source list (FR-SOC-01)', async () => {
    const r = await h.call('POST', '/api/v1/channels', { cookie: online, body: { name: 'Fanpage Tiệm Sách', kind: 'facebook', url: 'https://facebook.com/tiemsach', handle: '@tiemsach' } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const dupe = await h.call('POST', '/api/v1/channels', { cookie: online, body: { name: 'Fanpage Tiệm Sách', kind: 'facebook' } });
    expect(dupe.status).toBe(409);
    const list = await h.call('GET', '/api/v1/channels?active=true', { cookie: online });
    expect(list.body.items).toHaveLength(1);
    expect((await h.call('GET', '/api/v1/channels', { cookie: cashier })).status).toBe(403);
  });
});

describe('creating orders', () => {
  it('creates a COD chat order confirmed at once, finds or creates the customer and stores the chat handle (FR-ORD-02, FR-SOC-03)', async () => {
    const before = await level(book);
    const r = await create({ source: 'facebook', contactHandle: 'fb.com/an.nguyen', sourceRef: 'https://m.me/an.nguyen', lines: [{ variantId: book, qty: 2 }], shippingVnd: 30000 });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.docNo).toMatch(/^DH-\d{4}-00001$/);
    // “Tạo đơn giao”: a social order keyed by staff needs no confirmation (FR-ORD-02).
    expect(r.body.status).toBe('confirmed');
    expect(r.body.reviewReasons).toEqual([]);
    expect(r.body.totalVnd).toBe(230000);
    expect(r.body.paymentRef).toBeNull();
    expect(await level(book)).toEqual({ onHand: before.onHand, reserved: before.reserved + 2 });

    const contacts = await h.t.sql`select kind, value from crm.customer_contact where customer_id = ${r.body.customerId}`;
    expect(contacts).toEqual([expect.objectContaining({ kind: 'facebook', value: 'fb.com/an.nguyen' })]);
    // The same phone links to the same customer (BR-16).
    const again = await create({ recipient: { name: 'An', phone: '+84 912 345 678' } });
    expect(again.body.customerId).toBe(r.body.customerId);
  });

  it('gives the address of the customer’s latest delivery order to prefill Tạo đơn giao (FR-SOC-03)', async () => {
    const first = (await create({ recipient: { name: 'Bảo', phone: '0977000111' } })).body;
    const latest = (await create({ recipient: { name: 'Bảo', phone: '0977000111' }, address: { ...ward('1A0101'), line: '99 Hàng Bài' } })).body;
    expect(latest.customerId).toBe(first.customerId);
    const lastAddress = (customerId: string, cookie = online) => h.call('GET', `/api/v1/orders/last-address?customerId=${customerId}`, { cookie });
    const r = await lastAddress(first.customerId);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.address).toMatchObject({ wardCode: '1A0101', line: '99 Hàng Bài' });
    // A customer with no delivery order gets nothing to fill in.
    const pickupOnly = (await create({ delivery: 'pickup', address: null, recipient: { name: 'Cúc', phone: '0977000222' } })).body;
    expect((await lastAddress(pickupOnly.customerId)).body).toEqual({ address: null });
    expect((await lastAddress(first.customerId, cashier)).status).toBe(403);
    // Release the stock these orders reserved, so later tests see the same levels.
    for (const o of [first, latest, pickupOnly]) {
      expect((await h.call('POST', `/api/v1/orders/${o.id}/cancel`, { cookie: online, body: { reason: 'Đơn thử địa chỉ' } })).status).toBe(200);
    }
  });

  it('gives a transfer order a payment reference and keeps it New until paid (UC-08)', async () => {
    const r = await create({ paymentMethod: 'transfer' });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('new');
    expect(r.body.reviewReasons).toEqual(['unpaid_transfer']);
    expect(r.body.paymentRef).toMatch(/^[2-9A-HJKMNP-Z]{8}$/);
    const confirm = await h.call('POST', `/api/v1/orders/${r.body.id}/confirm`, { cookie: online });
    expect(confirm.status).toBe(409);
    expect(confirm.body.error.code).toBe('payment_required');

    const wrong = await h.call('POST', `/api/v1/orders/${r.body.id}/confirm-payment`, { cookie: online, body: { amountVnd: 1000 } });
    expect(wrong.status).toBe(422);
    const paid = await h.call('POST', `/api/v1/orders/${r.body.id}/confirm-payment`, { cookie: online, body: { amountVnd: r.body.totalVnd } });
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    expect(paid.body.status).toBe('confirmed');
    expect((await h.call('POST', `/api/v1/orders/${r.body.id}/confirm-payment`, { cookie: online, body: { amountVnd: r.body.totalVnd } })).body.error.code).toBe('already_paid');
  });

  it('flags high value, out of stock and incomplete address for review (FR-ORD-04, BR-30)', async () => {
    const high = await create({ lines: [{ variantId: pen, qty: 2 }] });
    expect(high.body.status).toBe('pending_review');
    expect(high.body.reviewReasons).toEqual(['high_value']);

    const before = await level(book);
    const oos = await create({ lines: [{ variantId: book, qty: 50 }] });
    expect(oos.body.status).toBe('pending_review');
    expect(oos.body.reviewReasons).toContain('out_of_stock');
    expect(await level(book)).toEqual(before);
    const confirm = await h.call('POST', `/api/v1/orders/${oos.body.id}/confirm`, { cookie: online });
    expect(confirm.body.error.code).toBe('insufficient_stock');

    const noWard = await create({ address: { provinceId: HN, line: '12 Phố Huế' } });
    expect(noWard.body.reviewReasons).toEqual(['incomplete_address']);
    const pickup = await create({ delivery: 'pickup', address: null });
    expect(pickup.body.reviewReasons).toEqual([]);
  });

  it('prices with the order channel and needs approval above the discount limit', async () => {
    const q = await h.call('POST', '/api/v1/orders/quote', { cookie: online, body: { source: 'zalo', lines: [{ variantId: book, qty: 1, manualDiscount: { kind: 'percent', bp: 500 } }], shippingVnd: 20000 } });
    expect(q.status, JSON.stringify(q.body)).toBe(200);
    expect(q.body.totalVnd).toBe(115000);
    const over = await create({ lines: [{ variantId: book, qty: 1, manualDiscount: { kind: 'percent', bp: 3000 } }] });
    expect(over.status).toBe(403);
    expect(over.body.error.code).toBe('approval_required');
    // A manual discount on the whole order (FR-ORD-02): within the limit it prices, above it needs approval.
    const whole = await h.call('POST', '/api/v1/orders/quote', { cookie: online, body: { source: 'zalo', lines: [{ variantId: book, qty: 1 }], orderManualDiscount: { kind: 'percent', bp: 500 } } });
    expect(whole.status, JSON.stringify(whole.body)).toBe(200);
    expect(whole.body.discountVnd).toBe(5000);
    const wholeOver = await create({ orderManualDiscount: { kind: 'percent', bp: 3000 } });
    expect(wholeOver.status).toBe(403);
    expect(wholeOver.body.error.code).toBe('approval_required');
  });

  it('refuses users without online.manage', async () => {
    expect((await create({}, cashier)).status).toBe(403);
    expect((await h.call('GET', '/api/v1/orders', { cookie: cashier })).status).toBe(403);
  });
});

describe('inbox', () => {
  it('searches, filters with counts and sorts orders needing action first (FR-ORD-05)', async () => {
    const all = await h.call('GET', '/api/v1/orders', { cookie: online });
    expect(all.status).toBe(200);
    expect(all.body.counts.confirmed).toBeGreaterThanOrEqual(1);
    const statuses: string[] = all.body.items.map((o: { status: string }) => o.status);
    const firstQuiet = statuses.findIndex((s) => !['new', 'pending_review', 'return_requested'].includes(s));
    expect(statuses.slice(firstQuiet).every((s) => !['new', 'pending_review', 'return_requested'].includes(s))).toBe(true);

    const byPhone = await h.call('GET', '/api/v1/orders?q=0912345678&status=pending_review,new', { cookie: online });
    expect(byPhone.body.items.length).toBeGreaterThan(0);
    expect(byPhone.body.items.every((o: { status: string }) => ['pending_review', 'new'].includes(o.status))).toBe(true);
    const byName = await h.call('GET', '/api/v1/orders?q=nguyen van', { cookie: online });
    expect(byName.body.items.length).toBeGreaterThan(0);
    expect(byName.body.items[0].readAt).toBeNull();

    const one = await h.call('GET', `/api/v1/orders/${byName.body.items[0].id}`, { cookie: online });
    expect(one.status).toBe(200);
    expect(one.body.events[0]).toMatchObject({ fromStatus: null });
    expect(one.body.lines[0].sku).toBeTruthy();
    const after = await h.call('GET', `/api/v1/orders?q=${one.body.docNo}`, { cookie: online });
    expect(after.body.items[0].readAt).not.toBeNull();
  });
});

describe('fulfilment', () => {
  it('ships, takes stock out at handover and counts on Done (BR-29, FR-ORD-10/11)', async () => {
    const o = (await create({ recipient: { name: 'Trần Bình', phone: '0987654321' }, lines: [{ variantId: book, qty: 1 }], shippingVnd: 30000 })).body;
    const before = await level(book);
    expect((await h.call('POST', `/api/v1/orders/${o.id}/confirm`, { cookie: online })).body.status).toBe('confirmed');
    expect((await h.call('POST', `/api/v1/orders/${o.id}/pack`, { cookie: online })).body.status).toBe('packing');
    const ship = await h.call('POST', `/api/v1/orders/${o.id}/shipment`, { cookie: online, body: { carrier: 'manual', trackingNo: 'GHN12345678' } });
    expect(ship.status, JSON.stringify(ship.body)).toBe(201);
    expect(ship.body.status).toBe('shipping');
    expect(await level(book)).toEqual({ onHand: before.onHand - 1, reserved: before.reserved - 1 });
    const dupe = await create({ recipient: { name: 'X', phone: '0911111111' } });
    await h.call('POST', `/api/v1/orders/${dupe.body.id}/confirm`, { cookie: online });
    expect((await h.call('POST', `/api/v1/orders/${dupe.body.id}/shipment`, { cookie: online, body: { carrier: 'manual', trackingNo: 'GHN12345678' } })).body.error.code).toBe('duplicate_tracking_no');

    const found = await h.call('GET', '/api/v1/orders?q=GHN1234', { cookie: online });
    expect(found.body.items.map((x: { id: string }) => x.id)).toContain(o.id);

    const done = await h.call('POST', `/api/v1/orders/${o.id}/delivered`, { cookie: online });
    expect(done.body.status).toBe('done');
    const rec = (await h.call('GET', `/api/v1/orders/${o.id}`, { cookie: owner })).body;
    expect(rec.doneAt).not.toBeNull();
    expect(rec.paidAt).not.toBeNull();
    expect(rec.lines[0].costVnd).toBe(50000);
    const [cod] = await h.t.sql`select expected_vnd::int as "expectedVnd", status from orders.cod_remittance`;
    expect(cod).toMatchObject({ expectedVnd: 130000, status: 'pending' });
    const [inv] = await h.t.sql`select status from sales.einvoice_job where order_id = ${o.id}`;
    expect(inv?.status).toBe('pending');
    const [cust] = await h.t.sql`select points_balance from crm.customer where id = ${rec.customerId}`;
    expect(cust!.points_balance).toBe(rec.pointsEarned);
    expect(rec.pointsEarned).toBeGreaterThan(0);
  });

  it('cancels with a reason and releases the stock (FR-ORD-09)', async () => {
    const o = (await create({})).body;
    await h.call('POST', `/api/v1/orders/${o.id}/confirm`, { cookie: online });
    const before = await level(book);
    const noReason = await h.call('POST', `/api/v1/orders/${o.id}/cancel`, { cookie: online, body: { reason: '' } });
    expect(noReason.status).toBe(400);
    const r = await h.call('POST', `/api/v1/orders/${o.id}/cancel`, { cookie: online, body: { reason: 'Khách đổi ý' } });
    expect(r.body).toMatchObject({ status: 'cancelled', refundDueVnd: 0 });
    expect(await level(book)).toEqual({ onHand: before.onHand, reserved: before.reserved - 1 });
    expect((await h.call('POST', `/api/v1/orders/${o.id}/confirm`, { cookie: online })).body.error.code).toBe('invalid_transition');
  });

  it('hands a pickup order over with its code (FR-ORD-12)', async () => {
    const o = (await create({ delivery: 'pickup', address: null, recipient: { name: 'Lê Chi', phone: '0933333333' } })).body;
    await h.call('POST', `/api/v1/orders/${o.id}/confirm`, { cookie: online });
    const ready = await h.call('POST', `/api/v1/orders/${o.id}/pickup-ready`, { cookie: online });
    expect(ready.status, JSON.stringify(ready.body)).toBe(200);
    expect(ready.body.pickupCode).toMatch(/^\d{6}$/);
    const wrongCode = ready.body.pickupCode === '000000' ? '111111' : '000000';
    expect((await h.call('POST', `/api/v1/orders/${o.id}/handover`, { cookie: online, body: { code: wrongCode } })).status).toBe(422);
    const before = await level(book);
    const ok = await h.call('POST', `/api/v1/orders/${o.id}/handover`, { cookie: online, body: { code: ready.body.pickupCode } });
    expect(ok.body.status).toBe('done');
    expect(await level(book)).toEqual({ onHand: before.onHand - 1, reserved: before.reserved - 1 });
  });

  it('confirms several orders with a result per order (FR-ORD-13)', async () => {
    const a = (await create({})).body;
    const b = (await create({ paymentMethod: 'transfer' })).body;
    const r = await h.call('POST', '/api/v1/orders/bulk-confirm', { cookie: online, body: { ids: [a.id, b.id] } });
    expect(r.body.confirmed).toBe(1);
    expect(r.body.results).toEqual([
      { id: a.id, ok: true },
      expect.objectContaining({ id: b.id, ok: false, code: 'payment_required' }),
    ]);
  });

  it('auto-cancels unpaid transfer orders after the timeout (BR-09)', async () => {
    const before = await level(book);
    const o = (await create({ paymentMethod: 'transfer' })).body;
    h.clock.advance(25 * 3600_000);
    const n = await orders.autocancelUnpaid(h.ctx());
    expect(n).toBeGreaterThanOrEqual(1);
    // Sessions idle out after 12 hours (TDD §10.2).
    online = await h.login('online', 'mat-khau-moi-456');
    owner = await h.login('lan', OWNER_PW);
    const rec = (await h.call('GET', `/api/v1/orders/${o.id}`, { cookie: online })).body;
    expect(rec.status).toBe('cancelled');
    expect(rec.events[0].reason).toMatch(/chưa nhận chuyển khoản/);
    // Its own hold is released (other stale unpaid orders are cancelled in the same run).
    const [held] = await h.t.sql`select count(*)::int as n from inventory.stock_reservation where ref_id = ${o.id} and status = 'active'`;
    expect(held!.n).toBe(0);
    expect((await level(book)).onHand).toBe(before.onHand);
  });

  it('keeps reservations equal to the active reservation rows and the ledger in balance', async () => {
    const [r] = await h.t.sql`
      select count(*)::int as drift from inventory.stock_level s
      where s.reserved <> coalesce((select sum(qty) from inventory.stock_reservation r where r.variant_id = s.variant_id and r.status = 'active'), 0)`;
    expect(r!.drift).toBe(0);
    expect(await jobs.integrityCheck(h.ctx())).toEqual([]);
  });
});

describe('GHN (FR-ORD-06, FR-ORD-10, TDD §8.2)', () => {
  it('refreshes address data with the district kept behind the ward', async () => {
    const r = await orders.refreshGeo(h.ctx(), h.carrier);
    expect(r).toEqual({ provinces: 1, wards: 3 });
    const wards = (await h.call('GET', `/api/v1/geo/provinces/${HN}/wards`, { cookie: online })).body.items;
    expect(wards.map((w: { label: string }) => w.label)).toEqual(expect.arrayContaining(['Phường Phúc Tân (Quận Hoàn Kiếm)', 'Phường Phúc Tân (Quận Ba Đình)']));
  });

  it('quotes the GHN fee from the ward and the item weights', async () => {
    const r = await h.call('POST', '/api/v1/orders/shipping-quote', { cookie: online, body: { wardCode: '1A0101', lines: [{ variantId: book, qty: 4 }] } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toEqual({ feeVnd: 27000, weightG: 800 });
    h.carrier.failNext = 'timeout';
    const down = await h.call('POST', '/api/v1/orders/shipping-quote', { cookie: online, body: { wardCode: '1A0101', lines: [{ variantId: book, qty: 1 }] } });
    expect(down.body.error.code).toBe('carrier_unavailable');
  });

  it('creates the GHN shipment and follows it to Done by polling', async () => {
    // More stock for the rest of the suite.
    const supplierId = (await h.call('GET', '/api/v1/purchasing/suppliers', { cookie: owner })).body.items[0].id;
    const si = await h.call('POST', '/api/v1/purchasing/stock-in/existing', { cookie: owner, body: { supplierId, line: { variantId: book, costVnd: 50000, sellingPriceVnd: 100000, qty: 10 } } });
    expect(si.status, JSON.stringify(si.body)).toBe(201);
    const o = (await create({ recipient: { name: 'Phạm Dung', phone: '0944444444' } })).body;
    await h.call('POST', `/api/v1/orders/${o.id}/confirm`, { cookie: online });
    const ship = await h.call('POST', `/api/v1/orders/${o.id}/shipment`, { cookie: online, body: { carrier: 'ghn' } });
    expect(ship.status, JSON.stringify(ship.body)).toBe(201);
    expect(ship.body.shipment.trackingNo).toMatch(/^MOCK/);
    const tracking = ship.body.shipment.trackingNo as string;

    h.carrier.statuses.set(tracking, 'delivering');
    expect(await orders.pollShipments(h.ctx(), h.carrier)).toMatchObject({ changed: 1 });
    h.carrier.statuses.set(tracking, 'delivered');
    await orders.pollShipments(h.ctx(), h.carrier);
    const rec = (await h.call('GET', `/api/v1/orders/${o.id}`, { cookie: online })).body;
    expect(rec.status).toBe('done');
    expect(rec.shipments[0]).toMatchObject({ carrier: 'ghn', status: 'delivered', carrierStatus: 'delivered' });
  });

  it('accepts the status webhook only with its secret and ignores replays', async () => {
    const o = (await create({ recipient: { name: 'Vũ Em', phone: '0955555555' } })).body;
    await h.call('POST', `/api/v1/orders/${o.id}/confirm`, { cookie: online });
    const tracking = (await h.call('POST', `/api/v1/orders/${o.id}/shipment`, { cookie: online, body: { carrier: 'ghn' } })).body.shipment.trackingNo;
    const body = { OrderCode: tracking, Status: 'delivered', Time: '2026-10-26T08:00:00Z' };
    expect((await h.call('POST', '/webhooks/ghn?token=wrong', { body })).status).toBe(404);
    const ok = await h.call('POST', `/webhooks/ghn?token=${WEBHOOK_SECRET}`, { body });
    expect(ok.body).toEqual({ duplicate: false, changed: true });
    expect((await h.call('POST', `/webhooks/ghn?token=${WEBHOOK_SECRET}`, { body })).body).toEqual({ duplicate: true });
    expect((await h.call('GET', `/api/v1/orders/${o.id}`, { cookie: online })).body.status).toBe('done');
  });
});

describe('returns (FR-ORD-17)', () => {
  it('turns a GHN return into an approved return that restocks on receipt', async () => {
    const o = (await create({ recipient: { name: 'Đỗ Giang', phone: '0966666666' } })).body;
    await h.call('POST', `/api/v1/orders/${o.id}/confirm`, { cookie: online });
    const tracking = (await h.call('POST', `/api/v1/orders/${o.id}/shipment`, { cookie: online, body: { carrier: 'ghn' } })).body.shipment.trackingNo;
    const before = await level(book);
    h.carrier.statuses.set(tracking, 'returned');
    await orders.pollShipments(h.ctx(), h.carrier);
    const rec = (await h.call('GET', `/api/v1/orders/${o.id}`, { cookie: online })).body;
    expect(rec.status).toBe('return_approved');
    expect(rec.returns[0]).toMatchObject({ status: 'approved', returnShippingPaidBy: 'store' });
    const tooMuch = await h.call('POST', `/api/v1/orders/${o.id}/return-receive`, { cookie: online, body: { lines: [{ orderLineId: rec.lines[0].id, restock: true }], refundVnd: 1000 } });
    expect(tooMuch.body.error.code).toBe('refund_exceeds_paid');
    const r = await h.call('POST', `/api/v1/orders/${o.id}/return-receive`, { cookie: online, body: { lines: [{ orderLineId: rec.lines[0].id, restock: true }], refundVnd: 0 } });
    expect(r.body.status).toBe('returned');
    expect((await level(book)).onHand).toBe(before.onHand + 1);
  });

  it('flags a phone with two parcels brought back as suspected abuse (BR-30)', async () => {
    const o = (await create({ recipient: { name: 'Đỗ Giang', phone: '0966666666' } })).body;
    await h.call('POST', `/api/v1/orders/${o.id}/confirm`, { cookie: online });
    const tracking = (await h.call('POST', `/api/v1/orders/${o.id}/shipment`, { cookie: online, body: { carrier: 'ghn' } })).body.shipment.trackingNo;
    h.carrier.statuses.set(tracking, 'returned');
    await orders.pollShipments(h.ctx(), h.carrier);
    const third = await create({ recipient: { name: 'Đỗ Giang', phone: '0966666666' } });
    expect(third.body.reviewReasons).toContain('suspected_abuse');
  });

  it('requests, approves and receives a customer return after Done, reversing points', async () => {
    const o = (await create({ recipient: { name: 'Hồ Hà', phone: '0977777777' }, lines: [{ variantId: book, qty: 2 }] })).body;
    await h.call('POST', `/api/v1/orders/${o.id}/confirm`, { cookie: online });
    await h.call('POST', `/api/v1/orders/${o.id}/shipment`, { cookie: online, body: { carrier: 'manual', trackingNo: 'TAY00000001' } });
    await h.call('POST', `/api/v1/orders/${o.id}/delivered`, { cookie: online });
    const rec = (await h.call('GET', `/api/v1/orders/${o.id}`, { cookie: online })).body;
    const [c0] = await h.t.sql`select points_balance from crm.customer where id = ${rec.customerId}`;

    const req = await h.call('POST', `/api/v1/orders/${o.id}/return-request`, { cookie: online, body: { reason: 'Sách lỗi in', lines: [{ orderLineId: rec.lines[0].id, qty: 1 }], returnShippingPaidBy: 'store' } });
    expect(req.status, JSON.stringify(req.body)).toBe(201);
    expect((await h.call('POST', `/api/v1/orders/${o.id}/return-approve`, { cookie: online })).body.status).toBe('return_approved');
    const before = await level(book);
    const r = await h.call('POST', `/api/v1/orders/${o.id}/return-receive`, { cookie: online, body: { lines: [{ orderLineId: rec.lines[0].id, restock: false }], refundVnd: 100000, refundRef: 'CK 26/10' } });
    expect(r.body).toMatchObject({ status: 'returned', refundVnd: 100000 });
    expect(r.body.pointsReversed).toBeGreaterThan(0);
    // Written off as damaged: no restock (BR-04).
    expect(await level(book)).toEqual(before);
    const [c1] = await h.t.sql`select points_balance from crm.customer where id = ${rec.customerId}`;
    expect(c1!.points_balance).toBe(c0!.points_balance - r.body.pointsReversed);
  });

  it('refuses a return request and leaves the order Done', async () => {
    const o = (await create({ recipient: { name: 'Lý Khoa', phone: '0988888888' } })).body;
    await h.call('POST', `/api/v1/orders/${o.id}/confirm`, { cookie: online });
    await h.call('POST', `/api/v1/orders/${o.id}/shipment`, { cookie: online, body: { carrier: 'manual', trackingNo: 'TAY00000002' } });
    await h.call('POST', `/api/v1/orders/${o.id}/delivered`, { cookie: online });
    const line = (await h.call('GET', `/api/v1/orders/${o.id}`, { cookie: online })).body.lines[0];
    await h.call('POST', `/api/v1/orders/${o.id}/return-request`, { cookie: online, body: { reason: 'Đổi ý', lines: [{ orderLineId: line.id, qty: 1 }], returnShippingPaidBy: 'customer' } });
    const r = await h.call('POST', `/api/v1/orders/${o.id}/return-reject`, { cookie: online, body: { reason: 'Quá hạn đổi trả' } });
    expect(r.body.status).toBe('done');
  });
});

describe('reports, customers and COD (FR-SOC-02, FR-CRM-03, FR-ORD-11, BR-29)', () => {
  it('counts Done online orders by source in the sales report, with their returns', async () => {
    const day = new Date(h.clock.now().getTime() + 7 * 3600_000).toISOString().slice(0, 10);
    const from = new Date(h.clock.now().getTime() - 3 * 86_400_000 + 7 * 3600_000).toISOString().slice(0, 10);
    const r = await h.call('GET', `/api/v1/reports/sales?from=${from}&to=${day}&groupBy=channel`, { cookie: owner });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const fb = r.body.rows.find((x: { key: string }) => x.key === 'Website');
    expect(fb.orders).toBeGreaterThanOrEqual(4);
    expect(fb.returnsVnd).toBe(100000);
    const [done] = await h.t.sql`select count(*)::int as n from orders.web_order where done_at is not null`;
    expect(r.body.totals.orders).toBe(done!.n);
    const dash = await h.call('GET', '/api/v1/reports/dashboard', { cookie: owner });
    expect(dash.status).toBe(200);
  });

  it('lists online orders in the customer purchases and list stats (FR-CRM-02/03)', async () => {
    const [c] = await h.t.sql`select id from crm.customer where phone_e164 = '+84977777777'`;
    const p = (await h.call('GET', `/api/v1/customers/${c!.id}/purchases`, { cookie: owner })).body;
    expect(p.items[0]).toMatchObject({ kind: 'order', channel: 'website', status: 'completed', returnsVnd: 100000 });
    expect(p.totals.orders).toBe(1);
    const list = (await h.call('GET', '/api/v1/customers?q=0977777777', { cookie: owner })).body.items;
    expect(list[0]).toMatchObject({ orders: 1, ordersVnd: 200000 });
  });

  it('reconciles COD against the carrier statement and flags differences', async () => {
    const pending = (await h.call('GET', '/api/v1/cod/remittances?status=pending', { cookie: online })).body.items;
    expect(pending.length).toBeGreaterThanOrEqual(2);
    const [a, b] = pending;
    expect((await h.call('POST', `/api/v1/cod/remittances/${a.id}/reconcile`, { cookie: online, body: { receivedVnd: a.expectedVnd, statementRef: 'GHN-BK-01' } })).body.status).toBe('matched');
    const diff = await h.call('POST', `/api/v1/cod/remittances/${b.id}/reconcile`, { cookie: online, body: { receivedVnd: b.expectedVnd - 5000, statementRef: 'GHN-BK-01' } });
    expect(diff.body).toMatchObject({ status: 'difference', differenceVnd: -5000 });
    // The Đối soát COD menu item counts the remittances with a difference.
    const differences = (await h.call('GET', '/api/v1/cod/remittances?status=difference', { cookie: online })).body.items.length;
    expect((await h.call('GET', '/api/v1/me/badges', { cookie: online })).body.codDifferences).toBe(differences);
    expect((await h.call('POST', `/api/v1/cod/remittances/${a.id}/reconcile`, { cookie: online, body: { receivedVnd: 1, statementRef: 'x' } })).body.error.code).toBe('already_reconciled');
  });

  it('makes a copy-ready share card for a product (FR-SOC-04)', async () => {
    expect((await h.call('PUT', '/api/v1/admin/settings', { cookie: owner, body: { 'web.product_url': 'https://tiemsach.vn/sach/{slug}' } })).status).toBe(204);
    const r = await h.call('POST', '/api/v1/share-links', { cookie: online, body: { variantId: book } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.url).toMatch(/^https:\/\/tiemsach\.vn\/sach\/.+/);
    expect(r.body.text).toContain('Giá: 100.000 ₫');
    expect(['Còn hàng', 'Sắp hết hàng']).toContain(r.body.availability);
  });
});

describe('Orders and Delivery screens (FR-ORD-01..03, FR-ORD-05)', () => {
  it('lists every order on Orders and lets a cashier confirm a website order', async () => {
    // Earlier tests moved the clock past the 12-hour session idle limit (TDD §10.2).
    cashier = await h.login('thu', 'mat-khau-moi-456');
    online = await h.login('online', 'mat-khau-moi-456');
    const web = (await create({ recipient: { name: 'Khách Website', phone: '0933000111' } })).body;
    expect(web.status).toBe('new');
    // The cashier sees online orders on Orders (online.confirm) but not the Delivery list.
    const list = await h.call('GET', '/api/v1/order-list?type=online&q=0933000111', { cookie: cashier });
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(list.body.items[0]).toMatchObject({ type: 'online', id: web.id, docNo: web.docNo, status: 'new', needsAction: true, customerName: 'Khách Website' });
    expect(list.body.counts.online).toBeGreaterThanOrEqual(1);
    expect((await h.call('GET', '/api/v1/orders?scope=delivery', { cookie: cashier })).status).toBe(403);
    expect((await h.call('GET', `/api/v1/orders/${web.id}`, { cookie: cashier })).status).toBe(200);
    const ok = await h.call('POST', `/api/v1/orders/${web.id}/confirm`, { cookie: cashier });
    expect(ok.body.status).toBe('confirmed');
    // Website orders waiting for confirmation sort first.
    const res = await h.call('GET', '/api/v1/order-list', { cookie: online });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const all = res.body.items as { needsAction: boolean }[];
    const firstQuiet = all.findIndex((r) => !r.needsAction);
    expect(all.length).toBeGreaterThan(0);
    expect(all.slice(firstQuiet).every((r) => !r.needsAction)).toBe(true);
  });

  it('shows only confirmed carrier orders on Delivery, by stage', async () => {
    const social = (await create({ source: 'zalo', recipient: { name: 'Khách Zalo', phone: '0933000222' } })).body;
    expect(social.status).toBe('confirmed');
    const fresh = (await create({ recipient: { name: 'Chưa xác nhận', phone: '0933000333' } })).body;
    const d = (await h.call('GET', '/api/v1/orders?scope=delivery&stage=waiting', { cookie: online })).body;
    const ids = d.items.map((o: { id: string }) => o.id);
    expect(ids).toContain(social.id);
    expect(ids).not.toContain(fresh.id);
    expect(d.items.every((o: { delivery: string; status: string }) => o.delivery === 'ship' && ['confirmed', 'packing'].includes(o.status))).toBe(true);
    expect(d.stages.waiting).toBeGreaterThanOrEqual(1);
    const badges = (await h.call('GET', '/api/v1/me/badges', { cookie: online })).body;
    expect(badges.shipmentsWaiting).toBe(d.stages.waiting);
    const cashierBadges = (await h.call('GET', '/api/v1/me/badges', { cookie: cashier })).body;
    expect(cashierBadges.ordersNeedingAction).toBeGreaterThanOrEqual(1);
    expect(cashierBadges).not.toHaveProperty('shipmentsWaiting');
  });
});
