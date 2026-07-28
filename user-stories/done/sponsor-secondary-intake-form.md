<!--
metadata:
  created_at:   2026-07-27T19:55:17-07:00
  activated_at: 2026-07-27T19:55:17-07:00
  planned_at:   2026-07-27T20:10:00-07:00
  finished_at:  2026-07-27T21:17:00-07:00
  updated_at:   2026-07-27T21:17:00-07:00
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

## Review

**Date:** 2026-07-27 · **Commit reviewed:** 5273271 · Self-review against ACs + browser verification · **Status: all 10 ACs met; 3 defects found and fixed in-flight**

### Acceptance criteria

| # | AC | Verdict |
|---|----|---------|
| 1 | Magic link opens the form; bad links get a courteous, non-leaky page | ✅ browser + 4 integration tests (wrong event / expired / garbage / wrong phase) |
| 2 | Captures every `EventIntake` field from §5.2.2 | ✅ all seven sections render and round-trip |
| 3 | Auto-saves; explicit "Save now"; resumable | ✅ verified by reloading mid-session — the weekend typed before reload came back from the DB |
| 4 | Progress indicator; VITAL fields marked as blocking | ✅ "3 of 3 vital sections complete", per-requirement hints, anchor links |
| 5 | Completion sets `completed_at`, advances the event, notifies admin **once** | ✅ verified in the DB (`intake_complete`, 2 audit rows) and the dev email log (exactly 1 send); test asserts a re-save adds no email and no audit rows |
| 6 | Emptying a vital field reverts and audits, without an email | ✅ integration test |
| 7 | Friday-anchored options, non-Friday rejected, canonical timeline shown | ✅ browser: Aug 15 rejected inline, Aug 14 expanded to the full Fri/Sat/Sun schedule |
| 8 | Private, validated, listed, removable uploads | ✅ browser: spoofed `.pdf` (MZ header) rejected; genuine PDF stored under a UUID key; download served `attachment` + `nosniff`; no-token/bogus-token/bad-id all 404 |
| 9 | Every write re-authorized server-side; phase-gated | ✅ `authorize()` at the top of all three actions + `FOR UPDATE` re-check; cross-event write and cross-event delete both refused in tests |
| 10 | Brand-themed, responsive, accessible | ✅ verified at 1200px and 375px; a11y tree shows labelled regions, `(required)`/`(optional)` markers, live regions, keyboard-operable rows. **No automated coverage** — same caveat as story 2 |

### Defects found and fixed

1. **`isFridayDate` threw on an empty date** — zod v4 runs `.refine()` even after the preceding `.regex()` check has already failed, so opening an empty weekend row crashed the whole form. Found in the browser console on the very first click, not by any unit test. Made total; regression test added.
2. **Autosave dispatched outside a transition** — `useActionState`'s action was called directly, so React warned and `isPending` never flipped (the "Saving…" state was dead). Wrapped in `startTransition`.
3. **Anchor links landed under the sticky save bar** — `scroll-mt-6` was shorter than the bar; raised to `scroll-mt-28`.

Two cosmetic fixes also came out of reading the rendered page: a JSX-collapsed space before an em dash, and the unused-variable lint in the row-key stripper.

### Verified correct by inspection

Token never logged/audited/echoed; `redeemIntakeToken` collapses every pre-token failure into one opaque reason; blob keys are random UUIDs so a filename never reaches the path; orphan blobs cleaned up when the row insert fails; blob deletion happens only after commit; completion recomputed from committed rows rather than the submitted payload; `loadIntake` deliberately kept out of the `"use server"` module so it can't be invoked as an endpoint.

### Known gaps (deliberate)

- Vercel Blob provider throws rather than being implemented — local disk is the only working provider, documented in HANDOFF with a merge-checklist item.
- No malware scanning; `scanUpload()` is a seam, and the docs say so plainly rather than implying protection.
- Token in URL (see Resolved decisions) pending Better Auth.
- No automated a11y/visual regression coverage.

## Learnings

**What went well**

- Making completeness a pure function over plain FACTS — rather than over the draft — meant the client progress indicator and the server's `intake_complete` decision are literally the same call. The client derives facts from what it has typed; the server derives them from committed rows. They cannot drift, and the server never has to trust the payload.
- Recomputing completion from committed rows *after* every mutation (save, upload, remove) collapsed three separate "did this change completion?" code paths into one `syncCompletion`. Removing the last attachment reverting the event fell out for free rather than needing its own logic.
- Writing the integration tests against real Postgres before touching any UI paid off immediately: 21 tests passed on first run, and every subsequent UI fix was verifiably non-breaking.
- Asserting *counts unchanged* (emails, audit rows) for the idempotency cases — carried forward from story 2 — is still the strongest form of that test.

**What was surprising**

- **zod v4 does not short-circuit a field's checks.** A `.refine()` predicate runs even when the `.regex()` before it already failed, so any predicate used in a schema must be TOTAL. A throwing helper that is perfectly reasonable on its own (`weekdayOfDate`) becomes a form-wide crash when used as a refinement. This is a general rule for this codebase, not a one-off.
- Unit tests could not have caught that: the schema tests only ever passed well-formed rows, because that is what a test author naturally writes. **The browser found it in the first ten seconds.** Browser verification is not a formality after the tests are green — it exercises the states tests don't think to construct (empty, half-typed, just-added).
- Calling a `useActionState` action outside a `<form>` needs an explicit `startTransition`. It "works" without one — the save really does happen — which is exactly why it is easy to ship broken: only the pending state is silently dead.
- JSX collapses a space before an entity across a line break, so `</span> &mdash;` renders as `vital—`. Only visible in a screenshot; the accessibility tree hides it too.

**Do differently next time**

- Add a "hostile inputs" pass to every shared schema's test file — empty string, whitespace, wrong type, half-filled row — since those are the states the UI actually produces and the ones a test author skips.
- Verify in the browser *while* building each section, not once at the end. The first three defects were all in the first section rendered; finding them earlier would have prevented repeating the same pattern in six more sections.
- Carry-forwards for the next story (**admin intake review + confirm the event weekend**, PRD §5.2.3 AC): the admin picks one `DateOption` → `is_confirmed` + `events.confirmed_friday_kickoff_at`; the intake save already preserves the confirmed flag but does NOT prevent the POC from deleting a confirmed weekend — decide that rule there. Also owed: resend of a failed approve/intake email, and a uniqueness migration on `events.sponsor_application_id`.
- The wholesale-replace strategy for criteria/tech sponsors is only safe because of the phase gate. If a later story lets intake edits happen past `repo_generating`, that gate must become a reconcile (as judges already are).
