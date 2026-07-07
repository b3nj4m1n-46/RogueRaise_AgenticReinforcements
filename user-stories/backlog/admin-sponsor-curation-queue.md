<!--
metadata:
  created_at:   2026-07-07T07:32:20-07:00
  activated_at:
  planned_at:
  finished_at:
  updated_at:   2026-07-07T07:32:20-07:00
-->

# Story: Admin Sponsor Curation Queue

## Summary

AS a WR Admin
I WANT a curation queue where I can review, approve, or reject sponsorship applications
SO THAT approved events advance to secondary intake with no manual coordination, and declined sponsors get a courteous answer

## Acceptance Criteria

- `/admin/sponsors` lists all `SponsorApplication`s as a queue, filterable by status (`submitted` / `under_review` / `approved` / `rejected`), newest first, showing org name, POC, financial commitment, and submitted date.
- A detail view (`/admin/sponsors/[id]`) shows **all Part 1 fields** — org, POC contact, pain points, goals/needs, financial commitment, and the stakeholder list.
- Admin can **Approve** or **Reject** from the detail view, each with an **optional note** stored on the application.
- **Approve** sets the application to `approved`, transitions the linked `Event.status → approved` and then automatically to `intake_pending`, and sends the POC the secondary-intake email containing a **magic link** to the (future) intake form route — a `magic_link_tokens` row is created (role `sponsor_poc`, event-scoped, hashed token, expiring).
- **Reject** sets the application to `rejected`, transitions the linked `Event.status → rejected` (terminal), and sends the POC a courteous decline email.
- Approve/Reject are **idempotent-guarded**: acting on an application that is no longer `submitted`/`under_review` is refused with a clear message (no double transitions, no duplicate emails).
- **Every state change is audit-logged** with actor, timestamp, and from→to values (application status and event status separately).
- All transitions happen in **one transaction**; emails send only after commit and a send failure does not roll back the decision.
- The queue and detail views are brand-themed (WR tokens/shadcn), responsive, and accessible (semantic table/list, keyboard-operable actions, focus management on confirm).
- The `/admin` dashboard badge (submitted count) reflects decisions immediately.

## Notes

- **Scope:** PRD §5.2.1 (Phase 1, Part 2 — human curation), milestone **M2** start. Builds directly on story 1's data.
- **Status model:** `sponsor_app_status: submitted → under_review → approved | rejected`. Decide in plan whether `under_review` is set automatically on first admin view or via an explicit action; PRD only requires filters for it.
- **Event lifecycle:** `submitted → under_review → approved → intake_pending` on approve; `→ rejected` on reject (per PRD §4 the enum supports this; the Event was created in `submitted` by story 1).
- **Magic link:** `magic_link_tokens` table exists (event-scoped, role, `token_hash`, `expires_at`). Generate raw token → store hash → embed raw token in the emailed URL `/sponsor/intake/[eventId]?token=…`. The intake form itself is the NEXT story — the link may 404 until then; that is acceptable and should be noted in the email copy ("form opens soon") or the route stubbed.
- **Admin auth is NOT in scope:** Better Auth admin wiring is its own story; `/admin/*` remains dev-open. Record `actor` as `"wr-admin"` placeholder until auth lands. Flag this prominently in HANDOFF/review.
- **Emails:** via the existing email adapter (dev-logs). Decline copy should be genuinely courteous per the barn-raise ethos.
- **Testing:** integration tests for approve/reject transitions (happy, idempotent-guard, rollback), token hashing, and email-after-commit; unit tests for any new schema/helpers.

## Implementation Plan

[to be filled in by /stories plan]
