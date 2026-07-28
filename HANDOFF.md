# HANDOFF.md — merging Rogue Raise into whiterabbitashland.com

This app was built standalone (own local Postgres, own Next.js app) so the full
flow works on a laptop with no WR credentials, then hands cleanly to WR tech
staff to merge into the main site (PRD §3.1). This guide is the merge contract.

## ⚠️ Admin console is dev-open — DO NOT deploy publicly yet

`/admin/*` (the WR staff console, including the sponsor curation queue's
**approve/reject** actions) has **no authentication yet** — Better Auth's `admin`
plugin is a separate, not-yet-built story. These are privileged, externally
visible, state-mutating actions (they transition events, mint magic-link tokens,
and send email).

Until the auth story lands:

- `src/middleware.ts` hard-refuses every `/admin/*` request with **403** unless
  `RR_ADMIN_DEV_OPEN === "true"`. That flag is set **only in local `.env`** and is
  documented `false` in `.env.example`. **Never set it `true` in a deployed
  environment.** Remove the flag + this gate once real admin auth exists.
- Audit rows for admin decisions record `actor: "wr-admin"` as a **placeholder**;
  swap it for the real authenticated admin identity when auth lands.

### Magic-link tokens (sponsor intake)

Approve mints a `rogue_raise.magic_link_tokens` row: role `sponsor_poc`,
event-scoped, **hashed** token (`HMAC-SHA256`), **14-day TTL**. The raw token
appears **only** in the emailed intake URL — never stored, logged, or audited.

Redemption lives in `src/lib/rogue-raise/intake/access.ts`. It hashes the
incoming raw token with the shared `hashMagicToken`, looks the row up by hash,
re-compares with `crypto.timingSafeEqual`, and scopes the result to one event and
one role — a valid token for Event A is refused on Event B.

**The sponsor intake link is deliberately multi-use.** The form is resumable
across sittings (PRD §5.2.2), so `consumed_at` is never set for `sponsor_poc`;
`expires_at` (14 days) and `revoked_at` are the controls. `consumed_at` stays
reserved for genuinely single-use flows.

### ⚠️ The intake token travels in the URL

`/sponsor/intake/[eventId]?token=…` carries the raw token as a query parameter. A
cookie exchange isn't possible during a Server Component render, and the emailed
URL shape shipped with the approve action. The exposure is contained, not
ignored: the page sets `referrer: no-referrer` and `robots: noindex`, the token
is never logged/audited/echoed into email, and every write re-verifies it
server-side. **When Better Auth's `magicLink` plugin lands, replace this seam** —
it should establish a session and drop the token from the URL.

Token reissue/resend (if the 14-day window lapses, or the approval email failed
to send) is still unbuilt; it needs an admin surface and is owned by the admin
intake-review story.

## Portability seams

Everything WR-specific is isolated behind a small number of seams — swap these,
not feature code:

- **Database** — a single `DATABASE_URL`. Local Postgres in dev, Neon at merge;
  no code change. All tables are namespaced under a dedicated **`rogue_raise`
  Postgres schema** so they drop into WR's Neon DB without colliding. Plain
  Postgres only (no local-only extensions).
- **Feature code** lives under movable segments:
  - `src/app/rogue-raise/*` — public hub + event surfaces
  - `src/app/admin/*` — WR staff console
  - `src/lib/rogue-raise/*` — all server logic, DB, integrations
- **External services** are behind thin adapters in
  `src/lib/rogue-raise/integrations/*` (email, blob, ai-gateway, github, auth),
  each env-driven. See that folder's README for the provider/env matrix.
- **File storage** — `integrations/blob.ts` picks its provider from the
  environment. With `BLOB_READ_WRITE_TOKEN` set it selects the Vercel Blob
  provider; with no token it uses a **local-disk provider** (`RR_LOCAL_BLOB_DIR`,
  default `.rr-blob/`) so a laptop runs the upload flow with no credentials.
  **In production with no token it throws rather than writing to an ephemeral
  filesystem.** Callers persist the opaque `ref` the adapter returns — never a
  path — so switching providers is config, not a data migration.
  **⚠️ The Vercel Blob provider is not implemented yet**: install `@vercel/blob`
  and fill in `unwiredVercelBlobAdapter` before the first deploy that accepts
  uploads. Intake attachments are private in both providers and are served only
  through the token-gated route
  `/sponsor/intake/[eventId]/attachments/[attachmentId]`
  (`Content-Disposition: attachment` + `nosniff`, never inline).
- **Malware scanning is NOT wired.** Uploads are validated by extension, declared
  MIME, and magic-byte sniff (`intake/uploads.ts`), which stops a renamed
  executable but is not a virus scan. `scanUpload()` is the single seam a real
  scanner hooks into; wiring it needs no call-site changes.
- **Auth** — built on Better Auth (WR's existing layer). At merge, point at WR's
  Better Auth config/instance instead of the local one; our `rogue_raise` rows
  reference that identity rather than storing their own.
- **Design tokens** — WR Tailwind tokens (`wr-olive-green`, `ink`, Fraunces,
  JetBrains Mono) are vendored in `src/app/globals.css` + `src/app/layout.tsx`.
  Confirm exact hex against the live site before launch.

### ⚠️ Agent layer: no durable workflow runtime yet

PRD §3/§11 specifies long agent runs as **durable Vercel Workflows (WDK)** so
they survive the function timeout, pause for human review, and resume. WDK
cannot run outside Vercel, so `lib/rogue-raise/agents/execute.ts` ships the
**inline** executor plus the record-keeping a durable one needs — every run is an
`agent_runs` row with inputs, logs, cost, and timestamps, and an interrupted run
is reclaimable rather than stuck. Until WDK is wired, **an agent is bounded by
the request timeout** (~300s on Fluid Compute). `runAgent` is the seam: a durable
adapter replaces the handler-invocation step; the gate and the persistence steps
are unchanged.

### AI model access

All model calls go through `integrations/ai-gateway.ts` using `"provider/model"`
strings via the Vercel AI Gateway. With `AI_GATEWAY_API_KEY` set it calls the
gateway; without one it uses a **deterministic dev provider** so the whole agent
pipeline runs locally with no credentials. That provider's output carries a
visible `[PLACEHOLDER …]` banner and **production refuses it** rather than
generating placeholder documents for a real event. Current model ids are
`anthropic/claude-opus-5` (authoring) and `anthropic/claude-haiku-4-5` (fast).

**The gateway provider has not been exercised against a live key** — it is
typechecked against the AI SDK but unverified at runtime. Budget a smoke test
when credentials are first configured.

## Environment variables

See `.env.example` for the full list with inline notes. Groups: database, Better
Auth (+ magic-link secret), AI Gateway (+ model ids), Resend email, Vercel Blob,
GitHub App.

## Schema & migrations

- Schema: `src/lib/rogue-raise/db/schema.ts` (Drizzle, `rogue_raise` pgSchema).
- Config: `drizzle.config.ts` (`schemaFilter: ['rogue_raise']`, out `./drizzle`).
- Migrations live in `./drizzle`. Drizzle owns these migrations end to end.
- At merge, confirm which Neon database/branch the `rogue_raise` schema lands in.

## Local dev

```bash
npm run db:up        # start local postgres:16 (docker compose)
npm install
npm run db:generate  # generate SQL migrations from the schema
npm run db:migrate   # apply migrations to local Postgres
npm run dev          # http://localhost:3000  ->  /rogue-raise
```

`npm run db:studio` opens Drizzle Studio; `npm run db:down` stops the DB.

## Merge checklist

- [ ] Lift `src/app/rogue-raise/*`, `src/app/admin/*`, `src/lib/rogue-raise/*`
      into the WR app (single cohesive segment).
- [ ] Point `DATABASE_URL` at the agreed Neon database/branch; run migrations.
- [ ] Repoint the `auth` adapter at WR's Better Auth instance.
- [ ] Fill real credentials for AI Gateway, Resend, Vercel Blob, GitHub App.
- [ ] **Smoke-test the AI Gateway provider** with a real key — it has only ever
      run against the dev provider.
- [ ] Wire durable Vercel Workflows before any long-running agent ships.
- [ ] **Implement the Vercel Blob provider** in `integrations/blob.ts` (it throws
      today) and confirm uploads never fall back to local disk in production.
- [ ] Set `RR_MAGIC_LINK_SECRET` — magic-link hashing fails fast without it in
      production, by design.
- [ ] Decide on malware scanning for sponsor uploads, or accept the documented
      validate-only posture in writing.
- [ ] Replace the URL-borne intake token with a Better Auth `magicLink` session.
- [ ] Confirm the WR GitHub org name + install the GitHub App with repo-create/
      push permissions.
- [ ] Verify design tokens match the live site exactly.
