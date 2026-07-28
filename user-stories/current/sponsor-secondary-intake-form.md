<!--
metadata:
  created_at:   2026-07-27T19:55:17-07:00
  activated_at: 2026-07-27T19:55:17-07:00
  planned_at:   2026-07-27T20:10:00-07:00
  finished_at:
  updated_at:   2026-07-27T20:10:00-07:00
-->

# Story: Sponsor Secondary Intake Form

## Summary

AS an approved Sponsor POC
I WANT a magic-link-gated intake form that saves as I go and shows me exactly what's still missing
SO THAT I can shape my Rogue Raise across several sittings without losing work, and the event advances the moment the vital details are in

## Acceptance Criteria

- The approval email's magic link opens a working intake form at `/sponsor/intake/[eventId]?token=…`. An invalid, expired, revoked, wrong-role, or wrong-event token renders a courteous, non-leaky "this link isn't valid" page (never a stack trace, never the real reason).
- The form captures every `EventIntake` field from PRD §5.2.2: `judges[]` (name/email/phone), `evaluative_criteria[]` (label/description/weight), `potential_dates[]` (weekend options), `awards_budget` (amount + note), `technical_sponsors[]` (name/offering/contact/status), `supplementary_info` (text + file attachments), and `stakeholder_tech_stack` (long text + tags).
- **Auto-saves.** Edits persist without an explicit submit (debounced), and an explicit "Save now" control exists. Returning to the link later restores everything previously entered.
- A **progress indicator** shows required vs. optional sections and names what remains before the event can advance. Required (VITAL) fields — `potential_dates`, `supplementary_info`, `stakeholder_tech_stack` — are visibly marked as blocking.
- When all three required fields are present, `EventIntake.completed_at` is set, `Event.status → intake_complete`, and WR Admin is notified by email. The notification fires **once** (re-saving a complete intake does not re-notify).
- If a required field is later emptied, the intake reverts to incomplete (`completed_at` cleared, `Event.status → intake_pending`) and the revert is audit-logged. No email on revert.
- **Date options enforce the fixed schedule template (§5.2.3):** each option is chosen as a weekend and stored as a Friday kickoff instant (default 5:00 PM Pacific, configurable per option). A non-Friday date is rejected with a clear message. The form shows the expanded canonical timeline (Fri kickoff / Sat build / Sun 4:00 PM pitches / 6:00 PM results) for each option so the POC sees what they're committing to.
- **File uploads** go to private Blob storage, are type-validated (extension + declared MIME + magic-byte sniff), size-limited, and count-limited. Uploaded files are listed with name/size and can be removed. Files are never public.
- Every write is authorized server-side by re-verifying the token against the `eventId` in the URL — a valid token for Event A can never write Event B. Editing is refused unless `Event.status` is `intake_pending` or `intake_complete`.
- The page is brand-themed (WR tokens/shadcn), responsive, and accessible: labelled sections, keyboard-operable repeatable rows, live-region announcements for save state and add/remove, no colour-only status.

## Notes

- **Scope:** PRD §5.2.2 (secondary intake) + the §5.2.3 schedule-template *rules* (Friday-anchored options, canonical expansion). The **admin-side** "confirm one DateOption as the event weekend" AC of §5.2.3, and admin intake-completeness review, are the NEXT story (`/admin/events/[id]`).
- **Schema:** no migration needed — `event_intakes`, `date_options`, `criteria`, `tech_sponsors`, `attachments`, `judges` all already exist from M0.
- **Carry-forwards from story 2 that land here:** reuse `hashMagicToken` + `timingSafeEqual` for redemption; `RR_MAGIC_LINK_SECRET` fail-fast already enforced.
- **Deliberately deferred:** approve-email resend (needs an admin surface — next story); uniqueness migration on `events.sponsor_application_id`; AV scanning of uploads (validated + seam documented, no scanner wired).

## Implementation Plan

### Overview

Add a magic-link-gated, auto-saving intake form as a third domain module under `lib/rogue-raise/intake/*`, mirroring the sponsors module's discipline: pure schema module (shared client/server), a `"use server"` actions module whose every write re-verifies the token server-side, all writes in one transaction, emails only after commit, PII-free audit rows. Two new pure modules carry the domain rules: `schedule.ts` (Friday anchoring + canonical timeline expansion, timezone-correct without a date library) and `completeness.ts` (required-trio evaluation, shared by the server action and the progress UI).

### Resolved decisions

- **Token stays in the URL** (`?token=`) rather than being exchanged for a session cookie. A cookie exchange can't happen in an RSC render (no `cookies().set`) and would need a route-handler bounce or Node-runtime middleware; the emailed URL shape is already shipped. Mitigations: `referrer: no-referrer` metadata, token never logged/audited, `robots: noindex`. The Better Auth `magicLink` story replaces this seam wholesale.
- **Multi-use token.** `consumed_at` stays NULL for `sponsor_poc` intake links — the form is resumable by design, so single-use would break the core AC. `expires_at` (14d) and `revoked_at` are the controls. `consumed_at` remains reserved for genuinely single-use flows.
- **Re-verify on every write.** The token travels in a hidden field; each action re-runs full redemption against the URL's `eventId` before touching a row. No trust is placed in the page render.
- **Wholesale replace of child collections** (dates/criteria/tech sponsors/judges) inside the transaction, gated on `Event.status ∈ {intake_pending, intake_complete}` — nothing downstream (judge invites, scores, award categories) can exist yet at those statuses, so replace is safe and idempotent. `date_options.is_confirmed` is preserved by re-matching on the kickoff instant.
- **Attachments are additive**, not replaced: separate upload/remove actions so an autosave can never drop a file.
- **`supplementary_info` counts as present** when the text is non-empty OR ≥1 attachment exists (PRD defines the field as "Attachment[] + text").
- **Completeness is a pure function** over the parsed form values, so the client progress indicator and the server transition agree by construction.
- **Timezone:** all schedule instants are anchored in `America/Los_Angeles` (Ashland, OR) via `Intl.DateTimeFormat` offset resolution — no date library, DST-correct.
- **Blob:** real `@vercel/blob` provider when `BLOB_READ_WRITE_TOKEN` is set; otherwise a local-filesystem dev provider under `.rr-blob/` served by a token-gated download route. Private in both cases.

### Steps

1. **`lib/rogue-raise/intake/schedule.ts` (+ test)** — `EVENT_TIMEZONE`, `DEFAULT_KICKOFF_HOUR = 17`; `zonedDateTimeToUtc(dateStr, hour, minute, tz)`; `isFridayInZone(date, tz)`; `buildFridayKickoff(dateStr, hour, minute)`; `expandSchedule(fridayKickoffAt)` → `{ fridayKickoff, saturdayStart, sundayBuildEnd (16:00), sundayResults (18:00) }`; `formatWeekendLabel()`. DST-boundary tested.
2. **`lib/rogue-raise/intake/schema.ts` (+ test)** — zod schemas for every section (judges, criteria, dateOptions, techSponsors, awardsBudget, supplementaryInfo, techStack + tags) with caps; `intakeSchema` composing them; `intakeDraftSchema` (everything optional — autosave must accept a half-filled form).
3. **`lib/rogue-raise/intake/completeness.ts` (+ test)** — `evaluateCompleteness(values, attachmentCount)` → `{ complete, requirements: [{key,label,met,hint}] }`.
4. **`lib/rogue-raise/intake/magic-link.ts` (+ test)** — `redeemIntakeToken({ eventId, rawToken })`: hash → single-row lookup → `timingSafeEqual` re-check → role/event/expiry/revocation checks → returns `{ ok, token, event, org }` or a generic failure reason. Never throws detail to the caller.
5. **`integrations/blob.ts`** — real provider selection (Vercel Blob when tokened, local `.rr-blob/` dev provider otherwise), `put`/`delete`/`read`; `.gitignore` + `.env.example` updates.
6. **`lib/rogue-raise/intake/uploads.ts` (+ test)** — allowed types, 10 MB cap, 20-file cap, extension/MIME/magic-byte agreement check, safe key generation. AV seam documented.
7. **`lib/rogue-raise/intake/actions.ts` (+ integration test)** — `saveIntake`, `uploadIntakeAttachment`, `removeIntakeAttachment`. Each: re-verify token → status gate → one transaction (upsert intake, replace collections, recompute completeness, transition event, audit) → post-commit admin notify on first completion only.
8. **`lib/rogue-raise/intake/emails.ts`** — `buildIntakeCompleteAdminEmail` (escaped, fixed subject).
9. **UI** — `app/sponsor/intake/[eventId]/page.tsx` (redeem, load, render), `intake-form.tsx` (client island: sections, repeatable rows, debounced autosave, save-state live region), `invalid-link.tsx`, `loading.tsx`, plus the attachment download route.
10. **Docs** — HANDOFF.md portability note for the Blob seam + the token-in-URL caveat; `.env.example`.

### Testing Strategy

Unit: schedule (Friday detection across zones, DST weekends, expansion offsets), schema caps, completeness truth table, upload validation (type mismatch, oversize, magic-byte spoof), token redemption (valid, expired, revoked, wrong event, wrong role, garbage). Integration against real Postgres, mirroring story 2's harness (dotenv first, mocked email/`next/cache`, real DB, `db.$client.end()` in `afterAll`): first-save creates intake; resume returns prior values; completing sets `completed_at` + `intake_complete` + exactly one admin email; re-saving complete does not re-notify; emptying a required field reverts and audits; wrong-event token refuses; wrong-status event refuses; forced mid-transaction throw rolls back; confirmed date option survives a replace.

### Risks

- Wholesale child-row replacement is only safe because of the status gate — if a later story lets intake edits happen after `repo_generating`, that gate must become a reconcile.
- Token in URL is a known, documented weakness pending Better Auth.
- Local blob provider must never be selected in production — provider choice is asserted in tests and documented in HANDOFF.
