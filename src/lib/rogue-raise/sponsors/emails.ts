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

// ---------------------------------------------------------------------------
// Admin curation (story 2) — decision emails to the sponsor POC.
//
// Same security posture as above: every echoed value is HTML-escaped in the
// body, subjects are fixed strings (no user interpolation), and no internal
// admin note is ever echoed. Both go through the `email` adapter seam.
// ---------------------------------------------------------------------------

/** Data the approval intake-invite email needs. `intakeUrl` carries the raw token. */
export interface IntakeInviteEmailData {
  orgName: string;
  pocName: string;
  pocEmail: string;
  intakeUrl: string;
  /**
   * True when WR Admin reissued the link (the original never arrived, or it
   * expired). The copy then leads with "here is a fresh link" and says plainly
   * that older links have stopped working, rather than re-announcing approval
   * to someone who already knows.
   */
  reissued?: boolean;
}

/** Data the courteous decline email needs. No note, no reasons echoed. */
export interface DeclineEmailData {
  orgName: string;
  pocName: string;
  pocEmail: string;
}

const INTAKE_INVITE_SUBJECT =
  "Your Rogue Raise is approved — let's begin intake";

const INTAKE_REISSUE_SUBJECT = "Here's a fresh link to your Rogue Raise intake";

const DECLINE_SUBJECT = "An update on your Rogue Raise application";

/**
 * Sent on approve. Announces the decision and links to the (future) intake form.
 * The form route may not be live yet — the copy says so and notes the 14-day
 * expiry so the POC knows the link is personal and time-bound.
 */
export function buildIntakeInviteEmail(
  data: IntakeInviteEmailData,
): SendEmailInput {
  const org = escapeHtml(data.orgName);
  const name = escapeHtml(data.pocName);
  const url = escapeHtml(data.intakeUrl);

  if (data.reissued) {
    const html = [
      `<p>Hi ${name},</p>`,
      `<p>Here&rsquo;s a fresh link to the intake form for <strong>${org}</strong>&rsquo;s ` +
        `Rogue Raise. Everything you&rsquo;d already filled in is still there.</p>`,
      `<p><a href="${url}">Open your intake form</a></p>`,
      `<p>Please use this link from now on &mdash; any earlier link we sent has ` +
        `stopped working. This one is personal to you and expires in 14 days.</p>`,
      `<p>&mdash; The White Rabbit team</p>`,
    ].join("\n");
    const text =
      `Hi ${data.pocName},\n\n` +
      `Here's a fresh link to the intake form for ${data.orgName}'s Rogue Raise. ` +
      `Everything you'd already filled in is still there.\n\n` +
      `Open your intake form:\n${data.intakeUrl}\n\n` +
      `Please use this link from now on — any earlier link we sent has stopped ` +
      `working. This one is personal to you and expires in 14 days.\n\n` +
      `— The White Rabbit team`;
    return {
      to: data.pocEmail,
      subject: INTAKE_REISSUE_SUBJECT,
      html,
      text,
    };
  }

  const html = [
    `<p>Hi ${name},</p>`,
    `<p>Good news &mdash; the Rogue Raise for <strong>${org}</strong> has been ` +
      `approved. The next step is a short intake form so we can shape the build ` +
      `around your goals.</p>`,
    `<p><a href="${url}">Open your intake form</a></p>`,
    `<p>Your intake form opens soon; if that link isn&rsquo;t live yet, keep this ` +
      `email and try again shortly. The link is personal to you and expires in ` +
      `14 days.</p>`,
    `<p>&mdash; The White Rabbit team</p>`,
  ].join("\n");
  const text =
    `Hi ${data.pocName},\n\n` +
    `Good news — the Rogue Raise for ${data.orgName} has been approved. ` +
    `The next step is a short intake form so we can shape the build around your goals.\n\n` +
    `Open your intake form:\n${data.intakeUrl}\n\n` +
    `Your intake form opens soon; if that link isn't live yet, keep this email ` +
    `and try again shortly. The link is personal to you and expires in 14 days.\n\n` +
    `— The White Rabbit team`;

  return {
    to: data.pocEmail,
    subject: INTAKE_INVITE_SUBJECT,
    html,
    text,
  };
}

/**
 * Sent on reject. Genuinely courteous, in the barn-raise spirit — we take on a
 * few builds at a time so each gets real focus, and we mean it when we say we'd
 * welcome them back. No note, no reasons, no false promises.
 */
export function buildDeclineEmail(data: DeclineEmailData): SendEmailInput {
  const org = escapeHtml(data.orgName);
  const name = escapeHtml(data.pocName);
  const html = [
    `<p>Hi ${name},</p>`,
    `<p>Thank you for putting <strong>${org}</strong> forward for a Rogue Raise. ` +
      `We gave your application real consideration, and after review we&rsquo;re ` +
      `not able to take it on this round.</p>`,
    `<p>That isn&rsquo;t a verdict on the worth of your work. We run a small number ` +
      `of builds at a time so each one gets the focus a barn-raise deserves &mdash; ` +
      `the aim is always to raise something that lasts alongside a community, not ` +
      `to spread ourselves thin.</p>`,
    `<p>We&rsquo;d genuinely welcome hearing from you again as our capacity opens ` +
      `up. Thank you for wanting to build something real with the people around you.</p>`,
    `<p>&mdash; The White Rabbit team</p>`,
  ].join("\n");
  const text =
    `Hi ${data.pocName},\n\n` +
    `Thank you for putting ${data.orgName} forward for a Rogue Raise. We gave your ` +
    `application real consideration, and after review we're not able to take it on ` +
    `this round.\n\n` +
    `That isn't a verdict on the worth of your work. We run a small number of builds ` +
    `at a time so each one gets the focus a barn-raise deserves — the aim is always ` +
    `to raise something that lasts alongside a community, not to spread ourselves thin.\n\n` +
    `We'd genuinely welcome hearing from you again as our capacity opens up. Thank you ` +
    `for wanting to build something real with the people around you.\n\n` +
    `— The White Rabbit team`;

  return {
    to: data.pocEmail,
    subject: DECLINE_SUBJECT,
    html,
    text,
  };
}
