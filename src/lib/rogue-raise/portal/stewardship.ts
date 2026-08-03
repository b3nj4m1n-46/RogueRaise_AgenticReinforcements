/**
 * The stewardship vocabulary (PRD §8.3). Plain module — a `"use server"` file
 * may only export async functions (see CLAUDE.md), and these constants are
 * needed by the client component that renders the choices.
 *
 * The wording is deliberately about commitment rather than status: "We're
 * adopting it" is a sentence somebody has to mean, which is the point of the
 * handoff bridge.
 */
export const STEWARDSHIP_CHOICES = [
  {
    value: "adopted",
    label: "We're adopting it",
    description: "Your organization will run and maintain this.",
  },
  {
    value: "stewarded",
    label: "We're stewarding it",
    description: "Someone will look after it, but it isn't in production.",
  },
  {
    value: "archived",
    label: "Archiving it",
    description: "Worth keeping, but nobody is carrying it forward.",
  },
  {
    value: "unmarked",
    label: "Not decided yet",
    description: "Come back to it.",
  },
] as const;

export type StewardshipValue = (typeof STEWARDSHIP_CHOICES)[number]["value"];

export function isStewardshipValue(value: string): value is StewardshipValue {
  return STEWARDSHIP_CHOICES.some((choice) => choice.value === value);
}

export function stewardshipLabel(value: string): string {
  return (
    STEWARDSHIP_CHOICES.find((choice) => choice.value === value)?.label ??
    "Not decided yet"
  );
}
