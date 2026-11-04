ALTER TABLE "library"."lib_payment" DROP CONSTRAINT "lib_payment_sign_ck";--> statement-breakpoint
ALTER TABLE "library"."loan" ADD COLUMN "slip_id" uuid;--> statement-breakpoint
ALTER TABLE "library"."loan" ADD CONSTRAINT "loan_slip_id_lib_payment_id_fk" FOREIGN KEY ("slip_id") REFERENCES "library"."lib_payment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "loan_slip_idx" ON "library"."loan" USING btree ("slip_id");--> statement-breakpoint
ALTER TABLE "library"."lib_payment" ADD CONSTRAINT "lib_payment_sign_ck" CHECK (("library"."lib_payment"."kind" = 'receipt') = ("library"."lib_payment"."amount_vnd" >= 0));--> statement-breakpoint
-- Loans from before slips: the slip is the receipt that paid the loan's first loan-fee charge.
UPDATE "library"."loan" l SET "slip_id" = c."payment_id"
FROM (
  SELECT DISTINCT ON ("loan_id") "loan_id", "payment_id"
  FROM "library"."lib_charge"
  WHERE "kind" = 'loan_fee' AND "loan_id" IS NOT NULL
  ORDER BY "loan_id", "created_at", "id"
) c
WHERE c."loan_id" = l."id" AND c."payment_id" IS NOT NULL AND l."slip_id" IS NULL;
