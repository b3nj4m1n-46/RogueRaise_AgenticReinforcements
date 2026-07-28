<!--
metadata:
  created_at:   2026-07-07T07:32:20-07:00
  activated_at: 2026-07-07T07:33:03-07:00
  planned_at:   2026-07-07T07:44:01-07:00
  finished_at:  2026-07-07T08:39:29-07:00
  updated_at:   2026-07-07T08:39:29-07:00
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

### Overview

Add a WR Admin curation queue mirroring story 1's domain-module discipline: a new privileged `admin-actions.ts` with two `useActionState`-shaped server actions that do all writes in one `db.transaction`, send email only after commit via `Promise.allSettled`, and log two PII-free audit rows per decision (application + event). Approve mints a hashed, event-scoped `sponsor_poc` magic-link token and emails an intake invite; reject sends a courteous decline. Three new Server-Component routes (`/admin/sponsors`, `/admin/sponsors/[id]`, stub `/sponsor/intake/[eventId]`). No schema migration needed.

### Resolved decisions

- **`under_review`:** NOT auto-set on view (GET must not mutate; no per-admin identity yet). Valid actionable input status; nothing sets it in v1 — its filter tab may be empty. Explicit "Start review" deferred.
- **Idempotency:** `SELECT … FOR UPDATE` the application row inside the transaction, capture true prior status (audit `fromValue`), guard on `{submitted, under_review}`. Row lock serializes concurrent admins — no double transitions/emails.
- **Event transition:** persist straight to `intake_pending` on approve (no phantom committed `approved` state); audit records real `from → intake_pending`, `metadata.via = "approved"`. Reject → `rejected`.
- **Token:** `randomBytes(32).toString("base64url")` raw → stored as HMAC-SHA256(raw, `RR_MAGIC_LINK_SECRET`) hex, in a shared helper the next (redemption) story imports. TTL 14 days. Raw token appears ONLY in the emailed URL — never audited or logged.
- **URL base:** from `BETTER_AUTH_URL` env, never the request Host header. URL: `/sponsor/intake/[eventId]?token=…`.
- **Admin note:** optional, internal-only (`sponsorApplications.adminNote`); never echoed into POC emails.
- **Actions location:** new `admin-actions.ts` separate from public `actions.ts` (trust-boundary clarity). Actor constant `ACTOR_WR_ADMIN = "wr-admin"` (placeholder until auth story).
- **Confirm UX:** inline expanding confirm panel (no modal); both Approve and Reject confirm; Reject copy conveys terminality. Rejection is final in v1 (no undo).
- **Default queue filter:** `submitted`. Approve-email failure recovery (resend) deferred to the intake story; failure is audit-logged + visible.

### Steps

1. **Magic-link helper — `src/lib/rogue-raise/sponsors/magic-link.ts` (+ test):** `generateMagicToken()` → `{raw, hash}`; `hashMagicToken(raw)` HMAC-SHA256 w/ `RR_MAGIC_LINK_SECRET`; `buildIntakeInviteUrl(eventId, raw)` from `BETTER_AUTH_URL`; `MAGIC_LINK_TTL_MS = 14d`; `SPONSOR_POC_ROLE`. Redemption (next story) must reuse this helper + `timingSafeEqual`.
2. **Schema + guards — extend `src/lib/rogue-raise/sponsors/schema.ts`:** `adminDecisionSchema = { note: trim max 2000 optional }`; pure `isActionableAppStatus()` over `["submitted","under_review"]` and `allowedNextStatus(current, decision)` with `assertNever` exhaustiveness.
3. **Admin actions — `src/lib/rogue-raise/sponsors/admin-actions.ts`:** `"use server"`; approve/reject actions reading only `application_id`, `decision`, `note` (never a client eventId/status — resolve event via `events.sponsorApplicationId`, **refuse if ≠1 events resolve**). Transaction: FOR UPDATE lock → guard → update app (status + adminNote) → update event → (approve) insert `magicLinkTokens` → two audit rows. Not-actionable → `{ok:false, formError:"This application has already been decided."}`. Post-commit: `Promise.allSettled` email, failure audited (`…email_failed`, actor `system`), never rolled back. Then `revalidatePath("/admin")` + `revalidatePath("/admin/sponsors")` + `redirect("/admin/sponsors")` (outside try/catch).
4. **Email builders — extend `src/lib/rogue-raise/sponsors/emails.ts`:** `buildIntakeInviteEmail` ("approved; your intake form opens soon"; URL in href) + `buildDeclineEmail` (courteous, barn-raise ethos; no note echo). Reuse `escapeHtml`/`stripCrlf`; fixed subjects.
5. **Queue — `src/app/admin/sponsors/page.tsx` + `loading.tsx`:** Server Component, `force-dynamic`; validate `?status=` against enum (default `submitted`); innerJoin organizations, `ORDER BY submitted_at DESC NULLS LAST, created_at DESC`; grouped count query for filter badges. No pagination (low volume).
6. **Detail — `src/app/admin/sponsors/[id]/page.tsx`:** Server Component, `force-dynamic`; app + org + linked event + stakeholders; `notFound()` on missing/malformed id; all Part 1 fields (`<dl>` contact w/ mailto:/tel:, long text `whitespace-pre-wrap`, stakeholder list); decided → resolved banner (outcome + timestamp/actor from audit_log + adminNote) instead of actions.
7. **Decision island — `src/app/admin/sponsors/[id]/decision-form.tsx`:** `"use client"`, `useActionState` + `useFormStatus`; inline confirm panels w/ shared optional-note `Field`/`Textarea`; focus into panel on open, back to trigger on Cancel/Esc.
8. **Intake stub — `src/app/sponsor/intake/[eventId]/page.tsx`:** branded "your intake form opens soon" page (email link must not hard-404); `Referrer-Policy: no-referrer` (token in query).
9. **Auth guardrail — `src/middleware.ts` + env + HANDOFF:** match `/admin/:path*`, hard-refuse unless `RR_ADMIN_DEV_OPEN === "true"` (on in local `.env` only). Add `RR_ADMIN_DEV_OPEN` to `.env.example`. HANDOFF: `/admin/*` must NOT deploy publicly until the auth story lands; redemption must use `timingSafeEqual`.
10. **Admin badge:** verify only — existing `force-dynamic` count + step 3's `revalidatePath` covers it.

### Design & UX

Queue: semantic `<table>` desktop / card list mobile (`md:`); `max-w-5xl`, eyebrow + serif h1 pattern; one tab stop per row (stretched org-name link); rows show submitted date (disambiguates same-name orgs). Status pills always text-labeled: Submitted → ink on `secondary`; Under review → `muted-foreground` on `muted`; Approved → white on `primary`; Rejected → white on `destructive`; never white on base olive. Filter = `<nav>` of query-param Links w/ count badges, `aria-current="page"` + non-color indicator. Financial: format from decimal string; `toDiscuss` → "To discuss"; null → "—". Detail: `max-w-3xl`, sectioned, back link. Reject trigger outline w/ destructive label; in-panel confirm `variant="destructive"` named "Confirm rejection — this cannot be undone". States: empty queue/filter, pending (`aria-busy`), resolved banner, PRG redirect + `role="status"` flash, inline error on failure.

### Accessibility

Real `<table>` w/ `<caption>` (conveys sort), `th scope`, `aria-sort`, org cell `<th scope="row">`; single row link w/ disambiguating name. Confirm panel: labelled `role="group"`, trigger `aria-expanded`/`aria-controls`, focus into panel heading (`tabIndex=-1`), Esc/Cancel returns focus. Persistent live regions rendered on first paint: `role="status"` success / `role="alert"` error; `aria-busy` during submit; move focus to result region when the activated button disables. Already-decided: `aria-disabled` + `aria-describedby` reason (focusable), server guard is real enforcement. Note field via `Field` (`(optional)`, no `aria-invalid` for emptiness). One `<h1>` (org name on detail), ordered `<h2>`s, `mailto:`/`tel:` links, row targets ≥24px, buttons ≥36px.

### Testing Strategy

`admin-actions.test.ts` (integration, story-1 harness: dotenv first, real Postgres, mock next/headers + email adapter, `db.$client.end()` in afterAll; **cleanup order: magicLinkTokens + auditLog + stakeholders → events → sponsorApplications → organizations**): approve happy path (app `approved`, event `intake_pending`, exactly 1 token row, 2 audit rows w/ correct from→to, 1 email, NEXT_REDIRECT); reject happy path; idempotent guard (pre-decided → formError; assert token/audit/email COUNTS unchanged); forced mid-transaction throw → zero changes; stored hash === `hashMagicToken(raw)`, raw never in DB; email-failure → committed + `email_failed` audit + still redirects; note persisted / null when empty; refuse when ≠1 events resolve. Unit: `magic-link.test.ts` (uniqueness, base64url charset, hash determinism, URL shape, TTL); guard helpers; `adminDecisionSchema` (max cap, empty ok).

### Risks

- **No admin auth** — first surface with privileged, externally-visible actions; mitigated by env-gated middleware + HANDOFF deploy gate; must be un-missable in review.
- **Approve-email failure** leaves `intake_pending` w/ unsent link — audited + visible; resend lands with intake story.
- **14-day TTL** must outlast the gap until the intake form ships; intake story owns reissue.
- **`events.sponsorApplicationId`** nullable/non-unique — action refuses on ≠1; consider a uniqueness migration later.
- Multiple approved applications per org = multiple independent events (assumed intended; same-org warning out of scope).

## Review

**Date:** 2026-07-07 · **Commit reviewed:** fc2ac80 · Reviewers: product-manager + code-reviewer agents (Opus 4.8) · **Status: review complete; all three fixes applied in a6fa20a**

### Acceptance criteria (PM verdicts)

All 10 ACs ✅ met, with two caveats: AC9 (brand/responsive/a11y) and AC10 (badge refresh) are correct-by-construction and browser-verified during implementation but have no automated coverage. AC4's "approved → intake_pending" two-step is honored via the documented reinterpretation: application row genuinely becomes `approved`; event persists straight to `intake_pending` with an honest audit trail (no phantom committed state).

### Code review (verdict: approve-with-nits)

**Fixes (applied in a6fa20a):**

1. **`formatFinancial` cents bug** (`src/app/admin/sponsors/status-pill.tsx:69`) — `"5000.50"` renders `$5,000.5`. Fix: `minimumFractionDigits: Number.isInteger(n) ? 0 : 2`.
2. **Silent magic-link secret fallback** (`src/lib/rogue-raise/sponsors/magic-link.ts:28`) — warn/fail-fast outside dev before the redemption story makes tokens a live security boundary.
3. **Repeated identical decision error won't re-focus/re-announce** (`decision-form.tsx` focus effect keys on `[isOpen, formError]`) — add a submit counter to deps.

**Deferred by design:** post-commit email-send failure is invisible to admin and unrecoverable (resend lands with the intake/redemption story); no admin auth (env-gated middleware + HANDOFF deploy gate).

**Verified correct:** FOR UPDATE lock + guards, honest from→to audit rows, NEXT_REDIRECT outside try/catch, middleware default-deny covering all /admin routes + action POSTs, 256-bit tokens/HMAC/URL-safe building, parameterized queries + UUID guard, genuine mid-transaction rollback test.

## Learnings

**What went well**

- Story 1's conventions (domain module, transaction shape, email-after-commit, audit discipline, test harness) transferred wholesale — the plan could say "mirror story 1" and three agents produced consistent code with no drift.
- `SELECT … FOR UPDATE` + a pure status-guard function made idempotency trivial to implement and to test; asserting *counts unchanged* (tokens/audit/emails) is a stronger idempotency test than asserting the error message.
- The test agent found a genuinely clean rollback seam without touching source: mocking `generateMagicToken` (which runs after the UPDATEs inside the transaction) forces a true mid-transaction rollback — closing the exact gap story 1's review flagged.
- In-browser verification (submit → queue → detail → open/cancel confirm panels → assert DB pristine) caught what unit tests can't: focus behavior, aria state, and console cleanliness.

**What was surprising**

- **Next 16 forbids non-async exports from `"use server"` modules** — this crashed at build/runtime, and the identical latent defect existed in story 1's committed code (its `/sponsor` form would have 500'd on this Next version). Constants/initial-state objects must live in plain sibling modules. This is now a project convention: `form-state.ts` / `admin-decision-state.ts`.
- `revalidatePath` throws outside a Next render store — tests must mock `next/cache` once an action calls it (story 1's harness didn't need this).
- Two parallel agents can safely touch the same test file when their edits are additive, but it worked by luck of ordering — next time give the test agent explicit ownership of test files and have the UI agent report needed test changes instead of making them.
- The "event persists straight to intake_pending" reinterpretation (vs. the AC's literal two-step) survived both reviews because the *application* row still records `approved` and the audit trail is honest — writing the reasoning into the plan's "Resolved decisions" pre-empted the review objection.

**Do differently next time**

- Encode the `"use server"` export rule in CLAUDE.md so future stories don't rediscover it.
- Give parallel agents disjoint file ownership, explicitly listed in both prompts.
- The dead `under_review` filter tab (nothing sets that status in v1) is acceptable but should have been called out in the story's ACs up front rather than resolved in planning.
- Carry-forwards for the intake/redemption story: reuse `hashMagicToken` + `timingSafeEqual`; email resend path for approve-email failures; consider a uniqueness migration for `events.sponsor_application_id`; prod deploy checklist must set `RR_MAGIC_LINK_SECRET` (now enforced by fail-fast).
