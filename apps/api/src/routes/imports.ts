import * as catalog from '@bookstore/modules/catalog';
import * as files from '@bookstore/modules/files';
import * as imports from '@bookstore/modules/imports';
import { AppError } from '@bookstore/modules/platform';
import type { OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { z } from 'zod';
import type { AppEnv, Deps } from '../http/context.js';
import { defineRoute, IdParams } from '../http/route.js';

/** File upload, product photos and the staged importer (TDD §4.12, §6.2). */

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function download(c: Context<AppEnv>, bytes: Uint8Array, filename: string, mime = XLSX): Response {
  return c.body(bytes as never, 200, {
    'Content-Type': mime,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
  });
}

async function rawUpload(c: Context<AppEnv>): Promise<{ bytes: Uint8Array; mime: string }> {
  const mime = (c.req.header('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (!bytes.length) throw new AppError(400, 'empty_file', 'Chưa chọn tệp.');
  return { bytes, mime };
}

const KindParams = z.object({ kind: z.enum(imports.IMPORT_KINDS) });

export function importRoutes(app: OpenAPIHono<AppEnv>, deps: Deps): void {
  // --- Files ----------------------------------------------------------------------------------
  defineRoute(
    app,
    {
      method: 'post',
      path: '/api/v1/files',
      access: 'session',
      summary: 'Upload an image or import file (raw body, Content-Type = file type)',
      status: 201,
      query: z.object({ purpose: z.enum(['image', 'import']).default('image') }),
    },
    async ({ ctx, query, c }) => files.upload(ctx, deps.storage, { ...(await rawUpload(c)), purpose: query.purpose }),
  );
  defineRoute(app, { method: 'get', path: '/api/v1/files/:id', access: 'session', summary: 'Read a file', params: IdParams }, async ({ ctx, params, c }) => {
    const f = await files.read(ctx, deps.storage, params.id);
    return c.body(f.bytes as never, 200, { 'Content-Type': f.mime, 'Cache-Control': 'private, max-age=3600' });
  });

  // --- Product photos -------------------------------------------------------------------------
  defineRoute(
    app,
    { method: 'post', path: '/api/v1/catalog/items/:id/images', access: 'catalog.edit', summary: 'Add a product photo', status: 201, params: IdParams, body: catalog.ImageSchema },
    async ({ ctx, params, body }) => catalog.addImage(ctx, params.id, body),
  );
  defineRoute(
    app,
    {
      method: 'delete',
      path: '/api/v1/catalog/items/:id/images/:imageId',
      access: 'catalog.edit',
      summary: 'Remove a product photo',
      status: 204,
      params: z.object({ id: z.uuid(), imageId: z.uuid() }),
    },
    async ({ ctx, params }) => {
      await catalog.removeImage(ctx, params.id, params.imageId);
    },
  );

  // --- Imports (permission per kind is checked by the module) ---------------------------------
  defineRoute(app, { method: 'get', path: '/api/v1/admin/import/:kind/template', access: 'session', summary: 'Download the import template', params: KindParams }, async ({ ctx, params, c }) =>
    download(c, await imports.template(ctx, params.kind), `mau-nhap-${params.kind}.xlsx`),
  );
  defineRoute(
    app,
    {
      method: 'post',
      path: '/api/v1/admin/import/:kind/preview',
      access: 'session',
      summary: 'Upload a file (raw XLSX/CSV body): map, validate and preview',
      status: 201,
      params: KindParams,
      query: z.object({ mapping: z.string().optional() }),
    },
    async ({ ctx, params, query, c }) => {
      const file = await rawUpload(c);
      if (file.mime !== XLSX && file.mime !== 'text/csv') throw new AppError(415, 'unsupported_file_type', 'Chỉ nhận tệp Excel (.xlsx) hoặc CSV.');
      let mapping: Record<string, string> | undefined;
      if (query.mapping) {
        const parsed = z.record(z.string(), z.string()).safeParse(JSON.parse(query.mapping));
        if (!parsed.success) throw new AppError(400, 'invalid_mapping', 'Cấu hình ghép cột không hợp lệ.');
        mapping = parsed.data;
      }
      return imports.preview(ctx, params.kind, file, mapping);
    },
  );
  defineRoute(app, { method: 'get', path: '/api/v1/admin/import/jobs/:id', access: 'session', summary: 'Import job and summary', params: IdParams }, async ({ ctx, params }) =>
    imports.getJob(ctx, params.id),
  );
  defineRoute(app, { method: 'get', path: '/api/v1/admin/import/jobs/:id/errors', access: 'session', summary: 'Download the error report', params: IdParams }, async ({ ctx, params, c }) =>
    download(c, await imports.errorReport(ctx, params.id), `bao-cao-loi-${params.id.slice(0, 8)}.xlsx`),
  );
  defineRoute(app, { method: 'post', path: '/api/v1/admin/import/jobs/:id/commit', access: 'session', summary: 'Commit a validated import (all rows or none)', params: IdParams }, async ({ ctx, params }) =>
    imports.commit(ctx, params.id),
  );
}
