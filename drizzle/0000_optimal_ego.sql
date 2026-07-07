CREATE SCHEMA "rogue_raise";
--> statement-breakpoint
CREATE TYPE "rogue_raise"."agent_run_status" AS ENUM('queued', 'running', 'paused_for_review', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "rogue_raise"."agent_run_type" AS ENUM('context_research_repo', 'judge_invitation_email', 'kickoff_deck', 'tech_sponsor_press_outreach', 'social_marketing', 'landing_page_content', 'submission_categorizer');--> statement-breakpoint
CREATE TYPE "rogue_raise"."asset_type" AS ENUM('research_doc', 'stakeholder_preferences', 'example_prd', 'setup_agent_instructions', 'judge_email', 'kickoff_deck', 'outreach_template', 'social_post', 'landing_page_content', 'faq');--> statement-breakpoint
CREATE TYPE "rogue_raise"."event_status" AS ENUM('draft', 'submitted', 'under_review', 'approved', 'rejected', 'intake_pending', 'intake_complete', 'repo_generating', 'repo_review', 'repo_approved', 'registration_open', 'live', 'judging', 'completed', 'archived');--> statement-breakpoint
CREATE TYPE "rogue_raise"."magic_link_role" AS ENUM('sponsor_poc', 'judge', 'participant', 'stakeholder');--> statement-breakpoint
CREATE TYPE "rogue_raise"."review_status" AS ENUM('pending', 'approved', 'edit_requested', 'rejected');--> statement-breakpoint
CREATE TYPE "rogue_raise"."social_platform" AS ENUM('instagram', 'facebook', 'x', 'reddit');--> statement-breakpoint
CREATE TYPE "rogue_raise"."sponsor_app_status" AS ENUM('submitted', 'under_review', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "rogue_raise"."stewardship_status" AS ENUM('unmarked', 'adopted', 'stewarded', 'archived');--> statement-breakpoint
CREATE TABLE "rogue_raise"."agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"type" "rogue_raise"."agent_run_type" NOT NULL,
	"status" "rogue_raise"."agent_run_status" DEFAULT 'queued' NOT NULL,
	"workflow_run_id" text,
	"inputs" jsonb,
	"logs" text,
	"cost_tokens" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rogue_raise"."attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"kind" text,
	"blob_url" text NOT NULL,
	"filename" text,
	"content_type" text,
	"size_bytes" integer,
	"is_public" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rogue_raise"."audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid,
	"actor" text,
	"action" text NOT NULL,
	"entity" text,
	"from_value" text,
	"to_value" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rogue_raise"."award_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"criterion_id" uuid,
	"winning_submission_id" uuid,
	"announced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rogue_raise"."context_repos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"github_repo_url" text NOT NULL,
	"default_branch" text DEFAULT 'main' NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"open_pr_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "context_repos_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "rogue_raise"."criteria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"weight" numeric(6, 3),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rogue_raise"."date_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"friday_kickoff_at" timestamp with time zone NOT NULL,
	"is_confirmed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rogue_raise"."event_intakes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"awards_budget_amount" numeric(12, 2),
	"awards_budget_note" text,
	"supplementary_info" text,
	"stakeholder_tech_stack" text,
	"stakeholder_tech_tags" text[],
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_intakes_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "rogue_raise"."events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"sponsor_application_id" uuid,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"topic_summary" text,
	"status" "rogue_raise"."event_status" DEFAULT 'draft' NOT NULL,
	"confirmed_friday_kickoff_at" timestamp with time zone,
	"location_name" text DEFAULT '5 North Main Street',
	"location_address" text DEFAULT 'Ashland, Oregon',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "rogue_raise"."generated_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"agent_run_id" uuid,
	"type" "rogue_raise"."asset_type" NOT NULL,
	"title" text,
	"body" text,
	"blob_url" text,
	"platform" "rogue_raise"."social_platform",
	"version" integer DEFAULT 1 NOT NULL,
	"review_status" "rogue_raise"."review_status" DEFAULT 'pending' NOT NULL,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rogue_raise"."judge_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"judge_id" uuid NOT NULL,
	"scores" jsonb,
	"notes" text,
	"final_score" numeric(6, 3),
	"is_draft" boolean DEFAULT true NOT NULL,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "judge_scores_submission_judge_uq" UNIQUE("submission_id","judge_id")
);
--> statement-breakpoint
CREATE TABLE "rogue_raise"."judges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"title" text,
	"bio" text,
	"headshot_blob_url" text,
	"expertise_tags" text[],
	"intro_preference" text,
	"criteria_questions" text,
	"background_completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rogue_raise"."magic_link_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"role" "rogue_raise"."magic_link_role" NOT NULL,
	"subject_id" uuid,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "magic_link_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "rogue_raise"."organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rogue_raise"."participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text NOT NULL,
	"github_username" text NOT NULL,
	"confirmation_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "participants_event_email_uq" UNIQUE("event_id","email")
);
--> statement-breakpoint
CREATE TABLE "rogue_raise"."sponsor_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"poc_name" text NOT NULL,
	"poc_email" text NOT NULL,
	"poc_phone" text NOT NULL,
	"pain_points" text NOT NULL,
	"goals_needs" text NOT NULL,
	"financial_commitment_amount" numeric(12, 2),
	"financial_commitment_note" text,
	"financial_commitment_to_discuss" boolean DEFAULT false NOT NULL,
	"status" "rogue_raise"."sponsor_app_status" DEFAULT 'submitted' NOT NULL,
	"admin_note" text,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rogue_raise"."stakeholders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"can_access_portal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rogue_raise"."submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"team_name" text NOT NULL,
	"project_summary" text NOT NULL,
	"repo_url" text NOT NULL,
	"pitch_materials_url" text,
	"lines_of_code" integer,
	"submission_category" text,
	"category_summary" text,
	"stewardship" "rogue_raise"."stewardship_status" DEFAULT 'unmarked' NOT NULL,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submissions_team_id_unique" UNIQUE("team_id")
);
--> statement-breakpoint
CREATE TABLE "rogue_raise"."team_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_memberships_team_participant_uq" UNIQUE("team_id","participant_id")
);
--> statement-breakpoint
CREATE TABLE "rogue_raise"."teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rogue_raise"."tech_sponsors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"offering" text,
	"contact_name" text,
	"contact_email" text,
	"status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rogue_raise"."agent_runs" ADD CONSTRAINT "agent_runs_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "rogue_raise"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rogue_raise"."attachments" ADD CONSTRAINT "attachments_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "rogue_raise"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rogue_raise"."audit_log" ADD CONSTRAINT "audit_log_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "rogue_raise"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rogue_raise"."award_categories" ADD CONSTRAINT "award_categories_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "rogue_raise"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rogue_raise"."award_categories" ADD CONSTRAINT "award_categories_criterion_id_criteria_id_fk" FOREIGN KEY ("criterion_id") REFERENCES "rogue_raise"."criteria"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rogue_raise"."award_categories" ADD CONSTRAINT "award_categories_winning_submission_id_submissions_id_fk" FOREIGN KEY ("winning_submission_id") REFERENCES "rogue_raise"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rogue_raise"."context_repos" ADD CONSTRAINT "context_repos_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "rogue_raise"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rogue_raise"."criteria" ADD CONSTRAINT "criteria_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "rogue_raise"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rogue_raise"."date_options" ADD CONSTRAINT "date_options_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "rogue_raise"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rogue_raise"."event_intakes" ADD CONSTRAINT "event_intakes_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "rogue_raise"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rogue_raise"."events" ADD CONSTRAINT "events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "rogue_raise"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rogue_raise"."events" ADD CONSTRAINT "events_sponsor_application_id_sponsor_applications_id_fk" FOREIGN KEY ("sponsor_application_id") REFERENCES "rogue_raise"."sponsor_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rogue_raise"."generated_assets" ADD CONSTRAINT "generated_assets_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "rogue_raise"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rogue_raise"."generated_assets" ADD CONSTRAINT "generated_assets_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "rogue_raise"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rogue_raise"."judge_scores" ADD CONSTRAINT "judge_scores_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "rogue_raise"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rogue_raise"."judge_scores" ADD CONSTRAINT "judge_scores_judge_id_judges_id_fk" FOREIGN KEY ("judge_id") REFERENCES "rogue_raise"."judges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rogue_raise"."judges" ADD CONSTRAINT "judges_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "rogue_raise"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rogue_raise"."magic_link_tokens" ADD CONSTRAINT "magic_link_tokens_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "rogue_raise"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rogue_raise"."participants" ADD CONSTRAINT "participants_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "rogue_raise"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rogue_raise"."sponsor_applications" ADD CONSTRAINT "sponsor_applications_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "rogue_raise"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rogue_raise"."stakeholders" ADD CONSTRAINT "stakeholders_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "rogue_raise"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rogue_raise"."submissions" ADD CONSTRAINT "submissions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "rogue_raise"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rogue_raise"."submissions" ADD CONSTRAINT "submissions_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "rogue_raise"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rogue_raise"."team_memberships" ADD CONSTRAINT "team_memberships_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "rogue_raise"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rogue_raise"."team_memberships" ADD CONSTRAINT "team_memberships_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "rogue_raise"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rogue_raise"."teams" ADD CONSTRAINT "teams_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "rogue_raise"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rogue_raise"."tech_sponsors" ADD CONSTRAINT "tech_sponsors_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "rogue_raise"."events"("id") ON DELETE no action ON UPDATE no action;