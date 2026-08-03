<!--
metadata:
  created_at:   2026-07-27T21:20:00-07:00
  activated_at: 2026-07-27T21:20:00-07:00
  planned_at:   2026-07-27T21:25:00-07:00
  finished_at:  2026-07-27T21:28:00-07:00
  updated_at:   2026-07-27T21:28:00-07:00
-->

# Story: Admin Event Review & Confirmed Weekend

## Summary

AS a WR Admin
I WANT to read a sponsor's completed intake in one place and lock in the event weekend
SO THAT the whole platform has one authoritative set of dates, and I can unblock a sponsor whose intake link never arrived

## Acceptance Criteria

- `/admin/events` lists every event with its status, organization, and intake progress (which vital fields are still missing), newest first, filterable by status.
- `/admin/events/[id]` shows the full intake read-only: every §5.2.2 field, the stakeholder list, judges, criteria, technical sponsors, awards budget, tech stack + tags, and the attached files (downloadable by an admin without the sponsor's magic link).
- Each offered weekend is shown with its **expanded canonical schedule** (Fri kickoff / Sat build / Sun 4:00 PM pitches / 6:00 PM results), not just a raw date.
- Admin can **confirm exactly one** weekend. Confirming sets `date_options.is_confirmed` on that option, clears it on every other option for the event, and writes `events.confirmed_friday_kickoff_at` — **the single source every downstream artifact reads**.
- Re-confirming a different weekend moves the confirmation atomically (never two confirmed, never zero mid-flight) and is audit-logged with from→to.
- Confirmation is refused unless the event is in a status where a weekend is meaningful, and refused if the chosen option doesn't belong to that event.
- Admin can **resend the sponsor's intake invitation**: it mints a fresh magic-link token, revokes the previous unexpired `sponsor_poc` tokens for that event, and re-sends the invite email. This closes the story-2 gap where an approve-email failure left a sponsor with no way in.
- Every action is audit-logged with actor, timestamp, and from→to values; all writes happen in one transaction; emails send only after commit.
- The intake-complete admin notification links to `/admin/events/[id]` rather than the sponsor queue.
- Views are brand-themed, responsive, and accessible; `/admin/*` remains behind the existing env gate.

## Notes

- **Scope:** the admin half of PRD §5.2.3 plus the admin-facing intake review that M2 calls for ("intake completeness tracking"). Completes **M2**.
- **Schema:** no migration needed — `date_options.is_confirmed` and `events.confirmed_friday_kickoff_at` already exist.
- **Reuse:** `intake/schedule.ts` for expansion/formatting, `intake/completeness.ts` for the progress read-out, `intake/queries.ts` for loading the intake, `sponsors/magic-link.ts` for the resend token.
- **Still deferred:** admin authentication (Better Auth `admin` plugin) — actor stays the `wr-admin` placeholder; a uniqueness migration on `events.sponsor_application_id`.

## Implementation Plan

### Overview

Add an `events` domain module mirroring the established shape: a plain `queries.ts` read model, a `"use server"` `admin-actions.ts` whose writes are transactional and audit-logged, a plain `state.ts` for the UI contract, and two Server-Component routes under the existing `/admin` env gate. The confirmed weekend is written in the same transaction that clears the others, so "exactly one confirmed" is a database-level guarantee rather than a UI convention.

### Resolved decisions

- **Confirmation is a move, not a toggle.** One statement clears `is_confirmed` for the event, one sets it on the chosen option, and `events.confirmed_friday_kickoff_at` is written from the option's own instant — all inside one transaction under a `FOR UPDATE` lock on the event.
- **`confirmed_friday_kickoff_at` is the source of truth**, and `expandSchedule` derives everything else. Nothing downstream stores its own copy of Saturday or Sunday times.
- **Confirmable statuses** are `intake_pending` … `registration_open` — before that there is no intake, and from `live` onward the weekend is happening. Re-confirming during `registration_open` is allowed but flagged in the UI as something participants have already been told.
- **Resend revokes**, so an old link in an old inbox stops working the moment a new one is issued. Revocation is by `revoked_at`, not deletion, so the audit trail survives.
- **Admin file access does not require the sponsor's token**: the existing route is sponsor-scoped, so admins get their own `/admin/events/[id]/attachments/[attachmentId]` behind the same env gate.

### Steps

1. **`lib/rogue-raise/events/queries.ts`** — `listAdminEvents(status?)` (event + org + intake completeness facts, one grouped query per collection), `loadAdminEvent(id)` (event + org + application + stakeholders + intake + date options + attachments).
2. **`lib/rogue-raise/events/state.ts`** — `AdminEventState`, `initialAdminEventState`, `ACTOR_WR_ADMIN` re-use.
3. **`lib/rogue-raise/events/admin-actions.ts`** — `confirmEventWeekend` (lock, validate option belongs to event, status gate, clear-then-set, write `confirmed_friday_kickoff_at`, audit from→to), `resendIntakeInvite` (revoke prior `sponsor_poc` tokens, mint, audit, email after commit).
4. **`lib/rogue-raise/events/emails.ts`** — reuse `buildIntakeInviteEmail`; add a "your link has been reissued" variant.
5. **Routes** — `/admin/events` (+ `loading.tsx`), `/admin/events/[id]` (+ `loading.tsx`), `confirm-weekend.tsx` client island, `/admin/events/[id]/attachments/[attachmentId]` download route.
6. **Wire-ups** — `/admin` dashboard gains an events card; the intake-complete email links to the event page.
7. **Tests** — integration: confirm happy path, move between options, exactly-one invariant, foreign option refused, status gate, audit rows; resend: revokes prior tokens, mints exactly one live token, emails after commit, audit row. Unit: any pure status-gate helper.

### Testing Strategy

Mirror the story-2/3 harness (dotenv first, real Postgres, mocked email + `next/cache`, `db.$client.end()` in `afterAll`). Assert the exactly-one-confirmed invariant by counting confirmed rows after every mutation, not by reading back the one we set.

### Risks

- Re-confirming after `registration_open` changes dates participants have already seen; the UI warns but does not block. If that turns out to be wrong, the gate is one constant.
- Resend revoking prior tokens means a sponsor mid-form on an old link is logged out on their next save; acceptable, and the message tells them to use the newest email.

## Review

**Date:** 2026-07-27 · **Commit reviewed:** eb6fd79 · Self-review against ACs + browser verification · **Status: all 10 ACs met**

### Acceptance criteria

| # | AC | Verdict |
|---|----|---------|
| 1 | `/admin/events` lists events with status, org, intake progress, filterable | ✅ browser; counts and filters verified live |
| 2 | Detail shows the full intake read-only + downloadable files | ✅ every §5.2.2 section rendered; admin download route behind the env gate |
| 3 | Each weekend shown with its expanded canonical schedule | ✅ browser: all four fixed moments per option |
| 4 | Confirm exactly one weekend; writes `confirmed_friday_kickoff_at` | ✅ integration test asserts the confirmed-row count, plus the event column |
| 5 | Re-confirming moves atomically; audit-logged from→to | ✅ test moves A→C and asserts one confirmed row and honest audit values |
| 6 | Refused out of phase, and for an option from another event | ✅ two integration tests; neither event is mutated |
| 7 | Resend mints fresh, revokes prior, re-sends | ✅ browser: the old link then reads "this link has been turned off"; test asserts one live token whose hash matches the raw token in the email |
| 8 | One transaction, audit-logged, email after commit | ✅ including the email-failure path, which keeps the new link and audits the failure |
| 9 | Intake-complete notification links to the event | ✅ |
| 10 | Brand-themed, responsive, accessible; env gate intact | ✅ verified in browser; no automated coverage (standing caveat) |

### Notable decisions confirmed in review

- **Failing safe in the right direction.** If the reissue email fails to send, the old links are already dead. That is deliberate: an admin who sees the error knows to retry or phone, whereas the alternative (revoke only after a successful send) can leave two live links with no record of which the sponsor used.
- **Already-expired tokens are left alone** rather than swept into the revoked set — a test pins this, so the "N earlier links stopped working" count stays truthful.
- **Late confirmation is warned, not blocked.** Changing dates after registration opens is a legitimate staff act; the confirm panel says what it means instead of refusing.

### Known gaps (deliberate)

- No admin auth — actor is still the `wr-admin` placeholder, and `/admin/*` remains behind the env gate. Unchanged from story 2, flagged in HANDOFF.
- A sponsor can still delete a weekend the admin has confirmed from their own intake form; the confirmed flag is preserved on re-save but not protected from removal. Called out below as the first carry-forward.
- No automated a11y/visual coverage.

## Learnings

**What went well**

- Reusing `evaluateCompleteness` for the admin view meant the console and the sponsor's own form describe intake progress in exactly the same words, for free. Pure functions over facts keep paying out.
- Deriving panel open/closed from the action version — rather than closing it in an effect — was both what the lint rule demanded and strictly less code. The rule was right; the first instinct was wrong.
- Storing only the Friday instant and deriving the rest continues to be the right call: the admin page, the emails, and the sponsor form all render the same weekend without any of them agreeing on a format.
- Every action in this story is a small transaction with a lock and an audit row. Four stories in, that shape is now automatic and reviews faster each time.

**What was surprising**

- Revoke-then-send has no failure ordering that is safe in both directions; it only has one that is safe in the direction that matters. Writing that reasoning into the code comment took longer than the code.
- `notInArray` on an enum column needed the literal tuple typed, a small friction that would bite anyone reaching for `notInArray(status, someStringArray)`.

**Do differently next time**

- Carry-forwards: **protect a confirmed weekend from sponsor deletion** (the intake save should refuse to remove a confirmed option, the way it refuses to remove a judge with a completed profile — the pattern already exists, it just wasn't applied here); a uniqueness migration on `events.sponsor_application_id`; and admin auth, which is now blocking two stories' worth of placeholder actors.
- **M2 is complete.** Next up is M3 — the agent layer core (`AgentRun`/`GeneratedAsset` infra, durable workflow scaffold, AI Gateway wiring, and the approve/edit/reject review UI), which everything in §5.3 depends on.
