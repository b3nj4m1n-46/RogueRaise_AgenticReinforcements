/**
 * Test environment defaults.
 *
 * Email pacing is disabled here so the integration suites that send in a loop
 * (judge invitations, submission invites, scoring links, portal opening) don't
 * spend real seconds waiting. The pacer's own behaviour is tested directly in
 * `integrations/rate-limit.test.ts` against a fake clock, which is where it
 * belongs — a suite that waited for real would be slow AND a worse test.
 */
process.env.RR_EMAIL_MIN_INTERVAL_MS = "0";
