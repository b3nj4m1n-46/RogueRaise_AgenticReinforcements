/**
 * Context research agent (PRD §5.3.1) — the document half.
 *
 * Reads the sponsor's intake and drafts the four starter-repo documents:
 * research notes, stakeholder preferences, an example PRD, and setup
 * instructions. **Pushing them to GitHub is M4** — this agent produces the
 * content; the repo-provisioning story commits it.
 *
 * The handler reads (it needs the intake) but never writes: assets go back to
 * the runner as plain data, so versioning, attribution, and the secret scan all
 * happen in one place.
 */
import { loadAdminEvent } from "../../events/queries";
import { formatWeekendLabel } from "../../intake/schedule";
import type { AgentHandler, DraftAsset } from "../registry";
import {
  buildExamplePrdPrompt,
  buildResearchPrompt,
  buildSetupInstructionsPrompt,
  buildStakeholderPreferencesPrompt,
  type DocumentPrompt,
  type EventBrief,
} from "./context-research-prompts";
import {
  buildCitationNote,
  checkCitations,
  describeReport,
  extractCitations,
  summarize,
} from "../citations";

/** Each document, in the order a builder would read them. */
const DOCUMENTS: {
  assetType: DraftAsset["type"];
  title: string;
  build: (brief: EventBrief) => DocumentPrompt;
}[] = [
  {
    assetType: "research_doc",
    title: "Research notes",
    build: buildResearchPrompt,
  },
  {
    assetType: "stakeholder_preferences",
    title: "Stakeholder preferences",
    build: buildStakeholderPreferencesPrompt,
  },
  {
    assetType: "example_prd",
    title: "Example PRD",
    build: buildExamplePrdPrompt,
  },
  {
    assetType: "setup_agent_instructions",
    title: "Setup instructions",
    build: buildSetupInstructionsPrompt,
  },
];

export const contextResearchHandler: AgentHandler = async (ctx) => {
  const detail = await loadAdminEvent(ctx.event.id);
  if (!detail) throw new Error("Event not found.");
  if (!detail.intake) {
    throw new Error(
      "This event has no intake yet — the sponsor's answers are what the research is built from.",
    );
  }

  const brief: EventBrief = {
    organizationName: detail.organizationName,
    eventTitle: detail.title,
    painPoints: detail.application?.painPoints ?? "",
    goalsNeeds: detail.application?.goalsNeeds ?? "",
    supportingContext: detail.intake.supplementaryInfo ?? "",
    technicalStack: detail.intake.stakeholderTechStack ?? "",
    technicalTags: detail.intake.stakeholderTechTags,
    attachmentNames: detail.attachments.map((a) => a.filename),
    // Descriptions only. A credential must never reach a prompt, let alone a
    // document — `offering` is what the sponsor is providing, in words.
    technicalSponsors: detail.techSponsors.map((s) => ({
      name: s.name,
      offering: s.offering,
      status: s.status,
    })),
    evaluativeCriteria: detail.criteria.map((c) => ({
      label: c.label,
      description: c.description,
    })),
    confirmedWeekend: detail.confirmedFridayKickoffAt
      ? formatWeekendLabel(new Date(detail.confirmedFridayKickoffAt))
      : null,
  };

  ctx.log(
    `Read the intake: ${brief.technicalTags.length} technology tag(s), ` +
      `${brief.attachmentNames.length} attachment(s), ` +
      `${brief.technicalSponsors.length} technical sponsor(s).`,
  );

  const assets: DraftAsset[] = [];
  let costTokens = 0;

  for (const doc of DOCUMENTS) {
    const { system, prompt } = doc.build(brief);
    // A re-run's extra steer is appended, so it shapes every document without
    // replacing the instructions that make each one what it is.
    const steer = ctx.additionalInstructions
      ? `${system}\n\nADDITIONAL INSTRUCTIONS FROM WHITE RABBIT (follow these over the general guidance above):\n${ctx.additionalInstructions}`
      : system;

    ctx.log(`Drafting ${doc.title}…`);
    const result = await ctx.ai.generate({ system: steer, prompt, maxOutputTokens: 8000 });
    costTokens += result.usage.totalTokens;

    // PRD §5.3.1 wants research documents with verifiable, REACHABLE citations.
    // A model asked to research a county's data will produce plausible URLs for
    // reports that don't exist, and a volunteer who follows a dead one on a
    // Saturday morning concludes the whole document is untrustworthy.
    //
    // The check reports; it never rewrites. A note naming the dead links is
    // appended so the record travels with the document into the repo, and the
    // reviewer decides whether to re-run, fix the source, or drop the claim.
    let body = result.text;
    const citations = extractCitations(body);
    if (citations.length > 0) {
      const report = summarize(await checkCitations(citations));
      ctx.log(`${doc.title}: ${describeReport(report)}`);
      const note = buildCitationNote(report);
      if (note) body += note;
    }

    assets.push({
      type: doc.assetType,
      title: `${doc.title} — ${brief.organizationName}`,
      body,
    });
  }

  return {
    assets,
    costTokens,
    summary: `Drafted ${assets.length} starter-repo documents from the intake.`,
  };
};
