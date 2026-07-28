/**
 * Submission-window emails (PRD §7.1). Same posture as every other email
 * module: escaped bodies, fixed subjects, nothing internal echoed.
 */
import type { SendEmailInput } from "../integrations/email";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripCrlf(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export interface SubmissionInviteData {
  firstName: string;
  email: string;
  eventTitle: string;
  submitUrl: string;
}

export function buildSubmissionInviteEmail(
  data: SubmissionInviteData,
): SendEmailInput {
  const url = escapeHtml(data.submitUrl);
  const html = [
    `<p>Hi ${escapeHtml(data.firstName)},</p>`,
    `<p>Build time is up. Submit what your team made — one submission per team, and whoever submits it lists the rest of you.</p>`,
    `<p><a href="${url}">Submit your project</a></p>`,
    `<p>You'll need: a team name (we call you up by it), a couple of sentences on what you built, and the link to your GitHub repository.</p>`,
    `<p>Pitches start at 4:00 PM. Get this in before then.</p>`,
    `<p>&mdash; The White Rabbit team</p>`,
  ].join("\n");

  const text = [
    `Hi ${data.firstName},`,
    "",
    "Build time is up. Submit what your team made — one submission per team, and whoever submits it lists the rest of you.",
    "",
    `Submit your project:\n${data.submitUrl}`,
    "",
    "You'll need: a team name (we call you up by it), a couple of sentences on what you built, and the link to your GitHub repository.",
    "",
    "Pitches start at 4:00 PM. Get this in before then.",
    "",
    "— The White Rabbit team",
  ].join("\n");

  return {
    to: data.email,
    subject: `Submit your project: ${stripCrlf(data.eventTitle)}`,
    html,
    text,
  };
}
