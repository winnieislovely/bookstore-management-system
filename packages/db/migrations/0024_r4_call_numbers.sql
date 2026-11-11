CREATE TABLE "library"."lib_accession_counter" (
	"prefix" text PRIMARY KEY NOT NULL,
	"last_no" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
DROP INDEX "library"."lib_title_code_uq";--> statement-breakpoint
ALTER TABLE "library"."lib_title" ALTER COLUMN "code" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "library"."lib_title" ADD COLUMN "dewey" text;--> statement-breakpoint
ALTER TABLE "library"."lib_title" ADD COLUMN "cutter" text;