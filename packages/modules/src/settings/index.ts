import { schema } from '@bookstore/db';
import {
  defaultSettings,
  isSecretSetting,
  maskSecret,
  SETTINGS,
  type SettingKey,
  type SettingsSnapshot,
} from '@bookstore/domain';
import { eq } from 'drizzle-orm';
import * as audit from '../audit/index.js';
import { AppError, requirePermission, type Ctx, type Tx } from '../platform/index.js';

/**
 * Settings registry service (FR-ADM-04, TDD §4.12, Appendix A). Values are validated by the Zod
 * schema of their key; secrets are encrypted at rest, write-only and masked in every response.
 */

const SCOPE = 'store';

/** Full typed snapshot for internal use by other modules (secrets decrypted). */
export async function snapshot(ctx: Pick<Ctx, 'db' | 'crypto'>, tx: Tx = ctx.db): Promise<SettingsSnapshot> {
  const out: Record<string, unknown> = defaultSettings();
  const rows = await tx.select().from(schema.setting).where(eq(schema.setting.scope, SCOPE));
  for (const row of rows) {
    if (!(row.key in SETTINGS)) continue;
    const key = row.key as SettingKey;
    out[key] = isSecretSetting(key) ? ctx.crypto.decrypt(row.value as string) : row.value;
  }
  return out as SettingsSnapshot;
}

/** Settings as shown in the Settings screen: secrets masked (`••••••••3f9a`). */
export async function list(ctx: Ctx) {
  requirePermission(ctx, 'settings.manage');
  const values = await snapshot(ctx);
  return (Object.keys(SETTINGS) as SettingKey[]).map((key) => {
    const secret = isSecretSetting(key);
    const value = values[key];
    return {
      key,
      secret,
      value: secret ? maskSecret(String(value)) : value,
      isSet: secret ? String(value) !== '' : true,
      default: secret ? null : SETTINGS[key].default,
    };
  });
}

export type SettingIssue = { key: string; message: string };

/** Validate and save several settings in one transaction; audited with secrets masked. */
export async function update(ctx: Ctx, changes: Record<string, unknown>, tx?: Tx): Promise<void> {
  requirePermission(ctx, 'settings.manage');
  await write(ctx, changes, tx);
}

/** Internal write used by `update` and by the first-run wizard (no permission check). */
export async function write(ctx: Ctx, changes: Record<string, unknown>, tx?: Tx): Promise<void> {
  const issues: SettingIssue[] = [];
  const parsed: { key: SettingKey; value: unknown }[] = [];
  for (const [key, value] of Object.entries(changes)) {
    if (!(key in SETTINGS)) {
      issues.push({ key, message: 'Cài đặt không tồn tại.' });
      continue;
    }
    const k = key as SettingKey;
    const result = SETTINGS[k].schema.safeParse(value);
    if (!result.success) issues.push({ key, message: result.error.issues[0]?.message ?? 'Giá trị không hợp lệ.' });
    else parsed.push({ key: k, value: result.data });
  }
  if (issues.length) {
    throw new AppError(400, 'invalid_settings', 'Một số cài đặt không hợp lệ. Hãy sửa các ô được đánh dấu rồi lưu lại.', issues);
  }

  const run = async (t: Tx) => {
    const before = await snapshot(ctx, t);
    for (const { key, value } of parsed) {
      const stored = isSecretSetting(key) ? ctx.crypto.encrypt(String(value)) : value;
      await t
        .insert(schema.setting)
        .values({ key, scope: SCOPE, value: stored, updatedBy: ctx.actor?.userId ?? null, updatedAt: ctx.clock.now() })
        .onConflictDoUpdate({
          target: [schema.setting.key, schema.setting.scope],
          set: { value: stored, updatedBy: ctx.actor?.userId ?? null, updatedAt: ctx.clock.now() },
        });
      const show = (v: unknown) => (isSecretSetting(key) ? maskSecret(String(v)) : v);
      await audit.record(t, ctx, {
        action: 'setting.update',
        entity: 'setting',
        entityId: key,
        before: { value: show(before[key]) },
        after: { value: show(value) },
      });
    }
  };
  if (tx) await run(tx);
  else await ctx.db.transaction(run);
}
