<!--
metadata:
  created_at:   2026-07-27T22:20:00-07:00
  activated_at: 2026-07-27T22:20:00-07:00
  planned_at:   2026-07-27T22:22:00-07:00
  finished_at:  2026-07-27T22:58:00-07:00
  updated_at:   2026-07-27T22:58:00-07:00
-->

# Story: Submissions, Judging & Awards

## Summary

AS a team that just built something, a judge scoring between pitches, and the WR Admin running the room
I WANT to submit a project, score every project against the sponsor's criteria, and see standings with ties surfaced
SO THAT the last two hours of a Rogue Raise are run from one screen instead of a spreadsheet and a shouted tally

Covers PRD §7.1 (submissions), §7.2 (judging), §7.3 (tabulation and awards) — milestone M8.

## Acceptance Criteria

- `/submit/[eventId]` is magic-link gated per participant and takes a team name, summary, repo URL, optional pitch materials, and the roster. The submitter is on their own team and cannot remove themselves.
- Submissions are accepted only while the event is `live`; the window is re-checked **under a row lock**, so a form opened at 3:55 and posted at 4:05 does not slip through.
- One submission per team, and a participant can only be on one team. Teammates listed by email are linked to their registered `participant` row (case-insensitively); anyone unregistered is still credited on the submission.
- The repo URL is checked against GitHub **advisorily**: only a definite 404 blocks, and the copy says a private repo looks the same from here.
- `/admin/events/[id]/submissions` fires the bulk invite (idempotent — a live link means skip, and the result says how many were skipped) and lists what has come in.
- `/judge/score/[eventId]` shows every submission with its own scorecard, 1–5 per criterion, scoped so a judge sees only their own cards.
- A **partial card saves as a draft** rather than being refused; only a complete card can be final, and a judge can re-score while judging is open.
- Scoring is **weighted when weights are set, a straight average otherwise, and the method is displayed** to judges and admin alike.
- Only submitted cards count toward standings; drafts never move a number.
- **Ties are surfaced, not silently broken** — shown as their own block above the standings for an Admin to decide.
- Awards are created by hand, optionally ranked by one criterion, and **assigning a winner is a separate step from announcing** one. An announced award locks its winner until reopened.
- `live → judging → completed` transitions are locked, audited, and refuse out of order; judging will not open on an empty room.

## Implementation Plan

`judging/scoring.ts` is pure and holds every number that decides a winner — weighted mean on the 1–5 scale (not a sum, so both methods are comparable), aggregation across judges, `findTies`, and `rankByCriterion`. Nothing in it breaks a tie. `judging/queries.ts` is a plain module (not `"use server"`) because a reader keyed only on an event id would be a way to read every team's scores without a token. `judging/actions.ts` owns the scorecard write with `onConflictDoUpdate` against the `(submission, judge)` unique constraint, plus the two phase transitions. `judging/award-actions.ts` keeps assign and announce apart. Submissions reuse the established shape: redeem token → validate → advisory external check → locked transaction → audit → PRG redirect.

## Review

**Date:** 2026-07-27 · **Commit reviewed:** (this commit) · **Status: all 12 ACs met**

26 pure-scoring tests and 26 integration tests against real Postgres, plus a full browser walk-through: two teams submitted, two judges scored, a deliberate tie at 4.25 was surfaced and left unbroken, an award ranked by "Handoff readiness" was assigned and announced, scoring was closed, and both the judge and submit pages then refused their tokens with the right copy. 417 tests pass; production build is clean.

Browser verification found five defects the tests did not:

1. The submitter could **Remove** themselves from their own team, which the server would have silently undone.
2. Score radios are `sr-only` inside styled labels, so keyboard focus was **invisible** — the ring is now drawn on the label.
3. `role="radiogroup"` inside a `fieldset`/`legend` made a screen reader **announce each criterion twice**.
4. React calls `form.reset()` after a server action settles; because the rendered `checked` values were unchanged, the reconciler never wrote them back and **a judge's picks vanished from the screen while still being saved**.
5. A multi-line JSX text node beginning right after `{expr}` **loses its leading space** at compile time ("The Unhousedisn't open"), and Prettier strips the `{" "}` fix.

**Known gaps (deliberate):** the submission window is a status check, not a clock — an Admin closes it, which matches how the room actually runs; bulk sends still loop inline rather than going through Vercel Queues (documented at the seam); there is no participant-facing view of a submitted project after the fact; awards have no generated announcement copy yet (that is the winners/marketing work in M9).

## Learnings

- **The tie rule is the whole feature.** Writing `findTies` as a reporter with no sorting escape hatch, and putting its output *above* the standings rather than as a footnote, is what makes "a person decided" true rather than aspirational. A `sort` by id would have been one line and would have hidden the decision forever.
- **Refusing a write is not the same as protecting the data.** The first version rejected an incomplete card outright; a judge scoring between pitches would have lost three of five scores to a validation error. Saving it as a draft *and* reporting what is missing is strictly better, and costs one boolean.
- **Controlled inputs and `form.reset()` disagree after a server action.** React only writes to the DOM when the rendered value changes, so a post-action reset survives. Keying the `<form>` on the action's version is the smallest honest fix; layering local picks over the server's saved card (rather than seeding state once) is what makes the remount safe.
- Weighted mode returning a **mean, not a sum**, is what lets `describeMethod` be honest: 4.2 means the same thing under both methods, so showing the method is information rather than decoration.
- Judges already hold a long-lived token from their invitation, but it is stored hashed — so the scoring email cannot reuse it and must mint a new one. That broke the "skip anyone with a live token" idempotency trick used elsewhere, and the audit trail had to become the idempotency key instead. Worth remembering: **hashing a token means you can never resend the same link.**
- Carry-forward: the stakeholder review surface is now owed by three stories, and `listSubmissionsWithTeams` was written with the Phase 4 handoff portal in mind — it already returns LOC, category, and stewardship columns that nothing populates yet.
