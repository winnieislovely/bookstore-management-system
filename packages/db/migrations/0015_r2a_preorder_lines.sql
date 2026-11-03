CREATE TABLE "orders"."preorder_line" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"preorder_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"variant_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"unit_price_vnd" bigint NOT NULL,
	"reserved_at" timestamp with time zone,
	CONSTRAINT "preorder_line_qty_ck" CHECK ("orders"."preorder_line"."qty" > 0)
);
--> statement-breakpoint
ALTER TABLE "orders"."preorder_line" ADD CONSTRAINT "preorder_line_preorder_id_preorder_id_fk" FOREIGN KEY ("preorder_id") REFERENCES "orders"."preorder"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders"."preorder_line" ADD CONSTRAINT "preorder_line_variant_id_item_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "catalog"."item_variant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "preorder_line_variant_uq" ON "orders"."preorder_line" USING btree ("preorder_id","variant_id");--> statement-breakpoint
CREATE INDEX "preorder_line_waiting_idx" ON "orders"."preorder_line" USING btree ("variant_id") WHERE "orders"."preorder_line"."reserved_at" is null;--> statement-breakpoint
-- Existing pre-orders become one line each; a held pre-order (arrived and later) has its line held.
INSERT INTO "orders"."preorder_line" ("preorder_id", "line_no", "variant_id", "qty", "unit_price_vnd", "reserved_at")
  SELECT "id", 1, "variant_id", "qty", "unit_price_vnd", CASE WHEN "status" IN ('arrived', 'contacted', 'collected') THEN coalesce("allocated_at", "created_at") END
  FROM "orders"."preorder";
