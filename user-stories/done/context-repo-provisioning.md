<!--
metadata:
  created_at:   2026-07-27T21:55:00-07:00
  activated_at: 2026-07-27T21:55:00-07:00
  planned_at:   2026-07-27T22:00:00-07:00
  finished_at:  2026-07-27T21:58:00-07:00
  updated_at:   2026-07-27T22:00:00-07:00
-->

# Story: Context Repo Provisioning

## Summary

AS a WR Admin
I WANT the approved documents turned into a real GitHub repository with a pull request
SO THAT participants arrive to a repo full of context instead of an empty folder, and the first 24 hours go to building

## Acceptance Criteria

- The **GitHub seam is implemented**: a GitHub App (never a PAT) authenticates as an installation, creates a repo in the WR org, commits files, opens a PR, and can change repo visibility. With no credentials a **local dev provider** writes the same file tree to disk so the whole flow is runnable and testable on a laptop; production refuses the dev provider.
- Provisioning assembles the PRD §5.3.1 file set from the approved assets and the intake: `README.md`, `research/`, `stakeholder-preferences.md`, `context/`, `prds/` (**≥2 example PRDs**), `setup-agent-instructions.md`, and `tools/`.
- **Only approved assets are pushed.** An asset still pending, sent back, or rejected blocks provisioning with a message naming what needs a decision. Superseded versions are never pushed.
- **No secret is ever committed.** Every file is scanned before the push, and a hit aborts the whole provisioning rather than pushing a partial tree.
- A **`ContextRepo` record** links the event to the repo URL and default branch, records the open PR, and tracks whether the repo is public.
- The repo is **created private**; it is made public only at the review-approval step (the next story).
- `Event.status` moves `repo_generating` → `repo_review`, each transition audit-logged, and a failure returns the event to its previous status rather than stranding it in `repo_generating`.
- Provisioning is **idempotent per event**: a second attempt against an event that already has a repo updates that repo rather than creating a duplicate.
- The console shows the repo, the PR, and what still blocks provisioning.

## Notes

- **Scope:** the provisioning half of PRD §5.3.1. The **repo review** surface (§5.3.2 — per-file approve/edit/reject, make public, `repo_approved`) is the next story.
- **Not an `AgentRun`:** provisioning makes no model call. It is deterministic assembly and I/O, so it is an audited service invoked by an admin action rather than a fake agent run. The documents it pushes are the agent's output and stay attributed to their runs.
- **Citation checking** (PRD §5.3.1 `AC:` "verifiable, reachable citations") needs live web research, which the dev provider can't produce. Deferred with the research agent's quality verification, and called out rather than silently skipped.

## Implementation Plan

### Overview

Three modules. `integrations/github.ts` grows a real App-authenticated provider (JWT → installation token → REST) beside a local-disk dev provider, selected from the environment like every other seam. `repo/file-set.ts` is pure: approved assets plus the intake in, a `path → content` map out — which makes the whole PRD §5.3.1 tree assertable in unit tests with no network. `repo/provision.ts` composes them under the status gate, with the secret scan as a hard stop and the `ContextRepo` record as the result.

### Resolved decisions

- **Assemble from approved assets only**, read at their latest version. Pushing a pending draft would defeat the review gate that M3b exists to enforce.
- **Scan every file, abort the whole push.** A partial tree in a repo that participants will read is worse than no tree.
- **Create private, publish later.** PRD §5.3.1 says public at event time, private during review, and the visibility flip belongs to the approval step.
- **Split the example-PRD document into `prds/NN-slug.md` on its top-level headings**, and ask the agent for two or three of varying ambition. The alternative — several `example_prd` assets — would make genuinely different PRDs look like revisions of each other under per-type versioning.
- **Idempotent by event**: `context_repos.event_id` is unique, so a re-provision updates the existing repo's files rather than creating a second one.
- **Status restored on failure.** Leaving an event in `repo_generating` after a crash would be the same "stuck forever" problem the agent runs already solve.

### Steps

1. **`integrations/github.ts`** — App JWT (RS256), installation token exchange, `createRepo`, `putFiles`, `openPullRequest`, `setVisibility`; local dev provider writing to `RR_LOCAL_GITHUB_DIR`; production refuses dev.
2. **`repo/file-set.ts` (+ test)** — pure assembly of the §5.3.1 tree, including PRD splitting and the README.
3. **`repo/provision.ts` (+ integration test)** — gate, assemble, scan, push, record, transition, audit.
4. **`repo/admin-actions.ts`** — the `"use server"` action.
5. **Prompt tweak** — ask the example-PRD document for ≥2 PRDs of varying ambition under `##` headings.
6. **UI** — a provisioning card on the agents page showing blockers, the repo, and the PR.
7. **Docs** — HANDOFF: GitHub App setup, the dev provider, and the citation-check gap.

### Testing Strategy

Unit: file-set assembly (every required path present; PRD splitting produces ≥2 files; absent intake sections omitted rather than empty; no file contains credential material). Integration: provisioning blocked while an asset is unapproved, and the message names it; happy path writes every file, records the `ContextRepo`, opens a PR, and moves the status; a secret anywhere aborts with nothing pushed; a second run updates rather than duplicating; a push failure restores the previous status.

### Risks

- **The real GitHub provider cannot be verified without App credentials.** Its shape follows the documented REST API and it is typechecked, but every test exercises the dev provider. Stated in HANDOFF, not implied away.
- Citation checking is not implemented; the PRD asks for it and this story does not deliver it.

## Review

**Date:** 2026-07-27 · **Commit reviewed:** cc754f6 · Self-review against ACs + browser verification · **Status: all 9 ACs met; 1 defect found and fixed**

### Acceptance criteria

| # | AC | Verdict |
|---|----|---------|
| 1 | GitHub App seam implemented; local dev provider; production refuses dev | ✅ App path typechecked (unverified against real credentials — stated); local provider exercised by every test and in the browser |
| 2 | PRD §5.3.1 file set assembled | ✅ 14 files written and inspected on disk |
| 3 | Only approved assets pushed; blockers named | ✅ integration test + the console lists blockers before offering the button |
| 4 | No secret committed; a hit aborts the whole push | ✅ test asserts nothing is written and the message never repeats the secret |
| 5 | `ContextRepo` record with URL, branch, PR, visibility | ✅ |
| 6 | Created private | ✅ |
| 7 | `repo_generating` → `repo_review`, audited; failure restores status | ✅ audit rows verified; the restore path is exercised by the secret test |
| 8 | Idempotent per event | ✅ second run updates, one row |
| 9 | Console shows repo, PR, and blockers | ✅ browser |

### Defect found and fixed

**The PRD splitter shredded any document with `##` headings.** It treated every top-level heading as a PRD boundary, so a document whose headings were ordinary sections became one file per section — visible immediately in the browser as seven nonsense files (`01-instructions-given.md`, `02-context-the-agent-supplied.md`, …). It now splits only on an explicit `## PRD: <name>` marker that the prompt asks for, and keeps anything unmarked as a single file. A regression test pins the shredding case.

The unit tests had missed it because every fixture *was* a well-formed PRD document. The browser ran it against real agent output, which wasn't.

### Known gaps (deliberate)

- **The App provider has never authenticated for real.** Its shape follows the documented REST API; every test uses the local provider. HANDOFF carries a smoke-test item and the App-permission list.
- **No citation checking.** PRD §5.3.1 asks for research documents with verifiable, reachable citations. The research agent does no web research yet, so there is nothing to check — deferred with the real AI provider and written into HANDOFF rather than quietly skipped.
- **Repo review is the next story** — the repo is private and the PR is open, and nothing yet publishes it.

## Learnings

**What went well**

- Making the file set a pure function meant the artifact participants actually read is fully asserted — required paths, the sponsor's own words, the credentials warning, the `.gitignore` — without a network or a database.
- Showing blockers *before* the button turned the review gate from an obstacle into information. The console tells a staff member what needs a decision instead of failing when they act.
- Restoring the previous status on failure took three lines and removes an entire class of "stuck in `repo_generating`" support question. That pattern has now paid off three times (agent runs, intake completion, provisioning).
- Deciding provisioning is *not* an `AgentRun` kept the agent tables honest: they describe model work, and nothing in them is a fake run with no model call.

**What was surprising**

- The dev providers keep finding real bugs by being *unlike* test fixtures. The AI dev provider's echoed prompt was the input that exposed the splitter — a canned "Lorem ipsum" fake would have sailed through.
- Splitting on structure the model was merely *expected* to produce is a bad contract. Splitting on a marker the prompt explicitly demands, and degrading to one file when it's absent, is the version that can't produce nonsense.

**Do differently next time**

- When code parses model output, write the "the model didn't follow the format" test first. That is the normal case, not the edge case.
- Carry-forwards for **repo review (§5.3.2)**: per-file approve/edit/reject with comment threads; feedback re-triggers the research agent as a new `AgentRun`; on approval flip visibility to public (`setVisibility` is already implemented) and move to `repo_approved`; and the PRD also asks for a **stakeholder-facing** review view, which is the same gap the asset review gate already has — worth solving once, for both.
