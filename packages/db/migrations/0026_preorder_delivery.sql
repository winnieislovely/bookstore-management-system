ALTER TABLE "orders"."preorder" ADD COLUMN "delivery" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders"."preorder" ADD COLUMN "delivery_note" text;