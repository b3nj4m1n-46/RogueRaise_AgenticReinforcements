/**
 * Judging emails (PRD §7.2). Same posture as every other email module: escaped
 * bodies, fixed subjects, nothing internal echoed.
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

export interface ScoringInviteData {
  judgeName: string;
  judgeEmail: string;
  eventTitle: string;
  projectCount: number;
  scoringUrl: string;
  replyTo?: string;
}

export function buildScoringInviteEmail(data: ScoringInviteData): SendEmailInput {
  const url = escapeHtml(data.scoringUrl);
  const count = `${data.projectCount} project${data.projectCount === 1 ? "" : "s"}`;

  const html = [
    `<p>Hi ${escapeHtml(data.judgeName)},</p>`,
    `<p>Scoring is open. There ${data.projectCount === 1 ? "is" : "are"} ${count} to score, each against the criteria the sponsor set.</p>`,
    `<p><a href="${url}">Open your scorecards</a></p>`,
    `<p>You can save a card part-finished and come back to it &mdash; nothing is lost between pitches. A card only counts once you submit it, and you can change a submitted card while scoring is still open.</p>`,
    `<p>Thank you for doing this.</p>`,
    `<p>&mdash; The White Rabbit team</p>`,
  ].join("\n");

  const text = [
    `Hi ${data.judgeName},`,
    "",
    `Scoring is open. There ${data.projectCount === 1 ? "is" : "are"} ${count} to score, each against the criteria the sponsor set.`,
    "",
    `Open your scorecards:\n${data.scoringUrl}`,
    "",
    "You can save a card part-finished and come back to it — nothing is lost between pitches. A card only counts once you submit it, and you can change a submitted card while scoring is still open.",
    "",
    "Thank you for doing this.",
    "",
    "— The White Rabbit team",
  ].join("\n");

  return {
    to: data.judgeEmail,
    subject: `Scoring is open: ${stripCrlf(data.eventTitle)}`,
    html,
    text,
    replyTo: data.replyTo,
  };
}
