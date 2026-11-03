CREATE SCHEMA "library";
--> statement-breakpoint
CREATE TABLE "library"."lib_charge" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"customer_id" uuid NOT NULL,
	"loan_id" uuid,
	"kind" text NOT NULL,
	"list_vnd" bigint NOT NULL,
	"discount_pct" integer DEFAULT 0 NOT NULL,
	"amount_vnd" bigint NOT NULL,
	"status" text DEFAULT 'unpaid' NOT NULL,
	"sale_id" uuid,
	"paid_at" timestamp with time zone,
	"waived_by" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lib_charge_kind_ck" CHECK ("library"."lib_charge"."kind" in ('loan_fee', 'late_fee', 'lost', 'damage')),
	CONSTRAINT "lib_charge_status_ck" CHECK ("library"."lib_charge"."status" in ('unpaid', 'paid', 'waived', 'cancelled')),
	CONSTRAINT "lib_charge_amount_ck" CHECK ("library"."lib_charge"."amount_vnd" > 0 and "library"."lib_charge"."list_vnd" >= "library"."lib_charge"."amount_vnd"),
	CONSTRAINT "lib_charge_paid_ck" CHECK (("library"."lib_charge"."status" = 'paid') = ("library"."lib_charge"."sale_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "library"."lib_copy" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"title_id" uuid NOT NULL,
	"copy_no" integer NOT NULL,
	"barcode" text NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	"condition" text,
	"value_vnd" bigint DEFAULT 0 NOT NULL,
	"acquired_via" text NOT NULL,
	"acquired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"shelf" text,
	"source_variant_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lib_copy_status_ck" CHECK ("library"."lib_copy"."status" in ('available', 'reserved', 'on_loan', 'lost', 'damaged')),
	CONSTRAINT "lib_copy_via_ck" CHECK ("library"."lib_copy"."acquired_via" in ('purchase', 'donation', 'transfer')),
	CONSTRAINT "lib_copy_value_ck" CHECK ("library"."lib_copy"."value_vnd" >= 0)
);
--> statement-breakpoint
CREATE TABLE "library"."lib_reservation" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"title_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"queued_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"copy_id" uuid,
	"hold_until" timestamp with time zone,
	"created_by" uuid,
	CONSTRAINT "lib_reservation_status_ck" CHECK ("library"."lib_reservation"."status" in ('queued', 'held', 'collected', 'expired', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "library"."lib_title" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"authors" text[] DEFAULT '{}'::text[] NOT NULL,
	"isbn13" text,
	"publisher" text,
	"year" integer,
	"language" text NOT NULL,
	"category" text,
	"call_no" text,
	"search_text" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "lib_title_language_ck" CHECK ("library"."lib_title"."language" in ('vi', 'en'))
);
--> statement-breakpoint
CREATE TABLE "library"."loan" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"copy_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"loaned_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"returned_at" timestamp with time zone,
	"closed_as" text,
	"renewals" integer DEFAULT 0 NOT NULL,
	"return_condition" text,
	"created_by" uuid,
	"closed_by" uuid,
	CONSTRAINT "loan_closed_as_ck" CHECK (("library"."loan"."returned_at" is null) = ("library"."loan"."closed_as" is null) and ("library"."loan"."closed_as" is null or "library"."loan"."closed_as" in ('returned', 'lost')))
);
--> statement-breakpoint
CREATE TABLE "library"."loan_renewal" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"loan_id" uuid NOT NULL,
	"renewed_at" timestamp with time zone NOT NULL,
	"new_due_at" timestamp with time zone NOT NULL,
	"by" uuid
);
--> statement-breakpoint
ALTER TABLE "sales"."sale_line" DROP CONSTRAINT "sale_line_class_ck";--> statement-breakpoint
ALTER TABLE "library"."lib_charge" ADD CONSTRAINT "lib_charge_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "crm"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library"."lib_charge" ADD CONSTRAINT "lib_charge_loan_id_loan_id_fk" FOREIGN KEY ("loan_id") REFERENCES "library"."loan"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library"."lib_charge" ADD CONSTRAINT "lib_charge_sale_id_sale_id_fk" FOREIGN KEY ("sale_id") REFERENCES "sales"."sale"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library"."lib_charge" ADD CONSTRAINT "lib_charge_waived_by_app_user_id_fk" FOREIGN KEY ("waived_by") REFERENCES "platform"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library"."lib_copy" ADD CONSTRAINT "lib_copy_title_id_lib_title_id_fk" FOREIGN KEY ("title_id") REFERENCES "library"."lib_title"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library"."lib_reservation" ADD CONSTRAINT "lib_reservation_title_id_lib_title_id_fk" FOREIGN KEY ("title_id") REFERENCES "library"."lib_title"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library"."lib_reservation" ADD CONSTRAINT "lib_reservation_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "crm"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library"."lib_reservation" ADD CONSTRAINT "lib_reservation_copy_id_lib_copy_id_fk" FOREIGN KEY ("copy_id") REFERENCES "library"."lib_copy"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library"."lib_reservation" ADD CONSTRAINT "lib_reservation_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "platform"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library"."loan" ADD CONSTRAINT "loan_copy_id_lib_copy_id_fk" FOREIGN KEY ("copy_id") REFERENCES "library"."lib_copy"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library"."loan" ADD CONSTRAINT "loan_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "crm"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library"."loan" ADD CONSTRAINT "loan_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "platform"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library"."loan" ADD CONSTRAINT "loan_closed_by_app_user_id_fk" FOREIGN KEY ("closed_by") REFERENCES "platform"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library"."loan_renewal" ADD CONSTRAINT "loan_renewal_loan_id_loan_id_fk" FOREIGN KEY ("loan_id") REFERENCES "library"."loan"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library"."loan_renewal" ADD CONSTRAINT "loan_renewal_by_app_user_id_fk" FOREIGN KEY ("by") REFERENCES "platform"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lib_charge_customer_idx" ON "library"."lib_charge" USING btree ("customer_id","status");--> statement-breakpoint
CREATE INDEX "lib_charge_sale_idx" ON "library"."lib_charge" USING btree ("sale_id") WHERE "library"."lib_charge"."sale_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "lib_copy_barcode_uq" ON "library"."lib_copy" USING btree ("barcode");--> statement-breakpoint
CREATE UNIQUE INDEX "lib_copy_no_uq" ON "library"."lib_copy" USING btree ("title_id","copy_no");--> statement-breakpoint
CREATE INDEX "lib_copy_status_idx" ON "library"."lib_copy" USING btree ("title_id","status");--> statement-breakpoint
CREATE INDEX "lib_reservation_title_idx" ON "library"."lib_reservation" USING btree ("title_id","queued_at");--> statement-breakpoint
CREATE UNIQUE INDEX "lib_reservation_open_uq" ON "library"."lib_reservation" USING btree ("title_id","customer_id") WHERE "library"."lib_reservation"."status" in ('queued', 'held');--> statement-breakpoint
CREATE UNIQUE INDEX "lib_title_code_uq" ON "library"."lib_title" USING btree (lower("code"));--> statement-breakpoint
CREATE INDEX "lib_title_search_trgm_idx" ON "library"."lib_title" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "loan_open_copy_uq" ON "library"."loan" USING btree ("copy_id") WHERE "library"."loan"."returned_at" is null;--> statement-breakpoint
CREATE INDEX "loan_customer_idx" ON "library"."loan" USING btree ("customer_id","returned_at");--> statement-breakpoint
CREATE INDEX "loan_due_idx" ON "library"."loan" USING btree ("due_at") WHERE "library"."loan"."returned_at" is null;--> statement-breakpoint
CREATE INDEX "loan_renewal_loan_idx" ON "library"."loan_renewal" USING btree ("loan_id");--> statement-breakpoint
ALTER TABLE "sales"."sale_line" ADD CONSTRAINT "sale_line_class_ck" CHECK ("sales"."sale_line"."item_class" in ('goods', 'event_ticket', 'library_charge'));--> statement-breakpoint
-- Library rules reworked (BR-13): renewals add a whole loan period, so renewal_days is gone; no deposit.
DELETE FROM "platform"."setting" WHERE "key" IN ('library.renewal_days', 'library.deposit_vnd');
