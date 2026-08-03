/**
 * Judge emails. Same security posture as every other email module: echoed
 * values are HTML-escaped, subjects are fixed with at most one CR/LF-stripped
 * slot, and no internal note or token is ever echoed.
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

/** Markdown-ish agent draft → simple HTML paragraphs. Escaped first. */
function toHtml(body: string): string {
  return body
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block.trim()).replace(/\n/g, "<br/>")}</p>`)
    .join("\n");
}

export interface JudgeInvitationEmailData {
  judgeName: string;
  judgeEmail: string;
  eventTitle: string;
  organizationName: string;
  /** The approved, possibly admin-edited draft for THIS judge. */
  body: string;
  /** Their personal background-form link; the raw token lives only here. */
  backgroundUrl: string;
  /** Where a judge's questions should go. */
  replyTo?: string;
}

export function buildJudgeInvitationEmail(
  data: JudgeInvitationEmailData,
): SendEmailInput {
  const url = escapeHtml(data.backgroundUrl);
  const html = [
    toHtml(data.body),
    `<p><a href="${url}">Open your judge form</a></p>`,
    `<p>The form asks how you'd like to be introduced at kickoff, and has a space for any questions about how the work will be judged — those go straight to us and to ${escapeHtml(data.organizationName)}.</p>`,
    `<p>The link is personal to you and expires in 30 days.</p>`,
    `<p>&mdash; The White Rabbit team</p>`,
  ].join("\n");

  const text = [
    data.body.trim(),
    "",
    `Open your judge form:\n${data.backgroundUrl}`,
    "",
    `The form asks how you'd like to be introduced at kickoff, and has a space for any questions about how the work will be judged — those go straight to us and to ${data.organizationName}.`,
    "",
    "The link is personal to you and expires in 30 days.",
    "",
    "— The White Rabbit team",
  ].join("\n");

  return {
    to: data.judgeEmail,
    replyTo: data.replyTo,
    subject: `You're invited to judge ${stripCrlf(data.eventTitle)}`,
    html,
    text,
  };
}

export interface CriteriaQuestionEmailData {
  judgeName: string;
  eventTitle: string;
  organizationName: string;
  question: string;
  /** WR Admin plus the sponsor POC (PRD §5.3.4). */
  to: string[];
  judgeEmail: string;
}

export function buildCriteriaQuestionEmail(
  data: CriteriaQuestionEmailData,
): SendEmailInput {
  const html = [
    `<p><strong>${escapeHtml(data.judgeName)}</strong> asked a question about the evaluative criteria for <strong>${escapeHtml(data.eventTitle)}</strong>.</p>`,
    `<blockquote>${escapeHtml(data.question).replace(/\n/g, "<br/>")}</blockquote>`,
    `<p>Reply to this email to answer them directly.</p>`,
  ].join("\n");

  return {
    to: data.to,
    // Replying reaches the judge who asked.
    replyTo: data.judgeEmail,
    subject: `Judge question about the criteria: ${stripCrlf(data.eventTitle)}`,
    html,
    text: `${data.judgeName} asked about the evaluative criteria for ${data.eventTitle}:\n\n${data.question}\n\nReply to this email to answer them directly.`,
  };
}
