<!--
metadata:
  created_at:   2026-07-27T21:20:00-07:00
  activated_at: 2026-07-27T21:20:00-07:00
  planned_at:   2026-07-27T21:25:00-07:00
  finished_at:
  updated_at:   2026-07-27T21:25:00-07:00
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
