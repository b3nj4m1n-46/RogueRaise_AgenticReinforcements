/**
 * Prompts for the three marketing agents (PRD §5.4). Pure, so what each agent is
 * told is testable without a model.
 *
 * All three share one brief — they're describing the same event to different
 * audiences — and each declares its own output shape. Where an output has parts
 * (four social platforms, two outreach templates), the prompt demands an
 * explicit marker and the splitter keys on it: the house pattern, arrived at
 * after splitting on incidental `##` headings shredded a document that didn't
 * follow the expected structure.
 */

export interface MarketingBrief {
  eventTitle: string;
  eventSlug: string;
  organizationName: string;
  painPoints: string;
  goalsNeeds: string;
  weekendLabel: string | null;
  scheduleLines: string[];
  locationName: string | null;
  locationAddress: string | null;
  technicalStack: string;
  technicalSponsors: { name: string; offering: string | null }[];
  /** Public URL of the event landing page, for CTAs. */
  landingUrl: string;
}

const HOUSE_STYLE = `You are writing for White Rabbit's "Rogue Raise" — a weekend community build event in Ashland, Oregon, modelled on a barn raising. Volunteers arrive Friday evening and ship something real for a local organization by Sunday afternoon.

Write plainly. No hype, no "revolutionary", no stacked adjectives, no exclamation marks. Specific beats enthusiastic: the actual problem and the actual town are more persuasive than any adjective. Never invent a statistic, a quote, a partner, or a person.`;

function block(heading: string, body: string): string {
  const text = body.trim();
  return text ? `## ${heading}\n\n${text}\n` : "";
}

export function buildMarketingBrief(brief: MarketingBrief): string {
  const location = [brief.locationName, brief.locationAddress]
    .filter(Boolean)
    .join(", ");
  const sponsors = brief.technicalSponsors
    .map((s) => [s.name, s.offering].filter(Boolean).join(" — "))
    .join("\n");

  return [
    `# ${brief.eventTitle}`,
    "",
    `Sponsoring organization: ${brief.organizationName}`,
    brief.weekendLabel ? `Weekend: ${brief.weekendLabel}` : "Weekend: to be confirmed",
    location ? `Location: ${location}` : "",
    `Landing page: ${brief.landingUrl}`,
    "",
    block("The problem", brief.painPoints),
    block("What a good outcome looks like", brief.goalsNeeds),
    block("The sponsor's technical stack", brief.technicalStack),
    block("Schedule", brief.scheduleLines.map((l) => `- ${l}`).join("\n")),
    block("Technical sponsors already on board", sponsors),
  ]
    .filter((part) => part !== "")
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface MarketingPrompt {
  system: string;
  prompt: string;
}

// --- 5.4.1 Technical-sponsor & press outreach ------------------------------

export const OUTREACH_MARKER = /^##\s+TEMPLATE\s*:\s*(.+?)\s*$/i;

export function buildOutreachPrompt(brief: MarketingBrief): MarketingPrompt {
  return {
    system: `${HOUSE_STYLE}

You are drafting OUTREACH TEMPLATES that White Rabbit and the sponsoring organization will send themselves. Write exactly two:

1. To a potential TECHNICAL SPONSOR — a company that could provide API credits, tooling, or access for the weekend. Say what the event is, what you're asking for concretely, what they get, and how to say yes.
2. To LOCAL PRESS — an editor or reporter in the Rogue Valley. Say why this is a story for their readers now, offer specifics they can verify, and make the ask small.

Each is a short email a busy person will actually read. Use merge fields in double braces for anything the sender must fill in: {{recipient_name}}, {{recipient_org}}, {{sender_name}}. Never guess at a name.

FORMAT, exactly: start each template with a line of the form \`## TEMPLATE: <audience>\` and nothing else on that line. Templates are split into separate files on that marker, so one without it will be merged into the previous. Include a \`Subject:\` line as the first line under each marker.`,
    prompt: buildMarketingBrief(brief),
  };
}

// --- 5.4.2 Social marketing ------------------------------------------------

export const SOCIAL_PLATFORMS = ["instagram", "facebook", "x", "reddit"] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export const SOCIAL_MARKER = /^##\s+POST\s*:\s*(instagram|facebook|x|reddit)\s*$/i;

export function buildSocialPrompt(brief: MarketingBrief): MarketingPrompt {
  return {
    system: `${HOUSE_STYLE}

You are drafting SOCIAL POSTS announcing this Rogue Raise and calling for builders. Write one for each of four platforms, in this order, and shape each to its platform:

- **instagram** — visual-first caption, 2–4 short lines, a handful of relevant hashtags at the end, and a note in square brackets suggesting what the image should be.
- **facebook** — a short paragraph aimed at Ashland locals who may not code but know someone who does. No hashtags.
- **x** — under 280 characters including the link. At most two hashtags.
- **reddit** — for /r/ashland. Conversational, no marketing voice, no hashtags, no emoji. Redditors punish promotion; be a neighbour explaining a thing that's happening. Include a title line and then the body.

End with a short suggested posting cadence (which platform, how far ahead of the weekend). Include the landing page link where it fits naturally.

FORMAT, exactly: start each post with a line of the form \`## POST: <platform>\`, using exactly one of instagram, facebook, x, reddit, and nothing else on that line. Posts are split into separate drafts on that marker. Put the posting cadence at the very end under a final \`## CADENCE\` line.`,
    prompt: buildMarketingBrief(brief),
  };
}

/**
 * Split the social draft into one post per platform.
 *
 * Any other top-level heading — `## CADENCE`, or a platform we don't publish to
 * — ends the post being collected but does NOT stop the scan: a stray heading
 * partway through must not swallow the valid posts after it.
 */
export function splitSocialPosts(
  document: string,
): { platform: SocialPlatform; body: string }[] {
  const posts: { platform: SocialPlatform; body: string }[] = [];
  let current: { platform: SocialPlatform; body: string } | null = null;

  for (const line of document.split(/\r?\n/)) {
    const marker = SOCIAL_MARKER.exec(line);
    if (marker) {
      current = { platform: marker[1].toLowerCase() as SocialPlatform, body: "" };
      posts.push(current);
      continue;
    }
    if (/^##\s+/.test(line)) {
      current = null;
      continue;
    }
    if (current) current.body += `${line}\n`;
  }

  const seen = new Set<string>();
  return posts
    .map((post) => ({ ...post, body: post.body.trim() }))
    .filter((post) => {
      if (post.body === "" || seen.has(post.platform)) return false;
      seen.add(post.platform);
      return true;
    });
}

/** Split the outreach draft into one template per audience. */
export function splitOutreachTemplates(
  document: string,
): { audience: string; body: string }[] {
  const lines = document.split(/\r?\n/);
  const templates: { audience: string; body: string }[] = [];

  for (const line of lines) {
    const marker = OUTREACH_MARKER.exec(line);
    if (marker) {
      templates.push({ audience: marker[1], body: "" });
      continue;
    }
    if (templates.length > 0) templates[templates.length - 1].body += `${line}\n`;
  }

  return templates
    .map((t) => ({ ...t, body: t.body.trim() }))
    .filter((t) => t.body !== "");
}

// --- 5.4.3 Landing page content + FAQ --------------------------------------

export function buildLandingPagePrompt(brief: MarketingBrief): MarketingPrompt {
  return {
    system: `${HOUSE_STYLE}

You are writing the PUBLIC LANDING PAGE copy for this event — the page a prospective participant lands on. Structure it with these headings exactly, in this order:

## Headline
One line. What this is, for whom. Under 12 words.

## Summary
Two or three sentences. The problem, and what a weekend of volunteers could do about it. This is the paragraph under the headline.

## Who should come
3–5 bullets. Be concrete about skills and be welcoming about level — plenty of useful work isn't code.

## What you'll be working on
3–5 bullets, grounded in the sponsor's actual problem and stack.

## What to bring
3–4 bullets. Practical.

Do not write the schedule, the date, the location, or a register button — the page renders those from the event record, and copy that repeats them will go stale.`,
    prompt: buildMarketingBrief(brief),
  };
}

export function buildFaqPrompt(brief: MarketingBrief): MarketingPrompt {
  return {
    system: `${HOUSE_STYLE}

You are writing the event FAQ — the questions someone actually asks before signing up for a weekend with strangers. Cover at least: whether they need to be a programmer, whether they need a team, what it costs, what to bring, whether they can come for only part of it, what happens to what they build, and who owns the code.

Answer plainly and honestly. Where the answer isn't settled, say so rather than inventing a policy — a made-up answer about ownership or cost is worse than "ask us".

FORMAT: each question as a \`### \` heading, its answer as the paragraph beneath. No preamble.`,
    prompt: buildMarketingBrief(brief),
  };
}
