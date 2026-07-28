/**
 * Judge background form validation (PRD §5.3.4). Shared by the client form and
 * the server action, which always re-validates.
 *
 * Everything except the confirmed name is optional: a judge who only has time
 * to confirm they're coming should not be blocked, and a half-filled profile is
 * more useful at kickoff than none.
 */
import { z } from "zod";

export const MAX_EXPERTISE_TAGS = 12;

export const judgeBackgroundSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "We need a name to introduce you by")
    .max(200, "Name is too long"),
  title: z
    .preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
      z.string().trim().max(200, "Title is too long").optional(),
    ),
  bio: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().max(4000, "Please keep the bio under 4000 characters").optional(),
  ),
  expertiseTags: z
    .array(z.string().trim().min(1).max(40, "Tags are limited to 40 characters"))
    .max(MAX_EXPERTISE_TAGS, `Up to ${MAX_EXPERTISE_TAGS} areas`),
  introPreference: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().max(2000, "Please keep this under 2000 characters").optional(),
  ),
  /** Routed to WR Admin + the sponsor POC — see PRD §5.3.4. */
  criteriaQuestions: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().max(4000, "Please keep this under 4000 characters").optional(),
  ),
});

export type JudgeBackgroundInput = z.infer<typeof judgeBackgroundSchema>;

export function emptyJudgeBackground(name = ""): JudgeBackgroundInput {
  return {
    name,
    title: undefined,
    bio: undefined,
    expertiseTags: [],
    introPreference: undefined,
    criteriaQuestions: undefined,
  };
}
