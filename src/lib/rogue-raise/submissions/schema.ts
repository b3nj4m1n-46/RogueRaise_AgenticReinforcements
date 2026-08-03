/**
 * Submission validation (PRD §7.1). Shared by the client form and the server
 * action, which always re-validates.
 */
import { z } from "zod";

export const MAX_TEAM_MEMBERS = 12;

/** A GitHub repo URL, normalized — trailing `.git` and slashes removed. */
export const repoUrlSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/\.git$/i, "").replace(/\/+$/, ""))
  .refine(
    (v) => /^https:\/\/github\.com\/[^/\s]+\/[^/\s?#]+$/i.test(v),
    "Paste the GitHub repository URL, e.g. https://github.com/your-team/project",
  );

export const teamMemberSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200, "Name is too long"),
  email: z.email("Enter a valid email").max(254, "Email is too long"),
});

export const submissionSchema = z.object({
  teamName: z
    .string()
    .trim()
    .min(1, "Your team needs a name — we call you up by it")
    .max(120, "Team name is too long"),
  projectSummary: z
    .string()
    .trim()
    .min(1, "Tell the judges what you built")
    .max(5000, "Please keep this under 5000 characters"),
  repoUrl: repoUrlSchema,
  pitchMaterialsUrl: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.url("Enter a valid link").max(2000).optional(),
  ),
  members: z
    .array(teamMemberSchema)
    .min(1, "Add at least one team member")
    .max(MAX_TEAM_MEMBERS, `Up to ${MAX_TEAM_MEMBERS} team members`),
});

export type SubmissionInput = z.infer<typeof submissionSchema>;
