import type { ShipmentStatus } from '@bookstore/domain';

/**
 * Carrier boundary (TDD §8.1, §8.2): GHN behind `CarrierAdapter` with a mock (tests, development
 * without credentials) and an HTTP implementation for GHN's sandbox and live environments.
 * Endpoints and fields follow GHN's public API (shiip/public-api); GHN still has three address
 * levels, so calls take the hidden district id kept on each ward.
 */

export interface GeoProvince {
  id: number;
  name: string;
}
export interface GeoDistrict {
  id: number;
  name: string;
}
export interface GeoWard {
  code: string;
  name: string;
}

export interface QuoteRequest {
  toDistrictId: number;
  toWardCode: string;
  weightG: number;
  codVnd: number;
  insuranceVnd: number;
}

export interface CreateShipmentRequest {
  /** Our order number; GHN rejects a second order with the same client code (idempotency). */
  clientOrderCode: string;
  to: { name: string; phone: string; address: string; wardCode: string; districtId: number };
  codVnd: number;
  insuranceVnd: number;
  weightG: number;
  items: { name: string; code: string; qty: number; priceVnd: number; weightG: number }[];
  note: string | null;
}

export interface CreateShipmentResult {
  trackingNo: string;
  feeVnd: number;
  expectedDeliveryAt: Date | null;
}

export interface ShipmentStatusResult {
  carrierStatus: string;
  status: ShipmentStatus;
  at: Date | null;
}

export interface CarrierAdapter {
  readonly name: 'mock' | 'ghn';
  provinces(): Promise<GeoProvince[]>;
  districts(provinceId: number): Promise<GeoDistrict[]>;
  wards(districtId: number): Promise<GeoWard[]>;
  quote(req: QuoteRequest): Promise<{ feeVnd: number }>;
  createShipment(req: CreateShipmentRequest): Promise<CreateShipmentResult>;
  status(trackingNo: string): Promise<ShipmentStatusResult>;
}

export class CarrierError extends Error {
  constructor(
    message: string,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = 'CarrierError';
  }
}

/** GHN order statuses mapped onto the states the system tracks (TDD §8.2). */
export function mapGhnStatus(raw: string): ShipmentStatus {
  switch (raw) {
    case 'ready_to_pick':
      return 'created';
    case 'picking':
    case 'money_collect_picking':
      return 'picking';
    case 'picked':
    case 'storing':
    case 'transporting':
    case 'sorting':
    case 'delivering':
    case 'money_collect_delivering':
      return 'in_transit';
    case 'delivered':
      return 'delivered';
    case 'waiting_to_return':
    case 'return':
    case 'return_transporting':
    case 'return_sorting':
    case 'returning':
    case 'return_fail':
      return 'returning';
    case 'returned':
      return 'returned';
    case 'cancel':
      return 'cancelled';
    default:
      // delivery_fail, exception, damage, lost: needs a person.
      return 'failed';
  }
}

export interface GhnConfig {
  token: string;
  shopId: number;
  /** `sandbox` = dev-online-gateway, `live` = online-gateway. */
  env: 'sandbox' | 'live';
  fetch?: typeof fetch;
  timeoutMs?: number;
}

interface GhnEnvelope<T> {
  code: number;
  message: string;
  code_message_value?: string;
  data: T;
}

export class GhnAdapter implements CarrierAdapter {
  readonly name = 'ghn' as const;
  private readonly base: string;
  private readonly http: typeof fetch;

  constructor(private readonly cfg: GhnConfig) {
    this.base = cfg.env === 'live' ? 'https://online-gateway.ghn.vn/shiip/public-api' : 'https://dev-online-gateway.ghn.vn/shiip/public-api';
    this.http = cfg.fetch ?? fetch;
  }

  private async call<T>(path: string, body?: unknown, withShop = false): Promise<T> {
    let res: Response;
    try {
      res = await this.http(`${this.base}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { Token: this.cfg.token, 'Content-Type': 'application/json', ...(withShop && { ShopId: String(this.cfg.shopId) }) },
        ...(body !== undefined && { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 15_000),
      });
    } catch (e) {
      throw new CarrierError(`Không kết nối được GHN: ${e instanceof Error ? e.message : String(e)}`);
    }
    const env = (await res.json().catch(() => null)) as GhnEnvelope<T> | null;
    if (!env || env.code !== 200) throw new CarrierError(env?.code_message_value || env?.message || `GHN trả lỗi HTTP ${res.status}`, env ? String(env.code) : null);
    return env.data;
  }

  async provinces(): Promise<GeoProvince[]> {
    const rows = await this.call<{ ProvinceID: number; ProvinceName: string; IsEnable?: number }[]>('/master-data/province');
    return rows.filter((r) => r.IsEnable !== 0).map((r) => ({ id: r.ProvinceID, name: r.ProvinceName }));
  }

  async districts(provinceId: number): Promise<GeoDistrict[]> {
    const rows = await this.call<{ DistrictID: number; DistrictName: string; IsEnable?: number }[] | null>('/master-data/district', { province_id: provinceId });
    return (rows ?? []).filter((r) => r.IsEnable !== 0).map((r) => ({ id: r.DistrictID, name: r.DistrictName }));
  }

  async wards(districtId: number): Promise<GeoWard[]> {
    const rows = await this.call<{ WardCode: string; WardName: string; IsEnable?: number }[] | null>('/master-data/ward', { district_id: districtId });
    return (rows ?? []).filter((r) => r.IsEnable !== 0).map((r) => ({ code: r.WardCode, name: r.WardName }));
  }

  async quote(req: QuoteRequest): Promise<{ feeVnd: number }> {
    const d = await this.call<{ total: number }>(
      '/v2/shipping-order/fee',
      { service_type_id: 2, to_district_id: req.toDistrictId, to_ward_code: req.toWardCode, weight: Math.max(1, req.weightG), insurance_value: req.insuranceVnd, cod_value: req.codVnd },
      true,
    );
    return { feeVnd: d.total };
  }

  async createShipment(req: CreateShipmentRequest): Promise<CreateShipmentResult> {
    const d = await this.call<{ order_code: string; total_fee: number; expected_delivery_time?: string }>(
      '/v2/shipping-order/create',
      {
        // The shop pays GHN; the customer's shipping fee is already in the COD amount (FR-ORD-11).
        payment_type_id: 1,
        required_note: 'CHOXEMHANGKHONGTHU',
        client_order_code: req.clientOrderCode,
        to_name: req.to.name,
        to_phone: req.to.phone,
        to_address: req.to.address,
        to_ward_code: req.to.wardCode,
        to_district_id: req.to.districtId,
        cod_amount: req.codVnd,
        insurance_value: req.insuranceVnd,
        weight: Math.max(1, req.weightG),
        service_type_id: 2,
        note: req.note ?? '',
        items: req.items.map((i) => ({ name: i.name, code: i.code, quantity: i.qty, price: i.priceVnd, weight: Math.max(1, i.weightG) })),
      },
      true,
    );
    return { trackingNo: d.order_code, feeVnd: d.total_fee, expectedDeliveryAt: d.expected_delivery_time ? new Date(d.expected_delivery_time) : null };
  }

  async status(trackingNo: string): Promise<ShipmentStatusResult> {
    const d = await this.call<{ status: string; updated_date?: string }>('/v2/shipping-order/detail', { order_code: trackingNo });
    return { carrierStatus: d.status, status: mapGhnStatus(d.status), at: d.updated_date ? new Date(d.updated_date) : null };
  }
}

/** Deterministic stand-in for tests and development without GHN credentials. */
export class MockCarrierAdapter implements CarrierAdapter {
  readonly name = 'mock' as const;
  /** Tracking number → raw GHN status; tests move shipments along by editing this map. */
  readonly statuses = new Map<string, string>();
  failNext: string | null = null;
  private seq = 0;

  async provinces(): Promise<GeoProvince[]> {
    return [{ id: 201, name: 'Hà Nội' }];
  }
  async districts(): Promise<GeoDistrict[]> {
    return [
      { id: 1488, name: 'Quận Hoàn Kiếm' },
      { id: 1489, name: 'Quận Ba Đình' },
    ];
  }
  async wards(districtId: number): Promise<GeoWard[]> {
    return districtId === 1488
      ? [
          { code: '1A0101', name: 'Phường Hàng Bài' },
          { code: '1A0102', name: 'Phường Phúc Tân' },
        ]
      : [{ code: '1A0201', name: 'Phường Phúc Tân' }];
  }
  async quote(req: QuoteRequest): Promise<{ feeVnd: number }> {
    this.throwIfFailing();
    return { feeVnd: 22000 + Math.ceil(Math.max(0, req.weightG - 500) / 500) * 5000 };
  }
  async createShipment(req: CreateShipmentRequest): Promise<CreateShipmentResult> {
    this.throwIfFailing();
    const trackingNo = `MOCK${String(++this.seq).padStart(6, '0')}${req.clientOrderCode.slice(-2)}`;
    this.statuses.set(trackingNo, 'ready_to_pick');
    return { trackingNo, feeVnd: 25000, expectedDeliveryAt: null };
  }
  async status(trackingNo: string): Promise<ShipmentStatusResult> {
    this.throwIfFailing();
    const raw = this.statuses.get(trackingNo);
    if (!raw) throw new CarrierError(`Không tìm thấy vận đơn ${trackingNo}.`);
    return { carrierStatus: raw, status: mapGhnStatus(raw), at: null };
  }
  private throwIfFailing() {
    if (this.failNext) {
      const m = this.failNext;
      this.failNext = null;
      throw new CarrierError(m);
    }
  }
}

/** GHN with credentials, otherwise the mock (development and tests without a GHN account). */
export function createCarrier(cfg: { GHN_TOKEN?: string | undefined; GHN_SHOP_ID?: number | undefined; GHN_ENV: 'sandbox' | 'live' }): CarrierAdapter {
  return cfg.GHN_TOKEN && cfg.GHN_SHOP_ID ? new GhnAdapter({ token: cfg.GHN_TOKEN, shopId: cfg.GHN_SHOP_ID, env: cfg.GHN_ENV }) : new MockCarrierAdapter();
}
