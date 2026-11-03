ALTER TABLE "orders"."preorder" DROP CONSTRAINT "preorder_qty_ck";--> statement-breakpoint
ALTER TABLE "orders"."preorder" DROP CONSTRAINT "preorder_variant_id_item_variant_id_fk";
--> statement-breakpoint
DROP INDEX "orders"."preorder_variant_idx";--> statement-breakpoint
CREATE INDEX "preorder_status_idx" ON "orders"."preorder" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "orders"."preorder" DROP COLUMN "variant_id";--> statement-breakpoint
ALTER TABLE "orders"."preorder" DROP COLUMN "qty";--> statement-breakpoint
ALTER TABLE "orders"."preorder" DROP COLUMN "unit_price_vnd";