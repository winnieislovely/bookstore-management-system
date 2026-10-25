import type { Db } from '@bookstore/db';
import type { Clock, Ctx, FieldCrypto } from '@bookstore/modules/platform';
import type { Logger } from 'pino';
import type { Config } from '../config.js';

/** Process-wide dependencies handed to `createApp` (tests inject a fake clock and a test database). */
export interface Deps {
  db: Db;
  clock: Clock;
  crypto: FieldCrypto;
  config: Config;
  log: Logger;
}

export interface SessionState {
  locked: boolean;
  mustChangePassword: boolean;
}

export type AppEnv = {
  Variables: {
    ctx: Ctx;
    requestId: string;
    session: SessionState | null;
  };
};

/** Name of the staff session cookie (TDD §6.1: `__Host-` prefix, SameSite=Strict). */
export const SESSION_COOKIE = '__Host-bms_sid';
/** Custom header required on state-changing staff requests (CSRF control, TDD §10.1). */
export const CSRF_HEADER = 'x-bms-request';
