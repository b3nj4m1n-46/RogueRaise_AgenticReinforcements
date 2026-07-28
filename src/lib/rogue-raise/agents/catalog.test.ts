import { describe, expect, it } from "vitest";

import {
  AGENT_CATALOG,
  AGENT_TYPES,
  canTriggerAgent,
  getAgentDefinition,
  producesAssetType,
} from "./catalog";

// The Postgres enums the catalog must stay in step with. Kept as literals here
// deliberately: if someone adds a catalog entry with a status or asset type the
// database doesn't have, that's a runtime insert failure — this test turns it
// into a build failure instead.
const EVENT_STATUSES = [
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
];

const ASSET_TYPES = [
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
  "submission_summary",
];

describe("AGENT_CATALOG", () => {
  it("covers every agent in the PRD §11.2 table", () => {
    expect(AGENT_TYPES).toEqual([
      "context_research_repo",
      "judge_invitation_email",
      "kickoff_deck",
      "tech_sponsor_press_outreach",
      "social_marketing",
      "landing_page_content",
      "submission_categorizer",
    ]);
  });

  it("keys every entry by its own type", () => {
    for (const [key, definition] of Object.entries(AGENT_CATALOG)) {
      expect(definition.type).toBe(key);
    }
  });

  it("only names real event statuses as triggers", () => {
    for (const definition of Object.values(AGENT_CATALOG)) {
      expect(definition.triggerStatuses.length).toBeGreaterThan(0);
      for (const status of definition.triggerStatuses) {
        expect(EVENT_STATUSES).toContain(status);
      }
    }
  });

  it("only names real asset types", () => {
    for (const definition of Object.values(AGENT_CATALOG)) {
      for (const assetType of definition.assetTypes) {
        expect(ASSET_TYPES).toContain(assetType);
      }
    }
  });

  it("gives every reviewable agent something to review", () => {
    // `auto` would mean "nothing here reaches anyone outside White Rabbit".
    // No agent currently qualifies: even the categorizer, whose numbers apply
    // themselves, drafts prose the sponsor reads.
    for (const definition of Object.values(AGENT_CATALOG)) {
      if (definition.reviewGate === "auto") continue;
      expect(definition.assetTypes.length).toBeGreaterThan(0);
    }
  });

  it("never lets an agent trigger before its inputs can exist", () => {
    // Nothing may run before the intake is complete — every agent reads the
    // intake, and before `intake_complete` there is nothing to read.
    const tooEarly = ["draft", "submitted", "under_review", "approved", "rejected", "intake_pending"];
    for (const definition of Object.values(AGENT_CATALOG)) {
      for (const status of definition.triggerStatuses) {
        expect(tooEarly).not.toContain(status);
      }
    }
  });
});

describe("canTriggerAgent", () => {
  it("allows a declared status and refuses everything else", () => {
    expect(canTriggerAgent("context_research_repo", "intake_complete")).toBe(true);
    expect(canTriggerAgent("context_research_repo", "registration_open")).toBe(false);
  });

  it("refuses an unknown agent rather than defaulting to allowed", () => {
    expect(canTriggerAgent("not_an_agent", "intake_complete")).toBe(false);
  });
});

describe("producesAssetType", () => {
  it("accepts a declared asset type", () => {
    expect(producesAssetType("context_research_repo", "research_doc")).toBe(true);
  });

  it("refuses an asset type the agent never declared", () => {
    expect(producesAssetType("context_research_repo", "social_post")).toBe(false);
    expect(producesAssetType("submission_categorizer", "faq")).toBe(false);
  });
});

describe("getAgentDefinition", () => {
  it("returns undefined for an unknown type", () => {
    expect(getAgentDefinition("nope")).toBeUndefined();
  });
});
