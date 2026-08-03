CREATE TABLE "rogue_raise"."repo_review_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"file_path" text,
	"author_role" text NOT NULL,
	"author_label" text,
	"body" text NOT NULL,
	"decision" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rogue_raise"."repo_review_comments" ADD CONSTRAINT "repo_review_comments_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "rogue_raise"."events"("id") ON DELETE no action ON UPDATE no action;