<!--
metadata:
  created_at:   2026-07-27T21:35:00-07:00
  activated_at: 2026-07-27T21:35:00-07:00
  planned_at:   2026-07-27T21:40:00-07:00
  finished_at:
  updated_at:   2026-07-27T21:40:00-07:00
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
