/**
 * Kickoff deck content (PRD §5.3.5).
 *
 * Pure: event data in, slides out. The deck's *structure* is deterministic —
 * every kickoff covers the same ground in the same order, and a model inventing
 * a different running order each time would be worse, not better. The one
 * genuinely generative slide is "the opportunities", where the agent's text is
 * used if it produced any and a plain fallback is used if it didn't.
 *
 * That split is deliberate: a deck must always be produceable, even with no AI
 * provider configured, because it's the thing standing between staff and Friday
 * evening.
 */

export interface DeckJudge {
  name: string;
  title: string | null;
  bio: string | null;
  expertiseTags: string[];
}

export interface DeckInput {
  eventTitle: string;
  organizationName: string;
  weekendLabel: string | null;
  scheduleLines: string[];
  locationName: string | null;
  locationAddress: string | null;
  painPoints: string;
  goalsNeeds: string;
  criteria: { label: string; description: string | null; weight: string | null }[];
  judges: DeckJudge[];
  /** Agent-written prose for the opportunities slide, if any. */
  opportunities: string | null;
}

export interface DeckSlide {
  title: string;
  /** Rendered as bullets. */
  bullets: string[];
  /** Rendered as a paragraph under the bullets. */
  body?: string;
  /** A quieter footer line — location, timing, etc. */
  note?: string;
}

/** Split agent prose into bullets, keeping it to what fits on a slide. */
function toBullets(text: string, max = 6): string[] {
  return text
    .split(/\n+/)
    .map((line) => line.replace(/^[-*•]\s*/, "").trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .slice(0, max);
}

export function buildDeckSlides(input: DeckInput): DeckSlide[] {
  const location = [input.locationName, input.locationAddress]
    .filter(Boolean)
    .join(", ");

  const slides: DeckSlide[] = [
    {
      title: input.eventTitle,
      bullets: [
        `A Rogue Raise with ${input.organizationName}`,
        input.weekendLabel ?? "Dates to be confirmed",
      ],
      note: location || undefined,
    },
    {
      title: "Why we're here",
      bullets: toBullets(input.painPoints || "To be described.", 5),
      note: `The problem ${input.organizationName} brought us.`,
    },
    {
      title: "What good looks like",
      bullets: toBullets(input.goalsNeeds || "To be described.", 5),
    },
  ];

  slides.push({
    title: "The opportunities",
    bullets: input.opportunities
      ? toBullets(input.opportunities, 6)
      : [
          "Pick a project from the repo's example PRDs, or invent your own.",
          "Talk to the sponsor tonight — they're in the room.",
          "Ship something that still runs on Monday.",
        ],
  });

  slides.push({
    title: "How the work is judged",
    bullets:
      input.criteria.length > 0
        ? input.criteria.map((c) =>
            [
              c.label,
              c.description ? `— ${c.description}` : "",
              c.weight ? `(weight ${c.weight})` : "",
            ]
              .filter(Boolean)
              .join(" "),
          )
        : ["Criteria are still being confirmed with the sponsor."],
    note: "Judges score each criterion from 1 to 5 on Sunday afternoon.",
  });

  if (input.judges.length > 0) {
    slides.push({
      title: "Your judges",
      bullets: input.judges.map((j) =>
        [j.name, j.title ? `— ${j.title}` : ""].filter(Boolean).join(" "),
      ),
      note: "Introduced in person tonight.",
    });
    // One slide per judge who told us about themselves — this is what the
    // background form exists to produce.
    for (const judge of input.judges) {
      if (!judge.bio && judge.expertiseTags.length === 0) continue;
      slides.push({
        title: judge.name,
        bullets: judge.expertiseTags.slice(0, 6),
        body: judge.bio ?? undefined,
        note: judge.title ?? undefined,
      });
    }
  } else {
    slides.push({
      title: "Your judges",
      bullets: ["Judges are being confirmed."],
    });
  }

  slides.push({
    title: "The weekend",
    bullets:
      input.scheduleLines.length > 0
        ? input.scheduleLines
        : ["Schedule to be confirmed."],
    note: location || undefined,
  });

  slides.push({
    title: "Let's build",
    bullets: [
      "The context repo has research, the sponsor's stack, and example PRDs.",
      "Ask the sponsor anything — that's why they're here.",
      "Pitches Sunday at 4:00 PM. Results at 6:00 PM.",
    ],
  });

  return slides;
}
