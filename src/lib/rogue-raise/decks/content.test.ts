import { describe, expect, it } from "vitest";

import { buildDeckSlides, type DeckInput } from "./content";
import { renderDeck } from "./render";

function input(overrides: Partial<DeckInput> = {}): DeckInput {
  return {
    eventTitle: "Rogue Raise: The Unhoused",
    organizationName: "Jackson County Health Department",
    weekendLabel: "Aug 14–16, 2026",
    scheduleLines: [
      "Fri, Aug 14 — Kickoff at 5:00 PM",
      "Sun, Aug 16 — Results and winners at 6:00 PM",
    ],
    locationName: "5 North Main Street",
    locationAddress: "Ashland, Oregon",
    painPoints: "Shelter capacity data lives in spreadsheets.",
    goalsNeeds: "One place to see who has beds tonight.",
    criteria: [{ label: "Impact", description: "Who it helps", weight: "40" }],
    judges: [
      {
        name: "Ada Lovelace",
        title: "Data Lead, JCHD",
        bio: "Runs the county's reporting.",
        expertiseTags: ["data", "public health"],
      },
    ],
    opportunities: "- A nightly bed board\n- An intake triage tool",
    ...overrides,
  };
}

describe("buildDeckSlides", () => {
  it("covers everything the PRD asks a kickoff deck to cover", () => {
    const titles = buildDeckSlides(input()).map((s) => s.title);
    expect(titles[0]).toBe("Rogue Raise: The Unhoused"); // topic
    expect(titles).toContain("Why we're here"); // the sponsor's pain
    expect(titles).toContain("What good looks like");
    expect(titles).toContain("The opportunities");
    expect(titles).toContain("How the work is judged"); // criteria
    expect(titles).toContain("Your judges");
    expect(titles).toContain("The weekend"); // schedule
  });

  it("puts the sponsor, the weekend, and the location on the title slide", () => {
    const [title] = buildDeckSlides(input());
    expect(title.bullets).toContain("A Rogue Raise with Jackson County Health Department");
    expect(title.bullets).toContain("Aug 14–16, 2026");
    expect(title.note).toBe("5 North Main Street, Ashland, Oregon");
  });

  it("gives a judge who filled in their background their own slide", () => {
    const slides = buildDeckSlides(input());
    const ada = slides.find((s) => s.title === "Ada Lovelace");
    expect(ada).toBeDefined();
    expect(ada!.body).toBe("Runs the county's reporting.");
    expect(ada!.bullets).toEqual(["data", "public health"]);
    expect(ada!.note).toBe("Data Lead, JCHD");
  });

  it("skips the per-judge slide for someone who told us nothing", () => {
    const slides = buildDeckSlides(
      input({
        judges: [{ name: "Grace Hopper", title: null, bio: null, expertiseTags: [] }],
      }),
    );
    expect(slides.some((s) => s.title === "Grace Hopper")).toBe(false);
    // …but they're still listed as a judge.
    const list = slides.find((s) => s.title === "Your judges")!;
    expect(list.bullets).toEqual(["Grace Hopper"]);
  });

  it("uses the agent's opportunities when there are any", () => {
    const slide = buildDeckSlides(input()).find((s) => s.title === "The opportunities")!;
    expect(slide.bullets).toEqual(["A nightly bed board", "An intake triage tool"]);
  });

  it("still produces a usable deck with no AI text and nothing confirmed", () => {
    // A deck must always be produceable — it's what stands between staff and
    // Friday evening.
    const slides = buildDeckSlides(
      input({
        opportunities: null,
        weekendLabel: null,
        scheduleLines: [],
        criteria: [],
        judges: [],
      }),
    );
    expect(slides.length).toBeGreaterThanOrEqual(7);
    const opportunities = slides.find((s) => s.title === "The opportunities")!;
    expect(opportunities.bullets.length).toBeGreaterThan(0);
    expect(slides.find((s) => s.title === "The weekend")!.bullets).toEqual([
      "Schedule to be confirmed.",
    ]);
    expect(slides.find((s) => s.title === "How the work is judged")!.bullets[0]).toMatch(
      /still being confirmed/,
    );
  });

  it("keeps a slide's bullets to what actually fits", () => {
    const wordy = Array.from({ length: 30 }, (_, i) => `Point ${i}`).join("\n");
    const slides = buildDeckSlides(input({ opportunities: wordy }));
    const slide = slides.find((s) => s.title === "The opportunities")!;
    expect(slide.bullets.length).toBeLessThanOrEqual(6);
  });

  it("drops markdown headings out of agent prose rather than bulleting them", () => {
    const slides = buildDeckSlides(
      input({ opportunities: "# Opportunities\n- A bed board" }),
    );
    const slide = slides.find((s) => s.title === "The opportunities")!;
    expect(slide.bullets).toEqual(["A bed board"]);
  });
});

describe("renderDeck", () => {
  it("produces a real .pptx file", async () => {
    const buffer = await renderDeck({
      slides: buildDeckSlides(input()),
      eventTitle: "Rogue Raise: The Unhoused",
      organizationName: "Jackson County Health Department",
    });

    expect(buffer.byteLength).toBeGreaterThan(1000);
    // .pptx is a zip: every one starts with the local file header magic.
    expect(buffer.subarray(0, 2).toString("latin1")).toBe("PK");
  });
});
