CREATE TABLE "library"."lib_count" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"doc_no" text NOT NULL,
	"scope" jsonb NOT NULL,
	"blind" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_by" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lib_count_docNo_unique" UNIQUE("doc_no"),
	CONSTRAINT "lib_count_status_ck" CHECK ("library"."lib_count"."status" in ('open', 'submitted', 'approved', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "library"."lib_count_line" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"count_id" uuid NOT NULL,
	"copy_id" uuid NOT NULL,
	"in_scope" boolean DEFAULT true NOT NULL,
	"expected_shelf" text,
	"expected_status" text NOT NULL,
	"found" boolean,
	"checked_at" timestamp with time zone,
	"checked_by" uuid,
	CONSTRAINT "lib_count_line_status_ck" CHECK ("library"."lib_count_line"."expected_status" in ('available', 'reserved', 'on_loan', 'lost', 'damaged'))
);
--> statement-breakpoint
ALTER TABLE "library"."lib_count" ADD CONSTRAINT "lib_count_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "platform"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library"."lib_count" ADD CONSTRAINT "lib_count_approved_by_app_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "platform"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library"."lib_count_line" ADD CONSTRAINT "lib_count_line_count_id_lib_count_id_fk" FOREIGN KEY ("count_id") REFERENCES "library"."lib_count"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library"."lib_count_line" ADD CONSTRAINT "lib_count_line_copy_id_lib_copy_id_fk" FOREIGN KEY ("copy_id") REFERENCES "library"."lib_copy"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library"."lib_count_line" ADD CONSTRAINT "lib_count_line_checked_by_app_user_id_fk" FOREIGN KEY ("checked_by") REFERENCES "platform"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lib_count_created_idx" ON "library"."lib_count" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "lib_count_line_uq" ON "library"."lib_count_line" USING btree ("count_id","copy_id");--> statement-breakpoint
-- Library counts (FR-LIB-04): librarians and managers count, managers approve; the owner holds every permission.
INSERT INTO "platform"."role_permission" ("role_id", "permission") SELECT "id", 'library.count' FROM "platform"."role" WHERE "code" IN ('manager', 'librarian') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "platform"."role_permission" ("role_id", "permission") SELECT "id", 'library.count_approve' FROM "platform"."role" WHERE "code" = 'manager' ON CONFLICT DO NOTHING;
