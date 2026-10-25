import { date, integer, pgSchema, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { vndCol } from './_common.js';

/** Read models (TDD §4.11), refreshed by the `report.refresh` job. */
export const reports = pgSchema('reports');

export const itemSalesDaily = reports.table(
  'item_sales_daily',
  {
    day: date({ mode: 'string' }).notNull(),
    itemId: uuid().notNull(),
    categoryId: uuid(),
    units: integer().notNull(),
    revenueVnd: vndCol().notNull(),
  },
  (t) => [primaryKey({ columns: [t.day, t.itemId] })],
);

export const cashierSalesMonthly = reports.table(
  'cashier_sales_monthly',
  {
    month: text().notNull(),
    cashierId: uuid().notNull(),
    netSalesVnd: vndCol().notNull(),
  },
  (t) => [primaryKey({ columns: [t.month, t.cashierId] })],
);
