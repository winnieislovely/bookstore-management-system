ALTER TABLE "orders"."preorder" DROP CONSTRAINT "preorder_status_ck";--> statement-breakpoint
DROP INDEX "orders"."preorder_line_variant_uq";--> statement-breakpoint
ALTER TABLE "orders"."preorder" ALTER COLUMN "status" SET DEFAULT 'quote';--> statement-breakpoint
ALTER TABLE "orders"."preorder_line" ALTER COLUMN "variant_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "orders"."preorder_line" ALTER COLUMN "unit_price_vnd" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "orders"."preorder" ADD COLUMN "quoted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders"."preorder" ADD COLUMN "quoted_by" uuid;--> statement-breakpoint
ALTER TABLE "orders"."preorder" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders"."preorder" ADD COLUMN "extensions" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders"."preorder_line" ADD COLUMN "requested_title" text;--> statement-breakpoint
ALTER TABLE "orders"."preorder" ADD CONSTRAINT "preorder_quoted_by_app_user_id_fk" FOREIGN KEY ("quoted_by") REFERENCES "platform"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Pre-orders taken before quotes existed were priced and paid at once: they count as quoted and confirmed (FR-ORD-14).
UPDATE "orders"."preorder" SET "quoted_at" = "created_at", "confirmed_at" = "created_at" WHERE "status" <> 'cancelled';--> statement-breakpoint
UPDATE "orders"."preorder" SET "status" = 'confirmed' WHERE "status" = 'reserved';--> statement-breakpoint
CREATE UNIQUE INDEX "preorder_line_variant_uq" ON "orders"."preorder_line" USING btree ("preorder_id","variant_id") WHERE "orders"."preorder_line"."variant_id" is not null;--> statement-breakpoint
ALTER TABLE "orders"."preorder" ADD CONSTRAINT "preorder_status_ck" CHECK ("orders"."preorder"."status" in ('quote', 'confirmed', 'ordered', 'arrived', 'contacted', 'collected', 'cancelled'));--> statement-breakpoint
ALTER TABLE "orders"."preorder_line" ADD CONSTRAINT "preorder_line_book_ck" CHECK ("orders"."preorder_line"."variant_id" is not null or "orders"."preorder_line"."requested_title" is not null);--> statement-breakpoint
-- The manager role gets the new pre-order permission (SRS Appendix A).
INSERT INTO "platform"."role_permission" ("role_id", "permission") SELECT "id", 'preorder.manage' FROM "platform"."role" WHERE "code" = 'manager' ON CONFLICT DO NOTHING;
