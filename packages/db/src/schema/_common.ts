import { sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { bigint, integer, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Column conventions (TDD §5.1): UUIDv7 keys, money as bigint `*_vnd` (mapped to JS numbers;
 * amounts stay far below 2^53), timestamptz in UTC, `version` for optimistic concurrency.
 * Column names are snake_case through Drizzle's `casing` option.
 */
export const id = () => uuid().primaryKey().default(sql`uuidv7()`);
export const vndCol = () => bigint({ mode: 'number' });
export const ts = () => timestamp({ withTimezone: true, mode: 'date' });
export const createdAt = () => ts().notNull().defaultNow();
export const updatedAt = () => ts().notNull().defaultNow();
export const version = () => integer().notNull().default(1);

/** `CHECK (col IN (...))` generated from the same constant as the TypeScript type (TDD §5.1). */
export function inList(column: AnyColumn | SQL, values: readonly string[]): SQL {
  return sql`${column} in (${sql.join(
    values.map((v) => sql.raw(`'${v.replace(/'/g, "''")}'`)),
    sql`, `,
  )})`;
}

/** Bilingual website text (FR-WEB-22): English required, Vietnamese optional. */
export type I18n<T> = { en: T; vi?: T };
