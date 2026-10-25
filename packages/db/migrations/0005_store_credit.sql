CREATE TABLE "crm"."store_credit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"customer_id" uuid NOT NULL,
	"delta_vnd" bigint NOT NULL,
	"reason" text NOT NULL,
	"ref_type" text,
	"ref_id" uuid,
	"note" text,
	"actor_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_credit_ledger_reason_ck" CHECK ("crm"."store_credit_ledger"."reason" in ('refund', 'spend', 'spend_reversal', 'adjust')),
	CONSTRAINT "store_credit_ledger_delta_ck" CHECK ("crm"."store_credit_ledger"."delta_vnd" <> 0)
);
--> statement-breakpoint
ALTER TABLE "sales"."sale_payment" DROP CONSTRAINT "sale_payment_method_ck";--> statement-breakpoint
ALTER TABLE "crm"."customer" ADD COLUMN "store_credit_vnd" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "crm"."store_credit_ledger" ADD CONSTRAINT "store_credit_ledger_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "crm"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "store_credit_ledger_customer_idx" ON "crm"."store_credit_ledger" USING btree ("customer_id","at");--> statement-breakpoint
ALTER TABLE "crm"."customer" ADD CONSTRAINT "customer_store_credit_ck" CHECK ("crm"."customer"."store_credit_vnd" >= 0);--> statement-breakpoint
ALTER TABLE "sales"."sale_payment" ADD CONSTRAINT "sale_payment_method_ck" CHECK ("sales"."sale_payment"."method" in ('cash', 'transfer', 'card', 'store_credit'));--> statement-breakpoint
-- Store-credit ledger is append-only (FR-CRM-10, TDD §5.1).
CREATE TRIGGER store_credit_ledger_immutable BEFORE UPDATE OR DELETE ON crm.store_credit_ledger
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_change();
