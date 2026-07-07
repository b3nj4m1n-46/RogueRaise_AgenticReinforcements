/**
 * Sponsor sign-up email bodies. Both go through the `email` adapter seam.
 *
 * Security: every echoed user value is HTML-escaped in the body, and anything
 * interpolated into a `subject` is CR/LF-stripped (header-injection guard). The
 * subject stays a fixed template with a single sanitized org-name slot.
 */
import type { SendEmailInput } from "../integrations/email";

/** Data an email needs — kept PII-local to this module; never logged/audited. */
export interface SponsorEmailData {
  orgName: string;
  pocName: string;
  pocEmail: string;
  pocPhone: string;
  painPoints: string;
  goalsNeeds: string;
  financialAmount: string | null;
  financialNote: string | null;
  financialToDiscuss: boolean;
  stakeholders: { name: string; email: string; phone: string }[];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Collapse CR/LF so a value can never split/forge a mail header. */
function stripCrlf(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

const POC_ACK_SUBJECT = "We received your Rogue Raise sponsorship interest";

export function buildPocAckEmail(data: SponsorEmailData): SendEmailInput {
  const org = escapeHtml(data.orgName);
  const name = escapeHtml(data.pocName);
  const html = [
    `<p>Hi ${name},</p>`,
    `<p>Thanks for your interest in bringing a Rogue Raise to <strong>${org}</strong>. ` +
      `We&rsquo;ve received your sponsorship application and the White Rabbit team will review it shortly.</p>`,
    `<p>We&rsquo;ll be in touch about next steps. No action is needed from you right now.</p>`,
    `<p>&mdash; The White Rabbit team</p>`,
  ].join("\n");
  const text =
    `Hi ${data.pocName},\n\n` +
    `Thanks for your interest in bringing a Rogue Raise to ${data.orgName}. ` +
    `We've received your sponsorship application and the White Rabbit team will review it shortly.\n\n` +
    `We'll be in touch about next steps. No action is needed from you right now.\n\n` +
    `— The White Rabbit team`;

  return {
    to: data.pocEmail,
    subject: POC_ACK_SUBJECT,
    html,
    text,
  };
}

export function buildAdminNotifyEmail(data: SponsorEmailData): SendEmailInput {
  const to = process.env.RR_ADMIN_NOTIFY_EMAIL ?? "admin@example.com";
  const financialLine = data.financialToDiscuss
    ? "Prefers to discuss the amount"
    : `Amount: ${escapeHtml(data.financialAmount ?? "")}`;
  const noteLine = data.financialNote
    ? `<p><strong>Financial note:</strong> ${escapeHtml(data.financialNote)}</p>`
    : "";

  const stakeholderRows = data.stakeholders
    .map(
      (s) =>
        `<li>${escapeHtml(s.name)} &mdash; ${escapeHtml(s.email)} &mdash; ${escapeHtml(s.phone)}</li>`,
    )
    .join("\n");

  const html = [
    `<p><strong>New Rogue Raise sponsor application</strong></p>`,
    `<p><strong>Organization:</strong> ${escapeHtml(data.orgName)}</p>`,
    `<p><strong>Primary contact:</strong> ${escapeHtml(data.pocName)} ` +
      `(${escapeHtml(data.pocEmail)}, ${escapeHtml(data.pocPhone)})</p>`,
    `<p><strong>The problem:</strong><br/>${escapeHtml(data.painPoints)}</p>`,
    `<p><strong>Goals &amp; needs:</strong><br/>${escapeHtml(data.goalsNeeds)}</p>`,
    `<p><strong>Financial commitment:</strong> ${financialLine}</p>`,
    noteLine,
    `<p><strong>Stakeholders:</strong></p>`,
    `<ul>\n${stakeholderRows}\n</ul>`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    to,
    replyTo: data.pocEmail,
    // Fixed template; org name CR/LF-stripped to prevent header injection.
    subject: `New Rogue Raise sponsor application: ${stripCrlf(data.orgName)}`,
    html,
  };
}
