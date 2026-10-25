import { z } from 'zod';

/** Runtime configuration from the environment (TDD §12.3). Business parameters live in settings. */
const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().default('postgres://bookstore:bookstore@127.0.0.1:5432/bookstore'),
  DATABASE_POOL_MAX: z.coerce.number().int().default(10),
  /** Origin of the staff app, checked on state-changing requests (CSRF, TDD §10.1). */
  APP_ORIGIN: z.string().default('http://localhost:5173'),
  /** 32 bytes, base64 – column encryption for secrets (TDD §10.4). */
  FIELD_ENCRYPTION_KEY: z.string().min(40),
  /** `__Host-` cookies need Secure; browsers accept Secure cookies on http://localhost. */
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  LOG_LEVEL: z.string().default('info'),
  /** Local-disk file storage for development; production uses S3-compatible storage (TDD §4.12). */
  STORAGE_DIR: z.string().default('./data/files'),
});
export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  return parsed.data;
}
