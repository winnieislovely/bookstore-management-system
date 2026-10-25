import { createDb, runMigrations, type Db } from '@bookstore/db';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type postgres from 'postgres';

/**
 * Integration-test database (TDD §13.1): a throw-away PostgreSQL 18 container with all migrations
 * applied. One container per test file; tests isolate themselves with their own rows.
 */
export interface TestDb {
  db: Db;
  sql: postgres.Sql;
  url: string;
  stop: () => Promise<void>;
}

export async function startTestDb(): Promise<TestDb> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer('postgres:18').start();
  const url = container.getConnectionUri();
  await runMigrations(url);
  const { db, client } = createDb(url, { max: 12 });
  return {
    db,
    sql: client,
    url,
    stop: async () => {
      await client.end();
      await container.stop();
    },
  };
}

/** Injectable clock (TDD §13.3) so time-based rules are testable without waiting. */
export class FakeClock {
  constructor(private current: Date = new Date('2026-10-25T03:00:00Z')) {}
  now(): Date {
    return new Date(this.current.getTime());
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
  set(at: Date): void {
    this.current = new Date(at.getTime());
  }
}
