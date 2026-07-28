import { describe, expect, it } from "vitest";

import {
  buildFaqPrompt,
  buildLandingPagePrompt,
  buildMarketingBrief,
  buildOutreachPrompt,
  buildSocialPrompt,
  SOCIAL_PLATFORMS,
  splitOutreachTemplates,
  splitSocialPosts,
  type MarketingBrief,
} from "./marketing-prompts";

function brief(overrides: Partial<MarketingBrief> = {}): MarketingBrief {
  return {
    eventTitle: "Rogue Raise: The Unhoused",
    eventSlug: "rogue-raise-unhoused-ab12cd",
    organizationName: "Jackson County Health Department",
    painPoints: "Shelter capacity data lives in spreadsheets.",
    goalsNeeds: "One place to see who has beds tonight.",
    weekendLabel: "Aug 14–16, 2026",
    scheduleLines: ["Fri, Aug 14 — Kickoff at 5:00 PM"],
    locationName: "5 North Main Street",
    locationAddress: "Ashland, Oregon",
    technicalStack: "Postgres and a Django admin.",
    technicalSponsors: [{ name: "Acme AI", offering: "API credits" }],
    landingUrl: "https://example.com/events/rogue-raise-unhoused-ab12cd",
    ...overrides,
  };
}

describe("buildMarketingBrief", () => {
  it("carries the event's own facts", () => {
    const text = buildMarketingBrief(brief());
    expect(text).toContain("Shelter capacity data lives in spreadsheets.");
    expect(text).toContain("Jackson County Health Department");
    expect(text).toContain("Aug 14–16, 2026");
    expect(text).toContain("5 North Main Street, Ashland, Oregon");
    expect(text).toContain("https://example.com/events/");
    expect(text).toContain("Acme AI — API credits");
  });

  it("says the weekend is unconfirmed rather than omitting it", () => {
    // A marketing draft that silently drops the date reads as if there isn't one.
    expect(buildMarketingBrief(brief({ weekendLabel: null }))).toContain(
      "Weekend: to be confirmed",
    );
  });

  it("omits sections with nothing in them", () => {
    const text = buildMarketingBrief(
      brief({ technicalStack: "", technicalSponsors: [], scheduleLines: [] }),
    );
    expect(text).not.toContain("technical stack");
    expect(text).not.toContain("Technical sponsors already");
    expect(text).not.toMatch(/\n{3,}/);
  });
});

describe("prompts", () => {
  const builders = [
    ["outreach", buildOutreachPrompt],
    ["social", buildSocialPrompt],
    ["landing page", buildLandingPagePrompt],
    ["faq", buildFaqPrompt],
  ] as const;

  it.each(builders)("%s carries the brief", (_name, build) => {
    expect(build(brief()).prompt).toContain("Shelter capacity data lives in spreadsheets.");
  });

  it.each(builders)("%s forbids inventing facts", (_name, build) => {
    expect(build(brief()).system).toMatch(/Never invent/);
  });

  it("asks the outreach templates for merge fields rather than guessed names", () => {
    const { system } = buildOutreachPrompt(brief());
    expect(system).toContain("{{recipient_name}}");
    expect(system).toMatch(/Never guess at a name/);
  });

  it("names all four platforms and shapes each differently", () => {
    const { system } = buildSocialPrompt(brief());
    for (const platform of SOCIAL_PLATFORMS) expect(system).toContain(platform);
    expect(system).toContain("280 characters");
    expect(system).toContain("/r/ashland");
  });

  it("keeps the schedule out of the landing copy, since the page renders it", () => {
    // Copy that repeats the date goes stale the moment the date moves.
    expect(buildLandingPagePrompt(brief()).system).toMatch(
      /Do not write the schedule, the date, the location/,
    );
  });

  it("tells the FAQ to admit an unsettled answer instead of inventing policy", () => {
    expect(buildFaqPrompt(brief()).system).toMatch(/rather than inventing a policy/);
  });
});

describe("splitSocialPosts", () => {
  it("splits one post per platform", () => {
    const posts = splitSocialPosts(
      [
        "## POST: instagram",
        "Bring your laptop. #ashland",
        "",
        "## POST: facebook",
        "Neighbours: we're building something.",
        "",
        "## POST: x",
        "One weekend, one problem.",
        "",
        "## POST: reddit",
        "Title: A build weekend in Ashland",
        "",
        "## CADENCE",
        "Post to Reddit two weeks out.",
      ].join("\n"),
    );

    expect(posts.map((p) => p.platform)).toEqual([
      "instagram",
      "facebook",
      "x",
      "reddit",
    ]);
    expect(posts[0].body).toContain("#ashland");
    // The cadence belongs to nobody's post.
    expect(posts.at(-1)!.body).not.toContain("two weeks out");
  });

  it("ignores an unknown platform rather than inventing one", () => {
    const posts = splitSocialPosts("## POST: tiktok\n\nDance.\n\n## POST: x\n\nHi.");
    expect(posts.map((p) => p.platform)).toEqual(["x"]);
  });

  it("keeps the first draft when a platform appears twice", () => {
    const posts = splitSocialPosts("## POST: x\n\nFirst.\n\n## POST: x\n\nSecond.");
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toBe("First.");
  });

  it("yields nothing when the draft has no markers", () => {
    expect(splitSocialPosts("Come to our event!")).toEqual([]);
  });
});

describe("splitOutreachTemplates", () => {
  it("splits one template per audience", () => {
    const templates = splitOutreachTemplates(
      "## TEMPLATE: technical sponsor\n\nSubject: A weekend\n\nHi {{recipient_name}}.\n\n## TEMPLATE: local press\n\nSubject: A story\n\nHi again.",
    );
    expect(templates.map((t) => t.audience)).toEqual([
      "technical sponsor",
      "local press",
    ]);
    expect(templates[0].body).toContain("{{recipient_name}}");
  });

  it("yields nothing when the draft has no markers", () => {
    expect(splitOutreachTemplates("Dear sir or madam")).toEqual([]);
  });
});
