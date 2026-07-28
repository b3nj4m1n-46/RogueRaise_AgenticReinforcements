<!--
metadata:
  created_at:   2026-07-27T23:15:00-07:00
  activated_at: 2026-07-27T23:15:00-07:00
  planned_at:   2026-07-27T23:17:00-07:00
  finished_at:  2026-07-27T23:50:00-07:00
  updated_at:   2026-07-27T23:50:00-07:00
-->

# Story: Admin Authentication & Hardening

## Summary

AS White Rabbit
I WANT the staff console behind a real sign-in, every privileged action to authorize itself, and the accessibility and rate-limit gaps closed
SO THAT this can actually be deployed — which, until now, it could not be

Covers PRD §12 (auth, permissions, security), §9 (audit log), §10 (rate-limited bulk sends), §13 (WCAG AA) — milestone M10.

## Acceptance Criteria

- `/admin/*` requires a signed-in Better Auth user with the `admin` role. Sign-up is disabled; accounts come from `npm run admin:create`.
- Authorization is enforced **per action**, not only per page — a Server Action is reachable without rendering the page that hosts it.
- Route handlers (the two private-file downloads) check for themselves, since layouts don't render for them.
- Everything **fails closed**: no session, no role, banned, unconfigured, or a thrown error all resolve to "not an admin".
- `RR_ADMIN_DEV_OPEN` is ignored when `NODE_ENV=production`, so a stray env var can't open the console.
- Better Auth's tables live in `public`, not `rogue_raise` — identity comes from WR's layer, per §12.
- Audit rows name the **individual admin** (`wr-admin:<userId>`), so "who sent those 40 emails" is answerable.
- A structural test fails if any future privileged action is added without a guard.
- Bulk sends are paced so a large blast doesn't lose its tail to provider 429s.
- The WCAG AA defects found in the M8–M9 surfaces are fixed.

## Implementation Plan

`integrations/auth.ts` builds Better Auth (email+password, `admin` plugin, `nextCookies`) with the instance type **inferred** rather than annotated, so the plugin's fields survive. `admin/guard.ts` holds `checkAdmin`/`requireAdmin`/`adminOrError` and is not a `"use server"` module. Three layers guard the console — middleware (fast, cookie-presence only), a `(console)` route-group layout (server-side, per page), and the per-action guard (the real boundary). `admin/coverage.test.ts` reads source to prove the third layer is reached everywhere. `integrations/rate-limit.ts` is an injectable-clock pacer, tested without sleeping.

## Review

**Date:** 2026-07-27 · **Commit reviewed:** (this commit) · **Status: all 10 ACs met**

523 tests pass (61 new); build clean. Verified end to end in a browser with `RR_ADMIN_DEV_OPEN` forced off against a real account: signed out → redirected with the deep link preserved; wrong password → uniform error, email kept, password cleared; correct password → landed on the deep link; a privileged action wrote `actor: "wr-admin:7kXMHvzx…"`; sign-out → refused again.

**Defence in depth verified by forging a cookie**, which passes middleware: `/admin/events` still redirected (layout guard) and the attachment route still returned **404, not 403** — an unauthorized caller learns nothing about whether the file exists.

An accessibility audit of the M8–M10 surfaces found eight defects, all fixed:

1. **The stewardship radio group disabled itself mid-interaction.** Radios respond to arrow keys, so pressing Down committed a value, disabled the fieldset, and blurred focus to `<body>` — options 3 and 4 were unreachable, on the one control the entire portal exists to capture. Verified fixed by arrowing through the group and confirming focus survives.
2. **Submission validation errors were completely silent.** `submitProject` returns `fieldErrors` with no `formError`; field errors reach the user only via `aria-describedby`, which is spoken on focus. A blind participant got a re-enabled button and no explanation. Now an anchored error summary with focus moved to it.
3. **The scorecard's `key`-based remount** (my own M8 fix) dumped focus to the top of the page and made the confirmation unreliable. Live regions hoisted out of the keyed subtree; focus restored.
4. `aria-describedby` on a roleless `<div>` — dropped entirely by assistive tech. Moved to the `<fieldset>`.
5. **The award winner `<select>` wrote on every `onChange`.** On Windows, arrowing a collapsed select fires change per option — a keyboard admin would assign a different winner for each team they passed. Now an explicit "Save winner".
6. `text-ink/50` is 3.31:1, below AA — and it carried the 1–5 scoring rubric.
7. Control borders at 1.44–1.65:1, below the 3:1 for non-text contrast, on radios whose input is `sr-only` (the border *was* the control).
8. **The team roster blanked on any validation error** — the same `form.reset()` desync documented in CLAUDE.md, in the one form that hadn't been fixed. Verified: a second member survives a failed submit.

**Known gaps (deliberate):** external roles still use this app's own event-scoped magic links rather than Better Auth's `magicLink` plugin — reasoned through in HANDOFF.md, because Better Auth authenticates a person but does not scope them to an event; there is no password reset or 2FA (WR staff are a handful of people and the plugin supports both when wanted); bulk sends are paced inline rather than queued.

## Learnings

- **A layout is not an authorization boundary, and neither is middleware.** Layouts don't render for Server Actions or Route Handlers; middleware runs on the Edge with no database and can only see that a cookie *exists*. Forging a cookie is the test that tells you which of your three layers is actually load-bearing — and it found two route handlers serving private files with no check at all.
- **The guard test that matters reads source, not behaviour.** `guard.test.ts` proves the check is correct; `coverage.test.ts` proves it is *reached*, including by actions nobody has written yet. Its allow-list — every action deliberately public or token-gated, with the reason — turned out to be the most useful artifact in the story, because it makes "should this be open?" a decision someone has to write down.
- **Making the audit actor a required parameter let the compiler find all 14 sites.** A default of `"wr-admin"` would have compiled everywhere and silently kept the placeholder in half of them.
- **`ReturnType<typeof betterAuth>` silently widens away the plugins.** The instance must be built in its own function and the type inferred, or `role` and `banned` — the exact fields the guard depends on — vanish.
- **`nextCookies()` must be last in the plugin list, and its absence fails silently.** Sign-in "succeeded", returned a user, and set no cookie; every subsequent request was anonymous. Nothing errored. Worth remembering that a green path is not evidence of a session.
- **An audit's most valuable findings were in code I had just written and tested.** Three of the eight (the keyed-form focus loss, the roster blanking, the roleless `aria-describedby`) were direct consequences of my own M8 fixes. Fixing a bug in one form and not auditing the sibling form is how the same bug ships twice.
