import { createDb } from '@bookstore/db';
import { LocalDiskStorage } from '@bookstore/modules/files';
import { createFieldCrypto, systemClock } from '@bookstore/modules/platform';
import { serve } from '@hono/node-server';
import pino from 'pino';
import { createApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const log = pino({
  level: config.LOG_LEVEL,
  // Log redaction of tokens, passwords and secrets (TDD §10.1, §11.5).
  redact: ['req.headers.cookie', 'password', 'pin', 'token', '*.password', '*.pin'],
});
const { db } = createDb(config.DATABASE_URL, { max: config.DATABASE_POOL_MAX });
const app = createApp({ db, clock: systemClock, crypto: createFieldCrypto(config.FIELD_ENCRYPTION_KEY), storage: new LocalDiskStorage(config.STORAGE_DIR), config, log });

serve({ fetch: app.fetch, port: config.PORT }, (info) => log.info({ port: info.port }, 'api listening'));
