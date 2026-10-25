CREATE SCHEMA "platform";
--> statement-breakpoint
CREATE SCHEMA "catalog";
--> statement-breakpoint
CREATE SCHEMA "inventory";
--> statement-breakpoint
CREATE SCHEMA "purchasing";
--> statement-breakpoint
CREATE SCHEMA "crm";
--> statement-breakpoint
CREATE SCHEMA "sales";
--> statement-breakpoint
CREATE SCHEMA "reports";
--> statement-breakpoint
CREATE TABLE "platform"."app_user" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"username" text NOT NULL,
	"display_name" text NOT NULL,
	"password_hash" text NOT NULL,
	"pin_hash" text,
	"role_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"must_change_pw" boolean DEFAULT true NOT NULL,
	"mfa_secret_enc" text,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "app_user_status_ck" CHECK ("platform"."app_user"."status" in ('active', 'locked', 'disabled'))
);
--> statement-breakpoint
CREATE TABLE "platform"."approval_token" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"token_hash" text NOT NULL,
	"approver_id" uuid NOT NULL,
	"requester_id" uuid,
	"action" text NOT NULL,
	"subject" text,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_token_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "platform"."audit_entry" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"request_id" text
);
--> statement-breakpoint
CREATE TABLE "platform"."file" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"object_key" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"owner_type" text,
	"owner_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_objectKey_unique" UNIQUE("object_key")
);
--> statement-breakpoint
CREATE TABLE "platform"."idempotency_key" (
	"key" text PRIMARY KEY NOT NULL,
	"request_hash" text NOT NULL,
	"status" integer,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."login_attempt" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"username" text NOT NULL,
	"ip" text,
	"success" boolean NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."master_data" (
	"kind" text NOT NULL,
	"code" text NOT NULL,
	"i18n" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "master_data_kind_code_pk" PRIMARY KEY("kind","code")
);
--> statement-breakpoint
CREATE TABLE "platform"."notification" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"channel" text NOT NULL,
	"to" text NOT NULL,
	"template" text NOT NULL,
	"vars" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_channel_ck" CHECK ("platform"."notification"."channel" in ('email', 'in_app')),
	CONSTRAINT "notification_status_ck" CHECK ("platform"."notification"."status" in ('pending', 'sent', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "platform"."notification_template" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"locale" text DEFAULT 'vi' NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."outbox_event" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."role" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_owner" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "role_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "platform"."role_permission" (
	"role_id" uuid NOT NULL,
	"permission" text NOT NULL,
	CONSTRAINT "role_permission_role_id_permission_pk" PRIMARY KEY("role_id","permission")
);
--> statement-breakpoint
CREATE TABLE "platform"."session" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"device_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"ip" text,
	"user_agent" text,
	CONSTRAINT "session_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "platform"."setting" (
	"key" text NOT NULL,
	"scope" text DEFAULT 'store' NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "setting_key_scope_pk" PRIMARY KEY("key","scope")
);
--> statement-breakpoint
CREATE TABLE "platform"."webhook_inbox" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'received' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog"."barcode" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"variant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "barcode_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "catalog"."brand" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"i18n" jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog"."bundle_component" (
	"bundle_variant_id" uuid NOT NULL,
	"component_variant_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	CONSTRAINT "bundle_component_bundle_variant_id_component_variant_id_pk" PRIMARY KEY("bundle_variant_id","component_variant_id"),
	CONSTRAINT "bundle_component_qty_ck" CHECK ("catalog"."bundle_component"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "catalog"."catalog_change" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"op" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_change_op_ck" CHECK ("catalog"."catalog_change"."op" in ('upsert', 'delete'))
);
--> statement-breakpoint
CREATE TABLE "catalog"."category" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"parent_id" uuid,
	"i18n" jsonb NOT NULL,
	"slug" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "category_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "catalog"."import_job" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"file_id" uuid,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_job_kind_ck" CHECK ("catalog"."import_job"."kind" in ('products', 'stock_in', 'customers', 'suppliers', 'library_copies', 'employees')),
	CONSTRAINT "import_job_status_ck" CHECK ("catalog"."import_job"."status" in ('uploaded', 'validated', 'committed', 'rolled_back', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "catalog"."import_row" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"job_id" uuid NOT NULL,
	"row_no" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog"."item" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"i18n" jsonb NOT NULL,
	"slug" text NOT NULL,
	"authors" text[] DEFAULT '{}'::text[] NOT NULL,
	"translator" text,
	"publisher_id" uuid,
	"brand_id" uuid,
	"model" text,
	"unit" text,
	"language" text,
	"publication_year" integer,
	"edition" text,
	"page_count" integer,
	"cover_type" text,
	"series" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"release_date" date,
	"status" text DEFAULT 'active' NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "item_slug_unique" UNIQUE("slug"),
	CONSTRAINT "item_kind_ck" CHECK ("catalog"."item"."kind" in ('book', 'stationery', 'other', 'bundle')),
	CONSTRAINT "item_status_ck" CHECK ("catalog"."item"."status" in ('active', 'hidden', 'discontinued'))
);
--> statement-breakpoint
CREATE TABLE "catalog"."item_category" (
	"item_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	CONSTRAINT "item_category_item_id_category_id_pk" PRIMARY KEY("item_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "catalog"."item_image" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"item_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"alt" jsonb
);
--> statement-breakpoint
CREATE TABLE "catalog"."item_variant" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"item_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"isbn13" text,
	"weight_g" integer NOT NULL,
	"price_vnd" bigint NOT NULL,
	"list_price_vnd" bigint,
	"vat_bp" integer DEFAULT 0 NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"published_pos" boolean DEFAULT true NOT NULL,
	"published_web" boolean DEFAULT false NOT NULL,
	"web_stock_display" text,
	"min_stock" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "item_variant_weight_ck" CHECK ("catalog"."item_variant"."weight_g" > 0),
	CONSTRAINT "item_variant_price_ck" CHECK ("catalog"."item_variant"."price_vnd" >= 0),
	CONSTRAINT "item_variant_status_ck" CHECK ("catalog"."item_variant"."status" in ('active', 'hidden', 'discontinued')),
	CONSTRAINT "item_variant_stock_display_ck" CHECK ("catalog"."item_variant"."web_stock_display" is null or "catalog"."item_variant"."web_stock_display" in ('exact', 'few_left', 'in_out', 'hidden'))
);
--> statement-breakpoint
CREATE TABLE "catalog"."price_history" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"variant_id" uuid NOT NULL,
	"price_vnd" bigint NOT NULL,
	"list_price_vnd" bigint,
	"vat_bp" integer NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_to" timestamp with time zone,
	"changed_by" uuid,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "catalog"."publisher" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"i18n" jsonb NOT NULL,
	"contact" jsonb,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory"."stock_adjustment" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"doc_no" text NOT NULL,
	"variant_id" uuid NOT NULL,
	"location" text DEFAULT 'floor' NOT NULL,
	"qty_delta" integer NOT NULL,
	"reason_code" text NOT NULL,
	"note" text,
	"value_vnd" bigint NOT NULL,
	"status" text DEFAULT 'posted' NOT NULL,
	"requested_by" uuid,
	"approved_by" uuid,
	"movement_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_adjustment_docNo_unique" UNIQUE("doc_no"),
	CONSTRAINT "stock_adjustment_qty_ck" CHECK ("inventory"."stock_adjustment"."qty_delta" <> 0),
	CONSTRAINT "stock_adjustment_status_ck" CHECK ("inventory"."stock_adjustment"."status" in ('pending_approval', 'posted', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "inventory"."stock_count" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"doc_no" text NOT NULL,
	"scope" jsonb NOT NULL,
	"location" text DEFAULT 'floor' NOT NULL,
	"blind" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_by" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_count_docNo_unique" UNIQUE("doc_no"),
	CONSTRAINT "stock_count_status_ck" CHECK ("inventory"."stock_count"."status" in ('open', 'submitted', 'approved', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "inventory"."stock_count_line" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"count_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"expected" integer NOT NULL,
	"counted" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory"."stock_level" (
	"variant_id" uuid NOT NULL,
	"location" text DEFAULT 'floor' NOT NULL,
	"on_hand" integer DEFAULT 0 NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	"avg_cost_vnd" bigint DEFAULT 0 NOT NULL,
	"last_sale_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_level_variant_id_location_pk" PRIMARY KEY("variant_id","location"),
	CONSTRAINT "stock_level_reserved_ck" CHECK ("inventory"."stock_level"."reserved" >= 0),
	CONSTRAINT "stock_level_location_ck" CHECK ("inventory"."stock_level"."location" in ('floor', 'back'))
);
--> statement-breakpoint
CREATE TABLE "inventory"."stock_movement" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"variant_id" uuid NOT NULL,
	"location" text DEFAULT 'floor' NOT NULL,
	"type" text NOT NULL,
	"qty_delta" integer NOT NULL,
	"unit_cost_vnd" bigint,
	"ref_type" text NOT NULL,
	"ref_id" uuid NOT NULL,
	"actor_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	CONSTRAINT "stock_movement_type_ck" CHECK ("inventory"."stock_movement"."type" in ('stock_in', 'sale', 'customer_return', 'consignment_receipt', 'consignment_return', 'adjustment', 'count', 'write_off', 'bundle_use', 'library_transfer')),
	CONSTRAINT "stock_movement_qty_ck" CHECK ("inventory"."stock_movement"."qty_delta" <> 0)
);
--> statement-breakpoint
CREATE TABLE "inventory"."stock_reservation" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"ref_type" text NOT NULL,
	"ref_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"location" text DEFAULT 'floor' NOT NULL,
	"qty" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_reservation_qty_ck" CHECK ("inventory"."stock_reservation"."qty" > 0),
	CONSTRAINT "stock_reservation_status_ck" CHECK ("inventory"."stock_reservation"."status" in ('active', 'converted', 'released', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "purchasing"."consignment_allocation" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"lot_id" uuid NOT NULL,
	"sale_line_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"unit_price_vnd" bigint NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consignment_allocation_qty_ck" CHECK ("purchasing"."consignment_allocation"."qty" <> 0)
);
--> statement-breakpoint
CREATE TABLE "purchasing"."consignment_lot" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"stock_in_line_id" uuid,
	"qty_received" integer NOT NULL,
	"qty_sold" integer DEFAULT 0 NOT NULL,
	"qty_returned" integer DEFAULT 0 NOT NULL,
	"discount_bp" integer DEFAULT 0 NOT NULL,
	"deadline_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consignment_lot_qty_ck" CHECK ("purchasing"."consignment_lot"."qty_sold" >= 0 and "purchasing"."consignment_lot"."qty_returned" >= 0 and "purchasing"."consignment_lot"."qty_sold" + "purchasing"."consignment_lot"."qty_returned" <= "purchasing"."consignment_lot"."qty_received")
);
--> statement-breakpoint
CREATE TABLE "purchasing"."consignment_return" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"note" text,
	"created_by" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consignment_return_qty_ck" CHECK ("purchasing"."consignment_return"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "purchasing"."consignment_statement" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"doc_no" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"period" text NOT NULL,
	"lines" jsonb NOT NULL,
	"amount_due_vnd" bigint NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"payable_id" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consignment_statement_docNo_unique" UNIQUE("doc_no"),
	CONSTRAINT "consignment_statement_status_ck" CHECK ("purchasing"."consignment_statement"."status" in ('draft', 'approved'))
);
--> statement-breakpoint
CREATE TABLE "purchasing"."payable" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"source" text NOT NULL,
	"source_id" uuid NOT NULL,
	"amount_vnd" bigint NOT NULL,
	"paid_vnd" bigint DEFAULT 0 NOT NULL,
	"due_at" timestamp with time zone,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payable_source_ck" CHECK ("purchasing"."payable"."source" in ('stock_in', 'consignment')),
	CONSTRAINT "payable_status_ck" CHECK ("purchasing"."payable"."status" in ('open', 'paid')),
	CONSTRAINT "payable_amount_ck" CHECK ("purchasing"."payable"."amount_vnd" >= 0 and "purchasing"."payable"."paid_vnd" >= 0 and "purchasing"."payable"."paid_vnd" <= "purchasing"."payable"."amount_vnd")
);
--> statement-breakpoint
CREATE TABLE "purchasing"."payable_payment" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"payable_id" uuid NOT NULL,
	"amount_vnd" bigint NOT NULL,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	"method" text NOT NULL,
	"note" text,
	"created_by" uuid,
	CONSTRAINT "payable_payment_amount_ck" CHECK ("purchasing"."payable_payment"."amount_vnd" > 0)
);
--> statement-breakpoint
CREATE TABLE "purchasing"."stock_in_entry" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"entry_no" text NOT NULL,
	"supplier_id" uuid,
	"supplier_invoice_no" text,
	"invoice_file_id" uuid,
	"consignment" boolean DEFAULT false NOT NULL,
	"note" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"import_job_id" uuid,
	"total_cost_vnd" bigint DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_in_entry_entryNo_unique" UNIQUE("entry_no")
);
--> statement-breakpoint
CREATE TABLE "purchasing"."stock_in_line" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"entry_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"unit_cost_vnd" bigint NOT NULL,
	"new_price_vnd" bigint,
	"created_product" boolean DEFAULT false NOT NULL,
	"margin_flag" boolean DEFAULT false NOT NULL,
	"order_line_id" uuid,
	CONSTRAINT "stock_in_line_qty_ck" CHECK ("purchasing"."stock_in_line"."qty" > 0),
	CONSTRAINT "stock_in_line_cost_ck" CHECK ("purchasing"."stock_in_line"."unit_cost_vnd" >= 0)
);
--> statement-breakpoint
CREATE TABLE "purchasing"."supplier" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"tax_code" text,
	"kind" text NOT NULL,
	"is_consignor" boolean DEFAULT false NOT NULL,
	"tracks_payables" boolean DEFAULT false NOT NULL,
	"terms_days" integer,
	"contacts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bank_enc" text,
	"note" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "supplier_kind_ck" CHECK ("purchasing"."supplier"."kind" in ('publisher', 'distributor', 'vendor', 'individual'))
);
--> statement-breakpoint
CREATE TABLE "purchasing"."supplier_order" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"doc_no" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"expected_at" timestamp with time zone,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "supplier_order_docNo_unique" UNIQUE("doc_no"),
	CONSTRAINT "supplier_order_status_ck" CHECK ("purchasing"."supplier_order"."status" in ('draft', 'sent', 'partially_received', 'received', 'closed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "purchasing"."supplier_order_line" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"unit_cost_vnd" bigint,
	"received_qty" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "supplier_order_line_qty_ck" CHECK ("purchasing"."supplier_order_line"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "crm"."coupon" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" text NOT NULL,
	"promotion_id" uuid NOT NULL,
	"channel" text,
	"usage_limit" integer,
	"used" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupon_used_ck" CHECK ("crm"."coupon"."used" >= 0 and ("crm"."coupon"."usage_limit" is null or "crm"."coupon"."used" <= "crm"."coupon"."usage_limit"))
);
--> statement-breakpoint
CREATE TABLE "crm"."customer" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"phone_e164" text,
	"email" text,
	"birth_date" date,
	"addresses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"note" text,
	"source" text,
	"tier_id" uuid,
	"points_balance" integer DEFAULT 0 NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	"merged_into" uuid,
	"anonymised_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "customer_points_ck" CHECK ("crm"."customer"."points_balance" >= 0)
);
--> statement-breakpoint
CREATE TABLE "crm"."customer_consent" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"customer_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"channel" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "crm"."customer_contact" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"customer_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm"."customer_tier_history" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"customer_id" uuid NOT NULL,
	"tier_id" uuid NOT NULL,
	"spend12m_vnd" bigint NOT NULL,
	"from_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm"."points_ledger" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"customer_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"ref_type" text,
	"ref_id" uuid,
	"note" text,
	"expires_at" timestamp with time zone,
	"actor_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "points_ledger_reason_ck" CHECK ("crm"."points_ledger"."reason" in ('earn', 'redeem', 'return_reversal', 'redeem_refund', 'expire', 'adjust', 'import')),
	CONSTRAINT "points_ledger_delta_ck" CHECK ("crm"."points_ledger"."delta" <> 0)
);
--> statement-breakpoint
CREATE TABLE "crm"."promotion" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"current_version_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm"."promotion_usage" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"promotion_id" uuid NOT NULL,
	"customer_id" uuid,
	"ref_type" text NOT NULL,
	"ref_id" uuid NOT NULL,
	"discount_vnd" bigint NOT NULL,
	"revenue_vnd" bigint NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm"."promotion_version" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"promotion_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"rule" jsonb NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm"."tier" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"min_spend_vnd" bigint NOT NULL,
	"benefits" jsonb NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "tier_code_unique" UNIQUE("code"),
	CONSTRAINT "tier_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "sales"."cash_movement" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"shift_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"amount_vnd" bigint NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_movement_direction_ck" CHECK ("sales"."cash_movement"."direction" in ('in', 'out')),
	CONSTRAINT "cash_movement_amount_ck" CHECK ("sales"."cash_movement"."amount_vnd" > 0)
);
--> statement-breakpoint
CREATE TABLE "sales"."doc_counter" (
	"series" text NOT NULL,
	"year" integer NOT NULL,
	"last_no" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "doc_counter_series_year_pk" PRIMARY KEY("series","year")
);
--> statement-breakpoint
CREATE TABLE "sales"."einvoice_job" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"sale_id" uuid,
	"order_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"provider_ref" text,
	"invoice_no" text,
	"buyer" jsonb,
	"email_requested" boolean DEFAULT false NOT NULL,
	"email_status" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "einvoice_job_status_ck" CHECK ("sales"."einvoice_job"."status" in ('pending', 'sent', 'issued', 'failed', 'cancelled', 'adjusted'))
);
--> statement-breakpoint
CREATE TABLE "sales"."held_cart" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"register_id" uuid NOT NULL,
	"cashier_id" uuid NOT NULL,
	"label" text,
	"payload" jsonb NOT NULL,
	"held_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales"."pos_device" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"register_id" uuid NOT NULL,
	"device_code" text NOT NULL,
	"public_key" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_device_deviceCode_unique" UNIQUE("device_code")
);
--> statement-breakpoint
CREATE TABLE "sales"."pos_inbox" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"device_id" uuid NOT NULL,
	"client_event_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"result" jsonb NOT NULL,
	"exception_code" text,
	"payload" jsonb,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales"."register" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "register_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "sales"."sale" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"doc_no" text NOT NULL,
	"client_event_id" uuid,
	"device_id" uuid,
	"shift_id" uuid NOT NULL,
	"cashier_id" uuid NOT NULL,
	"customer_id" uuid,
	"channel" text DEFAULT 'counter' NOT NULL,
	"subtotal_vnd" bigint NOT NULL,
	"discount_vnd" bigint NOT NULL,
	"points_redeemed" integer DEFAULT 0 NOT NULL,
	"points_discount_vnd" bigint DEFAULT 0 NOT NULL,
	"points_earned" integer DEFAULT 0 NOT NULL,
	"total_vnd" bigint NOT NULL,
	"vat_vnd" bigint NOT NULL,
	"is_deposit" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"offline" boolean DEFAULT false NOT NULL,
	"sold_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	"event_id" uuid,
	"coupon_code" text,
	"voided_by" uuid,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_docNo_unique" UNIQUE("doc_no"),
	CONSTRAINT "sale_status_ck" CHECK ("sales"."sale"."status" in ('completed', 'voided')),
	CONSTRAINT "sale_channel_ck" CHECK ("sales"."sale"."channel" in ('counter')),
	CONSTRAINT "sale_amounts_ck" CHECK ("sales"."sale"."total_vnd" >= 0 and "sales"."sale"."discount_vnd" >= 0 and "sales"."sale"."subtotal_vnd" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sales"."sale_line" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"sale_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"variant_id" uuid,
	"item_class" text DEFAULT 'goods' NOT NULL,
	"description" text NOT NULL,
	"service_ref" jsonb,
	"qty" integer NOT NULL,
	"unit_price_vnd" bigint NOT NULL,
	"discount_vnd" bigint DEFAULT 0 NOT NULL,
	"total_vnd" bigint NOT NULL,
	"vat_bp" integer NOT NULL,
	"vat_vnd" bigint NOT NULL,
	"cost_vnd" bigint DEFAULT 0 NOT NULL,
	"promotion_version_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"price_overridden" boolean DEFAULT false NOT NULL,
	"note" text,
	CONSTRAINT "sale_line_qty_ck" CHECK ("sales"."sale_line"."qty" > 0),
	CONSTRAINT "sale_line_class_ck" CHECK ("sales"."sale_line"."item_class" in ('goods', 'event_ticket', 'library_deposit', 'library_fine', 'library_charge'))
);
--> statement-breakpoint
CREATE TABLE "sales"."sale_payment" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"sale_id" uuid NOT NULL,
	"method" text NOT NULL,
	"amount_vnd" bigint NOT NULL,
	"tendered_vnd" bigint,
	"ref" text,
	"verified" boolean DEFAULT true NOT NULL,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "sale_payment_method_ck" CHECK ("sales"."sale_payment"."method" in ('cash', 'transfer', 'card')),
	CONSTRAINT "sale_payment_amount_ck" CHECK ("sales"."sale_payment"."amount_vnd" > 0)
);
--> statement-breakpoint
CREATE TABLE "sales"."sale_return" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"doc_no" text NOT NULL,
	"sale_id" uuid NOT NULL,
	"shift_id" uuid,
	"refund_method" text NOT NULL,
	"refund_vnd" bigint NOT NULL,
	"points_reversed" integer DEFAULT 0 NOT NULL,
	"reason" text,
	"approved_by" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_return_docNo_unique" UNIQUE("doc_no"),
	CONSTRAINT "sale_return_method_ck" CHECK ("sales"."sale_return"."refund_method" in ('cash', 'transfer', 'card', 'store_credit'))
);
--> statement-breakpoint
CREATE TABLE "sales"."sale_return_line" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"return_id" uuid NOT NULL,
	"sale_line_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"refund_vnd" bigint NOT NULL,
	"restock" boolean NOT NULL,
	CONSTRAINT "sale_return_line_qty_ck" CHECK ("sales"."sale_return_line"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "sales"."shift" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"shift_no" integer NOT NULL,
	"register_id" uuid NOT NULL,
	"opened_by" uuid NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"float_vnd" bigint NOT NULL,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"counted_vnd" bigint,
	"denominations" jsonb,
	"expected_vnd" bigint,
	"variance_vnd" bigint,
	"variance_reason" text,
	CONSTRAINT "shift_float_ck" CHECK ("sales"."shift"."float_vnd" >= 0),
	CONSTRAINT "shift_variance_reason_ck" CHECK ("sales"."shift"."closed_at" is null or "sales"."shift"."variance_vnd" = 0 or ("sales"."shift"."variance_reason" is not null and btrim("sales"."shift"."variance_reason") <> ''))
);
--> statement-breakpoint
CREATE TABLE "reports"."cashier_sales_monthly" (
	"month" text NOT NULL,
	"cashier_id" uuid NOT NULL,
	"net_sales_vnd" bigint NOT NULL,
	CONSTRAINT "cashier_sales_monthly_month_cashier_id_pk" PRIMARY KEY("month","cashier_id")
);
--> statement-breakpoint
CREATE TABLE "reports"."item_sales_daily" (
	"day" date NOT NULL,
	"item_id" uuid NOT NULL,
	"category_id" uuid,
	"units" integer NOT NULL,
	"revenue_vnd" bigint NOT NULL,
	CONSTRAINT "item_sales_daily_day_item_id_pk" PRIMARY KEY("day","item_id")
);
--> statement-breakpoint
ALTER TABLE "platform"."app_user" ADD CONSTRAINT "app_user_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "platform"."role"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."approval_token" ADD CONSTRAINT "approval_token_approver_id_app_user_id_fk" FOREIGN KEY ("approver_id") REFERENCES "platform"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."approval_token" ADD CONSTRAINT "approval_token_requester_id_app_user_id_fk" FOREIGN KEY ("requester_id") REFERENCES "platform"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."role_permission" ADD CONSTRAINT "role_permission_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "platform"."role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."session" ADD CONSTRAINT "session_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "platform"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."barcode" ADD CONSTRAINT "barcode_variant_id_item_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "catalog"."item_variant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."bundle_component" ADD CONSTRAINT "bundle_component_bundle_variant_id_item_variant_id_fk" FOREIGN KEY ("bundle_variant_id") REFERENCES "catalog"."item_variant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."bundle_component" ADD CONSTRAINT "bundle_component_component_variant_id_item_variant_id_fk" FOREIGN KEY ("component_variant_id") REFERENCES "catalog"."item_variant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."category" ADD CONSTRAINT "category_parent_id_category_id_fk" FOREIGN KEY ("parent_id") REFERENCES "catalog"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."import_row" ADD CONSTRAINT "import_row_job_id_import_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "catalog"."import_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."item" ADD CONSTRAINT "item_publisher_id_publisher_id_fk" FOREIGN KEY ("publisher_id") REFERENCES "catalog"."publisher"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."item" ADD CONSTRAINT "item_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "catalog"."brand"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."item_category" ADD CONSTRAINT "item_category_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "catalog"."item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."item_category" ADD CONSTRAINT "item_category_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "catalog"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."item_image" ADD CONSTRAINT "item_image_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "catalog"."item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."item_variant" ADD CONSTRAINT "item_variant_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "catalog"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."price_history" ADD CONSTRAINT "price_history_variant_id_item_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "catalog"."item_variant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory"."stock_adjustment" ADD CONSTRAINT "stock_adjustment_variant_id_item_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "catalog"."item_variant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory"."stock_adjustment" ADD CONSTRAINT "stock_adjustment_movement_id_stock_movement_id_fk" FOREIGN KEY ("movement_id") REFERENCES "inventory"."stock_movement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory"."stock_count_line" ADD CONSTRAINT "stock_count_line_count_id_stock_count_id_fk" FOREIGN KEY ("count_id") REFERENCES "inventory"."stock_count"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory"."stock_count_line" ADD CONSTRAINT "stock_count_line_variant_id_item_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "catalog"."item_variant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory"."stock_level" ADD CONSTRAINT "stock_level_variant_id_item_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "catalog"."item_variant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory"."stock_movement" ADD CONSTRAINT "stock_movement_variant_id_item_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "catalog"."item_variant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory"."stock_reservation" ADD CONSTRAINT "stock_reservation_variant_id_item_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "catalog"."item_variant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchasing"."consignment_allocation" ADD CONSTRAINT "consignment_allocation_lot_id_consignment_lot_id_fk" FOREIGN KEY ("lot_id") REFERENCES "purchasing"."consignment_lot"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchasing"."consignment_lot" ADD CONSTRAINT "consignment_lot_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "purchasing"."supplier"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchasing"."consignment_lot" ADD CONSTRAINT "consignment_lot_variant_id_item_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "catalog"."item_variant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchasing"."consignment_lot" ADD CONSTRAINT "consignment_lot_stock_in_line_id_stock_in_line_id_fk" FOREIGN KEY ("stock_in_line_id") REFERENCES "purchasing"."stock_in_line"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchasing"."consignment_return" ADD CONSTRAINT "consignment_return_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "purchasing"."supplier"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchasing"."consignment_return" ADD CONSTRAINT "consignment_return_lot_id_consignment_lot_id_fk" FOREIGN KEY ("lot_id") REFERENCES "purchasing"."consignment_lot"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchasing"."consignment_statement" ADD CONSTRAINT "consignment_statement_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "purchasing"."supplier"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchasing"."consignment_statement" ADD CONSTRAINT "consignment_statement_payable_id_payable_id_fk" FOREIGN KEY ("payable_id") REFERENCES "purchasing"."payable"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchasing"."payable" ADD CONSTRAINT "payable_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "purchasing"."supplier"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchasing"."payable_payment" ADD CONSTRAINT "payable_payment_payable_id_payable_id_fk" FOREIGN KEY ("payable_id") REFERENCES "purchasing"."payable"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchasing"."stock_in_entry" ADD CONSTRAINT "stock_in_entry_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "purchasing"."supplier"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchasing"."stock_in_line" ADD CONSTRAINT "stock_in_line_entry_id_stock_in_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "purchasing"."stock_in_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchasing"."stock_in_line" ADD CONSTRAINT "stock_in_line_variant_id_item_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "catalog"."item_variant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchasing"."stock_in_line" ADD CONSTRAINT "stock_in_line_order_line_id_supplier_order_line_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "purchasing"."supplier_order_line"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchasing"."supplier_order" ADD CONSTRAINT "supplier_order_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "purchasing"."supplier"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchasing"."supplier_order_line" ADD CONSTRAINT "supplier_order_line_order_id_supplier_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "purchasing"."supplier_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchasing"."supplier_order_line" ADD CONSTRAINT "supplier_order_line_variant_id_item_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "catalog"."item_variant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."coupon" ADD CONSTRAINT "coupon_promotion_id_promotion_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "crm"."promotion"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."customer" ADD CONSTRAINT "customer_tier_id_tier_id_fk" FOREIGN KEY ("tier_id") REFERENCES "crm"."tier"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."customer_consent" ADD CONSTRAINT "customer_consent_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "crm"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."customer_contact" ADD CONSTRAINT "customer_contact_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "crm"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."customer_tier_history" ADD CONSTRAINT "customer_tier_history_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "crm"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."customer_tier_history" ADD CONSTRAINT "customer_tier_history_tier_id_tier_id_fk" FOREIGN KEY ("tier_id") REFERENCES "crm"."tier"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."points_ledger" ADD CONSTRAINT "points_ledger_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "crm"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."promotion_usage" ADD CONSTRAINT "promotion_usage_promotion_id_promotion_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "crm"."promotion"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."promotion_version" ADD CONSTRAINT "promotion_version_promotion_id_promotion_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "crm"."promotion"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."cash_movement" ADD CONSTRAINT "cash_movement_shift_id_shift_id_fk" FOREIGN KEY ("shift_id") REFERENCES "sales"."shift"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."einvoice_job" ADD CONSTRAINT "einvoice_job_sale_id_sale_id_fk" FOREIGN KEY ("sale_id") REFERENCES "sales"."sale"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."held_cart" ADD CONSTRAINT "held_cart_register_id_register_id_fk" FOREIGN KEY ("register_id") REFERENCES "sales"."register"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."pos_device" ADD CONSTRAINT "pos_device_register_id_register_id_fk" FOREIGN KEY ("register_id") REFERENCES "sales"."register"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."pos_inbox" ADD CONSTRAINT "pos_inbox_device_id_pos_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "sales"."pos_device"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."sale" ADD CONSTRAINT "sale_device_id_pos_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "sales"."pos_device"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."sale" ADD CONSTRAINT "sale_shift_id_shift_id_fk" FOREIGN KEY ("shift_id") REFERENCES "sales"."shift"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."sale" ADD CONSTRAINT "sale_cashier_id_app_user_id_fk" FOREIGN KEY ("cashier_id") REFERENCES "platform"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."sale" ADD CONSTRAINT "sale_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "crm"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."sale_line" ADD CONSTRAINT "sale_line_sale_id_sale_id_fk" FOREIGN KEY ("sale_id") REFERENCES "sales"."sale"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."sale_line" ADD CONSTRAINT "sale_line_variant_id_item_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "catalog"."item_variant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."sale_payment" ADD CONSTRAINT "sale_payment_sale_id_sale_id_fk" FOREIGN KEY ("sale_id") REFERENCES "sales"."sale"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."sale_return" ADD CONSTRAINT "sale_return_sale_id_sale_id_fk" FOREIGN KEY ("sale_id") REFERENCES "sales"."sale"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."sale_return" ADD CONSTRAINT "sale_return_shift_id_shift_id_fk" FOREIGN KEY ("shift_id") REFERENCES "sales"."shift"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."sale_return_line" ADD CONSTRAINT "sale_return_line_return_id_sale_return_id_fk" FOREIGN KEY ("return_id") REFERENCES "sales"."sale_return"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."sale_return_line" ADD CONSTRAINT "sale_return_line_sale_line_id_sale_line_id_fk" FOREIGN KEY ("sale_line_id") REFERENCES "sales"."sale_line"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."shift" ADD CONSTRAINT "shift_register_id_register_id_fk" FOREIGN KEY ("register_id") REFERENCES "sales"."register"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."shift" ADD CONSTRAINT "shift_opened_by_app_user_id_fk" FOREIGN KEY ("opened_by") REFERENCES "platform"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales"."shift" ADD CONSTRAINT "shift_closed_by_app_user_id_fk" FOREIGN KEY ("closed_by") REFERENCES "platform"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_user_username_uq" ON "platform"."app_user" USING btree (lower("username"));--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "platform"."audit_entry" USING btree ("entity","entity_id","at");--> statement-breakpoint
CREATE INDEX "audit_actor_idx" ON "platform"."audit_entry" USING btree ("actor_id","at");--> statement-breakpoint
CREATE INDEX "file_owner_idx" ON "platform"."file" USING btree ("owner_type","owner_id");--> statement-breakpoint
CREATE INDEX "login_attempt_user_at_idx" ON "platform"."login_attempt" USING btree ("username","at");--> statement-breakpoint
CREATE INDEX "notification_to_idx" ON "platform"."notification" USING btree ("channel","to","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_template_uq" ON "platform"."notification_template" USING btree ("key","locale");--> statement-breakpoint
CREATE INDEX "outbox_unprocessed_idx" ON "platform"."outbox_event" USING btree ("created_at") WHERE "platform"."outbox_event"."processed_at" is null;--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "platform"."session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_inbox_uq" ON "platform"."webhook_inbox" USING btree ("provider","event_id");--> statement-breakpoint
CREATE INDEX "barcode_variant_idx" ON "catalog"."barcode" USING btree ("variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "brand_name_uq" ON "catalog"."brand" USING btree (lower(public.f_unaccent("i18n" -> 'en' ->> 'name')));--> statement-breakpoint
CREATE INDEX "category_parent_idx" ON "catalog"."category" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "import_row_job_row_uq" ON "catalog"."import_row" USING btree ("job_id","row_no");--> statement-breakpoint
CREATE INDEX "item_status_idx" ON "catalog"."item" USING btree ("status");--> statement-breakpoint
CREATE INDEX "item_search_trgm_idx" ON "catalog"."item" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "item_category_cat_idx" ON "catalog"."item_category" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "item_image_item_idx" ON "catalog"."item_image" USING btree ("item_id","sort");--> statement-breakpoint
CREATE UNIQUE INDEX "item_variant_sku_uq" ON "catalog"."item_variant" USING btree ("sku");--> statement-breakpoint
CREATE UNIQUE INDEX "item_variant_isbn_uq" ON "catalog"."item_variant" USING btree ("isbn13") WHERE "catalog"."item_variant"."isbn13" is not null;--> statement-breakpoint
CREATE INDEX "item_variant_item_idx" ON "catalog"."item_variant" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "price_history_variant_idx" ON "catalog"."price_history" USING btree ("variant_id","effective_from" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "publisher_name_uq" ON "catalog"."publisher" USING btree (lower(public.f_unaccent("i18n" -> 'en' ->> 'name')));--> statement-breakpoint
CREATE UNIQUE INDEX "stock_count_line_uq" ON "inventory"."stock_count_line" USING btree ("count_id","variant_id");--> statement-breakpoint
CREATE INDEX "stock_movement_variant_idx" ON "inventory"."stock_movement" USING btree ("variant_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "stock_movement_ref_idx" ON "inventory"."stock_movement" USING btree ("ref_type","ref_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_reservation_ref_uq" ON "inventory"."stock_reservation" USING btree ("ref_type","ref_id","variant_id");--> statement-breakpoint
CREATE INDEX "stock_reservation_expiry_idx" ON "inventory"."stock_reservation" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "consignment_allocation_uq" ON "purchasing"."consignment_allocation" USING btree ("sale_line_id","lot_id");--> statement-breakpoint
CREATE INDEX "consignment_lot_variant_idx" ON "purchasing"."consignment_lot" USING btree ("variant_id","created_at");--> statement-breakpoint
CREATE INDEX "consignment_return_lot_idx" ON "purchasing"."consignment_return" USING btree ("lot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "consignment_statement_uq" ON "purchasing"."consignment_statement" USING btree ("supplier_id","period");--> statement-breakpoint
CREATE INDEX "payable_supplier_idx" ON "purchasing"."payable" USING btree ("supplier_id","status");--> statement-breakpoint
CREATE INDEX "payable_payment_payable_idx" ON "purchasing"."payable_payment" USING btree ("payable_id");--> statement-breakpoint
CREATE INDEX "stock_in_entry_supplier_idx" ON "purchasing"."stock_in_entry" USING btree ("supplier_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_in_line_entry_idx" ON "purchasing"."stock_in_line" USING btree ("entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_tax_code_uq" ON "purchasing"."supplier" USING btree ("tax_code") WHERE "purchasing"."supplier"."tax_code" is not null;--> statement-breakpoint
CREATE INDEX "supplier_order_line_order_idx" ON "purchasing"."supplier_order_line" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coupon_code_uq" ON "crm"."coupon" USING btree (upper("code"));--> statement-breakpoint
CREATE UNIQUE INDEX "customer_phone_uq" ON "crm"."customer" USING btree ("phone_e164") WHERE "crm"."customer"."phone_e164" is not null;--> statement-breakpoint
CREATE INDEX "customer_search_trgm_idx" ON "crm"."customer" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "customer_consent_customer_idx" ON "crm"."customer_consent" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "customer_contact_customer_idx" ON "crm"."customer_contact" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "customer_tier_history_customer_idx" ON "crm"."customer_tier_history" USING btree ("customer_id","from_at");--> statement-breakpoint
CREATE INDEX "points_ledger_customer_idx" ON "crm"."points_ledger" USING btree ("customer_id","at");--> statement-breakpoint
CREATE INDEX "promotion_usage_promo_idx" ON "crm"."promotion_usage" USING btree ("promotion_id","customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "promotion_version_uq" ON "crm"."promotion_version" USING btree ("promotion_id","version");--> statement-breakpoint
CREATE INDEX "cash_movement_shift_idx" ON "sales"."cash_movement" USING btree ("shift_id");--> statement-breakpoint
CREATE UNIQUE INDEX "einvoice_job_sale_uq" ON "sales"."einvoice_job" USING btree ("sale_id") WHERE "sales"."einvoice_job"."sale_id" is not null;--> statement-breakpoint
CREATE INDEX "einvoice_job_status_idx" ON "sales"."einvoice_job" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "held_cart_register_idx" ON "sales"."held_cart" USING btree ("register_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_inbox_uq" ON "sales"."pos_inbox" USING btree ("device_id","client_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sale_device_event_uq" ON "sales"."sale" USING btree ("device_id","client_event_id") WHERE "sales"."sale"."client_event_id" is not null;--> statement-breakpoint
CREATE INDEX "sale_sold_at_idx" ON "sales"."sale" USING btree ("sold_at");--> statement-breakpoint
CREATE INDEX "sale_customer_idx" ON "sales"."sale" USING btree ("customer_id","sold_at");--> statement-breakpoint
CREATE INDEX "sale_cashier_idx" ON "sales"."sale" USING btree ("cashier_id","sold_at");--> statement-breakpoint
CREATE INDEX "sale_shift_idx" ON "sales"."sale" USING btree ("shift_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sale_line_no_uq" ON "sales"."sale_line" USING btree ("sale_id","line_no");--> statement-breakpoint
CREATE INDEX "sale_line_variant_idx" ON "sales"."sale_line" USING btree ("variant_id","sale_id");--> statement-breakpoint
CREATE INDEX "sale_payment_sale_idx" ON "sales"."sale_payment" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sale_return_sale_idx" ON "sales"."sale_return" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sale_return_line_sale_line_idx" ON "sales"."sale_return_line" USING btree ("sale_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shift_one_open_per_register_uq" ON "sales"."shift" USING btree ("register_id") WHERE "sales"."shift"."closed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "shift_no_uq" ON "sales"."shift" USING btree ("shift_no");