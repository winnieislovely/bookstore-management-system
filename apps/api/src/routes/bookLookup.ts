import * as lookup from '@bookstore/modules/catalog/lookup';
import type { StorageAdapter } from '@bookstore/modules/files';
import type { BookLookupAdapter } from '@bookstore/modules/integrations/openlibrary';
import type { OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '../http/context.js';
import { defineRoute } from '../http/route.js';

/** Book lookup in Open Library for the new-product form (FR-CAT-16, TDD §8.8). */
export function bookLookupRoutes(app: OpenAPIHono<AppEnv>, adapter: BookLookupAdapter, storage: StorageAdapter): void {
  defineRoute(
    app,
    { method: 'get', path: '/api/v1/catalog/book-lookup', access: 'catalog.edit', summary: 'Look a book up by title or ISBN', query: lookup.BookLookupQuery },
    async ({ ctx, query }) => lookup.lookupBooks(ctx, adapter, query),
  );
  defineRoute(
    app,
    { method: 'get', path: '/api/v1/catalog/book-lookup/description', access: 'catalog.edit', summary: 'Description of a looked-up work', query: lookup.BookDescriptionQuery },
    async ({ ctx, query }) => lookup.bookDescription(ctx, adapter, query),
  );
  defineRoute(
    app,
    { method: 'post', path: '/api/v1/catalog/book-lookup/cover', access: 'catalog.edit', summary: 'Store a looked-up cover as an image file', status: 201, body: lookup.BookCoverSchema },
    async ({ ctx, body }) => lookup.importCover(ctx, adapter, storage, body),
  );
  // The same lookup for library titles, with Dewey and language (FR-LIB-02a).
  defineRoute(
    app,
    { method: 'get', path: '/api/v1/library/book-lookup', access: 'library.manage', summary: 'Look a library book up by title or ISBN', query: lookup.BookLookupQuery },
    async ({ ctx, query }) => lookup.lookupBooks(ctx, adapter, query, 'library.manage'),
  );
  defineRoute(
    app,
    { method: 'get', path: '/api/v1/library/book-lookup/description', access: 'library.manage', summary: 'Description of a looked-up work (library)', query: lookup.BookDescriptionQuery },
    async ({ ctx, query }) => lookup.bookDescription(ctx, adapter, query, 'library.manage'),
  );
}
