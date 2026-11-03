import * as library from '@bookstore/modules/library';
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
  defineRoute(
    app,
    { method: 'get', path: '/api/v1/library/titles/next-code', access: 'library.manage', summary: 'Next free library code for a language', query: z.object({ lang: z.enum(['vi', 'en']) }) },
    async ({ ctx, query }) => library.nextCode(ctx, query.lang),
  );
  defineRoute(app, { method: 'post', path: '/api/v1/library/titles', access: 'library.manage', summary: 'Add a title', status: 201, body: library.TitleSchema }, async ({ ctx, body }) => library.createTitle(ctx, body));
  defineRoute(app, { method: 'get', path: '/api/v1/library/titles/:id', access: 'session', summary: 'Title with copies and reservations', params: IdParams }, async ({ ctx, params }) => library.getTitle(ctx, params.id));
  defineRoute(app, { method: 'patch', path: '/api/v1/library/titles/:id', access: 'library.manage', summary: 'Edit a title', params: IdParams, body: library.TitleSchema }, async ({ ctx, params, body }) =>
    library.updateTitle(ctx, params.id, body),
  );
  defineRoute(
    app,
    { method: 'post', path: '/api/v1/library/titles/:id/copies', access: 'library.manage', summary: 'Add copies (purchase or donation)', status: 201, params: IdParams, body: library.AddCopiesSchema },
    async ({ ctx, params, body }) => library.addCopies(ctx, params.id, body),
  );
  defineRoute(
    app,
    { method: 'post', path: '/api/v1/library/titles/:id/transfer-from-stock', access: 'library.manage', summary: 'Move retail stock into the collection', status: 201, params: IdParams, body: library.TransferSchema },
    async ({ ctx, params, body }) => library.transferFromStock(ctx, params.id, body),
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
  defineRoute(app, { method: 'post', path: '/api/v1/library/stocktake', access: 'library.manage', summary: 'Compare scanned copies with the records', body: library.StocktakeSchema }, async ({ ctx, body }) =>
    library.stocktake(ctx, body),
  );

  // --- Borrowers, loans and charges (FR-LIB-05..15) -------------------------------------------
  defineRoute(app, { method: 'get', path: '/api/v1/library/borrowers/:id', access: 'session', summary: 'Eligibility, fee, loans, charges and history of a customer', params: IdParams }, async ({ ctx, params }) =>
    library.borrower(ctx, params.id),
  );
  defineRoute(app, { method: 'get', path: '/api/v1/library/loans', access: 'library.lend', summary: 'Open, due-soon, overdue loans and held copies', query: library.LoansQuery }, async ({ ctx, query }) =>
    library.listLoans(ctx, query),
  );
  defineRoute(app, { method: 'post', path: '/api/v1/library/loans/checkout', access: 'library.lend', summary: 'Lend copies to a customer', status: 201, body: library.CheckoutSchema }, async ({ ctx, body }) =>
    library.checkout(ctx, body),
  );
  defineRoute(app, { method: 'post', path: '/api/v1/library/loans/checkin', access: 'library.lend', summary: 'Return a copy', body: library.CheckinSchema }, async ({ ctx, body }) => library.checkin(ctx, body));
  defineRoute(app, { method: 'post', path: '/api/v1/library/loans/:id/renew', access: 'library.lend', summary: 'Renew for another loan period', params: IdParams }, async ({ ctx, params }) => library.renew(ctx, params.id));
  defineRoute(app, { method: 'post', path: '/api/v1/library/loans/:id/mark-lost', access: 'library.lend', summary: 'The borrower lost the copy', params: IdParams }, async ({ ctx, params }) => library.markLost(ctx, params.id));
  defineRoute(app, { method: 'post', path: '/api/v1/library/charges/:id/waive', access: 'library.fine_waive', summary: 'Waive a charge with a reason', params: IdParams, body: library.WaiveSchema }, async ({ ctx, params, body }) =>
    library.waiveCharge(ctx, params.id, body),
  );
  defineRoute(
    app,
    { method: 'get', path: '/api/v1/customers/:id/library-charges', access: 'session', summary: 'Unpaid library charges, offered as POS service lines', params: IdParams },
    async ({ ctx, params }) => library.unpaidCharges(ctx, params.id),
  );
  defineRoute(app, { method: 'post', path: '/api/v1/library/reservations', access: 'library.lend', summary: 'Reserve a title that is fully on loan', status: 201, body: library.ReserveSchema }, async ({ ctx, body }) =>
    library.reserve(ctx, body),
  );
  defineRoute(app, { method: 'post', path: '/api/v1/library/reservations/:id/cancel', access: 'library.lend', summary: 'Cancel a reservation or hold', params: IdParams }, async ({ ctx, params }) =>
    library.cancelReservation(ctx, params.id),
  );
  defineRoute(app, { method: 'get', path: '/api/v1/reports/library', access: 'report.view', summary: 'Library report (FR-LIB-16)', query: library.ReportSchema }, async ({ ctx, query }) => library.report(ctx, query));
}
