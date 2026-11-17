import * as library from '@bookstore/modules/library';
import * as counts from '@bookstore/modules/library/counts';
import { AppError } from '@bookstore/modules/platform';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { z } from 'zod';
import type { AppEnv } from '../http/context.js';
import { defineRoute, IdParams } from '../http/route.js';

/** Library (TDD §6.2 “Library”); finer checks (manage or lend) are in the module. */
export function libraryRoutes(app: OpenAPIHono<AppEnv>): void {
  // --- Catalogue and copies (FR-LIB-01..04, FR-LIB-17) ---------------------------------------
  defineRoute(app, { method: 'get', path: '/api/v1/library/titles', access: 'session', summary: 'Library titles with copy counts', query: library.TitlesQuery }, async ({ ctx, query }) =>
    library.listTitles(ctx, query),
  );
  defineRoute(app, { method: 'get', path: '/api/v1/library/shelves', access: 'session', summary: 'Shelves in use and the suggestion for a Dewey class', query: library.ShelvesQuery }, async ({ ctx, query }) =>
    library.listShelves(ctx, query),
  );
  defineRoute(app, { method: 'post', path: '/api/v1/library/titles', access: 'library.manage', summary: 'Add a title', status: 201, body: library.TitleSchema }, async ({ ctx, body }) => library.createTitle(ctx, body));
  defineRoute(app, { method: 'get', path: '/api/v1/library/titles/:id', access: 'session', summary: 'Title with copies and reservations', params: IdParams }, async ({ ctx, params }) => library.getTitle(ctx, params.id));
  defineRoute(app, { method: 'patch', path: '/api/v1/library/titles/:id', access: 'library.manage', summary: 'Edit a title', params: IdParams, body: library.TitleSchema }, async ({ ctx, params, body }) =>
    library.updateTitle(ctx, params.id, body),
  );
  defineRoute(
    app,
    { method: 'post', path: '/api/v1/library/titles/:id/copies', access: 'library.manage', summary: 'Add copies (purchase, donation or from the shop)', status: 201, params: IdParams, body: library.AddCopiesSchema },
    async ({ ctx, params, body }) => library.addCopies(ctx, params.id, body),
  );
  defineRoute(app, { method: 'patch', path: '/api/v1/library/copies/:id', access: 'library.manage', summary: 'Edit a copy', params: IdParams, body: library.UpdateCopySchema }, async ({ ctx, params, body }) =>
    library.updateCopy(ctx, params.id, body),
  );
  defineRoute(app, { method: 'post', path: '/api/v1/library/copies/:id/found', access: 'library.lend', summary: 'A lost copy was found', params: IdParams }, async ({ ctx, params }) => library.markFound(ctx, params.id));
  defineRoute(
    app,
    { method: 'get', path: '/api/v1/library/labels', access: 'session', summary: 'Book labels to print', query: z.object({ copyIds: z.string().transform((s) => s.split(',').filter(Boolean)).pipe(z.array(z.uuid()).max(500)) }) },
    async ({ ctx, query }) => library.labels(ctx, query.copyIds),
  );
  defineRoute(
    app,
    { method: 'get', path: '/api/v1/library/copies', access: 'library.lend', summary: 'Copies matching a code or title', query: library.CopiesQuery },
    async ({ ctx, query }) => library.searchCopies(ctx, query),
  );
  defineRoute(
    app,
    { method: 'get', path: '/api/v1/library/copies/by-barcode/:barcode', access: 'library.lend', summary: 'One copy by its exact barcode', params: z.object({ barcode: z.string().trim().min(1).max(40) }) },
    async ({ ctx, params }) => library.copyByBarcode(ctx, params.barcode),
  );
  // --- Library counts (FR-LIB-04), as stock counts ------------------------------------------
  defineRoute(app, { method: 'get', path: '/api/v1/library/counts', access: 'library.count', summary: 'Library counts with progress', query: counts.LibCountsQuery }, async ({ ctx, query }) => ({
    items: await counts.listCounts(ctx, query),
  }));
  defineRoute(app, { method: 'get', path: '/api/v1/library/counts/shelves', access: 'library.count', summary: 'Shelves and categories for the count scope' }, async ({ ctx }) => counts.scopeOptions(ctx));
  defineRoute(app, { method: 'post', path: '/api/v1/library/counts', access: 'library.count', summary: 'Start a library count', status: 201, body: counts.CreateLibCountSchema }, async ({ ctx, body }) =>
    counts.createCount(ctx, body),
  );
  defineRoute(app, { method: 'get', path: '/api/v1/library/counts/:id', access: 'library.count', summary: 'Count with lines and variance summary', params: IdParams }, async ({ ctx, params }) => counts.getCount(ctx, params.id));
  defineRoute(app, { method: 'post', path: '/api/v1/library/counts/:id/scan', access: 'library.count', summary: 'A scanned copy is found', params: IdParams, body: counts.ScanSchema }, async ({ ctx, params, body }) =>
    counts.scan(ctx, params.id, body),
  );
  defineRoute(
    app,
    { method: 'get', path: '/api/v1/library/counts/:id/sheet', access: 'library.count', summary: 'Download the count sheet (XLSX or CSV)', params: IdParams, query: z.object({ format: z.enum(['xlsx', 'csv']).default('xlsx') }) },
    async ({ ctx, params, query, c }) => {
      const f = await counts.countSheet(ctx, params.id, query.format);
      return c.body(f.bytes as never, 200, { 'Content-Type': f.mime, 'Content-Disposition': `attachment; filename="${f.filename}"` });
    },
  );
  defineRoute(app, { method: 'post', path: '/api/v1/library/counts/:id/sheet', access: 'library.count', summary: 'Upload a filled count sheet (raw XLSX/CSV body)', params: IdParams }, async ({ ctx, params, c }) => {
    const mime = (c.req.header('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (!bytes.length) throw new AppError(400, 'empty_file', 'Chưa chọn tệp.');
    return counts.uploadCountSheet(ctx, params.id, { bytes, mime });
  });
  defineRoute(app, { method: 'post', path: '/api/v1/library/counts/:id/submit', access: 'library.count', summary: 'Submit for approval', status: 204, params: IdParams }, async ({ ctx, params }) => {
    await counts.submitCount(ctx, params.id);
  });
  defineRoute(app, { method: 'post', path: '/api/v1/library/counts/:id/cancel', access: 'library.count', summary: 'Cancel until approved', status: 204, params: IdParams }, async ({ ctx, params }) => {
    await counts.cancelCount(ctx, params.id);
  });
  defineRoute(app, { method: 'post', path: '/api/v1/library/counts/:id/approve', access: 'library.count_approve', summary: 'Approve: closes the variance report', params: IdParams }, async ({ ctx, params }) =>
    counts.approveCount(ctx, params.id),
  );

  // --- Borrowers, loans and charges (FR-LIB-05..15) -------------------------------------------
  defineRoute(app, { method: 'get', path: '/api/v1/library/overview', access: 'session', summary: 'Library overview now (FR-LIB-15a)' }, async ({ ctx }) => library.overview(ctx));
  defineRoute(app, { method: 'get', path: '/api/v1/library/new-borrower', access: 'session', summary: 'Borrow terms for a customer not created yet (Khách mới)' }, async ({ ctx }) => library.newBorrowerTerms(ctx));
  defineRoute(app, { method: 'get', path: '/api/v1/library/borrowers/:id', access: 'session', summary: 'Eligibility, fee, loans, charges and history of a customer', params: IdParams }, async ({ ctx, params }) =>
    library.borrower(ctx, params.id),
  );
  defineRoute(app, { method: 'get', path: '/api/v1/library/slips', access: 'library.lend', summary: 'Loan slips with copies, amount and due date', query: library.SlipsQuery }, async ({ ctx, query }) =>
    library.listSlips(ctx, query),
  );
  defineRoute(app, { method: 'get', path: '/api/v1/library/slips/:id', access: 'library.lend', summary: 'One loan slip: copies, receipts, owed charges', params: IdParams }, async ({ ctx, params }) =>
    library.getSlip(ctx, params.id),
  );
  defineRoute(app, { method: 'get', path: '/api/v1/library/loans', access: 'library.lend', summary: 'Open, due-soon, overdue loans and held copies', query: library.LoansQuery }, async ({ ctx, query }) =>
    library.listLoans(ctx, query),
  );
  defineRoute(app, { method: 'post', path: '/api/v1/library/loans/checkout', access: 'library.lend', summary: 'Lend copies to a customer', status: 201, body: library.CheckoutSchema }, async ({ ctx, body }) =>
    library.checkout(ctx, body),
  );
  defineRoute(app, { method: 'post', path: '/api/v1/library/loans/checkin', access: 'library.lend', summary: 'Return a copy', body: library.CheckinSchema }, async ({ ctx, body }) => library.checkin(ctx, body));
  defineRoute(app, { method: 'post', path: '/api/v1/library/loans/:id/renew', access: 'library.lend', summary: 'Renew for another loan period, fee taken at the desk', params: IdParams, body: library.RenewSchema }, async ({ ctx, params, body }) =>
    library.renew(ctx, params.id, body),
  );
  defineRoute(app, { method: 'post', path: '/api/v1/library/loans/:id/mark-lost', access: 'library.lend', summary: 'The borrower lost the copy', params: IdParams }, async ({ ctx, params }) => library.markLost(ctx, params.id));
  defineRoute(app, { method: 'post', path: '/api/v1/library/charges/:id/waive', access: 'library.fine_waive', summary: 'Waive a charge with a reason', params: IdParams, body: library.WaiveSchema }, async ({ ctx, params, body }) =>
    library.waiveCharge(ctx, params.id, body),
  );
  // --- Library cash book (FR-LIB-09a): fees taken at the desk, never through the POS --------
  defineRoute(app, { method: 'post', path: '/api/v1/library/charges/pay', access: 'library.lend', summary: 'Collect owed charges at the desk', status: 201, body: library.PayChargesSchema }, async ({ ctx, body }) =>
    library.payCharges(ctx, body),
  );
  defineRoute(app, { method: 'get', path: '/api/v1/library/payments', access: 'library.lend', summary: 'Library cash book with totals by method', query: library.PaymentsQuery }, async ({ ctx, query }) =>
    library.listPayments(ctx, query),
  );
  defineRoute(app, { method: 'post', path: '/api/v1/library/payments/:id/refund', access: 'library.fine_waive', summary: 'Refund a receipt; its charges are owed again', status: 201, params: IdParams, body: library.RefundSchema }, async ({ ctx, params, body }) =>
    library.refundPayment(ctx, params.id, body),
  );
  defineRoute(app, { method: 'post', path: '/api/v1/library/reservations', access: 'library.lend', summary: 'Reserve a title that is fully on loan', status: 201, body: library.ReserveSchema }, async ({ ctx, body }) =>
    library.reserve(ctx, body),
  );
  defineRoute(app, { method: 'post', path: '/api/v1/library/reservations/:id/cancel', access: 'library.lend', summary: 'Cancel a reservation or hold', params: IdParams }, async ({ ctx, params }) =>
    library.cancelReservation(ctx, params.id),
  );
  defineRoute(app, { method: 'get', path: '/api/v1/reports/library', access: 'report.view', summary: 'Library report (FR-LIB-16)', query: library.ReportSchema }, async ({ ctx, query }) => library.report(ctx, query));
}
