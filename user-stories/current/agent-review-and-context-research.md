<!--
metadata:
  created_at:   2026-07-27T21:45:00-07:00
  activated_at: 2026-07-27T21:45:00-07:00
  planned_at:   2026-07-27T21:50:00-07:00
  finished_at:
  updated_at:   2026-07-27T21:50:00-07:00
-->

# Story: Agent Review Gate & Context Research Agent

## Summary

AS a WR Admin
I WANT to run the context-research agent and then approve, edit, or reject everything it drafted
SO THAT the starter repo is written for me instead of by me, and nothing reaches a participant that a human hasn't read

## Acceptance Criteria

- `/admin/events/[id]/agents` lists every agent from the catalog with its phase, review gate, and whether it can run **right now** given the event's status — an agent that can't run says why rather than offering a dead button.
- Admin can **run** an agent from that page, and **re-run** it with additional instructions. A re-run is visibly a new attempt, not a replacement.
- Each run shows its status, when it ran, its token cost, its logs, and — when it failed — the error, in staff language.
- Every generated asset is listed by type with its **version**, its review status, and which run produced it. Older versions remain reachable.
- An asset opens to a full view of its content with three decisions: **Approve**, **Request edits** (with a note, which is what a re-run then acts on), and **Reject** (with a note). Every decision is audit-logged with from→to.
- Admin can **edit an asset's text and approve the edit in one step**. The edit is stored as a **new version attributed to no agent run** — the agent's original is never overwritten, so the diff between what the agent wrote and what a human shipped stays legible.
- The **context-research agent is implemented** (PRD §5.3.1's document half): from the intake it drafts `research_doc`, `stakeholder_preferences`, `example_prd`, and `setup_agent_instructions`, grounded in the sponsor's actual pain points, goals, tech stack, and supporting context.
- The agent **documents technical-sponsor offerings as instructions and never as credentials**, and the run fails loudly if it ever emits credential material.
- Views are brand-themed, responsive, accessible, and behind the existing `/admin` env gate.

## Notes

- **Scope:** completes **M3**. PRD §5.3.1's *repo provisioning* (GitHub App, push, PR) is **M4** — this story produces the documents that M4 pushes.
- **Review gate reality:** the catalog marks context research as `admin_and_stakeholders`, but there is no stakeholder-facing surface until Phase 4. This story implements the **admin half only** and says so on the page rather than implying stakeholders have signed off.
- **Deliberately not built:** the `paused_for_review` run status stays unused — it belongs to the durable-workflow case, not to asset review.

## Implementation Plan

### Overview

Three additions on top of M3a's machinery. `agents/queries.ts` is the read model (runs with their assets, newest first, plus per-event cost). `agents/handlers/context-research.ts` is the first real handler — it reads the intake through the existing intake query module, builds one prompt per document, and returns drafts. `agents/review-actions.ts` holds the privileged writes: run, re-run, review, and edit-and-approve. Two routes render it.

### Resolved decisions

- **An edit is a new version, never an update.** Overwriting the agent's text would destroy the only record of what the agent actually produced — which is the thing a reviewer is accountable for having changed. The human version carries `agent_run_id = null`, which is what distinguishes it.
- **"Request edits" is the input to a re-run.** The note is stored on the asset and pre-fills the re-run's additional instructions, so the loop is: reject with a reason → re-run with that reason → new version.
- **Reviewing an old version is refused** — only the latest version of a type is actionable, so an approval can't be attached to superseded text.
- **The handler builds one prompt per document** rather than one prompt asking for four, so a single bad document can be re-run without disturbing the other three.
- **The handler never sees credentials** — it is given the technical-sponsor *offering description* only, and the writer's secret scan is the backstop.

### Steps

1. **`agents/queries.ts`** — `listAgentRuns(eventId)`, `listAssets(eventId)` (latest per type + full history), `loadAsset(id)`.
2. **`agents/handlers/context-research.ts`** — the four-document handler + its prompt builders (pure, so the prompts are testable without a model).
3. **`agents/handlers/index.ts`** — registration module, imported for its side effect by the actions module.
4. **`agents/review-actions.ts`** — `"use server"`: `runAgentAction`, `rerunAgentAction`, `reviewAssetAction`, `editAndApproveAssetAction`; all audited, all status-gated.
5. **Routes** — `/admin/events/[id]/agents` (+ loading), `/admin/events/[id]/assets/[assetId]` (+ loading), two client islands.
6. **Wire-up** — link from the event page; note the stakeholder-gate gap on the page itself.

### Testing Strategy

Unit: prompt builders (include the intake's actual content; omit sections that are absent; never include credential-shaped input). Integration: run → four pending assets at version 1; approve → status + audit; request-edits note pre-fills a re-run; edit-and-approve creates version 2 with a null run id and leaves version 1 intact; reviewing a superseded version is refused; reviewing across events is refused.

### Risks

- The handler's output quality can't be judged with the dev provider — only its structure. Stated rather than implied.
- `admin_and_stakeholders` is half-implemented by design; if it ships without the stakeholder half being obvious, an admin could believe stakeholders approved something they never saw.
