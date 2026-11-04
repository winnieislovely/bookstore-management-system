CREATE TABLE "library"."lib_payment" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"doc_no" text NOT NULL,
	"kind" text DEFAULT 'receipt' NOT NULL,
	"customer_id" uuid NOT NULL,
	"method" text NOT NULL,
	"amount_vnd" bigint NOT NULL,
	"ref" text,
	"refund_of" uuid,
	"reason" text,
	"received_by" uuid,
	"received_at" timestamp with time zone NOT NULL,
	CONSTRAINT "lib_payment_docNo_unique" UNIQUE("doc_no"),
	CONSTRAINT "lib_payment_kind_ck" CHECK ("library"."lib_payment"."kind" in ('receipt', 'refund')),
	CONSTRAINT "lib_payment_method_ck" CHECK ("library"."lib_payment"."method" in ('cash', 'transfer', 'card')),
	CONSTRAINT "lib_payment_sign_ck" CHECK (("library"."lib_payment"."kind" = 'receipt') = ("library"."lib_payment"."amount_vnd" > 0))
);
--> statement-breakpoint
ALTER TABLE "library"."lib_charge" DROP CONSTRAINT "lib_charge_paid_ck";--> statement-breakpoint
ALTER TABLE "library"."lib_charge" ADD COLUMN "payment_id" uuid;--> statement-breakpoint
ALTER TABLE "library"."lib_payment" ADD CONSTRAINT "lib_payment_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "crm"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library"."lib_payment" ADD CONSTRAINT "lib_payment_received_by_app_user_id_fk" FOREIGN KEY ("received_by") REFERENCES "platform"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lib_payment_received_idx" ON "library"."lib_payment" USING btree ("received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "lib_payment_refund_uq" ON "library"."lib_payment" USING btree ("refund_of") WHERE "library"."lib_payment"."refund_of" is not null;--> statement-breakpoint
ALTER TABLE "library"."lib_charge" ADD CONSTRAINT "lib_charge_payment_id_lib_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "library"."lib_payment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library"."lib_charge" ADD CONSTRAINT "lib_charge_paid_ck" CHECK (("library"."lib_charge"."status" = 'paid') = ("library"."lib_charge"."sale_id" is not null or "library"."lib_charge"."payment_id" is not null));--> statement-breakpoint
DELETE FROM "platform"."setting" WHERE "key" = 'library.vat_bp';
