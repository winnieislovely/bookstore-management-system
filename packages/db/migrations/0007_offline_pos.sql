ALTER TABLE "sales"."pos_inbox" ADD COLUMN "exceptions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "sales"."pos_inbox" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sales"."pos_inbox" ADD COLUMN "resolved_by" uuid;--> statement-breakpoint
ALTER TABLE "sales"."pos_inbox" ADD COLUMN "resolution_note" text;--> statement-breakpoint
ALTER TABLE "sales"."shift" ADD COLUMN "device_id" uuid;--> statement-breakpoint
ALTER TABLE "sales"."shift" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "sales"."shift" ADD CONSTRAINT "shift_device_id_pos_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "sales"."pos_device"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shift_device_client_uq" ON "sales"."shift" USING btree ("device_id","client_id") WHERE "sales"."shift"."client_id" is not null;