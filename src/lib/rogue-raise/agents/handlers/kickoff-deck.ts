/**
 * Kickoff deck agent (PRD §5.3.5).
 *
 * The deck's structure is deterministic — every kickoff covers the same ground
 * in the same order — so the model writes one slide (the opportunities) and the
 * rest is built from the event. That means a deck can always be produced, even
 * with no AI provider configured, which matters because this is the thing
 * standing between staff and Friday evening.
 *
 * The rendered `.pptx` goes to Blob and the asset carries its reference; the
 * asset body holds a plain-text outline so a reviewer can read the deck without
 * downloading it.
 */
import { buildDeckSlides, type DeckSlide } from "../../decks/content";
import { renderDeck } from "../../decks/render";
import { loadAdminEvent } from "../../events/queries";
import { getBlobAdapter } from "../../integrations/blob";
import { describeSchedule, formatWeekendLabel } from "../../intake/schedule";
import { listJudges } from "../../judges/queries";
import type { AgentHandler } from "../registry";

function outline(slides: DeckSlide[]): string {
  return slides
    .map((slide, index) =>
      [
        `## ${index + 1}. ${slide.title}`,
        "",
        ...slide.bullets.map((b) => `- ${b}`),
        slide.body ? `\n${slide.body}` : "",
        slide.note ? `\n_${slide.note}_` : "",
      ]
        .filter((part) => part !== "")
        .join("\n"),
    )
    .join("\n\n");
}

export const kickoffDeckHandler: AgentHandler = async (ctx) => {
  const detail = await loadAdminEvent(ctx.event.id);
  if (!detail) throw new Error("Event not found.");

  const judges = await listJudges(ctx.event.id);

  // The one generative slide. A failure here degrades the deck rather than
  // failing the run — a deck without the opportunities slide still works.
  let opportunities: string | null = null;
  try {
    const result = await ctx.ai.generate({
      system: `You are writing ONE slide for the Friday-evening kickoff of a Rogue Raise — a weekend community build event in Ashland, Oregon.

The slide is titled "The opportunities". Write 4–6 short bullets naming concrete things a volunteer team could build this weekend for this sponsor, grounded in their actual problem and stack. Each bullet is one line, under 15 words, no sub-bullets, no heading, no preamble. Speak to builders in the room, not to the sponsor.${
        ctx.additionalInstructions
          ? `\n\nADDITIONAL INSTRUCTIONS FROM WHITE RABBIT:\n${ctx.additionalInstructions}`
          : ""
      }`,
      prompt: [
        `Sponsor: ${detail.organizationName}`,
        `Problem: ${detail.application?.painPoints ?? "unknown"}`,
        `Desired outcome: ${detail.application?.goalsNeeds ?? "unknown"}`,
        `Their stack: ${detail.intake?.stakeholderTechStack ?? "unknown"}`,
        `Supporting context: ${detail.intake?.supplementaryInfo ?? "none"}`,
      ].join("\n"),
      maxOutputTokens: 800,
    });
    opportunities = result.text;
    ctx.log(`Wrote the opportunities slide (${result.usage.totalTokens} tokens).`);
  } catch (err) {
    ctx.log(
      `Couldn't write the opportunities slide (${err instanceof Error ? err.message : String(err)}) — using the standard one.`,
    );
  }

  const slides = buildDeckSlides({
    eventTitle: detail.title,
    organizationName: detail.organizationName,
    weekendLabel: detail.confirmedFridayKickoffAt
      ? formatWeekendLabel(new Date(detail.confirmedFridayKickoffAt))
      : null,
    scheduleLines: detail.confirmedFridayKickoffAt
      ? describeSchedule(new Date(detail.confirmedFridayKickoffAt))
      : [],
    locationName: detail.locationName,
    locationAddress: detail.locationAddress,
    painPoints: detail.application?.painPoints ?? "",
    goalsNeeds: detail.application?.goalsNeeds ?? "",
    criteria: detail.criteria.map((c) => ({
      label: c.label,
      description: c.description,
      weight: c.weight,
    })),
    judges: judges.map((j) => ({
      name: j.name,
      title: j.title,
      bio: j.bio,
      expertiseTags: j.expertiseTags,
    })),
    opportunities,
  });

  const buffer = await renderDeck({
    slides,
    eventTitle: detail.title,
    organizationName: detail.organizationName,
  });

  // Regenerating on demand is the point, so the key carries the run id — an
  // older deck stays downloadable from its own asset version.
  const put = await getBlobAdapter().put({
    key: `decks/${ctx.event.id}/${ctx.runId}.pptx`,
    body: buffer,
    contentType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    access: "private",
  });

  ctx.log(`Rendered ${slides.length} slides (${Math.round(buffer.byteLength / 1024)} KB).`);

  return {
    assets: [
      {
        type: "kickoff_deck",
        title: `Kickoff deck — ${detail.organizationName}`,
        // The outline is what a reviewer reads; the file is what they present.
        body: outline(slides),
        blobUrl: put.ref,
      },
    ],
    summary: `Built a ${slides.length}-slide kickoff deck.`,
  };
};
