CREATE TABLE "orders"."preorder" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"doc_no" text NOT NULL,
	"source" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"unit_price_vnd" bigint NOT NULL,
	"deposit_vnd" bigint DEFAULT 0 NOT NULL,
	"deposit_method" text,
	"deposit_ref" text,
	"deposit_shift_id" uuid,
	"deposit_outcome" text,
	"refund_ref" text,
	"status" text DEFAULT 'reserved' NOT NULL,
	"allocated_at" timestamp with time zone,
	"contacted_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"order_id" uuid,
	"note" text,
	"cancel_reason" text,
	"overdue_notified_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "preorder_docNo_unique" UNIQUE("doc_no"),
	CONSTRAINT "preorder_status_ck" CHECK ("orders"."preorder"."status" in ('reserved', 'ordered', 'arrived', 'contacted', 'collected', 'cancelled')),
	CONSTRAINT "preorder_qty_ck" CHECK ("orders"."preorder"."qty" > 0),
	CONSTRAINT "preorder_source_ck" CHECK ("orders"."preorder"."source" in ('website', 'facebook', 'zalo', 'instagram', 'tiktok', 'marketplace', 'phone', 'other')),
	CONSTRAINT "preorder_deposit_method_ck" CHECK ("orders"."preorder"."deposit_method" is null or "orders"."preorder"."deposit_method" in ('cash', 'transfer', 'card')),
	CONSTRAINT "preorder_outcome_ck" CHECK ("orders"."preorder"."deposit_outcome" is null or "orders"."preorder"."deposit_outcome" in ('refunded', 'forfeited'))
);
--> statement-breakpoint
CREATE TABLE "orders"."special_order" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"doc_no" text NOT NULL,
	"source" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"requested_title" text NOT NULL,
	"isbn" text,
	"qty" integer DEFAULT 1 NOT NULL,
	"quote_vnd" bigint NOT NULL,
	"deposit_vnd" bigint DEFAULT 0 NOT NULL,
	"deposit_method" text,
	"deposit_ref" text,
	"deposit_shift_id" uuid,
	"deposit_outcome" text,
	"refund_ref" text,
	"status" text DEFAULT 'requested' NOT NULL,
	"variant_id" uuid,
	"ordered_at" timestamp with time zone,
	"arrived_at" timestamp with time zone,
	"contacted_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"order_id" uuid,
	"note" text,
	"cancel_reason" text,
	"overdue_notified_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "special_order_docNo_unique" UNIQUE("doc_no"),
	CONSTRAINT "special_order_status_ck" CHECK ("orders"."special_order"."status" in ('requested', 'ordered', 'arrived', 'contacted', 'collected', 'cancelled')),
	CONSTRAINT "special_order_qty_ck" CHECK ("orders"."special_order"."qty" > 0),
	CONSTRAINT "special_order_source_ck" CHECK ("orders"."special_order"."source" in ('website', 'facebook', 'zalo', 'instagram', 'tiktok', 'marketplace', 'phone', 'other')),
	CONSTRAINT "special_order_deposit_method_ck" CHECK ("orders"."special_order"."deposit_method" is null or "orders"."special_order"."deposit_method" in ('cash', 'transfer', 'card')),
	CONSTRAINT "special_order_outcome_ck" CHECK ("orders"."special_order"."deposit_outcome" is null or "orders"."special_order"."deposit_outcome" in ('refunded', 'forfeited'))
);
--> statement-breakpoint
ALTER TABLE "orders"."web_order" ADD COLUMN "deposit_vnd" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders"."preorder" ADD CONSTRAINT "preorder_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "crm"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."preorder" ADD CONSTRAINT "preorder_variant_id_item_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "catalog"."item_variant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."preorder" ADD CONSTRAINT "preorder_deposit_shift_id_shift_id_fk" FOREIGN KEY ("deposit_shift_id") REFERENCES "sales"."shift"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."preorder" ADD CONSTRAINT "preorder_order_id_web_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "orders"."web_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."preorder" ADD CONSTRAINT "preorder_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "platform"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."special_order" ADD CONSTRAINT "special_order_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "crm"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."special_order" ADD CONSTRAINT "special_order_deposit_shift_id_shift_id_fk" FOREIGN KEY ("deposit_shift_id") REFERENCES "sales"."shift"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."special_order" ADD CONSTRAINT "special_order_variant_id_item_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "catalog"."item_variant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."special_order" ADD CONSTRAINT "special_order_order_id_web_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "orders"."web_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."special_order" ADD CONSTRAINT "special_order_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "platform"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "preorder_variant_idx" ON "orders"."preorder" USING btree ("variant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "preorder_customer_idx" ON "orders"."preorder" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "special_order_status_idx" ON "orders"."special_order" USING btree ("status");--> statement-breakpoint
ALTER TABLE "orders"."web_order" ADD CONSTRAINT "web_order_deposit_ck" CHECK ("orders"."web_order"."deposit_vnd" >= 0 and "orders"."web_order"."deposit_vnd" <= "orders"."web_order"."total_vnd");