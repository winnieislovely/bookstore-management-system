ALTER TABLE "orders"."preorder" ADD COLUMN "order_id" uuid;--> statement-breakpoint
ALTER TABLE "orders"."web_order" ADD COLUMN "preorder_id" uuid;--> statement-breakpoint
ALTER TABLE "orders"."web_order" ADD COLUMN "deposit_vnd" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders"."preorder" ADD CONSTRAINT "preorder_order_id_web_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "orders"."web_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."web_order" ADD CONSTRAINT "web_order_preorder_id_preorder_id_fk" FOREIGN KEY ("preorder_id") REFERENCES "orders"."preorder"("id") ON DELETE no action ON UPDATE no action;