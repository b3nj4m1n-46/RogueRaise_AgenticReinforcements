<!--
metadata:
  created_at:   2026-07-06T19:24:50-07:00
  activated_at:
  planned_at:
  finished_at:
  updated_at:   2026-07-06T19:24:50-07:00
-->

# Story: Public Sponsor Sign-Up Form

## Summary

AS a Sponsor POC (point of contact at a prospective sponsoring organization)
I WANT to submit a sponsorship application through a public form
SO THAT White Rabbit can review our interest and stand up a Rogue Raise for our organization

## Acceptance Criteria

- A public route `/sponsor` renders the sponsorship sign-up form — brand-themed (WR tokens), responsive, body never scrolls horizontally.
- The form captures all Part 1 fields (PRD §5.1): `org_name`, `poc_name`, `poc_email`, `poc_phone` (E.164), `pain_points` (long text), `goals_needs` (long text), and `financial_commitment` (amount + note, with a "to discuss" option).
- Stakeholders are a **dynamic repeatable field group** (`name`, `email`, `phone`), minimum 1, with add/remove rows.
- Validation runs **client- and server-side from a single shared zod schema**; required fields and email/phone formats are enforced with clear inline errors.
- On submit, the server action `createSponsorApplication` — in one transaction — creates a `SponsorApplication` (`status=submitted`), creates or links an `Organization`, and creates an `Event` (`status=submitted`) linked to the application.
- The POC receives an acknowledgment email ("We received your Rogue Raise sponsorship interest") via the email adapter.
- WR Admin receives an internal notification (email + an admin dashboard badge/count).
- Spam protection is enabled on the public form (Vercel BotID or hCaptcha).
- The creation is **audit-logged** (`actor`, `action`, `entity`, `to_value`, timestamp) in `audit_log`.
- Duplicate or invalid submissions are rejected gracefully (no partial writes; the whole transaction rolls back).

## Notes

- **Scope:** PRD §5.1 (Phase 1, Part 1) and milestone **M1**. This is the product's front door and the first vertical slice exercising the M0 foundation end-to-end.
- **Entities:** `sponsor_applications`, `organizations`, `events`, `stakeholders` — all already in the schema (`src/lib/rogue-raise/db/schema.ts`).
- **Financial commitment:** stored as `financial_commitment_amount` + `financial_commitment_note` + `financial_commitment_to_discuss`. Payment is handled offline for MVP (§16 Q3) — store amount + intent only.
- **Auth:** none required — this form is public. The magic-link secondary intake (§5.2.2) is a later story; the ack email here is not a magic link.
- **Adapters:** email goes through `src/lib/rogue-raise/integrations/email.ts` (dev-logs until Resend is wired). No Blob/GitHub/AI needed for this story.
- **Design:** reuse WR tokens + shadcn form primitives; `/sponsor` lives under `app/rogue-raise/` or a top-level `app/sponsor` route mirroring the PRD's public path.
- **Testing:** shared zod schema and `createSponsorApplication` are the natural unit/integration test targets (see repo test-infra decision).

## Implementation Plan

[to be filled in by /stories plan]
