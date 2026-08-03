<!--
metadata:
  created_at:   2026-07-27T21:35:00-07:00
  activated_at: 2026-07-27T21:35:00-07:00
  planned_at:   2026-07-27T21:40:00-07:00
  finished_at:  2026-07-27T21:38:00-07:00
  updated_at:   2026-07-27T21:38:00-07:00
-->

# Story: Agent Run Infrastructure

## Summary

AS the Rogue Raise platform
I WANT every AI agent task to be a durable, auditable, re-runnable `AgentRun` that produces versioned `GeneratedAsset`s
SO THAT no agent output ever reaches a participant unreviewed, a failed run can be resumed or re-run with more instructions, and staff can always see what an agent did, what it cost, and which output came from which run

## Acceptance Criteria

- An **agent catalog** encodes PRD §11.2 as typed definitions: agent type, the `Event.status` values that may trigger it, which asset types it produces, and whether its review gate is WR Admin alone or Admin + Stakeholders.
- Starting an agent creates an `AgentRun` row (`queued` → `running` → `succeeded` / `failed` / `paused_for_review`) with `inputs`, `logs`, `cost_tokens`, `started_at`, `finished_at`. Every status change is audit-logged.
- **Execution is gated on `Event.status`** — an agent whose trigger statuses don't include the event's current status is refused before any model call, and the refusal is recorded.
- **Every output is a `GeneratedAsset`** attributed to its `AgentRun` (`agent_run_id`) and **versioned per (event, asset type)** — a re-run produces version N+1 rather than overwriting.
- All assets land with `review_status: "pending"`. **Nothing an agent produces is ever auto-published.**
- **Runs are independently re-runnable with additional instructions.** A re-run is a new `AgentRun` that records its parent and the extra instructions in `inputs`, so the chain of attempts is legible.
- **A crashed or interrupted run is recoverable**: a run left `running` past a staleness threshold can be reclaimed and marked failed with an honest reason, and re-run — no run is silently stuck forever.
- **Model access goes through one adapter** (`integrations/ai-gateway.ts`) using `"provider/model"` strings through the Vercel AI Gateway. With no credentials it uses a clearly-labelled deterministic dev provider so the whole flow runs on a laptop; the dev provider's output is unmistakably placeholder text.
- **Token cost is recorded per run** and is queryable per event.
- **No secret material is written into an asset** — the asset writer refuses content that matches credential-shaped patterns, and the refusal fails the run loudly rather than storing it.

## Notes

- **Scope:** PRD §11 (agent execution model) — the machinery only. This is **M3a**. The review UI (approve/edit/reject) and the first real agent (context research documents) are **M3b**, the next story.
- **Schema:** no migration needed — `agent_runs` and `generated_assets` exist from M0.
- **Durable workflows:** Vercel Workflows (WDK) can't run outside Vercel, so this story ships the *seam*: a runner interface with an inline executor, plus the `AgentRun` record that makes resumption possible at all. The WDK adapter is wired when the first genuinely long agent lands (M4). This limitation is documented rather than papered over.
- **Model ids:** the current Claude models are `claude-opus-5` (authoring) and `claude-haiku-4-5` (fast tier); `.env.example` still names `claude-opus-4-8` and is corrected here.

## Implementation Plan

### Overview

Four plain modules plus one adapter. `catalog.ts` states what each agent is and when it may run. `registry.ts` maps an agent type to a handler function. `runs.ts` owns the `AgentRun` lifecycle and asset writing — the only place either table is mutated. `execute.ts` composes them: gate → create run → invoke handler → persist assets → finish, with every transition audited and every failure recorded rather than thrown away. The AI adapter mirrors the email/blob pattern: real provider when configured, honest dev provider otherwise.

### Resolved decisions

- **Handlers never touch the database.** A handler receives a context (event snapshot, inputs, an `ai` adapter, a `log()` sink) and returns assets as plain data. All persistence is in `runs.ts`, so audit/versioning/secret-scanning can't be bypassed by a handler that forgets.
- **Versioning is computed under a lock** — `MAX(version)` for (event, asset type) inside the same transaction that inserts, so two concurrent runs can't both write version 3.
- **A re-run is a new row, never an update.** The audit value of the chain outweighs tidiness; `inputs.parentRunId` + `inputs.additionalInstructions` make it readable.
- **Failure is a recorded state, not an exception.** A handler that throws produces a `failed` run carrying the error message and the logs it managed to emit — the run row is the incident report.
- **Secret scanning is a hard stop**, not a redaction: silently mangling a document is worse than refusing it, and PRD §11 makes "no secret material in an asset" absolute.
- **Dev provider output is obviously fake** (prefixed, deterministic, and it says so) so a placeholder can never be mistaken for a real draft in a review queue.

### Steps

1. **`integrations/ai-gateway.ts`** — `AiAdapter` with `generate()`; gateway provider via the AI SDK's `"provider/model"` strings; deterministic dev provider; `AI_MODELS` corrected to `claude-opus-5`.
2. **`agents/catalog.ts` (+ test)** — the PRD §11.2 table as data, with trigger statuses, produced asset types, and review gates.
3. **`agents/registry.ts`** — handler type + registration/lookup.
4. **`agents/runs.ts`** — `startRun`, `finishRun`, `failRun`, `writeAssets` (versioning + secret scan), `reclaimStaleRuns`, all transactional and audited.
5. **`agents/secrets.ts` (+ test)** — credential-shaped pattern detection.
6. **`agents/execute.ts` (+ integration test)** — the composed runner with the status gate, re-run support, and the documented WDK seam.
7. **`agents/queries.ts`** — read model: runs for an event with their assets and cost totals.
8. **Docs** — HANDOFF (AI Gateway seam + the WDK gap), `.env.example` model ids.

### Testing Strategy

Unit: catalog invariants (every agent produces at least one asset type; trigger statuses are real `event_status` values), secret detection (API keys, PEM blocks, bearer tokens, `.env` lines — plus non-matches so it isn't trivially over-eager), dev-provider determinism. Integration against real Postgres: happy run (statuses, timestamps, audit rows, asset version 1, cost recorded); re-run produces version 2 and records the parent; wrong-status refusal writes nothing; handler throw → `failed` run with the error and its logs; secret in output → run fails and no asset row; stale-run reclamation; concurrent runs don't collide on version.

### Risks

- The gateway provider can't be exercised without credentials; its shape is typechecked but unverified at runtime, and that is stated plainly rather than implied.
- The inline runner means a long agent is still bounded by the request timeout until WDK lands — acceptable while no agent is long, and the reason M4 owns it.

## Review

**Date:** 2026-07-27 · **Commit reviewed:** 52a261a · Self-review against ACs · **Status: all 9 ACs met; 1 defect found by test and fixed**

### Acceptance criteria

| # | AC | Verdict |
|---|----|---------|
| 1 | Catalog encodes PRD §11.2 with triggers, asset types, review gates | ✅ 7 agents; unit tests pin every trigger status and asset type against the real Postgres enums, so a typo becomes a build failure rather than an insert error |
| 2 | `AgentRun` row with inputs/logs/cost/timestamps; audited transitions | ✅ integration test asserts the fields and the exact audit sequence |
| 3 | Execution gated on `Event.status`, refusal recorded | ✅ handler is asserted *not called*; refusal audit row present |
| 4 | Assets attributed and versioned per (event, type) | ✅ re-run yields version 2 with a different `agent_run_id`; types version independently |
| 5 | Everything lands `pending`; nothing auto-publishes | ✅ there is no code path that sets another value at creation |
| 6 | Re-runnable with additional instructions | ✅ new run records `parentRunId` + the instructions; the first attempt survives |
| 7 | Interrupted runs recoverable | ✅ `reclaimStaleRuns` fails an abandoned run with an honest reason; an in-flight run is left alone |
| 8 | One model adapter; labelled dev provider; refused in production | ✅ asset body carries the banner; run log says which provider ran |
| 9 | Cost recorded per run and queryable per event | ✅ `totalCostForEvent` |
| 10 | No secret material in an asset | ✅ run fails, **nothing** is stored (including the innocent sibling document in the same batch), and the error never repeats the secret |

### Defect found and fixed

**The refusal audit row was being discarded.** `startRun` inserted `agent_run.refused` and then threw `AgentNotTriggerableError` — from *inside* the transaction, so the rollback took the audit row with it. The AC and the code comment both claimed the refusal was recorded; it wasn't. The integration test asserting the audit sequence caught it. The row is now written after the commit — the same "audit outside the failed transaction" shape as email-after-commit in the sponsor actions.

### Deliberate limitations, stated plainly

- **Not durable yet.** The runner is inline; a long agent is bounded by the request timeout until WDK is wired (M4 owns it). The `AgentRun` record is what makes durability *possible* later, and reclamation is what makes the gap survivable now.
- **The gateway provider has never run against a live key.** It typechecks against the AI SDK; that is all that can honestly be claimed. HANDOFF carries a smoke-test checklist item.
- **No UI yet** — runs and assets are invisible to staff until M3b.

## Learnings

**What went well**

- Putting *all* persistence in `runs.ts` and giving handlers a data-only contract makes the hard guarantees structural. "Every asset is versioned and attributable" isn't a rule contributors must remember; there is no other way to write an asset.
- Encoding the PRD table as data and then testing it against the Postgres enums turned a whole class of future runtime failure into a build failure. Cheap, and it will keep paying as agents are added.
- Writing the secret scanner's *negative* cases first — a realistic setup document full of the word "key" — shaped the patterns far better than the positive cases did. A scanner that fires on prose about credentials would make the documents these agents exist to write impossible.
- Failing the whole asset batch on one bad document, and asserting that in a test, is the right default: a partially-stored agent output is worse than none.

**What was surprising**

- **An audit row written inside a transaction that throws does not exist.** Obvious once stated, and I had already learned the equivalent lesson for emails in story 1 — but the "record the refusal" pattern *looks* different enough from "send after commit" that it didn't transfer. The rule generalizes: anything whose purpose is to survive a failure must not be inside the thing that fails.
- The AI SDK's bare `"provider/model"` string genuinely is the whole gateway integration — no client construction, no provider import. The seam ended up smaller than the dev provider it sits beside.

**Do differently next time**

- When a test asserts an exact audit sequence, write it *before* the code — it caught the one real bug here, and it would have caught it a step earlier.
- Carry-forwards for **M3b (review UI + first real agent)**: the console needs a runs-and-assets read model (`agents/queries.ts`, deliberately not built yet); approve/edit/reject writes `generated_assets.review_status` + `review_note` and must audit; the `admin_and_stakeholders` gate has no stakeholder-facing surface yet, so M3b should either build it or narrow to admin-only and say so.
- The `paused_for_review` run status is modelled but unused — it's for the durable-workflow case. It should stay unused until WDK lands rather than being repurposed for asset review, which is a different thing entirely.
