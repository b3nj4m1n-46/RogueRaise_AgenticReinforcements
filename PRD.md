# Rogue Raise Platform — Product Requirements Document (PRD)

**Owner:** White Rabbit (Ashland, OR)
**Document type:** Implementation-ready PRD for autonomous coding agents (Auto mode)
**Version:** 1.0
**Last updated:** 2026-07-06

---

## 0. How to Read This Document (for Coding Agents)

This PRD is written to be executed by coding agents working in Auto mode. It is organized so that any section can be picked up and built independently once shared foundations (data model, auth, design system) exist.

Conventions used throughout:

- **`[MUST]`** — required for launch (MVP).
- **`[SHOULD]`** — required for a complete product, sequenced after MVP.
- **`[COULD]`** — nice-to-have; build only if cheap or explicitly requested.
- **`AC:`** — acceptance criteria. A feature is "done" only when every `AC` line is demonstrably true.
- **`AGENT:`** — an AI agent task that must be implemented as a durable, resumable job (see §11).
- Entities are written in `PascalCase`; fields in `snake_case`; routes in `/kebab-case`.

**Build order is defined in §14.** Do not begin phase features before the foundation milestone (M0) is complete.

---

## 1. Vision & Context

### 1.1 What a Rogue Raise Is

A Rogue Raise is White Rabbit's community build event, modeled on a traditional **barn raise**. Instead of a barn, neighbors gather to raise **working software and practical tools** that solve a real problem facing the Rogue Valley. It is explicitly **not** a conventional hackathon:

> "not about instant gratification or staying up all weekend to show off what we can build. It's about a community coming together to raise something that lasts."

The defining difference from a hackathon: **every project is handed off to a committed steward (a Sponsor Stakeholder) who actually deploys, adopts, or iterates on the solution afterward.** The platform must treat this handoff as a first-class outcome, not an afterthought.

### 1.2 Event Format

A Rogue Raise runs over a single weekend:

1. **Friday afternoon — Kickoff / opening ceremony.** Stakeholders and affected community members share perspectives; teams form around facets of the challenge.
2. **Saturday + Sunday until 4:00 PM — The build.** Parallel team work.
3. **Sunday 4:00 PM — Pitches.** Teams present.
4. **Sunday 6:00 PM — Judging results + winners announced.**
5. **Post-event — Ownership handoff.** Each repo transfers to a committed steward.

**Location:** 5 North Main Street, Ashland, Oregon.
**Core commitments:** Humanity (center those being served) and Truth (honest data + lived experience).

### 1.3 Product Goal

Build a web platform that runs the **entire four-phase lifecycle** of a Rogue Raise, with **AI agents doing the heavy lifting** of research, content creation, and repo preparation so that:

- Sponsors can be secured and curated with minimal White Rabbit staff effort.
- Participants arrive to a **rich, pre-researched GitHub repo** so their first 24 hours go to *building*, not researching.
- Judging is structured, fair, and fast.
- Stakeholders get **self-serve** access to results and handoff assets — no follow-up required.

### 1.3.1 North Star: Small Team, Agent-Leveraged

This is **internal tooling for a small White Rabbit team**. The controlling design principle is: **give WR staff a single, consistent, repeatable method for standing up and running a Rogue Raise, and automate every otherwise-manual step with AI agents.** WR's core gift is running AI agents well — the platform's job is to point that gift at the operational load (research, drafting, repo prep, comms, tabulation) so a couple of people can run a full community event.

For every feature, the design question is: *"What did a staff member have to do by hand here, and can an agent do it instead (with a human approval gate)?"* When in doubt, prefer an agent draft + human approve/edit/reject over a blank form a staff member must fill from scratch. **Time-saved-for-staff is the primary product metric.**

### 1.3.2 Worked Example (used throughout this PRD)

The first concrete Raise is **"Rogue Raise: The Unhoused"** — improving homelessness **data infrastructure** in the Rogue Valley (de-duplicating records, improving Point-in-Time counts, integrating new data sources via syndromic-surveillance methods).

- **Sponsor Organization:** Jackson County Health Department
- **Sponsor POC / Stakeholders:** Health Department staff who will steward the resulting repos
- **Pain points / goals:** duplicate records across systems, unreliable PIT counts, siloed data sources
- **Stakeholder tech stack:** (captured in intake) → becomes the "build-toward" parameters participants target so the work is actually adoptable by the County

This example is referenced in field tables and agent specs to make the abstract concrete.

### 1.4 The Four Phases

| Phase | Name | Primary Users | Core Output |
|------|------|---------------|-------------|
| 1 | Securing Sponsors via Sign-Up | Sponsor POC, WR Admin | Approved, fully-provisioned event with context repo, judge email, kickoff deck, marketing |
| 2 | Participant Registration | Participants | Registered participants + confirmation/rules email |
| 3 | Submission, Judging, Winner | Participants, Judges, WR Admin | Scored submissions + declared winners |
| 4 | Stakeholder Handoff Portal | Sponsor Stakeholders | Self-serve dashboard of all submissions + assets |

---

## 2. Roles & Personas

| Role | Description | Auth level |
|------|-------------|-----------|
| **WR Admin** | White Rabbit staff. Curates sponsors, provisions events, reviews AI outputs, tabulates judging, announces winners. Superuser. | Authenticated (admin) |
| **Sponsor POC** | Point of contact at the sponsoring org. Submits sponsorship, completes secondary intake form. | Magic-link / passwordless (scoped to their org's event) |
| **Sponsor Stakeholder** | Individual(s) who take ownership of submitted repos after the event. Access post-event portal. | Authenticated (stakeholder), scoped to their event |
| **Judge** | Evaluates submissions on a 1–5 scale. Fills background form pre-event; scores during pitches. | Magic-link, scoped to event |
| **Participant** | Builder. Registers, forms/joins a team, submits repo + pitch. | Magic-link, scoped to event |
| **Public / Prospect** | Anonymous visitor of the event landing page. | None |

**Auth model `[MUST]`:** Passwordless magic-link for external roles (POC, Judge, Participant, Stakeholder); full account auth for WR Admin. See §12.

---

## 3. System Architecture & Tech Stack

> **This platform is built into White Rabbit's existing stack** (verified by inspecting whiterabbitashland.com), not a greenfield stack. The goal is one codebase and one deployment model WR staff already understand. A coding agent must match the existing conventions below and preserve the contracts in §5–§13.

**Confirmed existing WR stack (from site fingerprinting):**

- **Framework:** Next.js **App Router**, built with **Turbopack** (modern Next.js 15/16-class), TypeScript, React Server Components. (Markers: `x-nextjs-prerender`, `self.__next`, `/_next/static/chunks/`, `turbopack-*.js`.)
- **Styling:** **Tailwind CSS** with a **custom White Rabbit design-token theme** already in production. Real tokens observed in markup: `wr-olive-green`, `ink` (near-black), plus component classes like `eyebrow-nav`. Reuse these tokens — do not invent a parallel palette.
- **Typography (via `next/font`):** **Fraunces** (serif display) + **JetBrains Mono** (mono). Body set to `font-sans antialiased`.
- **Hosting:** **Vercel** (Fluid Compute; default 300s function timeout — long agent runs MUST use durable workflows, see §11). **Cloudflare** sits in front (CDN/DNS).
- **Database:** **Neon Postgres** — *WR's existing backend DB.* Access through a typed query layer; **Drizzle ORM** recommended for schema + migrations against Neon. New tables live alongside/within the existing WR database (coordinate schema/namespace with WR — e.g., a `rogue_raise` schema).

**New capabilities to add (choose Vercel-native to stay in the existing operational model):**

- **Auth:** **Better Auth** — *WR's existing auth layer (confirmed).* Extend it; do not add a second auth system. It fits this platform natively: the **`magicLink` plugin** covers the passwordless external roles (Sponsor POC, Judge, Participant, Stakeholder), the **`admin` plugin** covers WR Admin, and the **Drizzle adapter** shares the same Neon/Postgres DB. During the standalone phase, run a local Better Auth instance against local Postgres; at merge, point at WR's existing Better Auth config. Role/event scoping is enforced in server logic on top of Better Auth sessions (see §12).
- **File/asset storage:** **Vercel Blob** (private for internal drafts, public for published assets).
- **Email:** Transactional provider (**Resend** recommended) with templated + AI-drafted sends; **all bulk sends go through a queue**.
- **AI agents:** **Vercel AI SDK** through the **AI Gateway** (use `"provider/model"` strings; default to the latest, most capable Claude models — e.g. `anthropic/claude-opus-4-8` for authoring/research, a faster tier for classification/categorization). Multi-step agents (research → write → commit) run as **Vercel Workflow (WDK)** durable workflows so they survive the function timeout and can **pause for human review**. This is the automation engine that delivers the §1.3.1 north star.
- **GitHub integration:** A **GitHub App** (not a PAT) with permission to create repos in the White Rabbit org, push commits, and open PRs. Used by the repo-provisioning agent (§5.3.1) and for LOC/category stats (§8).
- **Background jobs / scheduling:** **Vercel Cron** for time-based triggers (e.g., "fire submission blast at Sunday 4:00 PM"), **Vercel Queues** for bulk email fan-out.
- **Design system:** **shadcn/ui + Tailwind**, themed to the existing WR tokens above (see §13) so admin/judge/portal surfaces feel like part of whiterabbitashland.com.

### 3.1 Build Strategy: Standalone Now, Merge Into WR Later (DECIDED)

**We build this as a separate, self-contained Next.js app with its own local database**, get the full flow working, then **hand the repo to WR tech staff to formally merge into the main whiterabbitashland.com repo.** This makes two properties first-class from day one:

- **Portability** — nothing may hard-depend on private WR infrastructure. Everything talks to interfaces that swap cleanly (see below).
- **Mergeability** — code is organized so WR staff can lift it into their app as a cohesive segment with minimal rework.

Concrete rules for the standalone phase:

- **Database:** Run **Postgres locally** (Docker Compose: `postgres:16`) for development. Author the schema with **Drizzle** so migrations are portable. **Target Neon compatibility from the start** — plain Postgres features only, no local-only extensions; connection via a single `DATABASE_URL` so pointing at Neon later is a one-env-var change. Namespace all tables under a dedicated **`rogue_raise` schema** so they drop into WR's Neon DB without colliding.
- **Routing/portability:** Keep all feature code under a single top-level segment (e.g., `app/rogue-raise/*` + `app/admin/*`) and a single `lib/rogue-raise/*` for server logic, so the whole feature is a movable unit. Public entry route mirrors the eventual first-party path `/rogue-raise`.
- **Config isolation:** All external services (email, Blob, AI Gateway, GitHub App, auth) accessed through thin adapter modules in `lib/rogue-raise/integrations/*` with env-driven config — so WR swaps credentials/providers without touching feature logic.
- **Design tokens:** Vendor the WR Tailwind tokens (`wr-olive-green`, `ink`, Fraunces, JetBrains Mono) into this app's theme now, so the UI already matches and merges cleanly.
- **Handoff artifact:** Maintain a `HANDOFF.md` documenting env vars, the `rogue_raise` schema/migrations, adapter seams, and merge steps for WR tech staff.

Local dev uses local Postgres + local/blob-emulated storage + sandboxed email (e.g., a dev inbox) so the whole flow runs on a laptop with no WR credentials required.

### 3.1 High-Level Component Map

```
┌────────────────────────────────────────────────────────────────┐
│  Public Web (Next.js App Router)                                 │
│  /rogue-raise (hub) · /events/[slug] (landing) · /sponsor        │
│  /register · /judge · /submit · /portal                          │
├────────────────────────────────────────────────────────────────┤
│  Admin Web  /admin/*  (curation, provisioning, tabulation)       │
├────────────────────────────────────────────────────────────────┤
│  API / Server Actions  (validated with zod)                      │
├───────────────┬───────────────┬───────────────┬─────────────────┤
│  Postgres     │  Vercel Blob   │  Email (Resend)│  GitHub App     │
├───────────────┴───────────────┴───────────────┴─────────────────┤
│  AI Agent Layer (AI SDK + AI Gateway, orchestrated by WDK)       │
│  Research · Repo-Provision · Judge-Email · Deck · Marketing      │
├────────────────────────────────────────────────────────────────┤
│  Schedulers: Vercel Cron + Vercel Queues                         │
└────────────────────────────────────────────────────────────────┘
```

---

## 4. Global Data Model (Overview)

Full field lists appear inline with each phase. This is the entity graph and the canonical relationships.

```
Organization 1──* SponsorApplication *──1 Event
Event 1──* Judge
Event 1──* Stakeholder
Event 1──* Participant
Event 1──* Team *──* Participant   (via TeamMembership)
Event 1──* Submission 1──1 Team
Submission 1──* JudgeScore *──1 Judge
Event 1──1 ContextRepo (GitHub)
Event 1──* GeneratedAsset  (deck, marketing, emails, research docs)
Event 1──* AgentRun         (audit + resumability)
```

**Core lifecycle state on `Event`** (single source of truth for what's unlocked):

```
draft → submitted → under_review → approved → intake_pending →
intake_complete → repo_generating → repo_review → repo_approved →
registration_open → live → judging → completed → archived
                                   ↘ rejected (terminal)
```

Every phase gates on this enum. Agents and UI MUST check `Event.status` before allowing an action.

---

## 5. PHASE 1 — Securing Sponsors via Sign-Up

### 5.1 Part 1 — Public Sponsorship Sign-Up Form `[MUST]`

**Route:** `/sponsor` (public). **Server action:** `createSponsorApplication`.

**Entity: `SponsorApplication`**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | uuid | — | PK |
| `org_name` | string | ✅ | |
| `poc_name` | string | ✅ | |
| `poc_email` | string (email) | ✅ | Becomes magic-link identity for secondary form |
| `poc_phone` | string (E.164) | ✅ | |
| `pain_points` | text (long) | ✅ | "Pain Points/Opportunities for participants to solve" |
| `goals_needs` | text (long) | ✅ | "Goals/Needs from the solutions" |
| `stakeholders` | Stakeholder[] | ✅ (≥1) | Repeatable group (see below) |
| `financial_commitment` | money + text | ✅ | Amount committed to WR for facilitation; allow "to discuss" flag |
| `status` | enum | — | `submitted / under_review / approved / rejected` |
| `submitted_at` | timestamptz | — | |

**Nested `Stakeholder` (Part 1 capture):** `name` ✅, `email` ✅, `phone` ✅. Repeatable (add/remove rows, min 1).

**Behavior:**
- `AC:` Form validates all required fields client + server side (zod schema shared).
- `AC:` Stakeholders are a dynamic repeatable field group (add/remove).
- `AC:` On submit, creates `SponsorApplication` with `status=submitted`, creates/links an `Organization`, and creates an `Event` in `status=submitted` linked to the application.
- `AC:` POC receives an acknowledgment email ("We received your Rogue Raise sponsorship interest").
- `AC:` WR Admin receives an internal notification (email + admin dashboard badge).
- `AC:` Spam protection enabled (Vercel BotID or hCaptcha).

### 5.2 Part 2 — Admin Curation & Secondary Intake

#### 5.2.1 Admin Panel — Curation `[MUST]`

**Route:** `/admin/sponsors`.

- `AC:` Admin sees a queue of all `SponsorApplication`s with filters by status.
- `AC:` Detail view shows all Part 1 fields.
- `AC:` Admin can **Approve** or **Reject** with an optional note.
- `AC:` **Approve** transitions `Event.status → approved`, then automatically to `intake_pending`, and triggers the secondary intake email to the POC (magic link to the secondary form). Rejection sends a courteous decline email and sets `rejected` (terminal).
- `AC:` All state changes are audit-logged (actor, timestamp, from→to).

#### 5.2.2 Secondary Intake Form (Sponsor POC) `[MUST]`

**Route:** `/sponsor/intake/[eventId]` (magic-link gated). Auto-saves; **does not require completion in one sitting.** A progress indicator shows required vs. optional and what remains before the event can advance.

**Entity: `EventIntake` (1:1 with Event)**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `judges` | Judge[] | optional* | Repeatable: `name`, `email`, `phone`. *Needed before judge emails send |
| `evaluative_criteria` | Criterion[] | optional* | Each: `label`, `description`, `weight?`. Drives the 1–5 judging form |
| `potential_dates` | DateOption[] | ✅ **Required** | Each option = a Fri/Sat/Sun weekend. Enforce the fixed schedule template (§5.2.3) |
| `awards_budget` | money + text | optional | |
| `technical_sponsors` | TechSponsor[] | optional | Each: `name`, `offering` (API creds/tokens/etc.), `contact`, `status` |
| `supplementary_info` | Attachment[] + text | ✅ **Required** | Context data/docs for pain points, goals, needs. Files → Blob |
| `stakeholder_tech_stack` | text (long) + tags | ✅ **Required** | Stakeholders' technical stack/preferences → "build-toward" parameters for participants |
| `completed_at` | timestamptz | — | Set when all **required** fields present |

**Behavior:**
- `AC:` Form is fully resumable via magic link; partial saves persist; POC can return any time.
- `AC:` Required fields (`potential_dates`, `supplementary_info`, `stakeholder_tech_stack`) are clearly marked as VITAL and block event advancement until present.
- `AC:` When all required fields are complete, `Event.status → intake_complete` and WR Admin is notified.
- `AC:` File uploads stored in private Blob, virus/type-validated, size-limited.

#### 5.2.3 Fixed Schedule Template (enforced) `[MUST]`

Each `DateOption` expands to the canonical timeline; the platform stores this so every downstream artifact (deck, emails, landing page) uses consistent times:

- **Friday** — Kickoff (afternoon, configurable start; default 5:00 PM).
- **Saturday** — Full build day.
- **Sunday** — Build until **4:00 PM → pitches**; **6:00 PM → judging results + winners announced.**

`AC:` Admin selects one `DateOption` as the confirmed event weekend; confirmed dates propagate everywhere via a single source.

### 5.3 Part 2 — AI Agent Outputs (triggered after intake_complete)

Once `Event.status = intake_complete`, the WR Admin can trigger (or auto-trigger) the agent pipeline. **All agents write to `GeneratedAsset` records and log to `AgentRun` (see §11). Nothing is auto-published to participants without WR Admin + Stakeholder review (approval/edit/reject).**

#### 5.3.1 `AGENT: Context Research → GitHub Repo` `[MUST]`

Purpose: produce the rich context repo so participants' first 24h are for building.

Inputs: all `EventIntake` fields + Part 1 pain points/goals + supplementary files.

Steps (durable workflow):
1. **Web research** on the problem domain (e.g., Rogue Valley homelessness data infrastructure), using web-research skill/tools; gather sources, statistics, prior art, relevant datasets.
2. Generate repo file set:
   - `README.md` — event overview, problem statement, schedule, links.
   - `research/` — synthesized research docs **with citations**.
   - `stakeholder-preferences.md` — the stakeholders' tech stack/preferences as a standalone file (build-toward parameters).
   - `context/` — supplementary info/data reformatted for participant use.
   - `prds/` — **example PRDs** (multiple, varying ambition) to onboard people who have never done a hackathon.
   - `setup-agent-instructions.md` — a markdown file instructing an agent how to set up a **public** project GitHub repo with the right parameters.
   - `tools/` — any provided technical-sponsor credentials guidance (never commit secrets; document how to obtain).
3. **Create** the event-specific GitHub repo in the White Rabbit org (public at event time; private during review), commit + push the generated content on a branch, open a PR.

- `AC:` A `ContextRepo` record links the Event to the GitHub repo URL + default branch.
- `AC:` Research documents contain verifiable, reachable citations (URL-check pass).
- `AC:` `stakeholder-preferences.md`, `research/`, `prds/` (≥2 examples), and `setup-agent-instructions.md` all exist.
- `AC:` Secrets are never committed; credentials are referenced as instructions only.
- `AC:` `Event.status → repo_generating → repo_review` on completion.

#### 5.3.2 Internal Review of Repo `[MUST]`

**Route:** `/admin/events/[id]/repo-review` and a stakeholder-facing review view.

- `AC:` WR Admin and Stakeholders can review pushed content and give **Approve / Edit / Reject** feedback per file (comment thread).
- `AC:` "Reject" or "Edit" can re-trigger the agent with the feedback as additional instructions (new `AgentRun`, resumable).
- `AC:` On approval, the repo is made public and `Event.status → repo_approved`.

#### 5.3.3 `AGENT: Judge Invitation Email` `[MUST]`

Purpose: email each judge a link to a background form so they can be introduced at kickoff, plus schedule, expectations, and evaluative criteria.

- `AC:` Drafts a personalized email per judge containing: link to **Judge Background Form** (§5.3.4), full **schedule of events**, **expectations of judges**, and the **evaluative criteria**, with an invitation/CTA to **ask questions about the criteria itself** (reply-to or a question thread link).
- `AC:` Draft goes to WR Admin for approval before send (edit-in-place).
- `AC:` On approval, sends via transactional email; logs delivery status per judge.

#### 5.3.4 Judge Background Form `[MUST]`

**Route:** `/judge/background/[token]` (magic-link).

- `AC:` Collects judge bio/background used for the kickoff introduction (name confirmed, title/org, short bio, headshot optional, expertise tags, "how you'd like to be introduced").
- `AC:` Includes a free-text "Questions about the evaluative criteria" field that routes to WR Admin + Sponsor POC.
- `AC:` Submissions stored on the `Judge` record and surfaced in the kickoff deck data.

#### 5.3.5 `AGENT: Kickoff Deck (PPTX)` `[SHOULD]`

Purpose: generate a Friday kickoff presentation.

- `AC:` Produces a `.pptx` covering: the topic/problem, sponsor introduction(s), the sponsor's pain/need, the opportunities, the evaluative criteria, judges (using background-form data), schedule, and location.
- `AC:` Deck is downloadable by WR Admin and editable (stored in Blob; regenerate on demand).
- `AC:` Brand-themed (White Rabbit).

### 5.4 Part 3 — Marketing & Solicitation Agents `[SHOULD]`

Triggered after Part 2 completion (`repo_approved`).

#### 5.4.1 `AGENT: Technical-Sponsor & Press Outreach Drafts`

- `AC:` Drafts solicitation materials that **White Rabbit** and the **Rogue Raise Sponsor** can use to contact potential technical sponsors (API/credit providers) and the press.
- `AC:` Outputs are per-recipient-type templates (tech sponsor, local press) with merge fields, saved as `GeneratedAsset`s, editable, exportable.

#### 5.4.2 `AGENT: Outbound Social Marketing` (distinct agent)

- `AC:` Drafts suggested posts for **Instagram, Facebook, X (Twitter), and Reddit (/r/ashland)** — platform-appropriate length/tone/hashtags, with a suggested posting cadence.
- `AC:` Drafts require WR Admin approval; no auto-posting in MVP (manual copy-out is fine).

#### 5.4.3 Unique Event Landing Page (generation/config)

- `AC:` Produces the content for the event's public landing page (see §6). The page itself is a real route; the agent fills its content model.

---

## 6. PHASE 2 — Participant Registration

### 6.1 Event Landing Page `[MUST]`

**Route:** `/events/[slug]`, linked from the primary `/rogue-raise` hub.

- `AC:` Displays event topic, confirmed **date/time** (from the single schedule source), **location** (5 North Main Street, Ashland, OR), and description.
- `AC:` Includes an **event FAQ** (content-managed; seedable by the marketing agent).
- `AC:` Prominent "Register" CTA.
- `AC:` Responsive; body never scrolls horizontally; brand-themed.

### 6.2 Participant Registration Form `[MUST]`

**Route:** `/events/[slug]/register`. **Entity: `Participant`.**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `first_name` | string | ✅ | |
| `last_name` | string | ✅ | |
| `email` | string (email) | ✅ | Unique per event |
| `github_username` | string | ✅ | Validate against GitHub API; if none, show link to GitHub sign-up |
| `event_id` | fk | ✅ | |

**Behavior:**
- `AC:` Registration only open when `Event.status = registration_open` (Admin toggles/schedules).
- `AC:` If the user has no GitHub account, the form shows a clear link to sign up at github.com and lets them proceed once they have one.
- `AC:` GitHub username is format-validated (and existence-checked where feasible).
- `AC:` On submit, participant receives a **confirmation email** that includes the **Rogue Raise rules**.
- `AC:` Duplicate email per event is rejected gracefully.
- `AC:` Registration count is visible to WR Admin.

---

## 7. PHASE 3 — Submission, Judging, Winner

### 7.1 Part 1 — Project Submission `[MUST]`

**Trigger:** At/near Sunday 4:00 PM (build phase ends). WR Admin fires a **bulk email** to all registered participants with a link to the submission form.

**Entity: `Submission` (1:1 with `Team`).**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `team_name` | string | ✅ | Used to call teams up for presentation |
| `project_summary` | text | ✅ | |
| `repo_url` | string (url) | ✅ | GitHub repo link; validated |
| `pitch_materials_url` | string/Attachment | optional | Slides/video; encourage including in repo |
| `members` | Participant[] | ✅ | Team roster (name/email) for contact + call-up |
| `event_id` | fk | ✅ | |
| `submitted_at` | timestamptz | — | |

**Behavior:**
- `AC:` Bulk submission-invite email fan-out via queue (idempotent; no duplicate sends). Each participant/team gets a submission link.
- `AC:` Submission link works only while the submission window is open (Admin-controlled).
- `AC:` `repo_url` is validated as a reachable GitHub repo.
- `AC:` On submit, appears immediately in the judge and admin views.
- `AC:` Pitch materials are encouraged to be in the repo; an optional upload/link is also accepted.

### 7.2 Part 2 — Judge Scoring `[MUST]`

**Route:** `/judge/[eventId]` (magic-link gated per judge).

- `AC:` Shows a **card per submission**; each card opens a detail view with the project summary, repo link, and pitch materials.
- `AC:` Each detail view has a **notes field** the judge can write in **during the presentation** (auto-saved, private to that judge).
- `AC:` Each detail view has the **evaluation form** built from `evaluative_criteria`: **1–5 scale per criterion**, plus a computed **final score** (weighted if weights provided; otherwise sum/average — display the method).
- `AC:` Judge can save drafts and submit final scores per submission.

**Entity: `JudgeScore`** — `judge_id`, `submission_id`, `scores` (JSON: criterion→1–5), `notes`, `final_score` (computed), `submitted_at`.

### 7.3 Winner Tabulation & Declaration `[MUST]`

**Route:** `/admin/events/[id]/results`.

- `AC:` Final-score tabulation is sent to / visible by WR Admin: per-submission aggregate across judges, and per-criterion breakdowns.
- `AC:` Admin can announce the winner based on total score **and** derive **different award types from different scales/criteria** (e.g., "Most Deployable," "Best Use of Data") — configurable award categories mapped to criteria.
- `AC:` Ties are surfaced (not silently broken) for Admin decision.
- `AC:` Declared winners/awards are recorded on the Event and surfaced to the Phase 4 portal.

---

## 8. PHASE 4 — Stakeholder Handoff Portal

**Route:** `/portal/[eventId]` (authenticated; scoped to that event's Stakeholders). This is the payoff of the whole model — **no follow-up with WR required.**

### 8.1 Dashboard `[MUST]`

- `AC:` Signed-in Stakeholder sees event summary stats:
  - number of submissions,
  - **total lines of code submitted** (computed from repos via GitHub API — sum across submission repos),
  - a **summary of the types of submissions** (AI-generated categorization/summary),
  - awards/winners.
- `AC:` Stats compute from real submission repos; a background job populates LOC and categories after submission close.

### 8.2 Submission Cards `[MUST]`

- `AC:` One card per submission showing: team name, project summary, **participant contact information**, a **link to the judges' evaluations** for that submission, and a **link to the GitHub repo**.
- `AC:` Stakeholder can **download** the repo (link to GitHub download/zip) and/or **contact the participant** (mailto or in-app message).
- `AC:` Access is strictly scoped: a Stakeholder sees only their own event.

### 8.3 Handoff Bridge to the Barn-Raise Model `[SHOULD]`

- `AC:` Each submission can be marked "adopted / stewarded / archived" by the Stakeholder, capturing the ongoing-ownership commitment that defines a Rogue Raise.

---

## 9. Admin Console (Cross-Phase) `[MUST]`

**Route:** `/admin/*`. One place for WR staff to run everything.

- `AC:` Event list with lifecycle status and quick actions per state.
- `AC:` Sponsor curation queue (§5.2.1).
- `AC:` Intake completeness tracker per event (what's still missing).
- `AC:` Agent run monitor: status, logs, re-run/resume, approve/edit/reject generated assets (§11).
- `AC:` Registration, submission, and judging live counts.
- `AC:` Manual triggers: send judge emails, open registration, fire submission-invite blast, publish landing page, publish repo.
- `AC:` Full audit log of state transitions and sends.

---

## 10. Notifications & Email (Cross-Phase) `[MUST]`

All transactional and bulk email flows in one place. Bulk sends go through a **queue** and are **idempotent**.

| Trigger | To | Content |
|---------|----|---------|
| Sponsorship submitted | POC | Acknowledgment |
| Sponsorship submitted | WR Admin | Internal alert |
| Application approved | POC | Secondary intake magic link |
| Application rejected | POC | Courteous decline |
| Intake complete | WR Admin | Ready-to-provision alert |
| Judge invite (agent-drafted) | Each Judge | Background form link + schedule + expectations + criteria + ask-questions CTA |
| Registration confirmed | Participant | Confirmation + Rogue Raise rules |
| Build phase ends | All Participants (bulk) | Submission form link |
| Winners announced | Participants / Stakeholders | Results (optional) |
| Portal ready | Stakeholders | Sign-in link to handoff portal |

- `AC:` Every email type has an editable template; agent-drafted emails are reviewable before send.
- `AC:` Bulk sends are queued, rate-limited, idempotent, and delivery-tracked.

---

## 11. AI Agent Layer (Specification) `[MUST for repo+judge email; SHOULD for deck/marketing]`

> **See `AGENTS_PRD.md` for the full agent specification** — per-agent triggers, inputs, tools, models, workflow steps, guardrails, orchestration, and acceptance criteria. This section is the summary; the companion doc governs agent behavior.

### 11.1 Execution Model

- Every agent task is an **`AgentRun`** record: `id`, `event_id`, `type`, `status` (`queued/running/paused_for_review/succeeded/failed`), `inputs`, `outputs` (→ `GeneratedAsset`), `logs`, `cost_tokens`, `started_at`, `finished_at`.
- Long/multi-step agents (research→write→commit) run as **durable Vercel Workflows** so they survive the function timeout, can **pause for human review**, and **resume** with feedback.
- Models via **AI Gateway** using `"provider/model"` strings; default to the latest, most capable Claude models for authoring. Configure fallbacks.
- **Human-in-the-loop is mandatory** before anything reaches participants: WR Admin (and Stakeholders where noted) must Approve/Edit/Reject.

### 11.2 Agent Catalog

| Agent | Phase | Trigger | Output | Review gate |
|-------|-------|---------|--------|-------------|
| Context Research → Repo | 1.2 | `intake_complete` | GitHub repo (research, stakeholder-preferences.md, example PRDs, setup-agent-instructions.md) | WR Admin + Stakeholders |
| Judge Invitation Email | 1.2 | judges present | Per-judge email drafts | WR Admin |
| Kickoff Deck | 1.2 | repo approved | `.pptx` | WR Admin |
| Tech-Sponsor/Press Outreach | 1.3 | repo approved | Outreach templates | WR Admin + Sponsor |
| Social Marketing | 1.3 | repo approved | IG/FB/X/Reddit post drafts | WR Admin |
| Landing Page Content | 1.3 | repo approved | Landing page content + FAQ | WR Admin |
| Submission Categorizer / LOC | 4 | submissions close | Types summary + LOC totals | Auto (Admin visible) |

- `AC:` Each agent is independently re-runnable with additional instructions.
- `AC:` Every generated asset is versioned and attributable to an `AgentRun`.
- `AC:` No secret material is ever emitted into a public repo or asset.

---

## 12. Auth, Permissions & Security `[MUST]`

**Built on Better Auth** (WR's existing auth layer), with a Drizzle adapter over the same Postgres/Neon DB.

- `AC:` WR Admin uses full authenticated accounts via Better Auth's **`admin` plugin**; role = `admin`.
- `AC:` Sponsor POC, Judge, Participant, Stakeholder authenticate via Better Auth's **`magicLink` plugin**, scoped to a specific event and role. Links are single-purpose, expiring, and revocable. (The `magic_link_tokens` table in our schema records event/role scope + hashed token for our own scoping/audit on top of Better Auth's session.)
- `AC:` Better Auth's own tables live in WR's existing auth schema; our `rogue_raise` tables reference the resulting user/session identity — no duplicate identity store.
- `AC:` Every server action authorizes by (role, event scope) derived from the Better Auth session. A Judge for Event A cannot read Event B; a Stakeholder sees only their event's portal.
- `AC:` File uploads validated (type, size) and stored private by default; only explicitly published assets are public.
- `AC:` Secrets (GitHub App keys, provider tokens, technical-sponsor creds) live in Vercel env vars, never in the DB in plaintext and never in repos.
- `AC:` PII (emails, phones) access is role-gated and audit-logged.
- `AC:` Bot protection on all public forms.

---

## 13. Design & Brand `[SHOULD]`

Reuse the **existing White Rabbit design system** verified on the live site — do not invent a new look.

- `AC:` Uses the existing WR Tailwind design tokens (`wr-olive-green`, `ink`, and siblings) and typography — **Fraunces** (serif display/headings) + **JetBrains Mono** (mono/code), with `font-sans antialiased` body. New surfaces should be visually indistinguishable from whiterabbitashland.com.
- `AC:` Tone honors the **barn-raise** ethos — "raise something that lasts," community over spectacle, Humanity + Truth.
- `AC:` Accessible (WCAG AA): color contrast, keyboard nav, form labels, focus states.
- `AC:` Fully responsive; wide content (tables, cards) scrolls within its own container, never the page body (the site already uses `overflow-x-hidden` on the shell).
- `AC:` Consistent component library (shadcn/ui, themed to WR tokens) across public, admin, judge, and portal surfaces.

---

## 14. Build Order (Milestones for Coding Agents)

Execute in order. Each milestone ends with its `AC`s green.

- **M0 — Foundation.** Next.js + Vercel + Postgres + Better Auth + Blob + email provider + design system. Data model + `Event` lifecycle enum + audit log + zod schemas. *Gate for everything else.*

  **M0 build artifacts to create (these are required deliverables, not optional):**
  - `package.json` — standalone Next.js app + scripts: `db:up`, `db:generate`, `db:migrate`, `db:push`, `db:studio`.
  - `docker-compose.yml` — local `postgres:16` (Neon-compatible) for dev.
  - `drizzle.config.ts` — Drizzle Kit config with `schemaFilter: ['rogue_raise']`, output `./drizzle`, `DATABASE_URL` credential.
  - `src/lib/rogue-raise/db/schema.ts` — the full Drizzle schema per **Appendix A** (all enums + tables under the `rogue_raise` Postgres schema + relations).
  - `src/lib/rogue-raise/db/index.ts` — DB client using the `postgres` driver + Drizzle (single `DATABASE_URL`, HMR-safe singleton).
  - `src/lib/rogue-raise/integrations/*` — thin adapter modules for email, Blob, AI Gateway, GitHub App, and Better Auth (env-driven; swappable at merge).
  - `.env.example` — every env seam: `DATABASE_URL`, `BETTER_AUTH_SECRET`/`BETTER_AUTH_URL`, `AI_GATEWAY_API_KEY` + model ids, `RESEND_API_KEY` + from-address, `BLOB_READ_WRITE_TOKEN`, GitHub App vars + `RR_GITHUB_ORG`, `RR_MAGIC_LINK_SECRET`.
  - Generated migration(s) under `./drizzle` (from `db:generate`) that apply cleanly to local Postgres via `db:migrate`.
  - `HANDOFF.md` — merge guide for WR tech staff (portability seams, env vars, `rogue_raise` schema, merge checklist).
  - Tailwind theme + design tokens vendored from WR (`wr-olive-green`, `ink`, Fraunces, JetBrains Mono) + shadcn/ui initialized.
  - `AC:` `npm run db:up && npm install && npm run db:generate && npm run db:migrate` succeeds against local Postgres with all `rogue_raise` tables created.
- **M1 — Phase 1 Part 1.** Public `/sponsor` form + `SponsorApplication`/`Event` creation + ack/alert emails + spam protection.
- **M2 — Phase 1 Part 2 (human).** Admin curation queue + approve/reject + secondary intake form (resumable) + schedule template + intake completeness tracking.
- **M3 — Agent layer core.** `AgentRun`/`GeneratedAsset` infra + durable workflow scaffold + AI Gateway wiring + review UI (approve/edit/reject).
- **M4 — Context Repo agent.** Research → repo generation → GitHub App push/PR → repo review → publish.
- **M5 — Judge email + background form** and **kickoff deck** agents.
- **M6 — Phase 1 Part 3.** Marketing/outreach/social agents + landing page content model.
- **M7 — Phase 2.** Event landing page + FAQ + participant registration + confirmation/rules email.
- **M8 — Phase 3.** Submission blast + submission form + judge scoring UI + tabulation + winner/awards declaration.
- **M9 — Phase 4.** Stakeholder portal: dashboard stats (LOC + categories agent) + submission cards + contact/download + stewardship marking.
- **M10 — Hardening.** Auth scoping tests, idempotent bulk email, accessibility, audit coverage, load-check bulk sends.

---

## 15. Non-Functional Requirements `[MUST]`

- **Resilience:** Agent jobs must be resumable; bulk email idempotent; no partial-send duplication.
- **Auditability:** Every state transition, send, and agent output is logged with actor + timestamp.
- **Data integrity:** Confirmed event schedule, criteria, and repo URL each have a single source of truth referenced everywhere.
- **Privacy:** PII minimized in generated/public assets; role-gated access; magic links expire.
- **Performance:** Landing/registration pages fast (SSR/edge cache where safe); heavy agent work off the request path.
- **Observability:** Agent runs, email deliverability, and queue depth are visible to WR Admin.

---

## 16. Open Questions (resolve with WR before/juring build)

1. **Team formation:** Are teams formed on-platform (self-serve join/create) or only captured at submission time? (Data model supports either; §7.1 currently captures at submission.)
2. **Judging = "real users too":** The public site says real users (not just judges) evaluate. Do community/user scores factor into tabulation, or are formal `JudgeScore`s the sole basis? (MVP assumes judges only.)
3. **Financial commitment handling:** Is payment collected in-platform (e.g., Stripe) or handled offline? (MVP assumes offline; store amount + status only.)
4. **Auto-posting social:** MVP drafts only. Confirm no direct IG/FB/X/Reddit publishing is required.
5. **LOC definition:** Total lines across the default branch at submission time? Additions only? Language filters? (Affects Phase 4 stat.)
6. **Repo ownership transfer:** Does the platform perform the actual GitHub ownership/transfer to the Stakeholder, or just link/download? (MVP: link + download; transfer is a `[COULD]`.)
7. **Multiple concurrent events:** Confirm the platform must support several live Rogue Raises at once (data model assumes yes).
8. ~~Mono-app vs. separate app~~ **DECIDED (§3.1):** separate standalone app now with local Postgres, handed to WR tech staff to merge later. Portability + mergeability are first-class.
9. **Neon schema/namespace:** Tables namespaced under a dedicated **`rogue_raise` schema** (decided). Still confirm with WR *at merge time* which Neon database/branch it lands in and that Drizzle owns those migrations.
10. ~~Existing auth~~ **DECIDED:** WR uses **Better Auth**. Extend it (magicLink + admin plugins, Drizzle adapter over the shared DB); no second auth system. At merge, confirm which Better Auth config/instance and how our `rogue_raise` rows reference its user identity.
11. **GitHub org + App:** Confirm the White Rabbit GitHub org name and that we can install a GitHub App with repo-create/push permissions for the repo-provisioning agent.

---

---

## Appendix A — REFERENCE: Proposed Data Schema

> **Reference only — not a build artifact.** This appendix documents a proposed
> table design so the reasoning from PRD §4–§8 is captured for the team. It is meant
> to be *reproduced* during the live build, not copied as finished code. Treat field
> lists as the intent; final column types/names are the implementer's call.

### A.1 Conventions

- **Namespace:** all tables under a dedicated Postgres schema **`rogue_raise`** so they
  drop into WR's Neon DB at merge without colliding. Plain-Postgres only (Neon-compatible).
- **ORM:** Drizzle (portable migrations), `postgres` driver (works local + Neon), single
  `DATABASE_URL`.
- **Shared columns:** every table has `id uuid PK default random`, `created_at timestamptz`;
  mutable tables add `updated_at timestamptz`.
- **Auth:** identity comes from **Better Auth** (its own tables); `rogue_raise` rows
  reference that identity rather than storing their own.

### A.2 Enumerations

| Enum | Values |
|------|--------|
| `event_status` | draft, submitted, under_review, approved, rejected, intake_pending, intake_complete, repo_generating, repo_review, repo_approved, registration_open, live, judging, completed, archived |
| `sponsor_app_status` | submitted, under_review, approved, rejected |
| `agent_run_type` | context_research_repo, judge_invitation_email, kickoff_deck, tech_sponsor_press_outreach, social_marketing, landing_page_content, submission_categorizer |
| `agent_run_status` | queued, running, paused_for_review, succeeded, failed |
| `asset_type` | research_doc, stakeholder_preferences, example_prd, setup_agent_instructions, judge_email, kickoff_deck, outreach_template, social_post, landing_page_content, faq |
| `review_status` | pending, approved, edit_requested, rejected |
| `social_platform` | instagram, facebook, x, reddit |
| `magic_link_role` | sponsor_poc, judge, participant, stakeholder |
| `stewardship_status` | unmarked, adopted, stewarded, archived |

### A.3 Tables (by phase)

**Phase 1 — Sponsors**

| Table | Key fields | Notes |
|-------|-----------|-------|
| `organizations` | name | Sponsor orgs (e.g., Jackson County Health Dept) |
| `sponsor_applications` | org_id→, poc_name/email/phone, pain_points, goals_needs, financial_commitment_{amount,note,to_discuss}, status, admin_note, submitted_at | Phase 1 Part 1 form |
| `events` | org_id→, sponsor_application_id→, slug (uq), title, topic_summary, status (`event_status`), confirmed_friday_kickoff_at, location_name/address | Lifecycle hub; confirmed schedule is single source of truth |
| `stakeholders` | event_id→, name, email, phone, can_access_portal | Steward repos in Phase 4 |
| `event_intakes` | event_id→ (uq/1:1), awards_budget_{amount,note}, supplementary_info, stakeholder_tech_stack, stakeholder_tech_tags[], completed_at | Phase 1 Part 2, resumable; required fields gate advancement |
| `date_options` | event_id→, friday_kickoff_at, is_confirmed | Required potential weekends; one confirmed |
| `criteria` | event_id→, label, description, weight?, sort_order | Drives the 1–5 judging form |
| `tech_sponsors` | event_id→, name, offering, contact_{name,email}, status | Secrets NEVER stored here |
| `attachments` | event_id→, kind, blob_url, filename, content_type, size_bytes, is_public | Metadata only; files in Blob |
| `judges` | event_id→, name, email, phone, title, bio, headshot_blob_url, expertise_tags[], intro_preference, criteria_questions, background_completed_at | Background form for kickoff intro |
| `context_repos` | event_id→ (uq/1:1), github_repo_url, default_branch, is_public, open_pr_url | Agent-provisioned repo |
| `agent_runs` | event_id→, type, status, workflow_run_id, inputs(jsonb), logs, cost_tokens, error, started/finished_at | Audit + resumability for every agent |
| `generated_assets` | event_id→, agent_run_id→, type (`asset_type`), title, body, blob_url, platform?, version, review_status, review_note | Versioned agent outputs w/ approve/edit/reject |

**Phase 2 — Registration**

| Table | Key fields | Notes |
|-------|-----------|-------|
| `participants` | event_id→, first_name, last_name, email, github_username, confirmation_sent_at | Unique (event_id, email) |

**Phase 3 — Submission & Judging**

| Table | Key fields | Notes |
|-------|-----------|-------|
| `teams` | event_id→, name | |
| `team_memberships` | team_id→, participant_id→ | Unique (team, participant) |
| `submissions` | event_id→, team_id→ (uq/1:1), team_name, project_summary, repo_url, pitch_materials_url, lines_of_code, submission_category, category_summary, stewardship | LOC/category computed in Phase 4 |
| `judge_scores` | submission_id→, judge_id→, scores(jsonb criterion→1–5), notes, final_score, is_draft, submitted_at | Unique (submission, judge); notes private per judge |
| `award_categories` | event_id→, label, description, criterion_id?, winning_submission_id?, announced_at | Different award types from different scales |

**Cross-cutting**

| Table | Key fields | Notes |
|-------|-----------|-------|
| `magic_link_tokens` | event_id→, role (`magic_link_role`), subject_id, email, token_hash (uq), expires_at, consumed_at, revoked_at | Store hash, never raw token; layers event/role scope on Better Auth |
| `audit_log` | event_id?→, actor, action, entity, from_value, to_value, metadata(jsonb) | Append-only; state transitions + sends |

### A.4 Portability seams (reproduce these during the live build)

- `rogue_raise` schema namespace → clean drop into Neon.
- One `DATABASE_URL` → local Postgres in dev, Neon at merge, no code change.
- Feature code under a single movable segment (`lib/rogue-raise/*`, `app/rogue-raise/*` + `app/admin/*`).
- External services (email, Blob, AI Gateway, GitHub App) behind thin adapters in
  `lib/rogue-raise/integrations/*`.
- WR design tokens (`wr-olive-green`, `ink`, Fraunces, JetBrains Mono) vendored into the theme.

---

*End of PRD v1.0.*
