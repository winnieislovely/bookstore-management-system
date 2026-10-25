CREATE TABLE "platform"."download_token" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"report" text NOT NULL,
	"params" jsonb NOT NULL,
	"format" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "download_token_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "platform"."download_token" ADD CONSTRAINT "download_token_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "platform"."app_user"("id") ON DELETE no action ON UPDATE no action;