import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export * as schema from './schema/index.js';
export { runMigrations } from './migrate.js';

export type Db = PostgresJsDatabase<typeof schema>;
/** A transaction or the database; services take this so one transaction can span modules (TDD §3.1). */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0] | Db;

export function createDb(url: string, opts: { max?: number } = {}): { db: Db; client: postgres.Sql } {
  const client = postgres(url, { max: opts.max ?? 10, onnotice: () => {} });
  return { db: drizzle(client, { schema, casing: 'snake_case' }), client };
}
