/**
 * The agent catalog — PRD §11.2 expressed as data rather than prose.
 *
 * Every agent declares three things the runtime enforces:
 *   - `triggerStatuses` — the `Event.status` values during which it may run.
 *     `Event.status` is the single source of truth for what is unlocked (PRD §4),
 *     so this is checked before any model call, not after.
 *   - `assetTypes` — what it is allowed to produce. An agent writing an asset
 *     type it never declared is a bug the writer refuses.
 *   - `reviewGate` — who must approve the output. Human-in-the-loop is mandatory
 *     for anything that reaches a participant (PRD §11.1); `auto` exists only for
 *     the categorizer, whose output is internal statistics.
 *
 * Adding an agent means adding a row here and registering a handler — the
 * lifecycle, auditing, versioning, and secret scanning come for free.
 */

/** Matches the `agent_run_type` Postgres enum. */
export type AgentType =
  | "context_research_repo"
  | "judge_invitation_email"
  | "kickoff_deck"
  | "tech_sponsor_press_outreach"
  | "social_marketing"
  | "landing_page_content"
  | "submission_categorizer";

/** Matches the `asset_type` Postgres enum. */
export type AssetType =
  | "research_doc"
  | "stakeholder_preferences"
  | "example_prd"
  | "setup_agent_instructions"
  | "judge_email"
  | "kickoff_deck"
  | "outreach_template"
  | "social_post"
  | "landing_page_content"
  | "faq";

/**
 * Who must approve before the output can be used. `auto` means there is nothing
 * participant-facing to approve — it does NOT mean "publishes itself".
 */
export type ReviewGate =
  | "admin"
  | "admin_and_stakeholders"
  | "admin_and_sponsor"
  | "auto";

export interface AgentDefinition {
  type: AgentType;
  /** Short human label for the console. */
  label: string;
  /** One line on what it does, in staff language. */
  description: string;
  /** PRD phase, for grouping in the console. */
  phase: string;
  triggerStatuses: readonly string[];
  assetTypes: readonly AssetType[];
  reviewGate: ReviewGate;
  /** `[MUST]` / `[SHOULD]` from the PRD — drives build order, not runtime. */
  priority: "must" | "should";
}

export const AGENT_CATALOG: Record<AgentType, AgentDefinition> = {
  context_research_repo: {
    type: "context_research_repo",
    label: "Context research → repo",
    description:
      "Researches the sponsor's problem domain and drafts the starter repo: research notes, stakeholder preferences, example PRDs, and setup instructions.",
    phase: "1.2",
    triggerStatuses: ["intake_complete", "repo_review"],
    assetTypes: [
      "research_doc",
      "stakeholder_preferences",
      "example_prd",
      "setup_agent_instructions",
    ],
    reviewGate: "admin_and_stakeholders",
    priority: "must",
  },
  judge_invitation_email: {
    type: "judge_invitation_email",
    label: "Judge invitation emails",
    description:
      "Drafts a personal invitation to each judge the sponsor named, in the voice of the event.",
    phase: "1.2",
    // Contiguous from intake onward: judges can be invited as soon as the
    // sponsor has named them, and being blocked during repo review would be an
    // artificial hole in the middle of the flow.
    triggerStatuses: [
      "intake_complete",
      "repo_review",
      "repo_approved",
      "registration_open",
    ],
    assetTypes: ["judge_email"],
    reviewGate: "admin",
    priority: "must",
  },
  kickoff_deck: {
    type: "kickoff_deck",
    label: "Kickoff deck",
    description:
      "Builds the Friday-evening kickoff deck from the intake and the confirmed weekend.",
    phase: "1.2",
    triggerStatuses: ["repo_approved", "registration_open"],
    assetTypes: ["kickoff_deck"],
    reviewGate: "admin",
    priority: "should",
  },
  tech_sponsor_press_outreach: {
    type: "tech_sponsor_press_outreach",
    label: "Technical-sponsor & press outreach",
    description:
      "Drafts outreach to technical sponsors and local press for this specific build.",
    phase: "1.3",
    triggerStatuses: ["repo_approved", "registration_open"],
    assetTypes: ["outreach_template"],
    reviewGate: "admin_and_sponsor",
    priority: "should",
  },
  social_marketing: {
    type: "social_marketing",
    label: "Social marketing posts",
    description:
      "Drafts platform-appropriate posts announcing the raise and calling for builders.",
    phase: "1.3",
    triggerStatuses: ["repo_approved", "registration_open"],
    assetTypes: ["social_post"],
    reviewGate: "admin",
    priority: "should",
  },
  landing_page_content: {
    type: "landing_page_content",
    label: "Landing page content & FAQ",
    description:
      "Writes the event landing page copy and the FAQ participants actually ask.",
    phase: "1.3",
    triggerStatuses: ["repo_approved", "registration_open"],
    assetTypes: ["landing_page_content", "faq"],
    reviewGate: "admin",
    priority: "should",
  },
  submission_categorizer: {
    type: "submission_categorizer",
    label: "Submission categorizer & LOC",
    description:
      "Categorizes what got built and totals lines of code once submissions close.",
    phase: "4",
    triggerStatuses: ["judging", "completed"],
    // Writes statistics onto submissions rather than producing a document.
    assetTypes: [],
    reviewGate: "auto",
    priority: "must",
  },
};

export const AGENT_TYPES = Object.keys(AGENT_CATALOG) as AgentType[];

export function getAgentDefinition(type: string): AgentDefinition | undefined {
  return AGENT_CATALOG[type as AgentType];
}

/** True when this agent may run against an event in `eventStatus`. */
export function canTriggerAgent(type: string, eventStatus: string): boolean {
  const definition = getAgentDefinition(type);
  if (!definition) return false;
  return definition.triggerStatuses.includes(eventStatus);
}

/** True when `assetType` is one this agent declared it produces. */
export function producesAssetType(type: string, assetType: string): boolean {
  const definition = getAgentDefinition(type);
  if (!definition) return false;
  return (definition.assetTypes as readonly string[]).includes(assetType);
}

/** Human-readable list of the statuses an agent can run in, for error copy. */
export function describeTriggerStatuses(type: string): string {
  const definition = getAgentDefinition(type);
  if (!definition) return "";
  return definition.triggerStatuses.join(", ");
}
