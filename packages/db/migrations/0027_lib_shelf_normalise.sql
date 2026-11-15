-- Shelves are stored in capitals with single spaces, so "a1 " and "A1" are one shelf (FR-LIB-02, 15 Nov 2026).
UPDATE "library"."lib_copy" SET "shelf" = NULLIF(upper(regexp_replace(btrim("shelf"), '\s+', ' ', 'g')), '') WHERE "shelf" IS NOT NULL;--> statement-breakpoint
UPDATE "library"."lib_count_line" SET "expected_shelf" = NULLIF(upper(regexp_replace(btrim("expected_shelf"), '\s+', ' ', 'g')), '') WHERE "expected_shelf" IS NOT NULL;
