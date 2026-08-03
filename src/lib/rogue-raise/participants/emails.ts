/**
 * Participant confirmation email (PRD §6.2): confirms the spot and carries the
 * Rogue Raise rules, which is the AC — a confirmation without the rules is a
 * confirmation the participant has to chase.
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

/**
 * The rules, in one place. They are the same for every Rogue Raise, so they
 * live here rather than being generated — an agent rewriting the rules each
 * time is exactly the wrong use of an agent.
 */
export const ROGUE_RAISE_RULES = [
  "Teams form on Friday night. Come alone or bring people — both work.",
  "Anything you start before Friday evening stays out of the build. Open-source libraries and starter templates are fine; a half-finished version of the project is not.",
  "Everything you build goes in a public repository under the White Rabbit organization, under an open licence, so the sponsor can actually keep using it.",
  "Never commit credentials. If you need an API key, ask an organizer — they'll get you one for the weekend.",
  "Pitches are Sunday at 4:00 PM, five minutes each. Results at 6:00 PM.",
  "Be good to each other. This is a barn raising, not a competition with casualties.",
];

export interface ParticipantConfirmationData {
  firstName: string;
  email: string;
  eventTitle: string;
  organizationName: string;
  weekendLabel: string | null;
  scheduleLines: string[];
  location: string | null;
  eventUrl: string;
  repoUrl: string | null;
}

export function buildParticipantConfirmationEmail(
  data: ParticipantConfirmationData,
): SendEmailInput {
  const rulesHtml = ROGUE_RAISE_RULES.map((r) => `<li>${escapeHtml(r)}</li>`).join("\n");
  const scheduleHtml = data.scheduleLines.length
    ? `<ul>\n${data.scheduleLines.map((l) => `<li>${escapeHtml(l)}</li>`).join("\n")}\n</ul>`
    : "<p>We'll confirm the schedule shortly.</p>";

  const html = [
    `<p>Hi ${escapeHtml(data.firstName)},</p>`,
    `<p>You're registered for <strong>${escapeHtml(data.eventTitle)}</strong>, a Rogue Raise with ${escapeHtml(data.organizationName)}.</p>`,
    data.weekendLabel ? `<p><strong>${escapeHtml(data.weekendLabel)}</strong></p>` : "",
    scheduleHtml,
    data.location ? `<p>${escapeHtml(data.location)}</p>` : "",
    data.repoUrl
      ? `<p>The context repo — research, the sponsor's stack, and example projects — is here: <a href="${escapeHtml(data.repoUrl)}">${escapeHtml(data.repoUrl)}</a>. Reading it beforehand is encouraged.</p>`
      : "",
    `<h3>The rules</h3>`,
    `<ol>\n${rulesHtml}\n</ol>`,
    `<p><a href="${escapeHtml(data.eventUrl)}">Event page</a></p>`,
    `<p>&mdash; The White Rabbit team</p>`,
  ]
    .filter(Boolean)
    .join("\n");

  const text = [
    `Hi ${data.firstName},`,
    "",
    `You're registered for ${data.eventTitle}, a Rogue Raise with ${data.organizationName}.`,
    "",
    data.weekendLabel ?? "",
    ...data.scheduleLines.map((l) => `  ${l}`),
    data.location ?? "",
    "",
    data.repoUrl
      ? `The context repo — research, the sponsor's stack, and example projects:\n${data.repoUrl}\nReading it beforehand is encouraged.\n`
      : "",
    "THE RULES",
    ...ROGUE_RAISE_RULES.map((r, i) => `${i + 1}. ${r}`),
    "",
    `Event page: ${data.eventUrl}`,
    "",
    "— The White Rabbit team",
  ]
    .filter((line) => line !== "")
    .join("\n");

  return {
    to: data.email,
    subject: `You're registered: ${stripCrlf(data.eventTitle)}`,
    html,
    text,
  };
}
