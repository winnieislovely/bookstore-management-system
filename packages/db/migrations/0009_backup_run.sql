CREATE TABLE "platform"."backup_run" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"requested_by" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"size_bytes" bigint,
	"label" text,
	"error" text,
	CONSTRAINT "backup_run_kind" CHECK ("platform"."backup_run"."kind" in ('full', 'diff', 'dump', 'manual')),
	CONSTRAINT "backup_run_status" CHECK ("platform"."backup_run"."status" in ('requested', 'running', 'succeeded', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "platform"."backup_run" ADD CONSTRAINT "backup_run_requested_by_app_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "platform"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backup_run_recent_idx" ON "platform"."backup_run" USING btree ("requested_at");--> statement-breakpoint
CREATE UNIQUE INDEX "backup_run_one_pending" ON "platform"."backup_run" USING btree ("status") WHERE "platform"."backup_run"."status" in ('requested', 'running');