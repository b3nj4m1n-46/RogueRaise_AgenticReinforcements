# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current State

This repo is **pre-code**: it contains only planning artifacts. There is no `package.json`, build system, or application code yet.

- `PRD.md` — the implementation-ready Product Requirements Document (v1.0). This is the source of truth. It is written to be executed by coding agents in Auto mode and defines the data model, phases, agent specs, tech stack, and build order.
- `whiteboard-july-6.md` — earlier planning notes; superseded in detail by the PRD but useful for original intent.

When building, **follow the PRD's build order (§14)**: milestone **M0 (Foundation)** gates everything else. Do not start phase features before M0 is complete.

## What This Product Is

**Rogue Raise** is internal tooling for a small White Rabbit (WR) team to run community "barn-raise" build events end to end. The controlling design principle (PRD §1.3.1): give staff one repeatable method to stand up and run an event, and **automate every otherwise-manual step with an AI agent behind a human approval gate**. When designing any feature, ask "what did a staff member do by hand here, and can an agent draft it instead?" Prefer *agent draft → human approve/edit/reject* over a blank form. Time-saved-for-staff is the primary product metric.

The platform runs four phases, each gated on `Event.status`: (1) securing sponsors, (2) participant registration, (3) submission/judging/winners, (4) stakeholder handoff portal.

## Architecture & Conventions (from PRD §3)

This is built as a **standalone Next.js app now, to be merged into WR's existing `whiterabbitashland.com` codebase later** (PRD §3.1, DECIDED). Two properties are first-class consequences:

- **Portability** — nothing may hard-depend on private WR infrastructure. All external services (email, Blob, AI Gateway, GitHub App, auth) go through thin adapter modules in `lib/rogue-raise/integrations/*` with env-driven config.
- **Mergeability** — keep all feature code under single movable segments: `app/rogue-raise/*` + `app/admin/*` for routes, `lib/rogue-raise/*` for server logic.

**Stack (match this exactly — it mirrors WR's production stack; do not introduce parallel choices):**

- **Next.js App Router** (Next 15/16-class), TypeScript, React Server Components, Turbopack.
- **Tailwind CSS** themed to WR's existing design tokens — `wr-olive-green`, `ink`, plus siblings. **Reuse these tokens; do not invent a new palette.** Typography via `next/font`: **Fraunces** (serif display/headings) + **JetBrains Mono** (mono); body `font-sans antialiased`.
- **shadcn/ui** components, themed to WR tokens.
- **Postgres** via **Drizzle ORM** (portable migrations, `postgres` driver). Local dev uses `postgres:16` in Docker Compose; production targets **Neon**. Use a single `DATABASE_URL` so pointing at Neon is a one-env-var change. **Plain-Postgres features only** (no local-only extensions). **Namespace every table under a dedicated `rogue_raise` Postgres schema** so it drops into WR's Neon DB without colliding.
- **Better Auth** for auth (extend WR's existing layer; do not add a second auth system): `magicLink` plugin for external roles (Sponsor POC, Judge, Participant, Stakeholder), `admin` plugin for WR Admin, Drizzle adapter over the same DB. Role/event scoping is enforced in server logic on top of Better Auth sessions — a Judge for Event A must never read Event B.
- **Vercel** hosting (Fluid Compute; ~300s function timeout). **Long/multi-step agent runs MUST use durable Vercel Workflows (WDK)** so they survive the timeout and can pause for human review and resume with feedback. **Vercel Blob** for files (private by default), **Vercel Cron** for time triggers, **Vercel Queues** for bulk email fan-out.
- **AI agents** via the **Vercel AI SDK** through the **AI Gateway**, using `"provider/model"` strings. Default to the latest, most capable Claude models for authoring/research (e.g. `anthropic/claude-opus-4-8`) and a faster tier for classification/categorization.
- **Email** via **Resend** (templated + AI-drafted). All bulk sends go through a queue and must be **idempotent**.
- **GitHub App** (not a PAT) with permission to create repos in the WR org, push commits, open PRs. Used by the repo-provisioning agent and for LOC/category stats.
- **Validation:** server actions validated with **zod** (share client/server schemas).

## Data Model (PRD §4, Appendix A)

`Event` is the lifecycle hub; its `status` enum is the single source of truth for what is unlocked, and **every agent and UI action must check `Event.status` before proceeding**. Lifecycle:

```
draft → submitted → under_review → approved → intake_pending →
intake_complete → repo_generating → repo_review → repo_approved →
registration_open → live → judging → completed → archived
                                   ↘ rejected (terminal)
```

Appendix A is a **reference schema, not a build artifact** — reproduce its intent during the live build; final column types/names are the implementer's call. Shared columns: every table has `id uuid PK`, `created_at`; mutable tables add `updated_at`. Identity comes from Better Auth's own tables — `rogue_raise` rows reference that identity rather than storing their own.

## Agent Layer Rules (PRD §11)

- Every agent task is an `AgentRun` record (status, inputs, outputs → `GeneratedAsset`, logs, cost_tokens) for audit + resumability. Each agent must be independently re-runnable with additional instructions.
- **Human-in-the-loop is mandatory** before anything reaches participants: WR Admin (and Stakeholders where noted) must Approve/Edit/Reject. Nothing auto-publishes.
- **No secret material is ever emitted into a public repo or asset.** Technical-sponsor credentials are documented as instructions only, never committed.
- Generated assets are versioned and attributable to their `AgentRun`.

## Planned Commands (M0 deliverables, PRD §14)

These scripts do not exist yet — they are required M0 artifacts. When scaffolding, create `package.json` scripts:

- `db:up` — start local `postgres:16` (Docker Compose)
- `db:generate` — generate Drizzle migrations
- `db:migrate` — apply migrations
- `db:push` — push schema
- `db:studio` — Drizzle Studio

M0 acceptance: `npm run db:up && npm install && npm run db:generate && npm run db:migrate` succeeds against local Postgres with all `rogue_raise` tables created. Also required at M0: `docker-compose.yml`, `drizzle.config.ts` (with `schemaFilter: ['rogue_raise']`), `.env.example` covering every env seam, and `HANDOFF.md` (merge guide for WR tech staff: portability seams, env vars, `rogue_raise` schema, merge checklist).

## Conventions Used in the PRD

- `[MUST]` = MVP-required; `[SHOULD]` = complete-product, post-MVP; `[COULD]` = nice-to-have.
- `AC:` = acceptance criteria — a feature is done only when every `AC` line is demonstrably true.
- `AGENT:` = an AI agent task that must be a durable, resumable job.
- Entities `PascalCase`, fields `snake_case`, routes `/kebab-case`.
- The recurring worked example is **"Rogue Raise: The Unhoused"** (Jackson County Health Department, homelessness data infrastructure) — used throughout the PRD to make abstractions concrete.
