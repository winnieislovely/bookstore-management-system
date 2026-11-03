ALTER TABLE "orders"."special_order" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "orders"."special_order" CASCADE;--> statement-breakpoint
ALTER TABLE "sales"."sale_payment" DROP CONSTRAINT "sale_payment_method_ck";--> statement-breakpoint
ALTER TABLE "orders"."contact_task" DROP CONSTRAINT "contact_task_reason_ck";--> statement-breakpoint
ALTER TABLE "orders"."web_order" DROP CONSTRAINT "web_order_deposit_ck";--> statement-breakpoint
ALTER TABLE "orders"."preorder" ADD COLUMN "sale_id" uuid;--> statement-breakpoint
ALTER TABLE "orders"."preorder" ADD CONSTRAINT "preorder_sale_id_sale_id_fk" FOREIGN KEY ("sale_id") REFERENCES "sales"."sale"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."web_order" DROP COLUMN "deposit_vnd";--> statement-breakpoint
ALTER TABLE "sales"."sale_payment" ADD CONSTRAINT "sale_payment_method_ck" CHECK ("sales"."sale_payment"."method" in ('cash', 'transfer', 'card', 'store_credit', 'deposit'));--> statement-breakpoint
ALTER TABLE "orders"."contact_task" ADD CONSTRAINT "contact_task_reason_ck" CHECK ("orders"."contact_task"."reason" in ('preorder_arrived', 'pickup_ready', 'library_hold', 'waitlist_offer', 'event_cancelled'));