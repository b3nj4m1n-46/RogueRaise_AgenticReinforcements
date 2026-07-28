/**
 * Participant registration validation (PRD §6.2). Shared by the client form and
 * the server action, which always re-validates.
 */
import { z } from "zod";

/**
 * GitHub's own rule: 1–39 characters, alphanumeric or single hyphens, no
 * leading or trailing hyphen. Format-checking here; existence is checked
 * separately and non-blockingly (see `github.ts`).
 */
export const GITHUB_USERNAME_REGEX =
  /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

export const participantSchema = z.object({
  firstName: z
    .string()
    .trim()
    .min(1, "First name is required")
    .max(100, "First name is too long"),
  lastName: z
    .string()
    .trim()
    .min(1, "Last name is required")
    .max(100, "Last name is too long"),
  email: z.email("Enter a valid email").max(254, "Email is too long"),
  githubUsername: z
    .string()
    .trim()
    // A pasted profile URL is the most common way people answer this.
    .transform((v) => v.replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/\/+$/, ""))
    .refine(
      (v) => GITHUB_USERNAME_REGEX.test(v),
      "That doesn't look like a GitHub username — letters, numbers and single hyphens only.",
    ),
});

export type ParticipantInput = z.infer<typeof participantSchema>;
