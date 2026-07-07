# Rogue Raise — Agent System PRD (Companion to `PRD.md`)

**Owner:** White Rabbit (Ashland, OR)
**Document type:** Implementation-ready PRD for the AI agent layer
**Version:** 1.0
**Last updated:** 2026-07-06
**Companion to:** `PRD.md` (the platform PRD). This document expands **PRD §11** into a full specification. Where the two overlap, `PRD.md` governs data model and lifecycle; this document governs agent behavior.

---

## 0. Purpose & How to Read

The whole reason this platform exists (see `PRD.md` §1.3.1) is that **White Rabbit is a small team whose core gift is running AI agents well.** The agents are not a feature — they are the labor force. This PRD specifies each agent as a buildable unit: trigger, inputs, tools, model, steps, outputs, guardrails, review gate, and acceptance criteria.

Conventions match the main PRD: `[MUST]` / `[SHOULD]` / `[COULD]`, `AC:` acceptance criteria. Agents are referenced as **`A#`** (e.g., `A1`). Every agent writes to the `agent_runs` + `generated_assets` tables defined in `PRD.md` Appendix A.

**Golden rule for every agent:** *Draft, don't decide.* No agent output reaches a participant, judge, sponsor, or the public without a human **Approve / Edit / Reject** gate. Agents remove the blank page and the busywork; humans keep authorship.

---

## 1. Agent Design Principles

1. **Human-in-the-loop by default.** Every externally-visible artifact pauses at `paused_for_review` until a WR Admin (and, where noted, a Stakeholder) approves. Reject/Edit re-runs the agent with the feedback appended as instructions.
2. **Durable over fast.** Multi-step agents (research → write → commit) run as **Vercel Workflow (WDK)** durable workflows so they survive the function timeout, can pause for review, and resume without losing work. Never rely on a single long function call.
3. **Idempotent & resumable.** Re-running an agent must not duplicate side effects (no double repo, no double email). Side effects are keyed on `(event_id, agent_type, target)`.
4. **Every run is auditable.** One `agent_runs` row per invocation with inputs, logs, token cost, and status. Every output asset links back to its run and carries a `version`.
5. **Secrets never leak.** No agent may emit credentials, tokens, or API keys into a public repo, asset, or email. Technical-sponsor credentials are described as *instructions to obtain*, never inlined.
6. **Cite or don't claim.** Research agents must attach reachable source URLs to factual claims; unverifiable claims are dropped or flagged, not asserted.
7. **On-brand.** Outward-facing copy follows White Rabbit voice — barn-raise ethos, community over spectacle, Humanity + Truth (see `PRD.md` §13).
8. **Cheap by default, powerful when needed.** Classification/summarization use a fast model; authoring/research use the strongest model (see §2.3).

---

## 2. Shared Agent Architecture

### 2.1 Execution Model `[MUST]`

- Every agent task = one **`agent_runs`** row (`type`, `status`, `workflow_run_id`, `inputs`, `logs`, `cost_tokens`, timestamps). States: `queued → running → (paused_for_review) → succeeded | failed`.
- Orchestrated with **Vercel Workflow (WDK)**: each logical step is a durable step that checkpoints. A `paused_for_review` step blocks on a human decision recorded in the review UI, then resumes.
- Triggered by: (a) a lifecycle transition on `events.status` (auto), or (b) an explicit WR Admin "Run"/"Re-run" action in the admin console.
- `AC:` Killing/redeploying mid-run does not lose completed steps; the workflow resumes from the last checkpoint.
- `AC:` A re-run with reviewer feedback produces a **new** `generated_assets.version`, preserving prior versions.

### 2.2 Tool & Skill Inventory `[MUST]`

Agents are granted only the tools they need (least privilege). Tools are implemented as adapter modules under `lib/rogue-raise/integrations/*`.

| Tool | Used by | Capability |
|------|---------|-----------|
| `web.search` / `web.fetch` | A1 | Query the web, fetch + read pages for research |
| `url.verify` | A1 | HEAD/GET check that a citation URL is reachable (2xx) |
| `github.app` | A2, A8 | Create repo, commit files, open PR, read repo stats (LOC/languages) |
| `blob.write` | A2, A4, all | Store generated binaries/docs (e.g., `.pptx`) |
| `email.draft` / `email.send` | A3, A5, A6 | Produce a draft asset; send only after human approval |
| `pptx.generate` | A4 | Render a themed deck to `.pptx` |
| `db.read` (scoped) | all | Read the event's intake, criteria, judges, submissions |
| `asset.write` | all | Persist a `generated_assets` row (+ optional Blob) |

- `AC:` No agent has `email.send` power without a preceding approved review gate.
- `AC:` `github.app` writes to public repos only after the repo-review approval (`PRD.md` §5.3.2).

### 2.3 Model Selection `[MUST]`

Via **Vercel AI Gateway** using `"provider/model"` strings. Configure per-role env vars (`RR_AUTHOR_MODEL`, `RR_FAST_MODEL`) with fallbacks.

| Role | Default | Used for |
|------|---------|----------|
| Author/Research | latest most-capable Claude (e.g. `anthropic/claude-opus-4-8`) | A1, A3, A4, A5, A6, A7 |
| Fast/Classify | fast Claude tier (e.g. `anthropic/claude-haiku-4-5-20251001`) | A8 categorization, short summaries, tagging |

- `AC:` Model ids are configurable via env; no model id is hard-coded in agent logic.

### 2.4 Human Review Gates `[MUST]`

- Each `generated_assets` row has `review_status ∈ {pending, approved, edit_requested, rejected}` and a `review_note`.
- The admin console (`PRD.md` §9) renders every pending asset with inline edit + Approve / Request-Edit / Reject.
- **Approve** → asset becomes usable (email sends, repo publishes, page goes live).
- **Request-Edit / Reject** → captures the note, spawns a re-run passing the note as additional instruction, increments `version`.
- `AC:` Repo content review (A2) additionally routes to **Stakeholders** for feedback, not just WR Admin (`PRD.md` §5.3.2).

### 2.5 Guardrails `[MUST]`

- **Secret scanning:** before any `github.app` commit or public asset publish, scan content for secret patterns (API keys, tokens, private keys); block on hit.
- **Citation integrity (A1):** every factual claim carries ≥1 `url.verify`-passing source; drop/flag the rest.
- **PII minimization:** generated public assets must not include participant/stakeholder personal contact info unless explicitly required by that asset's spec.
- **Brand voice check:** outward-facing copy passes a lightweight brand-voice review step before hitting the human gate.
- **Prompt-injection resistance:** research agents treat fetched web content as untrusted data, never as instructions.

### 2.6 Observability, Cost & Limits `[SHOULD]`

- `AC:` Admin console shows per-run status, step logs, token cost, and duration.
- `AC:` Per-event agent spend is summed and visible; a soft budget alert fires past a configurable threshold.
- `AC:` Web-research and GitHub calls are rate-limited and retried with backoff.

### 2.7 Prompt Structure Convention `[SHOULD]`

Every agent prompt is assembled from: (1) a **role/system** block (who the agent is, the golden rule, brand voice), (2) a **task** block (this agent's job + output contract), (3) a **context** block (structured event data from `db.read`), (4) **constraints/guardrails**, (5) **output schema** (the agent must return structured output validated before persisting). Fetched/untrusted content is fenced and labeled as data.

---

## 3. Agent Catalog (Detailed)

> Legend — **Trigger:** what starts it. **Reviewer:** who gates the output. **Outputs:** `generated_assets.type` (+ side effects). Each agent lists workflow steps and acceptance criteria.

### A1 — Context Research Agent `[MUST]`

- **Phase / ref:** 1, part of `PRD.md` §5.3.1.
- **Trigger:** `events.status = intake_complete`, or Admin "Run research."
- **Reviewer:** WR Admin + Stakeholders (as part of repo review, A2).
- **Inputs:** `sponsor_applications.pain_points/goals_needs`, `event_intakes.supplementary_info` + attachments, `stakeholder_tech_stack`, event topic. (Worked example: Rogue Valley homelessness data infrastructure — dedup, PIT counts, syndromic surveillance.)
- **Tools:** `web.search`, `web.fetch`, `url.verify`, `db.read`, `asset.write`.
- **Model:** Author/Research.
- **Workflow steps:**
  1. Derive a research plan (sub-questions) from pain points + goals.
  2. **Fan out** parallel searches per sub-question (multi-agent pattern §4.2); fetch + read top sources.
  3. Verify every candidate citation with `url.verify`; discard unreachable ones.
  4. Synthesize into structured research docs **with inline citations**.
  5. Reformat supplementary info/data into participant-friendly context.
  6. Emit assets (not yet committed): `research_doc`(s), a `stakeholder_preferences` doc, and `context/` material.
- **Outputs:** `generated_assets` of type `research_doc`, `stakeholder_preferences`, plus context files (handed to A2 for commit).
- **Guardrails:** citation integrity; treat fetched pages as untrusted; no secrets.
- `AC:` Each research doc's factual claims carry reachable citations.
- `AC:` `stakeholder_preferences` translates the sponsor's tech stack into concrete "build-toward" parameters participants can target.
- `AC:` Output is coherent enough that a newcomer could start building without further research (the "first 24 hours for building, not researching" test).

### A2 — Repo Provisioning Agent `[MUST]`

- **Phase / ref:** 1, `PRD.md` §5.3.1–§5.3.2.
- **Trigger:** A1 assets ready (chained), or Admin "Provision repo."
- **Reviewer:** WR Admin + Stakeholders (per-file Approve/Edit/Reject).
- **Inputs:** A1 outputs + event metadata + confirmed schedule.
- **Tools:** `github.app`, `blob.write`, `db.read`, `asset.write`.
- **Model:** Author (for READMEs, example PRDs, setup instructions).
- **Workflow steps:**
  1. Assemble the repo file tree:
     - `README.md` — problem statement, schedule, location, links.
     - `research/` — A1 research docs with citations.
     - `stakeholder-preferences.md` — standalone build-toward parameters.
     - `context/` — reformatted supplementary data.
     - `prds/` — **≥2 example PRDs** of varying ambition (onboard first-time hackathon participants).
     - `setup-agent-instructions.md` — instructions for an agent to stand up a **public** project repo.
     - `tools/` — how to obtain technical-sponsor creds (never the creds themselves).
  2. **Secret-scan** all content (guardrail §2.5).
  3. Create the event repo in the WR GitHub org (private during review), push to a branch, open a PR.
  4. Record `context_repos` row; set `events.status → repo_review`.
  5. **Pause for review** (A2 gate). On approval: make repo public, `events.status → repo_approved`.
- **Outputs:** GitHub repo + PR; `generated_assets` of type `example_prd`, `setup_agent_instructions`; `context_repos` row.
- **Guardrails:** secret scan blocks commit; repo stays private until approved; idempotent (no duplicate repo on re-run — reuse existing `context_repos.github_repo_url`).
- `AC:` Repo contains README, `research/`, `stakeholder-preferences.md`, `prds/` (≥2), `setup-agent-instructions.md`.
- `AC:` No secrets committed.
- `AC:` Reviewer Edit/Reject on a file re-runs A2 (or A1) with the note and re-opens the PR.
- `AC:` Repo is public only after approval.

### A3 — Judge Invitation Email Agent `[MUST]`

- **Phase / ref:** 1, `PRD.md` §5.3.3–§5.3.4.
- **Trigger:** judges present on the event + Admin "Draft judge emails."
- **Reviewer:** WR Admin (before send).
- **Inputs:** `judges` (name/email), confirmed schedule, `criteria`, expectations text, background-form link per judge.
- **Tools:** `db.read`, `email.draft`, `email.send` (post-approval), `asset.write`.
- **Model:** Author.
- **Workflow steps:**
  1. For each judge, draft a personalized email containing: link to the **Judge Background Form**, full **schedule of events**, **expectations of judges**, the **evaluative criteria**, and a clear CTA to **ask questions about the criteria** (reply-to or thread link).
  2. Emit one `judge_email` asset per judge; pause for review.
  3. On approval, `email.send` per judge; log delivery status; record send in `audit_log`.
- **Outputs:** `generated_assets` type `judge_email` (one per judge); sent emails.
- **Guardrails:** no send before approval; idempotent (don't re-send to an already-emailed judge unless forced).
- `AC:` Each email includes background-form link + schedule + expectations + criteria + ask-questions CTA.
- `AC:` Send is per-judge, tracked, and non-duplicating.

### A4 — Kickoff Deck Agent `[SHOULD]`

- **Phase / ref:** 1, `PRD.md` §5.3.5.
- **Trigger:** `events.status = repo_approved`, or Admin "Generate kickoff deck."
- **Reviewer:** WR Admin.
- **Inputs:** event topic, sponsor org + pain/need, opportunities, `criteria`, `judges` (background-form bios/intro prefs), confirmed schedule, location.
- **Tools:** `db.read`, `pptx.generate`, `blob.write`, `asset.write`.
- **Model:** Author (narrative), then render.
- **Workflow steps:**
  1. Draft the slide outline: title, the problem/topic, sponsor intro(s), sponsor pain/need, opportunities, evaluative criteria, judges (from background data), schedule, location/logistics.
  2. Render a WR-brand-themed `.pptx`; store in Blob.
  3. Emit `kickoff_deck` asset; pause for review; regenerate on request.
- **Outputs:** `generated_assets` type `kickoff_deck` (Blob `.pptx`).
- `AC:` Deck covers topic, sponsors, pain/need, opportunities, judges, criteria, schedule.
- `AC:` Downloadable + regenerable by Admin; brand-themed.

### A5 — Technical-Sponsor & Press Outreach Agent `[SHOULD]`

- **Phase / ref:** 1 Part 3, `PRD.md` §5.4.1.
- **Trigger:** `repo_approved`, or Admin action.
- **Reviewer:** WR Admin + Sponsor.
- **Inputs:** event context, `tech_sponsors` targets, goals/needs, press-angle from research.
- **Tools:** `db.read`, `email.draft`, `asset.write`.
- **Model:** Author.
- **Workflow steps:** draft per-recipient-type templates (technical sponsor ask; local press pitch) with merge fields; emit assets; pause for review; export on approval (no auto-send in MVP).
- **Outputs:** `generated_assets` type `outreach_template` (tech-sponsor + press variants).
- `AC:` Distinct, editable templates for WR **and** the Sponsor to send; merge fields present; no auto-send.

### A6 — Social Marketing Agent `[SHOULD]`

- **Phase / ref:** 1 Part 3, `PRD.md` §5.4.2. **Distinct agent** from A5.
- **Trigger:** `repo_approved`, or Admin action.
- **Reviewer:** WR Admin.
- **Inputs:** event topic, date/location, landing-page URL, brand voice.
- **Tools:** `db.read`, `asset.write`.
- **Model:** Author.
- **Workflow steps:** draft platform-appropriate posts for **Instagram, Facebook, X (Twitter), and Reddit (/r/ashland)** — correct length/tone/hashtags per platform — plus a suggested posting cadence. Emit one `social_post` asset per platform (`generated_assets.platform`); pause for review. **No auto-posting in MVP** (manual copy-out).
- **Outputs:** `generated_assets` type `social_post` (per platform).
- `AC:` One tailored draft per platform (IG/FB/X/Reddit) + cadence suggestion; requires approval; no auto-post.

### A7 — Landing Page & FAQ Content Agent `[SHOULD]`

- **Phase / ref:** 1 Part 3 → feeds Phase 2, `PRD.md` §5.4.3 + §6.1.
- **Trigger:** `repo_approved`, or Admin action.
- **Reviewer:** WR Admin.
- **Inputs:** event topic/description, confirmed date/time, location, rules, common questions.
- **Tools:** `db.read`, `asset.write`.
- **Model:** Author.
- **Workflow steps:** generate the event landing-page copy + an **event FAQ**; emit `landing_page_content` and `faq` assets; pause for review. The page route (`/events/[slug]`) renders from these approved assets.
- **Outputs:** `generated_assets` type `landing_page_content`, `faq`.
- `AC:` Produces landing copy + FAQ that populate the real landing page after approval.

### A8 — Submission Categorizer & LOC Agent `[MUST]`

- **Phase / ref:** 4, `PRD.md` §8.1.
- **Trigger:** submission window closes (Cron/Admin).
- **Reviewer:** Auto (Admin-visible; no external exposure).
- **Inputs:** all `submissions` for the event (repo URLs).
- **Tools:** `github.app` (read repo stats/languages), `db.read`, `asset.write`, `db.write` (stats).
- **Model:** Fast/Classify.
- **Workflow steps:**
  1. For each submission repo: compute **lines of code** (per the agreed LOC definition — see Open Questions) and language/type breakdown via `github.app`.
  2. Summarize each project's **type/category**; write `submissions.lines_of_code`, `submission_category`, `category_summary`.
  3. Produce an event-level **"types of submissions" summary** for the Stakeholder dashboard.
- **Outputs:** per-submission stats + an event summary asset; powers Phase 4 dashboard.
- **Guardrails:** read-only on participant repos; graceful handling of private/unreachable repos (flag, don't crash).
- `AC:` Dashboard stats (submission count, total LOC, type summary) compute from real repos.
- `AC:` Unreachable/invalid repos are flagged, not fatal.

### A9 — Criteria Q&A Assistant `[COULD]`

- **Phase / ref:** 1, supports `PRD.md` §5.3.3 ("ask questions about the criteria").
- **Trigger:** a judge submits a question via the background form/thread.
- **Reviewer:** WR Admin (agent **drafts** a suggested reply; Admin/Sponsor sends).
- **Inputs:** the judge's question, `criteria`, event context.
- **Tools:** `db.read`, `email.draft`, `asset.write`.
- **Model:** Author.
- `AC:` Drafts a suggested answer grounded only in the event's criteria/context; routes to WR Admin + Sponsor for approval before reply. Never auto-answers.

---

## 4. Orchestration & Multi-Agent Patterns

### 4.1 Sequencing `[MUST]`

The Phase 1 agent pipeline chains along the event lifecycle, each with a gate:

```
intake_complete
   └─ A1 Context Research ──► A2 Repo Provisioning ──►[repo_review gate: Admin + Stakeholders]──► repo_approved
                                                                                                     ├─ A4 Kickoff Deck
A3 Judge Emails (when judges present, independent) ──►[Admin gate]──► sent                            ├─ A5 Outreach
                                                                                                     ├─ A6 Social
submission_close ──► A8 Categorizer/LOC ──► Phase 4 dashboard                                         └─ A7 Landing/FAQ
```

- `AC:` A2 never runs before A1 assets exist; A4–A7 never run before `repo_approved`.
- `AC:` A3 can run independently once judges are entered (does not block on the repo).

### 4.2 Fan-out / Verify Patterns `[SHOULD]`

- **Research fan-out (A1):** decompose into sub-questions, run parallel search sub-agents, then a synthesis step. Improves coverage over a single pass.
- **Citation verify:** a dedicated verify step re-checks each claim's source reachability before synthesis is accepted.
- **Completeness check (A1/A2):** a final critic step asks "what context is missing that a builder would need?" and, if material, triggers one more research round.

### 4.3 Idempotency Keys `[MUST]`

| Agent | Idempotency key | On re-run |
|-------|-----------------|-----------|
| A2 repo | `context_repos.github_repo_url` per event | reuse repo, new branch/PR |
| A3 email | `(judge_id, event_id)` sent flag | skip already-sent unless forced |
| A8 stats | `submission_id` | overwrite stats, no dupes |

---

## 5. Data Model Touchpoints

Agents rely on tables already defined in `PRD.md` Appendix A:

- **`agent_runs`** — one row per invocation (audit + resumability).
- **`generated_assets`** — versioned outputs with `review_status` gate.
- **`context_repos`** — repo link/state (A2 idempotency).
- **`audit_log`** — every send + state transition.

No new tables are required for MVP. `[COULD]` add an `agent_review_comments` table if per-file threaded review on A2 outgrows `review_note`.

---

## 6. Non-Functional Requirements (Agents)

- **Resilience:** all multi-step agents resumable (WDK); no lost work on redeploy.
- **Idempotency:** no duplicate repos, emails, or stat rows.
- **Latency expectations:** A1/A2 are minutes-scale (async, off the request path); A8 batch after submission close; A3 draft in seconds. None block a user-facing request.
- **Cost control:** fast model for classify/summarize; per-event spend visible with budget alert.
- **Safety:** secret scanning, citation verification, prompt-injection isolation, PII minimization — all enforced before any external exposure.
- **Auditability:** every run + asset + send attributable and versioned.

---

## 7. Open Questions (Agent-Specific)

1. **LOC definition (blocks A8):** total lines on default branch at submission time? additions only? language filters? exclude vendored/generated? (Same as `PRD.md` §16 #5 — must resolve for A8.)
2. **Auto-send vs. draft-only:** confirmed MVP = draft-only for A5/A6 (no posting/sending without a human). Any exceptions (e.g., judge emails A3 auto-send after approval)? Current spec: A3 sends after approval; A5/A6 export only.
3. **Research depth budget (A1):** how many sub-questions / sources / verify rounds per event before diminishing returns? Set a default (e.g., 6–10 sub-questions, 2 completeness rounds) and tune.
4. **Repo hosting org (blocks A2):** confirm the WR GitHub org + GitHub App install with repo-create/push (same as `PRD.md` §16 #11).
5. **Stakeholder review reach (A2):** do all Stakeholders review repo content, or a designated lead? Affects the gate's approval rule (any-one vs. all).
6. **Deck tooling (A4):** generate `.pptx` directly, or Markdown → deck via a converter? Affects fidelity vs. editability.
7. ~~Brand voice source~~ **DECIDED:** derive White Rabbit voice from the existing site copy. See `brand/BRAND_VOICE.md` (the derived guide) — outward-facing agents (A5–A7, and any participant/judge-facing copy) load it as the voice reference.

---

*End of Agent System PRD v1.0. Read alongside `PRD.md`.*
