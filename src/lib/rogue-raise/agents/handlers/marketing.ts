/**
 * The three marketing agents (PRD §5.4). They share a brief builder because
 * they're describing the same event to different audiences, and each produces
 * its own asset types.
 *
 * Social posts are stored one asset per platform, using `generated_assets.platform`
 * — the column exists for exactly this, and it means a reviewer can approve the
 * Reddit post without approving the Instagram one. That's the one place where
 * per-type versioning genuinely wants a second dimension, and the schema already
 * had it.
 */
import { loadAdminEvent } from "../../events/queries";
import { describeSchedule, formatWeekendLabel } from "../../intake/schedule";
import type { AgentHandler, DraftAsset } from "../registry";
import {
  buildFaqPrompt,
  buildLandingPagePrompt,
  buildOutreachPrompt,
  buildSocialPrompt,
  splitOutreachTemplates,
  splitSocialPosts,
  type MarketingBrief,
} from "./marketing-prompts";

async function loadBrief(eventId: string): Promise<MarketingBrief> {
  const detail = await loadAdminEvent(eventId);
  if (!detail) throw new Error("Event not found.");

  const base = (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(
    /\/+$/,
    "",
  );

  return {
    eventTitle: detail.title,
    eventSlug: detail.slug,
    organizationName: detail.organizationName,
    painPoints: detail.application?.painPoints ?? "",
    goalsNeeds: detail.application?.goalsNeeds ?? "",
    weekendLabel: detail.confirmedFridayKickoffAt
      ? formatWeekendLabel(new Date(detail.confirmedFridayKickoffAt))
      : null,
    scheduleLines: detail.confirmedFridayKickoffAt
      ? describeSchedule(new Date(detail.confirmedFridayKickoffAt))
      : [],
    locationName: detail.locationName,
    locationAddress: detail.locationAddress,
    technicalStack: detail.intake?.stakeholderTechStack ?? "",
    technicalSponsors: detail.techSponsors.map((s) => ({
      name: s.name,
      offering: s.offering,
    })),
    landingUrl: `${base}/events/${detail.slug}`,
  };
}

/** Appends a re-run's steer without replacing what makes each prompt itself. */
function steer(system: string, additional?: string): string {
  return additional
    ? `${system}\n\nADDITIONAL INSTRUCTIONS FROM WHITE RABBIT (follow these over the general guidance above):\n${additional}`
    : system;
}

export const outreachHandler: AgentHandler = async (ctx) => {
  const brief = await loadBrief(ctx.event.id);
  const { system, prompt } = buildOutreachPrompt(brief);

  ctx.log("Drafting technical-sponsor and press outreach…");
  const result = await ctx.ai.generate({
    system: steer(system, ctx.additionalInstructions),
    prompt,
    maxOutputTokens: 4000,
  });

  const templates = splitOutreachTemplates(result.text);
  ctx.log(
    templates.length > 0
      ? `Split into ${templates.length} template(s): ${templates.map((t) => t.audience).join(", ")}.`
      : "No `## TEMPLATE:` markers found — keeping the draft whole for review.",
  );

  return {
    assets: [
      {
        type: "outreach_template",
        title: `Outreach templates — ${brief.organizationName}`,
        body: result.text,
      },
    ],
    costTokens: result.usage.totalTokens,
    summary: `Drafted ${templates.length || 1} outreach template(s).`,
  };
};

export const socialMarketingHandler: AgentHandler = async (ctx) => {
  const brief = await loadBrief(ctx.event.id);
  const { system, prompt } = buildSocialPrompt(brief);

  ctx.log("Drafting social posts…");
  const result = await ctx.ai.generate({
    system: steer(system, ctx.additionalInstructions),
    prompt,
    maxOutputTokens: 4000,
  });

  const posts = splitSocialPosts(result.text);
  if (posts.length === 0) {
    // No markers — one asset holding the whole draft is still reviewable, and
    // a re-run with clearer instructions is the fix.
    ctx.log("No `## POST:` markers found — keeping the draft whole for review.");
    return {
      assets: [
        {
          type: "social_post",
          title: `Social posts — ${brief.organizationName}`,
          body: result.text,
        },
      ],
      costTokens: result.usage.totalTokens,
      summary: "Drafted social posts (unsplit — the draft had no platform markers).",
    };
  }

  ctx.log(`Split into ${posts.length} post(s): ${posts.map((p) => p.platform).join(", ")}.`);
  const assets: DraftAsset[] = posts.map((post) => ({
    type: "social_post",
    title: `${post.platform} — ${brief.organizationName}`,
    body: post.body,
    platform: post.platform,
  }));

  return {
    assets,
    costTokens: result.usage.totalTokens,
    summary: `Drafted ${posts.length} platform post(s).`,
  };
};

export const landingPageHandler: AgentHandler = async (ctx) => {
  const brief = await loadBrief(ctx.event.id);

  // Two calls rather than one: the page copy and the FAQ are different jobs,
  // and a weak FAQ shouldn't force a re-run of the page copy.
  const page = buildLandingPagePrompt(brief);
  ctx.log("Writing the landing page copy…");
  const pageResult = await ctx.ai.generate({
    system: steer(page.system, ctx.additionalInstructions),
    prompt: page.prompt,
    maxOutputTokens: 3000,
  });

  const faq = buildFaqPrompt(brief);
  ctx.log("Writing the FAQ…");
  const faqResult = await ctx.ai.generate({
    system: steer(faq.system, ctx.additionalInstructions),
    prompt: faq.prompt,
    maxOutputTokens: 3000,
  });

  return {
    assets: [
      {
        type: "landing_page_content",
        title: `Landing page — ${brief.organizationName}`,
        body: pageResult.text,
      },
      {
        type: "faq",
        title: `FAQ — ${brief.organizationName}`,
        body: faqResult.text,
      },
    ],
    costTokens: pageResult.usage.totalTokens + faqResult.usage.totalTokens,
    summary: "Drafted the landing page copy and the FAQ.",
  };
};
