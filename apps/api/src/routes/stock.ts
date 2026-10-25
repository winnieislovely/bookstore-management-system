import * as catalog from '@bookstore/modules/catalog';
import * as inventory from '@bookstore/modules/inventory';
import * as purchasing from '@bookstore/modules/purchasing';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { z } from 'zod';
import type { AppEnv } from '../http/context.js';
import { defineRoute, IdParams } from '../http/route.js';

/** Catalogue, inventory and purchasing routes (TDD §6.2). */
export function stockRoutes(app: OpenAPIHono<AppEnv>): void {
  // --- Catalogue ------------------------------------------------------------------------------
  defineRoute(app, { method: 'get', path: '/api/v1/catalog/items', access: 'catalog.view', summary: 'Search and filter items', query: catalog.ListQuery }, async ({ ctx, query }) =>
    catalog.listItems(ctx, query),
  );
  defineRoute(app, { method: 'post', path: '/api/v1/catalog/items', access: 'catalog.edit', summary: 'Create an item with its variants', status: 201, body: catalog.ItemSchema }, async ({ ctx, body }) =>
    catalog.createItem(ctx, body),
  );
  defineRoute(app, { method: 'get', path: '/api/v1/catalog/items/:id', access: 'catalog.view', summary: 'Product detail', params: IdParams }, async ({ ctx, params }) =>
    catalog.getItem(ctx, params.id),
  );
  defineRoute(
    app,
    { method: 'patch', path: '/api/v1/catalog/items/:id', access: 'catalog.edit', summary: 'Update an item (version check)', params: IdParams, body: catalog.ItemUpdateSchema },
    async ({ ctx, params, body }) => catalog.updateItem(ctx, params.id, body),
  );
  defineRoute(
    app,
    { method: 'post', path: '/api/v1/catalog/items/:id/variants', access: 'catalog.edit', summary: 'Add a variant', status: 201, params: IdParams, body: catalog.VariantSchema },
    async ({ ctx, params, body }) => catalog.addVariant(ctx, params.id, body),
  );
  defineRoute(
    app,
    { method: 'patch', path: '/api/v1/catalog/variants/:id', access: 'catalog.edit', summary: 'Update a variant', params: IdParams, body: catalog.VariantUpdateSchema },
    async ({ ctx, params, body }) => catalog.updateVariant(ctx, params.id, body),
  );
  defineRoute(
    app,
    { method: 'put', path: '/api/v1/catalog/variants/:id/price', access: 'catalog.edit', summary: 'Change price/VAT', status: 204, params: IdParams, body: catalog.PriceChangeSchema },
    async ({ ctx, params, body }) => {
      await catalog.setPrice(ctx, params.id, body);
    },
  );
  defineRoute(
    app,
    { method: 'get', path: '/api/v1/catalog/variants/:id/price-history', access: 'catalog.view', summary: 'Price history', params: IdParams },
    async ({ ctx, params }) => ({ items: await catalog.priceHistory(ctx, params.id) }),
  );
  defineRoute(
    app,
    { method: 'get', path: '/api/v1/catalog/lookup', access: 'catalog.view', summary: 'Lookup by barcode, SKU or ISBN', query: z.object({ code: z.string().min(1) }) },
    async ({ ctx, query }) => catalog.lookupCode(ctx, query.code),
  );
  defineRoute(app, { method: 'get', path: '/api/v1/catalog/categories', access: 'catalog.view', summary: 'Category tree' }, async ({ ctx }) => ({
    items: await catalog.listCategories(ctx),
  }));
  defineRoute(app, { method: 'post', path: '/api/v1/catalog/categories', access: 'catalog.edit', summary: 'Create a category', status: 201, body: catalog.CategorySchema }, async ({ ctx, body }) =>
    catalog.createCategory(ctx, body),
  );
  defineRoute(app, { method: 'get', path: '/api/v1/catalog/publishers', access: 'catalog.view', summary: 'Publishers' }, async ({ ctx }) => ({
    items: await catalog.listPublishers(ctx),
  }));
  defineRoute(app, { method: 'post', path: '/api/v1/catalog/publishers', access: 'catalog.edit', summary: 'Create a publisher', status: 201, body: catalog.NamedSchema }, async ({ ctx, body }) =>
    catalog.createPublisher(ctx, body),
  );
  defineRoute(app, { method: 'get', path: '/api/v1/catalog/brands', access: 'catalog.view', summary: 'Brands' }, async ({ ctx }) => ({ items: await catalog.listBrands(ctx) }));
  defineRoute(app, { method: 'post', path: '/api/v1/catalog/brands', access: 'catalog.edit', summary: 'Create a brand', status: 201, body: catalog.NamedSchema }, async ({ ctx, body }) =>
    catalog.createBrand(ctx, body),
  );

  // --- Inventory ------------------------------------------------------------------------------
  defineRoute(
    app,
    { method: 'get', path: '/api/v1/inventory/levels', access: 'inventory.view', summary: 'On hand, reserved, available', query: z.object({ variant: z.union([z.uuid(), z.array(z.uuid())]) }) },
    async ({ ctx, query }) => ({ items: await inventory.levels(ctx, Array.isArray(query.variant) ? query.variant : [query.variant]) }),
  );
  defineRoute(app, { method: 'get', path: '/api/v1/inventory/movements', access: 'inventory.view', summary: 'Stock ledger, keyset paged', query: inventory.MovementQuery }, async ({ ctx, query }) =>
    inventory.movements(ctx, query),
  );
  defineRoute(app, { method: 'get', path: '/api/v1/inventory/low-stock', access: 'inventory.view', summary: 'Items below minimum level' }, async ({ ctx }) => ({
    items: await inventory.lowStock(ctx),
  }));
  defineRoute(app, { method: 'get', path: '/api/v1/inventory/valuation', access: 'catalog.view_cost', summary: 'Stock valuation' }, async ({ ctx }) => inventory.valuation(ctx));
  defineRoute(
    app,
    { method: 'post', path: '/api/v1/inventory/adjustments', access: 'inventory.adjust', summary: 'Adjustment with reason; approval over threshold', status: 201, body: inventory.AdjustmentSchema },
    async ({ ctx, body }) => inventory.adjust(ctx, body),
  );
  defineRoute(app, { method: 'get', path: '/api/v1/inventory/counts', access: 'inventory.count', summary: 'Stock counts', query: z.object({ status: z.string().optional() }) }, async ({ ctx, query }) => ({
    items: await inventory.listCounts(ctx, query.status),
  }));
  defineRoute(app, { method: 'post', path: '/api/v1/inventory/counts', access: 'inventory.count', summary: 'Start a stock count', status: 201, body: inventory.CreateCountSchema }, async ({ ctx, body }) =>
    inventory.createCount(ctx, body),
  );
  defineRoute(app, { method: 'get', path: '/api/v1/inventory/counts/:id', access: 'inventory.count', summary: 'Count with lines (blind for non-approvers)', params: IdParams }, async ({ ctx, params }) =>
    inventory.getCount(ctx, params.id),
  );
  defineRoute(
    app,
    { method: 'post', path: '/api/v1/inventory/counts/:id/lines', access: 'inventory.count', summary: 'Record a scan or a counted quantity', params: IdParams, body: inventory.CountLineSchema },
    async ({ ctx, params, body }) => inventory.recordCount(ctx, params.id, body),
  );
  defineRoute(app, { method: 'post', path: '/api/v1/inventory/counts/:id/submit', access: 'inventory.count', summary: 'Submit a count for approval', status: 204, params: IdParams }, async ({ ctx, params }) => {
    await inventory.submitCount(ctx, params.id);
  });
  defineRoute(app, { method: 'post', path: '/api/v1/inventory/counts/:id/approve', access: 'inventory.count_approve', summary: 'Approve and post variances', params: IdParams }, async ({ ctx, params }) =>
    inventory.approveCount(ctx, params.id),
  );

  // --- Purchasing -----------------------------------------------------------------------------
  const header = { supplierId: true, supplierInvoiceNo: true, invoiceFileId: true, note: true, consignment: true, consignmentDiscountBp: true, consignmentDeadline: true, payableVnd: true } as const;
  const Header = purchasing.StockInBaseSchema.pick(header);

  defineRoute(
    app,
    {
      method: 'post',
      path: '/api/v1/purchasing/stock-in/new-product',
      access: 'purchasing.manage',
      summary: 'Create a product and its first stock-in (FR-PUR-02)',
      status: 201,
      body: Header.extend({ line: purchasing.NewProductLineSchema.omit({ kind: true }) }),
    },
    async ({ ctx, body }) => {
      const { line, ...h } = body;
      return purchasing.postStockIn(ctx, { ...h, lines: [{ kind: 'new', ...line }] });
    },
  );
  defineRoute(
    app,
    {
      method: 'post',
      path: '/api/v1/purchasing/stock-in/existing',
      access: 'purchasing.manage',
      summary: 'Add quantity with cost and selling price (FR-PUR-03)',
      status: 201,
      body: Header.extend({ line: purchasing.ExistingLineSchema.omit({ kind: true }) }),
    },
    async ({ ctx, body }) => {
      const { line, ...h } = body;
      return purchasing.postStockIn(ctx, { ...h, lines: [{ kind: 'existing', ...line }] });
    },
  );
  defineRoute(
    app,
    { method: 'post', path: '/api/v1/purchasing/stock-in', access: 'purchasing.manage', summary: 'Stock-in entry with several lines', status: 201, body: purchasing.StockInSchema },
    async ({ ctx, body }) => purchasing.postStockIn(ctx, body),
  );
  defineRoute(app, { method: 'get', path: '/api/v1/purchasing/stock-in', access: 'purchasing.manage', summary: 'List stock-in entries', query: purchasing.StockInQuery }, async ({ ctx, query }) =>
    purchasing.listStockIns(ctx, query),
  );
  defineRoute(app, { method: 'get', path: '/api/v1/purchasing/suppliers', access: 'purchasing.manage', summary: 'Suppliers' }, async ({ ctx }) => ({
    items: await purchasing.listSuppliers(ctx),
  }));
  defineRoute(app, { method: 'patch', path: '/api/v1/purchasing/suppliers/:id', access: 'purchasing.manage', summary: 'Edit a supplier', params: IdParams, body: purchasing.SupplierUpdateSchema }, async ({ ctx, params, body }) =>
    purchasing.updateSupplier(ctx, params.id, body),
  );
  defineRoute(app, { method: 'post', path: '/api/v1/purchasing/suppliers', access: 'purchasing.manage', summary: 'Create a supplier', status: 201, body: purchasing.SupplierSchema }, async ({ ctx, body }) =>
    purchasing.createSupplier(ctx, body),
  );
  defineRoute(
    app,
    { method: 'get', path: '/api/v1/purchasing/payables', access: 'purchasing.payables', summary: 'Payables with ageing', query: z.object({ supplier: z.uuid().optional() }) },
    async ({ ctx, query }) => purchasing.listPayables(ctx, query.supplier),
  );
  defineRoute(
    app,
    { method: 'post', path: '/api/v1/purchasing/payables/:id/payments', access: 'purchasing.payables', summary: 'Record a payment', status: 201, params: IdParams, body: purchasing.PaymentSchema },
    async ({ ctx, params, body }) => purchasing.payPayable(ctx, params.id, body),
  );

  // --- Consignment ----------------------------------------------------------------------------
  defineRoute(
    app,
    { method: 'get', path: '/api/v1/purchasing/consignment/lots', access: 'purchasing.manage', summary: 'Consignment lots', query: z.object({ supplier: z.uuid().optional() }) },
    async ({ ctx, query }) => ({ items: await purchasing.listLots(ctx, query.supplier) }),
  );
  defineRoute(
    app,
    { method: 'post', path: '/api/v1/purchasing/consignment/statements', access: 'purchasing.payables', summary: 'Generate a monthly statement', status: 201, body: purchasing.StatementSchema },
    async ({ ctx, body }) => purchasing.generateStatement(ctx, body),
  );
  defineRoute(
    app,
    { method: 'get', path: '/api/v1/purchasing/consignment/statements', access: 'purchasing.payables', summary: 'Statements', query: z.object({ supplier: z.uuid().optional() }) },
    async ({ ctx, query }) => ({ items: await purchasing.listStatements(ctx, query.supplier) }),
  );
  defineRoute(app, { method: 'get', path: '/api/v1/purchasing/consignment/statements/:id', access: 'purchasing.payables', summary: 'Statement with lines', params: IdParams }, async ({ ctx, params }) =>
    purchasing.getStatement(ctx, params.id),
  );
  defineRoute(app, { method: 'post', path: '/api/v1/purchasing/consignment/statements/:id/approve', access: 'purchasing.payables', summary: 'Approve: creates the payable', params: IdParams }, async ({ ctx, params }) =>
    purchasing.approveStatement(ctx, params.id),
  );
  defineRoute(
    app,
    { method: 'post', path: '/api/v1/purchasing/consignment/returns', access: 'purchasing.manage', summary: 'Return unsold consignment stock', status: 201, body: purchasing.ConsignmentReturnSchema },
    async ({ ctx, body }) => purchasing.returnConsignment(ctx, body),
  );
}
