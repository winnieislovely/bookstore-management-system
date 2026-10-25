/**
 * E-invoice provider boundary (TDD §8.1, §8.3). MISA meInvoice sits behind this interface with
 * mock, sandbox and live implementations; the worker calls it from the persistent queue, so a
 * provider outage never blocks a sale.
 */
export interface InvoiceLine {
  description: string;
  qty: number;
  unitPriceVnd: number;
  discountVnd: number;
  totalVnd: number;
  vatBp: number;
  vatVnd: number;
}

export interface Buyer {
  name: string;
  taxCode?: string | undefined;
  address?: string | undefined;
  email?: string | undefined;
}

export interface IssueRequest {
  /** Idempotency: one invoice per sale (TDD §8.1). */
  reference: string;
  issuedAt: Date;
  /** Null: invoiced to a retail customer (FR-POS-15). */
  buyer: Buyer | null;
  lines: InvoiceLine[];
  totalVnd: number;
  vatVnd: number;
}

export interface IssueResult {
  providerRef: string;
  invoiceNo: string;
}

export interface EInvoiceAdapter {
  issue(req: IssueRequest): Promise<IssueResult>;
  /** Cancel an issued invoice (voided sale) as regulation allows. */
  cancel(providerRef: string, reason: string): Promise<void>;
  /** Replace an issued invoice with one carrying buyer details (TDD §8.3). */
  replace(providerRef: string, req: IssueRequest): Promise<IssueResult>;
  /** Ask the provider to email the invoice to the buyer (FR-POS-16). */
  emailToBuyer(providerRef: string, email: string): Promise<void>;
}

export class ProviderUnavailable extends Error {
  constructor(message = 'Provider unreachable') {
    super(message);
    this.name = 'ProviderUnavailable';
  }
}

/** Deterministic in-memory implementation for development and tests. */
export class MockEInvoiceAdapter implements EInvoiceAdapter {
  private counter = 0;
  readonly issued = new Map<string, { req: IssueRequest; invoiceNo: string; cancelled: boolean }>();
  readonly emails: { providerRef: string; email: string }[] = [];
  /** Number of upcoming calls that fail as if the provider were down. */
  failNext = 0;

  private maybeFail() {
    if (this.failNext > 0) {
      this.failNext--;
      throw new ProviderUnavailable('MISA meInvoice không phản hồi (mô phỏng)');
    }
  }

  async issue(req: IssueRequest): Promise<IssueResult> {
    this.maybeFail();
    const existing = [...this.issued.entries()].find(([, v]) => v.req.reference === req.reference && !v.cancelled);
    if (existing) return { providerRef: existing[0], invoiceNo: existing[1].invoiceNo };
    const invoiceNo = String(++this.counter).padStart(8, '0');
    const providerRef = `mock-${req.reference}-${invoiceNo}`;
    this.issued.set(providerRef, { req, invoiceNo, cancelled: false });
    return { providerRef, invoiceNo };
  }

  async cancel(providerRef: string): Promise<void> {
    this.maybeFail();
    const inv = this.issued.get(providerRef);
    if (inv) inv.cancelled = true;
  }

  async replace(providerRef: string, req: IssueRequest): Promise<IssueResult> {
    this.maybeFail();
    await this.cancel(providerRef);
    return this.issue({ ...req, reference: `${req.reference}-r${this.counter + 1}` });
  }

  async emailToBuyer(providerRef: string, email: string): Promise<void> {
    this.maybeFail();
    this.emails.push({ providerRef, email });
  }
}
