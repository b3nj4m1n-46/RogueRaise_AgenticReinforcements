/**
 * Rogue Raise data model — reproduced from PRD §4 + Appendix A.
 *
 * All tables live under a dedicated `rogue_raise` Postgres schema (Neon-compatible,
 * plain-Postgres only) so they drop into WR's Neon DB at merge without colliding.
 * `Event.status` is the single source of truth for what is unlocked; every agent
 * and UI action gates on it.
 */
import { relations } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const rogueRaise = pgSchema("rogue_raise");

// Shared column builders (fresh instance per call — never spread a single builder).
const pk = () => uuid("id").defaultRandom().primaryKey();
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).defaultNow().notNull();
const ts = (name: string) => timestamp(name, { withTimezone: true });

// ---------------------------------------------------------------------------
// Enumerations (Appendix A.2)
// ---------------------------------------------------------------------------

export const eventStatus = rogueRaise.enum("event_status", [
  "draft",
  "submitted",
  "under_review",
  "approved",
  "rejected",
  "intake_pending",
  "intake_complete",
  "repo_generating",
  "repo_review",
  "repo_approved",
  "registration_open",
  "live",
  "judging",
  "completed",
  "archived",
]);

export const sponsorAppStatus = rogueRaise.enum("sponsor_app_status", [
  "submitted",
  "under_review",
  "approved",
  "rejected",
]);

export const agentRunType = rogueRaise.enum("agent_run_type", [
  "context_research_repo",
  "judge_invitation_email",
  "kickoff_deck",
  "tech_sponsor_press_outreach",
  "social_marketing",
  "landing_page_content",
  "submission_categorizer",
]);

export const agentRunStatus = rogueRaise.enum("agent_run_status", [
  "queued",
  "running",
  "paused_for_review",
  "succeeded",
  "failed",
]);

export const assetType = rogueRaise.enum("asset_type", [
  "research_doc",
  "stakeholder_preferences",
  "example_prd",
  "setup_agent_instructions",
  "judge_email",
  "kickoff_deck",
  "outreach_template",
  "social_post",
  "landing_page_content",
  "faq",
]);

export const reviewStatus = rogueRaise.enum("review_status", [
  "pending",
  "approved",
  "edit_requested",
  "rejected",
]);

export const socialPlatform = rogueRaise.enum("social_platform", [
  "instagram",
  "facebook",
  "x",
  "reddit",
]);

export const magicLinkRole = rogueRaise.enum("magic_link_role", [
  "sponsor_poc",
  "judge",
  "participant",
  "stakeholder",
]);

export const stewardshipStatus = rogueRaise.enum("stewardship_status", [
  "unmarked",
  "adopted",
  "stewarded",
  "archived",
]);

// ---------------------------------------------------------------------------
// Phase 1 — Sponsors
// ---------------------------------------------------------------------------

export const organizations = rogueRaise.table("organizations", {
  id: pk(),
  name: text("name").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sponsorApplications = rogueRaise.table("sponsor_applications", {
  id: pk(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id),
  pocName: text("poc_name").notNull(),
  pocEmail: text("poc_email").notNull(),
  pocPhone: text("poc_phone").notNull(),
  painPoints: text("pain_points").notNull(),
  goalsNeeds: text("goals_needs").notNull(),
  financialCommitmentAmount: numeric("financial_commitment_amount", {
    precision: 12,
    scale: 2,
  }),
  financialCommitmentNote: text("financial_commitment_note"),
  financialCommitmentToDiscuss: boolean("financial_commitment_to_discuss")
    .default(false)
    .notNull(),
  status: sponsorAppStatus("status").default("submitted").notNull(),
  adminNote: text("admin_note"),
  submittedAt: ts("submitted_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const events = rogueRaise.table("events", {
  id: pk(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id),
  sponsorApplicationId: uuid("sponsor_application_id").references(
    () => sponsorApplications.id,
  ),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  topicSummary: text("topic_summary"),
  status: eventStatus("status").default("draft").notNull(),
  // Confirmed schedule is the single source of truth referenced everywhere.
  confirmedFridayKickoffAt: ts("confirmed_friday_kickoff_at"),
  locationName: text("location_name").default("5 North Main Street"),
  locationAddress: text("location_address").default("Ashland, Oregon"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const stakeholders = rogueRaise.table("stakeholders", {
  id: pk(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  canAccessPortal: boolean("can_access_portal").default(false).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const eventIntakes = rogueRaise.table("event_intakes", {
  id: pk(),
  eventId: uuid("event_id")
    .notNull()
    .unique()
    .references(() => events.id),
  awardsBudgetAmount: numeric("awards_budget_amount", {
    precision: 12,
    scale: 2,
  }),
  awardsBudgetNote: text("awards_budget_note"),
  supplementaryInfo: text("supplementary_info"),
  stakeholderTechStack: text("stakeholder_tech_stack"),
  stakeholderTechTags: text("stakeholder_tech_tags").array(),
  completedAt: ts("completed_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const dateOptions = rogueRaise.table("date_options", {
  id: pk(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id),
  fridayKickoffAt: ts("friday_kickoff_at").notNull(),
  isConfirmed: boolean("is_confirmed").default(false).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const criteria = rogueRaise.table("criteria", {
  id: pk(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id),
  label: text("label").notNull(),
  description: text("description"),
  weight: numeric("weight", { precision: 6, scale: 3 }),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const techSponsors = rogueRaise.table("tech_sponsors", {
  id: pk(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id),
  name: text("name").notNull(),
  offering: text("offering"),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  status: text("status"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const attachments = rogueRaise.table("attachments", {
  id: pk(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id),
  kind: text("kind"),
  blobUrl: text("blob_url").notNull(),
  filename: text("filename"),
  contentType: text("content_type"),
  sizeBytes: integer("size_bytes"),
  isPublic: boolean("is_public").default(false).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const judges = rogueRaise.table("judges", {
  id: pk(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  title: text("title"),
  bio: text("bio"),
  headshotBlobUrl: text("headshot_blob_url"),
  expertiseTags: text("expertise_tags").array(),
  introPreference: text("intro_preference"),
  criteriaQuestions: text("criteria_questions"),
  backgroundCompletedAt: ts("background_completed_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const contextRepos = rogueRaise.table("context_repos", {
  id: pk(),
  eventId: uuid("event_id")
    .notNull()
    .unique()
    .references(() => events.id),
  githubRepoUrl: text("github_repo_url").notNull(),
  defaultBranch: text("default_branch").default("main").notNull(),
  isPublic: boolean("is_public").default(false).notNull(),
  openPrUrl: text("open_pr_url"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const agentRuns = rogueRaise.table("agent_runs", {
  id: pk(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id),
  type: agentRunType("type").notNull(),
  status: agentRunStatus("status").default("queued").notNull(),
  workflowRunId: text("workflow_run_id"),
  inputs: jsonb("inputs"),
  logs: text("logs"),
  costTokens: integer("cost_tokens").default(0).notNull(),
  error: text("error"),
  startedAt: ts("started_at"),
  finishedAt: ts("finished_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const generatedAssets = rogueRaise.table("generated_assets", {
  id: pk(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id),
  agentRunId: uuid("agent_run_id").references(() => agentRuns.id),
  type: assetType("type").notNull(),
  title: text("title"),
  body: text("body"),
  blobUrl: text("blob_url"),
  platform: socialPlatform("platform"),
  version: integer("version").default(1).notNull(),
  reviewStatus: reviewStatus("review_status").default("pending").notNull(),
  reviewNote: text("review_note"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------------------
// Phase 2 — Registration
// ---------------------------------------------------------------------------

export const participants = rogueRaise.table(
  "participants",
  {
    id: pk(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email").notNull(),
    githubUsername: text("github_username").notNull(),
    confirmationSentAt: ts("confirmation_sent_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("participants_event_email_uq").on(t.eventId, t.email)],
);

// ---------------------------------------------------------------------------
// Phase 3 — Submission & Judging
// ---------------------------------------------------------------------------

export const teams = rogueRaise.table("teams", {
  id: pk(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id),
  name: text("name").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const teamMemberships = rogueRaise.table(
  "team_memberships",
  {
    id: pk(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique("team_memberships_team_participant_uq").on(
      t.teamId,
      t.participantId,
    ),
  ],
);

export const submissions = rogueRaise.table("submissions", {
  id: pk(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id),
  teamId: uuid("team_id")
    .notNull()
    .unique()
    .references(() => teams.id),
  teamName: text("team_name").notNull(),
  projectSummary: text("project_summary").notNull(),
  repoUrl: text("repo_url").notNull(),
  pitchMaterialsUrl: text("pitch_materials_url"),
  // LOC + category are computed in Phase 4 after submissions close.
  linesOfCode: integer("lines_of_code"),
  submissionCategory: text("submission_category"),
  categorySummary: text("category_summary"),
  stewardship: stewardshipStatus("stewardship").default("unmarked").notNull(),
  submittedAt: ts("submitted_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const judgeScores = rogueRaise.table(
  "judge_scores",
  {
    id: pk(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id),
    judgeId: uuid("judge_id")
      .notNull()
      .references(() => judges.id),
    // criterion_id -> 1..5
    scores: jsonb("scores"),
    notes: text("notes"),
    finalScore: numeric("final_score", { precision: 6, scale: 3 }),
    isDraft: boolean("is_draft").default(true).notNull(),
    submittedAt: ts("submitted_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("judge_scores_submission_judge_uq").on(t.submissionId, t.judgeId),
  ],
);

export const awardCategories = rogueRaise.table("award_categories", {
  id: pk(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id),
  label: text("label").notNull(),
  description: text("description"),
  criterionId: uuid("criterion_id").references(() => criteria.id),
  winningSubmissionId: uuid("winning_submission_id").references(
    () => submissions.id,
  ),
  announcedAt: ts("announced_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------------------
// Cross-cutting
// ---------------------------------------------------------------------------

export const magicLinkTokens = rogueRaise.table("magic_link_tokens", {
  id: pk(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id),
  role: magicLinkRole("role").notNull(),
  subjectId: uuid("subject_id"),
  email: text("email").notNull(),
  // Store the hash, never the raw token.
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: ts("expires_at").notNull(),
  consumedAt: ts("consumed_at"),
  revokedAt: ts("revoked_at"),
  createdAt: createdAt(),
});

export const auditLog = rogueRaise.table("audit_log", {
  id: pk(),
  eventId: uuid("event_id").references(() => events.id),
  actor: text("actor"),
  action: text("action").notNull(),
  entity: text("entity"),
  fromValue: text("from_value"),
  toValue: text("to_value"),
  metadata: jsonb("metadata"),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const organizationsRelations = relations(organizations, ({ many }) => ({
  sponsorApplications: many(sponsorApplications),
  events: many(events),
}));

export const sponsorApplicationsRelations = relations(
  sponsorApplications,
  ({ one, many }) => ({
    organization: one(organizations, {
      fields: [sponsorApplications.orgId],
      references: [organizations.id],
    }),
    events: many(events),
  }),
);

export const eventsRelations = relations(events, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [events.orgId],
    references: [organizations.id],
  }),
  sponsorApplication: one(sponsorApplications, {
    fields: [events.sponsorApplicationId],
    references: [sponsorApplications.id],
  }),
  intake: one(eventIntakes),
  contextRepo: one(contextRepos),
  stakeholders: many(stakeholders),
  dateOptions: many(dateOptions),
  criteria: many(criteria),
  techSponsors: many(techSponsors),
  attachments: many(attachments),
  judges: many(judges),
  agentRuns: many(agentRuns),
  generatedAssets: many(generatedAssets),
  participants: many(participants),
  teams: many(teams),
  submissions: many(submissions),
  awardCategories: many(awardCategories),
}));

export const stakeholdersRelations = relations(stakeholders, ({ one }) => ({
  event: one(events, {
    fields: [stakeholders.eventId],
    references: [events.id],
  }),
}));

export const eventIntakesRelations = relations(eventIntakes, ({ one }) => ({
  event: one(events, {
    fields: [eventIntakes.eventId],
    references: [events.id],
  }),
}));

export const dateOptionsRelations = relations(dateOptions, ({ one }) => ({
  event: one(events, {
    fields: [dateOptions.eventId],
    references: [events.id],
  }),
}));

export const criteriaRelations = relations(criteria, ({ one, many }) => ({
  event: one(events, { fields: [criteria.eventId], references: [events.id] }),
  awardCategories: many(awardCategories),
}));

export const techSponsorsRelations = relations(techSponsors, ({ one }) => ({
  event: one(events, {
    fields: [techSponsors.eventId],
    references: [events.id],
  }),
}));

export const attachmentsRelations = relations(attachments, ({ one }) => ({
  event: one(events, {
    fields: [attachments.eventId],
    references: [events.id],
  }),
}));

export const judgesRelations = relations(judges, ({ one, many }) => ({
  event: one(events, { fields: [judges.eventId], references: [events.id] }),
  scores: many(judgeScores),
}));

export const contextReposRelations = relations(contextRepos, ({ one }) => ({
  event: one(events, {
    fields: [contextRepos.eventId],
    references: [events.id],
  }),
}));

export const agentRunsRelations = relations(agentRuns, ({ one, many }) => ({
  event: one(events, { fields: [agentRuns.eventId], references: [events.id] }),
  assets: many(generatedAssets),
}));

export const generatedAssetsRelations = relations(
  generatedAssets,
  ({ one }) => ({
    event: one(events, {
      fields: [generatedAssets.eventId],
      references: [events.id],
    }),
    agentRun: one(agentRuns, {
      fields: [generatedAssets.agentRunId],
      references: [agentRuns.id],
    }),
  }),
);

export const participantsRelations = relations(
  participants,
  ({ one, many }) => ({
    event: one(events, {
      fields: [participants.eventId],
      references: [events.id],
    }),
    memberships: many(teamMemberships),
  }),
);

export const teamsRelations = relations(teams, ({ one, many }) => ({
  event: one(events, { fields: [teams.eventId], references: [events.id] }),
  memberships: many(teamMemberships),
  submission: one(submissions),
}));

export const teamMembershipsRelations = relations(
  teamMemberships,
  ({ one }) => ({
    team: one(teams, {
      fields: [teamMemberships.teamId],
      references: [teams.id],
    }),
    participant: one(participants, {
      fields: [teamMemberships.participantId],
      references: [participants.id],
    }),
  }),
);

export const submissionsRelations = relations(
  submissions,
  ({ one, many }) => ({
    event: one(events, {
      fields: [submissions.eventId],
      references: [events.id],
    }),
    team: one(teams, {
      fields: [submissions.teamId],
      references: [teams.id],
    }),
    scores: many(judgeScores),
  }),
);

export const judgeScoresRelations = relations(judgeScores, ({ one }) => ({
  submission: one(submissions, {
    fields: [judgeScores.submissionId],
    references: [submissions.id],
  }),
  judge: one(judges, {
    fields: [judgeScores.judgeId],
    references: [judges.id],
  }),
}));

export const awardCategoriesRelations = relations(
  awardCategories,
  ({ one }) => ({
    event: one(events, {
      fields: [awardCategories.eventId],
      references: [events.id],
    }),
    criterion: one(criteria, {
      fields: [awardCategories.criterionId],
      references: [criteria.id],
    }),
    winningSubmission: one(submissions, {
      fields: [awardCategories.winningSubmissionId],
      references: [submissions.id],
    }),
  }),
);

export const magicLinkTokensRelations = relations(
  magicLinkTokens,
  ({ one }) => ({
    event: one(events, {
      fields: [magicLinkTokens.eventId],
      references: [events.id],
    }),
  }),
);

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  event: one(events, { fields: [auditLog.eventId], references: [events.id] }),
}));
