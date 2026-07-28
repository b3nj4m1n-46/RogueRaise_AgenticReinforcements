/**
 * Portal-ready email (PRD §10, "Portal ready → Stakeholders"). Same posture as
 * every other email module: escaped bodies, fixed subjects, nothing internal
 * echoed.
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

export interface PortalInviteData {
  stakeholderName: string;
  stakeholderEmail: string;
  eventTitle: string;
  submissionCount: number;
  portalUrl: string;
  replyTo?: string;
}

export function buildPortalInviteEmail(data: PortalInviteData): SendEmailInput {
  const url = escapeHtml(data.portalUrl);
  const count = `${data.submissionCount} project${data.submissionCount === 1 ? "" : "s"}`;

  const html = [
    `<p>Hi ${escapeHtml(data.stakeholderName)},</p>`,
    `<p>Your handoff portal is open. ${count} were built for you this weekend, and everything is in one place: what each team made, who built it and how to reach them, the judges' evaluations, and the code itself.</p>`,
    `<p><a href="${url}">Open your handoff portal</a></p>`,
    `<p>The part that matters most is the last column: for each project you can say whether you&rsquo;re <strong>adopting</strong> it, <strong>stewarding</strong> it, or <strong>archiving</strong> it. That&rsquo;s the whole point of a Rogue Raise &mdash; the work goes home with someone.</p>`,
    `<p>You don&rsquo;t need to come back to us for any of this. If you want to talk it through anyway, just reply.</p>`,
    `<p>&mdash; The White Rabbit team</p>`,
  ].join("\n");

  const text = [
    `Hi ${data.stakeholderName},`,
    "",
    `Your handoff portal is open. ${count} were built for you this weekend, and everything is in one place: what each team made, who built it and how to reach them, the judges' evaluations, and the code itself.`,
    "",
    `Open your handoff portal:\n${data.portalUrl}`,
    "",
    "The part that matters most is the last column: for each project you can say whether you're adopting it, stewarding it, or archiving it. That's the whole point of a Rogue Raise — the work goes home with someone.",
    "",
    "You don't need to come back to us for any of this. If you want to talk it through anyway, just reply.",
    "",
    "— The White Rabbit team",
  ].join("\n");

  return {
    to: data.stakeholderEmail,
    subject: `Your handoff portal is open: ${stripCrlf(data.eventTitle)}`,
    html,
    text,
    replyTo: data.replyTo,
  };
}
