ALTER TABLE "orders"."preorder" DROP CONSTRAINT "preorder_order_id_web_order_id_fk";
--> statement-breakpoint
ALTER TABLE "orders"."preorder" DROP COLUMN "order_id";