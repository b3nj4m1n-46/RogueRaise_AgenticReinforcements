/**
 * Intake notification emails. Same security posture as the sponsor emails: every
 * echoed value is HTML-escaped, subjects are fixed strings with at most one
 * CR/LF-stripped slot, and nothing internal (notes, tokens, file contents) is
 * ever echoed. All sends go through the `email` adapter seam.
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

export interface IntakeCompleteEmailData {
  orgName: string;
  eventTitle: string;
  /** Human-readable weekend options, already formatted by `schedule.ts`. */
  weekendLabels: string[];
  judgeCount: number;
  criteriaCount: number;
  attachmentCount: number;
}

/**
 * Sent once, when the last VITAL intake field lands and the event flips to
 * `intake_complete`. Deliberately a summary, not a data dump — the console is
 * the place to read the intake; this is the nudge to go there.
 */
export function buildIntakeCompleteAdminEmail(
  data: IntakeCompleteEmailData,
): SendEmailInput {
  const to = process.env.RR_ADMIN_NOTIFY_EMAIL ?? "admin@example.com";
  const base = (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(
    /\/+$/,
    "",
  );
  const consoleUrl = `${base}/admin/sponsors`;

  const weekends = data.weekendLabels.length
    ? data.weekendLabels.map((w) => `<li>${escapeHtml(w)}</li>`).join("\n")
    : "<li>None offered</li>";

  const html = [
    `<p><strong>Intake complete: ${escapeHtml(data.orgName)}</strong></p>`,
    `<p>${escapeHtml(data.eventTitle)} has every vital intake field filled in, and the event has advanced to <code>intake_complete</code>.</p>`,
    `<p><strong>Weekend options offered:</strong></p>`,
    `<ul>\n${weekends}\n</ul>`,
    `<p><strong>Also provided:</strong> ${data.judgeCount} judge(s), ${data.criteriaCount} evaluative criteria, ${data.attachmentCount} supporting file(s).</p>`,
    `<p><a href="${escapeHtml(consoleUrl)}">Open the Rogue Raise console</a></p>`,
  ].join("\n");

  const text =
    `Intake complete: ${data.orgName}\n\n` +
    `${data.eventTitle} has every vital intake field filled in, and the event has advanced to intake_complete.\n\n` +
    `Weekend options offered:\n` +
    (data.weekendLabels.length
      ? data.weekendLabels.map((w) => `  - ${w}`).join("\n")
      : "  - None offered") +
    `\n\nAlso provided: ${data.judgeCount} judge(s), ${data.criteriaCount} evaluative criteria, ` +
    `${data.attachmentCount} supporting file(s).\n\n` +
    `Open the console: ${consoleUrl}`;

  return {
    to,
    subject: `Rogue Raise intake complete: ${stripCrlf(data.orgName)}`,
    html,
    text,
  };
}
