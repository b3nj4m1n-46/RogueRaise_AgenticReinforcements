/**
 * Stakeholder review invitation (PRD §10). Same posture as every other email
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

export interface ReviewInviteData {
  stakeholderName: string;
  stakeholderEmail: string;
  eventTitle: string;
  reviewUrl: string;
  replyTo?: string;
}

export function buildReviewInviteEmail(data: ReviewInviteData): SendEmailInput {
  const url = escapeHtml(data.reviewUrl);

  const html = [
    `<p>Hi ${escapeHtml(data.stakeholderName)},</p>`,
    `<p>Before we hand anything to volunteers, we&rsquo;d like you to read what we&rsquo;ve written about your organization&rsquo;s problem. It&rsquo;s the briefing every team will build from, so if we&rsquo;ve misunderstood something, now is the moment it&rsquo;s cheap to fix.</p>`,
    `<p><a href="${url}">Read the drafts</a></p>`,
    `<p>You can comment on anything, and say whether each document looks right. Nothing goes to volunteers until you&rsquo;ve had the chance &mdash; and you won&rsquo;t hold anything up by being thorough.</p>`,
    `<p>&mdash; The White Rabbit team</p>`,
  ].join("\n");

  const text = [
    `Hi ${data.stakeholderName},`,
    "",
    "Before we hand anything to volunteers, we'd like you to read what we've written about your organization's problem. It's the briefing every team will build from, so if we've misunderstood something, now is the moment it's cheap to fix.",
    "",
    `Read the drafts:\n${data.reviewUrl}`,
    "",
    "You can comment on anything, and say whether each document looks right. Nothing goes to volunteers until you've had the chance — and you won't hold anything up by being thorough.",
    "",
    "— The White Rabbit team",
  ].join("\n");

  return {
    to: data.stakeholderEmail,
    subject: `Please review: ${stripCrlf(data.eventTitle)}`,
    html,
    text,
    replyTo: data.replyTo,
  };
}
