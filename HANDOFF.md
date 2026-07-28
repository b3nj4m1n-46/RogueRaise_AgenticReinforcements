# HANDOFF.md — merging Rogue Raise into whiterabbitashland.com

This app was built standalone (own local Postgres, own Next.js app) so the full
flow works on a laptop with no WR credentials, then hands cleanly to WR tech
staff to merge into the main site (PRD §3.1). This guide is the merge contract.

## Admin console authentication

`/admin/*` is behind **Better Auth** with the `admin` plugin (PRD §12). Three
layers, because only the last one is a real boundary:

| Layer | What it does | Why it isn't enough on its own |
|---|---|---|
| `src/middleware.ts` | Redirects to `/admin/sign-in` when no session cookie is present | Edge runtime, no DB — it checks cookie PRESENCE, not validity. A forged cookie passes it |
| `app/admin/(console)/layout.tsx` | Server-side `checkAdmin()` for every page in the group | Layouts do not render for Server Actions or Route Handlers |
| `requireAdmin()` / `adminOrError()` in each action | The actual boundary | — |

`src/lib/rogue-raise/admin/coverage.test.ts` reads the source of every
`"use server"` module and fails if a privileged action doesn't call the guard.
Its allow-list is the written-down set of actions that are deliberately public or
magic-link gated, each with a reason. **A new admin action with no guard fails
that test** — that is how this property survives future work.

Everything fails closed: no session, no role, a banned account, an unconfigured
environment, or a thrown error all resolve to "not an admin"
(`admin/guard.ts`, proven in `admin/guard.test.ts`).

### First-run setup

```bash
npm run db:auth-migrate                  # Better Auth tables, in `public`
npm run admin:create -- you@wr.com "You" # prints a generated password once
```

Sign-up is **disabled in the app** (`disableSignUp: true`) — an open sign-up form
on a console that can email every participant is not a thing to ship. Accounts
come from `admin:create`, which also promotes an existing account to admin when
re-run. At merge, WR's own staff accounts already exist; grant them the `admin`
role rather than creating new ones.

### `RR_ADMIN_DEV_OPEN`

Still exists, but it is now local-only convenience rather than the security
model: `isDevOpen()` returns false whenever `NODE_ENV === "production"`, so
setting it in a deployed environment does nothing. Audit rows written while it is
on are attributed to `"wr-admin"` rather than to a person.

### External roles do NOT use Better Auth sessions

PRD §12 lists the `magicLink` plugin for Sponsor POC, Judge, Participant, and
Stakeholder. This app uses **its own** magic-link implementation for those
(`rogue_raise.magic_link_tokens` + `access/redeem.ts`), and that is deliberate:
ours scopes a token to one **event** *and* one **role** and audits it, which is
the property §12's own scoping AC turns on ("a Judge for Event A cannot read
Event B"). Better Auth's plugin authenticates a person; it does not scope them to
an event. Migrating would mean layering our event scoping back on top of it —
possible, but it must not be done by simply swapping in the plugin.

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

### Magic-link roles and TTLs

Every external role uses the same hashed-token machinery via
`src/lib/rogue-raise/access/redeem.ts`. The TTLs differ because the windows do:

| Role | Redeemer | TTL | Notes |
|---|---|---|---|
| `sponsor_poc` | `intake/access.ts` | 14 days | Multi-use; the intake form is resumable |
| `judge` | `judges/access.ts` | 30 days | Covers invitation → background form → scoring |
| `participant` | `participants/access.ts` | 7 days | Minted for the submission window |
| `stakeholder` | `portal/access.ts` | **365 days** | The portal is the deliverable, not a step — a stakeholder returning in three months to check on a project they adopted is the model working |

**The stakeholder role has a second gate:** `stakeholders.can_access_portal`. A
valid token is refused until an admin opens the portal, so "your portal isn't
open yet" is a distinct, honest message rather than an indistinguishable
"invalid link". Closing the portal for a stakeholder clears the flag **and**
revokes their tokens — clearing the flag alone would leave live links that merely
fail a second check.

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
  The **Vercel provider is implemented** (`@vercel/blob`), writes
  `access: "private"` unless a caller explicitly asks otherwise, and namespaces
  its refs (`vercel:<url>`) so a row written by the local provider cannot
  resolve against production storage. **It has never run against a real
  `BLOB_READ_WRITE_TOKEN`** — smoke-test it on the first deploy that accepts
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

### Agent layer: durable runs

PRD §3/§11 specifies long agent runs as **durable Vercel Workflows (WDK)**.
`agents/workflow.ts` is the `"use workflow"` module and `agents/dispatch.ts`
chooses between it and the inline executor:

- `RR_WORKFLOWS_ENABLED="true"` → `start()` the workflow and return; the
  `agent_runs` row is how the console tracks it, exactly as for a long inline
  run.
- Unset (**the default**) → run inline, bounded by the request timeout (~300s on
  Fluid Compute).
- Enabled but the runtime is unreachable → **falls back to inline** rather than
  failing the run, and logs why.

Inline is the default deliberately: WDK needs its own runtime (`next dev` with
the plugin, or a Vercel deployment), and an app that only works in production is
the wrong way round for a codebase being handed over. **Turn the flag on once
deployed**, and confirm the context-research agent — the long one — completes.

The human review pause is NOT modelled as a workflow hook. It already lives in
the database: the run finishes, its assets are `pending`, and the admin console
resumes the process days later across deploys. Modelling it twice would give two
sources of truth that can disagree.

Re-runs stay inline: they carry the previous run's context, which would have to
be threaded across the workflow boundary for no current benefit.

### GitHub App

Repo provisioning goes through `integrations/github.ts`. With the
`RR_GITHUB_APP_*` credentials set it authenticates as a **GitHub App
installation** (never a PAT): a short-lived RS256 JWT is exchanged for an
installation token, which creates the repo, commits the file tree, and opens the
PR. Without credentials it uses a **local provider** that writes the same tree
under `RR_LOCAL_GITHUB_DIR`; production refuses it, because a "repository" that
is really a folder on an ephemeral disk fails silently at exactly the moment
participants need the repo.

**The App provider has never run against real credentials** — it follows the
documented REST API and is typechecked, but every test exercises the local
provider. Smoke-test it when the App is first installed.

Setup: create a GitHub App in the WR org with **Contents: read & write**,
**Pull requests: read & write**, and **Administration: read & write** (repo
creation); install it on the org; then set `RR_GITHUB_APP_ID`,
`RR_GITHUB_APP_INSTALLATION_ID`, `RR_GITHUB_ORG`, and
`RR_GITHUB_APP_PRIVATE_KEY` (PEM with literal `\n` escapes).

Repos are created **private** and made public only when the repo review is
approved. Every file is scanned for credential material before the push, and a
hit aborts the whole provisioning rather than pushing a partial tree.

`fetchRepoStats` (used by the Phase 4 categorizer) reads
`GET /repos/{owner}/{repo}/stats/code_frequency` for line counts and
`/languages` for the breakdown. Both are also used unauthenticated when no App
credentials are configured, at a much lower rate limit. Three live-observed
responses matter and are all handled as "not counted" rather than zero:

| Status | Meaning | Does re-running help? |
|---|---|---|
| `202` | GitHub is still computing the statistics | **Yes** — verified: a repo that returned 202 counted 735,495 lines on the next run |
| `422` | Repository too large for GitHub to compute at all | No, ever |
| `404` / `403` | Private or gone / rate limited | Only for the rate limit |

**Live web research is implemented.** The two documents that make claims about
the world — research notes and example PRDs — run with Anthropic's server-side
web search attached (`integrations/ai-gateway.ts`, `webSearch`), and the pages
the model actually read are logged on the run. The other two describe our own
repo and process and deliberately do NOT search: letting a model look those up
invites it to import someone else's conventions over the ones we just wrote
down. **This has never run against a real `AI_GATEWAY_API_KEY`** — the tool
revision (`webSearch_20260209`) is dated and model-specific, so if a model
rejects it, check which revision it accepts rather than dropping the tool.

**Citation checking is implemented** (`agents/citations.ts`): every link in a
research document is extracted and checked, results go to the run log, and a
note naming any dead or unverifiable link is appended to the document. It
reports and never rewrites. A 403/timeout/rate-limit is "unverified", not
"dead" — only a definite 4xx/5xx or a DNS failure counts as a failure.

The two together are the answer to §5.3.1: search makes the citations real,
and the checker catches the ones that still aren't. Neither is a substitute for
the review gate — a live URL that doesn't say what the document claims it says
is still a human's job to catch.

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

Two Drizzle configs, deliberately separate:

| | Rogue Raise | Better Auth |
|---|---|---|
| Schema | `db/schema.ts` | `db/auth-schema.ts` |
| Postgres schema | `rogue_raise` | `public` |
| Config | `drizzle.config.ts` | `drizzle.auth.config.ts` |
| Migrations | `./drizzle` | `./drizzle/auth` |
| Commands | `db:generate`, `db:migrate` | `db:auth-generate`, `db:auth-migrate` |

They never share a migration folder, which is what makes the merge mechanical:
WR already has the auth tables, so `db/auth-schema.ts`, `drizzle.auth.config.ts`,
and `drizzle/auth/` are all **deleted** at merge, leaving the `rogue_raise`
migrations untouched.

At merge, confirm which Neon database/branch the `rogue_raise` schema lands in.

## Local dev

```bash
npm run db:up        # start local postgres:16 (docker compose)
npm install
npm run db:generate  # generate SQL migrations from the schema
npm run db:migrate   # apply migrations to local Postgres
npm run db:auth-migrate                     # Better Auth tables (public schema)
npm run admin:create -- you@wr.com "You"    # a staff account to sign in with
npm run dev          # http://localhost:3000  ->  /rogue-raise
```

Set `RR_ADMIN_DEV_OPEN="true"` in `.env` to skip sign-in locally.

`npm run db:studio` opens Drizzle Studio; `npm run db:down` stops the DB.

## Merge checklist

- [ ] Lift `src/app/rogue-raise/*`, `src/app/admin/*`, `src/lib/rogue-raise/*`
      into the WR app (single cohesive segment).
- [ ] Point `DATABASE_URL` at the agreed Neon database/branch; run migrations.
- [ ] Repoint `integrations/auth.ts` at WR's existing Better Auth instance and
      DELETE `db/auth-schema.ts`, `drizzle.auth.config.ts`, `drizzle/auth/`, and
      `app/api/auth/[...all]/route.ts` — WR already has all four.
- [ ] Grant the `admin` role to WR staff accounts that already exist, rather
      than running `admin:create`.
- [ ] Confirm `RR_ADMIN_DEV_OPEN` is unset in every deployed environment (it is
      ignored in production, but leaving it set is misleading).
- [ ] Fill real credentials for AI Gateway, Resend, Vercel Blob, GitHub App.
- [ ] **Smoke-test the AI Gateway provider** with a real key — it has only ever
      run against the dev provider.
- [ ] **Smoke-test the Vercel Blob provider** with a real `BLOB_READ_WRITE_TOKEN`
      and confirm uploads never fall back to local disk in production.
- [ ] Set `RR_WORKFLOWS_ENABLED="true"` once deployed, and confirm the
      context-research agent completes durably.
- [ ] Set `RR_MAGIC_LINK_SECRET` — magic-link hashing fails fast without it in
      production, by design.
- [ ] Decide on malware scanning for sponsor uploads, or accept the documented
      validate-only posture in writing.
- [ ] Decide whether bulk email keeps the inline pacer
      (`integrations/rate-limit.ts`, ~600ms between sends) or moves to Vercel
      Queues. The pacer holds the request open for the whole send, which is fine
      at tens of recipients and wrong at thousands.
- [ ] Replace the URL-borne intake token with a Better Auth `magicLink` session.
- [ ] Confirm the WR GitHub org name + install the GitHub App with repo-create/
      push permissions, then **smoke-test provisioning** — the App provider has
      only ever run against the local disk provider.
- [ ] Verify design tokens match the live site exactly.
