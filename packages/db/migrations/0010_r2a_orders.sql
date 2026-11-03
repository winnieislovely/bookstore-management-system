CREATE SCHEMA "orders";
--> statement-breakpoint
CREATE TABLE "orders"."channel" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"url" text,
	"handle" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_name_unique" UNIQUE("name"),
	CONSTRAINT "channel_kind_ck" CHECK ("orders"."channel"."kind" in ('facebook', 'zalo', 'instagram', 'tiktok', 'marketplace'))
);
--> statement-breakpoint
CREATE TABLE "orders"."cod_remittance" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"expected_vnd" bigint NOT NULL,
	"received_vnd" bigint,
	"statement_ref" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reconciled_by" uuid,
	"reconciled_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cod_remittance_shipmentId_unique" UNIQUE("shipment_id"),
	CONSTRAINT "cod_remittance_status_ck" CHECK ("orders"."cod_remittance"."status" in ('pending', 'matched', 'difference'))
);
--> statement-breakpoint
CREATE TABLE "orders"."contact_task" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"reason" text NOT NULL,
	"customer_id" uuid,
	"name" text NOT NULL,
	"phone" text,
	"ref_type" text NOT NULL,
	"ref_id" uuid NOT NULL,
	"ref_label" text,
	"due_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"contacted_by" uuid,
	"contacted_at" timestamp with time zone,
	"note" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"overdue_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_task_reason_ck" CHECK ("orders"."contact_task"."reason" in ('preorder_arrived', 'special_order_arrived', 'pickup_ready', 'library_hold', 'waitlist_offer', 'event_cancelled')),
	CONSTRAINT "contact_task_status_ck" CHECK ("orders"."contact_task"."status" in ('open', 'contacted', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "orders"."geo_province" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"search_text" text NOT NULL,
	"refreshed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders"."geo_ward" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"province_id" integer NOT NULL,
	"district_id" integer NOT NULL,
	"district_name" text NOT NULL,
	"search_text" text NOT NULL,
	"refreshed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders"."order_event" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"actor_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "orders"."order_line" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"variant_id" uuid NOT NULL,
	"description" text NOT NULL,
	"qty" integer NOT NULL,
	"unit_price_vnd" bigint NOT NULL,
	"discount_vnd" bigint DEFAULT 0 NOT NULL,
	"total_vnd" bigint NOT NULL,
	"vat_bp" integer NOT NULL,
	"vat_vnd" bigint NOT NULL,
	"cost_vnd" bigint,
	"promotion_version_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	CONSTRAINT "order_line_qty_ck" CHECK ("orders"."order_line"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "orders"."return_request" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"lines" jsonb NOT NULL,
	"refund_vnd" bigint,
	"refund_ref" text,
	"return_shipping_paid_by" text NOT NULL,
	"points_reversed" integer DEFAULT 0 NOT NULL,
	"requested_by" uuid,
	"received_by" uuid,
	"received_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "return_request_status_ck" CHECK ("orders"."return_request"."status" in ('requested', 'approved', 'received', 'rejected')),
	CONSTRAINT "return_request_paid_by_ck" CHECK ("orders"."return_request"."return_shipping_paid_by" in ('store', 'customer'))
);
--> statement-breakpoint
CREATE TABLE "orders"."shipment" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_id" uuid NOT NULL,
	"carrier" text NOT NULL,
	"tracking_no" text NOT NULL,
	"fee_vnd" bigint DEFAULT 0 NOT NULL,
	"cod_vnd" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"carrier_status" text,
	"status_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipment_carrier_ck" CHECK ("orders"."shipment"."carrier" in ('ghn', 'manual')),
	CONSTRAINT "shipment_status_ck" CHECK ("orders"."shipment"."status" in ('created', 'picking', 'in_transit', 'delivered', 'failed', 'returning', 'returned', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "orders"."web_order" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"doc_no" text NOT NULL,
	"source" text NOT NULL,
	"source_ref" text,
	"external_id" text,
	"channel_id" uuid,
	"customer_id" uuid,
	"recipient" jsonb NOT NULL,
	"delivery" text DEFAULT 'ship' NOT NULL,
	"address" jsonb,
	"status" text DEFAULT 'new' NOT NULL,
	"payment_method" text NOT NULL,
	"payment_ref" text,
	"subtotal_vnd" bigint NOT NULL,
	"discount_vnd" bigint NOT NULL,
	"shipping_vnd" bigint DEFAULT 0 NOT NULL,
	"total_vnd" bigint NOT NULL,
	"vat_vnd" bigint NOT NULL,
	"points_redeemed" integer DEFAULT 0 NOT NULL,
	"points_discount_vnd" bigint DEFAULT 0 NOT NULL,
	"points_earned" integer DEFAULT 0 NOT NULL,
	"coupon_code" text,
	"paid_at" timestamp with time zone,
	"paid_confirmed_by" uuid,
	"review_reasons" text[] DEFAULT '{}'::text[] NOT NULL,
	"note" text,
	"read_at" timestamp with time zone,
	"pickup_code_hash" text,
	"ready_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"done_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"attribution" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "web_order_docNo_unique" UNIQUE("doc_no"),
	CONSTRAINT "web_order_status_ck" CHECK ("orders"."web_order"."status" in ('new', 'pending_review', 'confirmed', 'packing', 'shipping', 'done', 'return_requested', 'return_approved', 'returned', 'cancelled')),
	CONSTRAINT "web_order_source_ck" CHECK ("orders"."web_order"."source" in ('website', 'facebook', 'zalo', 'instagram', 'tiktok', 'marketplace', 'phone', 'other')),
	CONSTRAINT "web_order_delivery_ck" CHECK ("orders"."web_order"."delivery" in ('ship', 'pickup')),
	CONSTRAINT "web_order_payment_ck" CHECK ("orders"."web_order"."payment_method" in ('cod', 'transfer')),
	CONSTRAINT "web_order_reasons_ck" CHECK ("orders"."web_order"."review_reasons" <@ array['out_of_stock', 'incomplete_address', 'unpaid_transfer', 'high_value', 'suspected_abuse']::text[]),
	CONSTRAINT "web_order_amounts_ck" CHECK ("orders"."web_order"."total_vnd" >= 0 and "orders"."web_order"."discount_vnd" >= 0 and "orders"."web_order"."subtotal_vnd" >= 0 and "orders"."web_order"."shipping_vnd" >= 0),
	CONSTRAINT "web_order_ship_address_ck" CHECK ("orders"."web_order"."delivery" = 'pickup' or "orders"."web_order"."address" is not null)
);
--> statement-breakpoint
ALTER TABLE "orders"."cod_remittance" ADD CONSTRAINT "cod_remittance_shipment_id_shipment_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "orders"."shipment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."contact_task" ADD CONSTRAINT "contact_task_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "crm"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."geo_ward" ADD CONSTRAINT "geo_ward_province_id_geo_province_id_fk" FOREIGN KEY ("province_id") REFERENCES "orders"."geo_province"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."order_event" ADD CONSTRAINT "order_event_order_id_web_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "orders"."web_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."order_line" ADD CONSTRAINT "order_line_order_id_web_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "orders"."web_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."order_line" ADD CONSTRAINT "order_line_variant_id_item_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "catalog"."item_variant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."return_request" ADD CONSTRAINT "return_request_order_id_web_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "orders"."web_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."shipment" ADD CONSTRAINT "shipment_order_id_web_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "orders"."web_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."web_order" ADD CONSTRAINT "web_order_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "orders"."channel"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."web_order" ADD CONSTRAINT "web_order_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "crm"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."web_order" ADD CONSTRAINT "web_order_paid_confirmed_by_app_user_id_fk" FOREIGN KEY ("paid_confirmed_by") REFERENCES "platform"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."web_order" ADD CONSTRAINT "web_order_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "platform"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cod_remittance_status_idx" ON "orders"."cod_remittance" USING btree ("status");--> statement-breakpoint
CREATE INDEX "contact_task_status_idx" ON "orders"."contact_task" USING btree ("status","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_task_open_ref_uq" ON "orders"."contact_task" USING btree ("reason","ref_type","ref_id") WHERE "orders"."contact_task"."status" = 'open';--> statement-breakpoint
CREATE INDEX "geo_ward_province_idx" ON "orders"."geo_ward" USING btree ("province_id");--> statement-breakpoint
CREATE INDEX "order_event_order_idx" ON "orders"."order_event" USING btree ("order_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "order_line_no_uq" ON "orders"."order_line" USING btree ("order_id","line_no");--> statement-breakpoint
CREATE INDEX "order_line_variant_idx" ON "orders"."order_line" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "return_request_order_idx" ON "orders"."return_request" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shipment_tracking_uq" ON "orders"."shipment" USING btree ("carrier","tracking_no");--> statement-breakpoint
CREATE INDEX "shipment_order_idx" ON "orders"."shipment" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "shipment_status_idx" ON "orders"."shipment" USING btree ("carrier","status");--> statement-breakpoint
CREATE UNIQUE INDEX "web_order_external_uq" ON "orders"."web_order" USING btree ("source","external_id") WHERE "orders"."web_order"."external_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "web_order_payment_ref_uq" ON "orders"."web_order" USING btree ("payment_ref") WHERE "orders"."web_order"."payment_ref" is not null;--> statement-breakpoint
CREATE INDEX "web_order_status_idx" ON "orders"."web_order" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "web_order_customer_idx" ON "orders"."web_order" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "web_order_done_idx" ON "orders"."web_order" USING btree ("done_at") WHERE "orders"."web_order"."done_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "einvoice_job_order_uq" ON "sales"."einvoice_job" USING btree ("order_id") WHERE "sales"."einvoice_job"."order_id" is not null;--> statement-breakpoint
CREATE TRIGGER order_event_immutable BEFORE UPDATE OR DELETE ON orders.order_event
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_change();
