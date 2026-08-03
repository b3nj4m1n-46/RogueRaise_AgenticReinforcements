<!--
metadata:
  created_at:   2026-07-27T22:21:00-07:00
  activated_at: 2026-07-27T22:21:00-07:00
  planned_at:   2026-07-27T22:21:00-07:00
  finished_at:  2026-07-27T22:28:00-07:00
  updated_at:   2026-07-27T22:28:00-07:00
-->

# Story: Event Landing Page & Participant Registration

## Summary

AS a prospective builder
I WANT a public page that tells me what this Rogue Raise is and a short form to sign up
SO THAT I can decide in a minute whether to give up my weekend, and register without friction

## Acceptance Criteria

- `/events/[slug]` shows the topic, the confirmed date and time **from the single schedule source**, the location, and the description, with an event FAQ and a prominent Register CTA. Linked from the `/rogue-raise` hub.
- **Only approved copy is public.** With none, the page falls back to the sponsor's own words rather than showing an unreviewed draft or an empty page.
- `/events/[slug]/register` creates a `Participant`, and is **only open while `Event.status = registration_open`** — re-checked under a lock at write time.
- GitHub username is **format-validated**, existence-checked where feasible, and someone without an account gets a link and can come back.
- The confirmation email includes the **Rogue Raise rules**.
- A **duplicate email per event** is rejected gracefully and doesn't email twice.
- **Registration count is visible to WR Admin.**
- Responsive, brand-themed, body never scrolls horizontally.

## Implementation Plan

`events/landing.ts` is the public read model — approved-only copy, parsers for the agent's headings, schedule from the event. `participants/*` holds the schema, the confirmation email (rules included), and the action, which reuses the sponsor form's spam posture. `checkGithubUser` joins the GitHub integration as a deliberately non-blocking, three-valued check.

## Review

**Date:** 2026-07-27 · **Commit:** d174a2d · Self-review + browser verification · **Status: all 8 ACs met**

Verified end to end in the browser: a pasted GitHub profile URL normalized to the username, the participant row created, the confirmation email sent with the rules, and the landing page rendering the fallback path (no approved copy) with the schedule from the event record. 16 new tests cover the closed-registration refusal, duplicate emails, the three GitHub check outcomes, honeypot rejection, value retention on validation failure, the copy parsers, and — importantly — that unapproved copy never reaches the public page.

**Known gaps (deliberate):** the GitHub check is advisory by design and will let a typo'd-but-plausible username through when the API can't answer; there is no waitlist or capacity limit, which the PRD doesn't ask for; and admin has no toggle to open registration yet — status is moved by the repo-approval flow or by hand.

## Learnings

- Making the existence check three-valued rather than boolean was the whole design. `true`/`false`/`unknown` means a GitHub rate limit degrades to "let them in" instead of "your username is wrong" — turning our infrastructure problem into the participant's would be the worst possible failure on a registration form.
- Telling the marketing agent *not* to write the date, and rendering it from the event, paid off one story later: the landing page cannot show a stale weekend, because the copy never contained one.
- The fallback to the sponsor's own words means a page exists the moment registration opens, without waiting on an agent run and a review. Falling back to *their* words rather than generic filler is what makes it acceptable rather than a placeholder.
- The test suite caught nothing new here — but only because the spam, transaction, audit, and email-after-commit patterns were lifted wholesale from the sponsor sign-up. The first story's shape is still paying.
- Carry-forward for **M8** (Phase 3): submissions need a magic-link or participant-identified route, judge scoring needs the criteria and the 1–5 scale already in the intake, and tabulation needs a defined tie-break rule — the PRD doesn't state one, so that decision has to be made explicitly and written down.
