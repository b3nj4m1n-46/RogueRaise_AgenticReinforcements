<!--
metadata:
  created_at:   2026-07-06T19:24:50-07:00
  activated_at: 2026-07-06T19:35:55-07:00
  planned_at:   2026-07-06T19:42:49-07:00
  finished_at:  2026-07-07T07:28:23-07:00
  updated_at:   2026-07-07T07:28:23-07:00
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

### Overview

Add a `src/lib/rogue-raise/sponsors/` domain module (shared zod schema + `"use server"` action + slug helper) plus a public route at `src/app/sponsor/` following the project's RSC-page + client-form split. The action performs all writes (Organization link/create, SponsorApplication, Event, Stakeholders, audit row) inside one `db.transaction`, then fires the two emails *after* commit. A new spam-guard integration adapter mirrors the existing email/blob seam so BotID/hCaptcha can swap in for production without touching the action. One shared zod schema drives both client and server validation. No DB migration is required for the core slice (all target tables are live).

### Steps

**1. Shared zod schema — `src/lib/rogue-raise/sponsors/schema.ts` (new)**

Single source of truth imported by client and server. Fields with hard caps (columns are unbounded Postgres `text` — caps are a DoS guard):

- `orgName` trim min 1 max 200; `pocName` trim min 1 max 200
- `pocEmail` `z.email()` max 254; `pocPhone` E.164 regex `/^\+[1-9]\d{6,14}$/`
- `painPoints`, `goalsNeeds` trim min 1 max 5000
- `financialCommitment: { amount, note?, toDiscuss }` — validate `amount` as a numeric STRING (`z.string().regex(/^\d{1,10}(\.\d{1,2})?$/)`), never a JS float, to preserve `numeric(12,2)` precision; `note` max 2000. `.refine()` enforcing `toDiscuss` XOR `amount != null`, error path `["financialCommitment","amount"]`.
- `stakeholders: z.array({ name min1, email z.email(), phone E.164 }).min(1).max(20)` — phone required per PRD §5.1; DB column stays nullable, no migration.

Export the schema, its inferred type, and the E.164 regex const. `.trim()` and reject empty-after-trim everywhere.

**2. Spam-guard adapter — `src/lib/rogue-raise/integrations/spam.ts` (new)**

Mirror `email.ts`/`blob.ts`: `interface SpamGuard { issueChallenge(): { renderedAt: string; sig: string }; verify(input): { ok: boolean; reason?: string } }` and `getSpamGuard()`. Dev impl = honeypot-empty check + HMAC-signed timestamp (min elapsed ~3s, max ~1h). Sign with `RR_SPAM_SECRET` (add to `.env.example`; may fall back to `RR_MAGIC_LINK_SECRET`). Prod swaps to Vercel BotID/hCaptcha behind the same factory. Register in `integrations/README.md`.

**3. Server action — `src/lib/rogue-raise/sponsors/actions.ts` (new)**

`"use server"`. `createSponsorApplication(prevState, formData)` shaped for `useActionState`. Order:

1. `getSpamGuard().verify(...)` first; on fail return a *generic* form error.
2. Parse FormData (stakeholders as one hidden JSON field — guard the `JSON.parse`); `schema.safeParse`. On fail return `{ ok:false, fieldErrors }` — server re-validation mandatory, client validation is UX only.
3. `db.transaction`: org link-or-create (select by `lower(name)`, reuse or insert) → insert `sponsorApplications` (status `submitted`, set `submittedAt`) → insert `events` (slug `slugify(orgName)-nanoid(6)` unconditionally — race-proof; title from org name; status `submitted`) → bulk-insert `stakeholders` on the new `eventId` → insert `auditLog` (`actor:"public"`, `action:"sponsor_application.created"`, `entity:"sponsor_application"`, `toValue:"submitted"`, metadata ids only — **no PII**). Any throw rolls back everything.
4. After commit, send both emails via `Promise.allSettled`; a send failure is audit-logged but does not fail the submission.
5. Unexpected DB errors map to generic `{ ok:false, formError }`; never leak stack traces.

Hash client IP before use. `slugify` in `src/lib/rogue-raise/sponsors/slug.ts`.

**4. Email bodies — `src/lib/rogue-raise/sponsors/emails.ts`**

POC acknowledgment (`to: pocEmail`) + admin notification (`to: RR_ADMIN_NOTIFY_EMAIL`, `replyTo: pocEmail`). HTML-escape every echoed user value; strip CR/LF from anything in `subject`; keep subject a fixed template.

**5. Route + form — `src/app/sponsor/page.tsx`, `sponsor-form.tsx`, `thanks/page.tsx` (new)**

- `page.tsx` — server component mirroring hub styling (`max-w-2xl`, WR tokens); calls `getSpamGuard().issueChallenge()` server-side, passes signed token to the form; exports `metadata`.
- `sponsor-form.tsx` — `"use client"`, `useActionState` + `useFormStatus`. Stakeholder array in local state keyed by `crypto.randomUUID()`; serialized to hidden JSON input. Inline errors from `state.fieldErrors`; on server error preserve all entered values. Honeypot + signed challenge included.
- `thanks/page.tsx` — action `redirect()`s here on success (PRG pattern, refresh-safe).

**6. shadcn/ui primitives (first components in repo)**

Generate `button`, `input`, `textarea`, `label`, `radio-group`. Do NOT generate shadcn `form` (react-hook-form dep conflicts with server actions). Hand-write a `Field` wrapper (label + control + error) wiring `htmlFor`/`id`/`aria-describedby`/`aria-invalid`. Add a semantic token layer in `globals.css` mapping shadcn tokens (`--color-primary`, `--color-ring`, `--color-border`, `--color-destructive`, …) onto WR tokens.

**7. Admin badge — `src/app/admin/page.tsx` (modify)**

Async server component; COUNT of `sponsor_applications` where `status='submitted'` (a COUNT query, never `findMany().length`). Seed of the M2 curation queue.

**8. Env + docs (modify)**

Add `RR_SPAM_SECRET`, `RR_ADMIN_NOTIFY_EMAIL` to `.env.example` + local `.env`. Spam-guard row in `integrations/README.md`.

**9. Tests**

- `schema.test.ts` (unit): valid payload; bad E.164; empty required long-text; stakeholders min/max; financial XOR both directions + passing case; length caps.
- `actions.test.ts` (integration, local Postgres): happy path writes exactly one org/app/event + N stakeholders + one audit row, linked; org reuse on same name; unique slugs across same-name submissions; forced failure → zero rows (rollback); emails fire only after commit (spy) and a send failure doesn't fail the action. Unique org names per test; cleanup in FK order in `afterEach`.
- Verify `z.flattenError` / `z.email()` shapes against installed zod v4.

### Design & UX

Single-column form, five `<fieldset>` sections with Fraunces `<legend>`s: organization / primary contact / the problem / financial commitment / stakeholders. Only side-by-side pair: stakeholder email/phone (`sm:grid-cols-2`, `min-w-0`). Financial "to discuss" is a **radio group** ("Commit an amount" / "I'd prefer to discuss"), amount cleared + out of tab order when discussing. Stakeholder rows: hide Remove when 1 row; focus new row's Name on Add, previous Remove on Remove. Submitting → disable submit button only. Olive fails AA for small text (~4.26:1) — use for borders/rings/filled buttons/headings ≥24px only; body/error text on ink/verified danger color.

### Accessibility (WCAG AA)

Real `<label htmlFor>` everywhere; stakeholder rows in `<fieldset><legend>Stakeholder N</legend>`; `autocomplete`/`inputmode` on primary contact only. Errors: `aria-invalid` + `aria-describedby`, never color-only. Top-of-form error summary (`tabindex=-1`, focus moved to it, links to offending fields incl. stakeholder rows). Add/Remove are `type="button"` with descriptive `aria-label`s; add/remove announced via visually-hidden `aria-live="polite"`. Honeypot: off-screen CSS + `aria-hidden` + `tabindex=-1` + `autocomplete="off"`, non-tempting name (`contact_time`), excluded from validation/summary/tab order. Pending: `aria-live` + `aria-busy`. Success: focus confirmation heading, `role="status"`. Server error: `role="alert"`, focus moved, values preserved. `:focus-visible` ring ≥3:1 (ink outline fallback), touch targets ≥44px, one `<h1>`, `<main>` landmark, required marked with text, reflow at 400%, `prefers-reduced-motion` respected.

### Risks & Decisions

- **Route placement:** thin route at top-level `src/app/sponsor/` (matches PRD URL); all logic under movable `src/lib/rogue-raise/*`. Document seam in HANDOFF at merge.
- **Org dedupe:** accept the rare concurrent same-name race in v1 (documented known gap); revisit with a `lower(name)` unique index if it bites.
- **Rate limiting:** honeypot + signed min-time only for this slice; real rate limiting arrives with the prod BotID swap.
- **Money:** amount validated/stored as numeric string end-to-end (no float).
- **Duplicates:** only rapid resubmit is rejected (disabled button + PRG); a later second application from the same org is a valid new lead.
- **Email failure UX:** user still sees success (record saved); failure audit-logged; no retry queue this story.
- **Test isolation:** shared local DB + per-test cleanup now; dedicated `DATABASE_URL_TEST` as follow-up.

## Review

**Date:** 2026-07-07 · **Commit reviewed:** 57ec6c9 (fixes applied in 2a9b622) · Reviewers: product-manager + code-reviewer agents (Opus 4.8)

### Acceptance criteria

| # | Criterion | Verdict | Evidence |
|---|-----------|---------|----------|
| 1 | Public `/sponsor`, WR-themed, responsive, no h-scroll | ⚠️ met; 1 manual check | Route + tokens + `min-w-0` grid guards in place; remaining manual check: 320px width & 400% zoom |
| 2 | All Part 1 fields captured | ✅ | All fields rendered, parsed, validated (E.164 via shared regex) |
| 3 | Repeatable stakeholders, min 1, add/remove | ✅ | Controlled rows, Remove hidden at 1, Add capped at 20, schema min/max |
| 4 | Single shared zod schema client+server | ✅ | One schema both sides; amount-regex duplication fixed in 2a9b622 |
| 5 | One transaction: application + org link/create + event | ✅ | Single `db.transaction`; proven by integration tests (links, statuses, org reuse) |
| 6 | POC ack email via adapter | ✅ | Exact subject per story; post-commit send; dev adapter is the documented M0 seam |
| 7 | Admin notification (email + badge) | ✅ | RR_ADMIN_NOTIFY_EMAIL send + live COUNT badge on /admin (contrast fixed in 2a9b622) |
| 8 | Spam protection | ⚠️ reinterpreted (authorized) | Honeypot + HMAC-signed timestamp per story Notes; `getSpamGuard()` seam confirmed for BotID/hCaptcha swap |
| 9 | Audit-logged | ✅ | actor/action/entity/toValue/timestamp in transaction; ids + salted ipHash only, no PII |
| 10 | Duplicates/invalid rejected gracefully, full rollback | ⚠️ partially | Invalid → zero rows proven; mid-transaction rollback untested (rests on Postgres semantics); org-level "duplicate" is a valid new lead by documented decision |

### Code review findings (verdict: approve-with-nits)

Fixed post-review (2a9b622): **badge contrast** (major — white-on-olive 4.49:1 < AA), **IP-hash empty-salt fallback**, **stale-challenge lockout messaging**, **client AMOUNT_REGEX duplication**.

Accepted/deferred: org link-or-create race under concurrency (documented v1 gap; needs `lower(name)` unique index + upsert if it bites); mid-transaction rollback test; audit-metadata PII assertion test; `discuss`-mode DB-shape test; error summary `role="alert"`+focus double-announce (minor SR polish).

Strengths confirmed: clean server/client boundary (no secret leak), NEXT_REDIRECT outside try/catch, HTML-escape + CRLF-strip in emails, length-guarded `timingSafeEqual`, PII-free audit metadata.

## Learnings

**What went well**

- The M0 walking skeleton paid off exactly as intended: schema, adapters, tokens, and Vitest all existed, so the story was pure feature work — no yak-shaving mid-implementation.
- Splitting implementation into server-domain → (UI ∥ tests) with an explicit written contract (FormData field names, exported types, fieldError key shape) let the two downstream agents work in parallel with zero integration friction.
- Writing the plan's field caps, XOR rule, and transaction order into the story file made the plan the single authority — three different agents executed against it without drift.
- Adversarial review earned its cost: it caught a real WCAG AA regression (badge contrast) that contradicted the design system's own documented contract, plus three cheap hardening wins.

**What was surprising**

- zod v4's `flattenError` is lossy for nested/array paths — per-row stakeholder errors required building dot-path fieldErrors directly from `issues`. Worth remembering for every future multi-row form.
- `redirect()` throwing NEXT_REDIRECT shapes the whole action's error handling (and its tests) — success-as-throw must be designed in, not bolted on.
- Testing the 3s spam floor without sleeping needed a backdated challenge minted under fake timers, then real timers for the DB calls — fake timers and network I/O don't mix.
- Client-random UUIDs are fine as React keys but must not become DOM ids (SSR hydration mismatch); useId+index for ids, UUID for keys.

**Do differently next time**

- Include a mid-transaction rollback test in the plan's test list from the start (the "zero rows" tests all rejected pre-transaction; atomicity went unverified).
- Export every shared constant (AMOUNT_REGEX) from the schema module immediately — "single source of truth" erodes one convenient re-declaration at a time.
- Story ACs should name the dev-phase spam mechanism directly instead of "BotID or hCaptcha" + a Notes escape hatch — reviewers flag the mismatch otherwise.
- Consider a dedicated DATABASE_URL_TEST before the next story with integration tests; per-test FK-ordered cleanup works but is brittle as tables accumulate.
