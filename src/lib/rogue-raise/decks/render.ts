/**
 * Renders deck slides to a real `.pptx`, themed to White Rabbit (PRD §5.3.5).
 *
 * Kept separate from the content builder so the *content* is testable without
 * generating a binary, and so re-theming never risks changing what the deck says.
 */
import PptxGenJS from "pptxgenjs";

import type { DeckSlide } from "./content";

/** WR tokens, vendored as hex for the deck (PRD §13). */
const WR_OLIVE = "6B7A3F";
const INK = "1A1A17";
const PAPER = "F7F5EF";

export async function renderDeck(input: {
  slides: DeckSlide[];
  eventTitle: string;
  organizationName: string;
}): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  pptx.title = input.eventTitle;
  pptx.company = "White Rabbit";
  pptx.subject = `Rogue Raise kickoff — ${input.organizationName}`;

  input.slides.forEach((slide, index) => {
    const s = pptx.addSlide();
    s.background = { color: index === 0 ? WR_OLIVE : PAPER };

    s.addText(slide.title, {
      x: 0.6,
      y: index === 0 ? 2.2 : 0.5,
      w: 8.8,
      h: index === 0 ? 1.4 : 0.9,
      fontSize: index === 0 ? 40 : 30,
      bold: true,
      color: index === 0 ? PAPER : INK,
      fontFace: "Georgia",
    });

    if (slide.bullets.length > 0) {
      s.addText(
        slide.bullets.map((text) => ({ text, options: { bullet: index !== 0 } })),
        {
          x: 0.6,
          y: index === 0 ? 3.6 : 1.6,
          w: 8.8,
          h: 3,
          fontSize: index === 0 ? 18 : 16,
          color: index === 0 ? PAPER : INK,
          lineSpacingMultiple: 1.3,
        },
      );
    }

    if (slide.body) {
      s.addText(slide.body, {
        x: 0.6,
        y: 3.2,
        w: 8.8,
        h: 1.6,
        fontSize: 13,
        color: INK,
      });
    }

    if (slide.note) {
      s.addText(slide.note, {
        x: 0.6,
        y: 4.9,
        w: 8.8,
        h: 0.4,
        fontSize: 11,
        italic: true,
        color: index === 0 ? PAPER : WR_OLIVE,
      });
    }
  });

  // `write` returns a Node Buffer under the "nodebuffer" output type.
  const output = await pptx.write({ outputType: "nodebuffer" });
  return output as Buffer;
}
