<!--
metadata:
  created_at:   2026-07-27T23:52:00-07:00
  activated_at: 2026-07-27T23:52:00-07:00
  planned_at:   2026-07-27T23:54:00-07:00
  finished_at:  2026-07-28T00:05:00-07:00
  updated_at:   2026-07-28T00:05:00-07:00
-->

# Story: Closing the Deferred Gaps

## Summary

AS the team that has to hand this over
I WANT the four things every previous story deferred to be actually built
SO THAT "not implemented" appears nowhere that the PRD says `[MUST]`

Covers the stakeholder review surface (PRD §11.2 `admin_and_stakeholders`), citation checking (§5.3.1), the Vercel Blob provider (§3), and the durable-workflow seam (§3, §11.1).

## Acceptance Criteria

- **Stakeholder review** — `/review/[eventId]`, magic-link gated, showing the latest version of each `admin_and_stakeholders` draft. Stakeholders comment, approve, or ask for changes; "needs changes" requires an explanation.
- Review access works **without** `can_access_portal` — review happens months before the portal opens, so requiring that flag would make it impossible by construction.
- The admin asset page shows what stakeholders said, prominently when someone has asked for changes. It **advises, it does not block**: a busy stakeholder must not be able to stall an event.
- Invitations are idempotent **per round of drafts** — re-running the agent legitimately re-asks.
- **Citations** — research documents have every link extracted and checked; results are reported in the run log and appended to the document as a note. Nothing is silently rewritten, dropped, or "fixed".
- A link that can't be checked (timeout, 403, rate limit) is reported as **unverified, not dead**. Only a definite 4xx/5xx or a DNS failure is a failure.
- **Vercel Blob** is implemented, private by default, with refs namespaced so a local-provider row can't resolve against production storage.
- **Durable runs** — a `"use workflow"` module and a dispatcher; inline stays the default, and a failed durable dispatch falls back rather than failing the run.

## Implementation Plan

`stakeholders/review.ts` derives the reviewable asset types from the agent catalog's own `reviewGate`, so the two can't drift; comments reuse `repo_review_comments` with a new nullable `asset_id` (overloading `file_path` would have been a lie). `agents/citations.ts` is pure extraction plus an injectable-fetch checker, wired into the research handler. `integrations/blob.ts` gains the real provider. `agents/workflow.ts` + `agents/dispatch.ts` are the durability seam.

## Review

**Date:** 2026-07-28 · **Commit reviewed:** (this commit) · **Status: all 8 ACs met**

580 tests pass (57 new); build clean. Verified the full review loop in a browser: a stakeholder opened their link, read a rendered draft, asked for changes with a reason, and the admin then saw "Dana Whitfield asked for changes" in a bordered panel above the approve button.

Browser verification found one defect: the prose renderer showed markdown links **as literal `[text](url)`**. Research documents are made of citations, so this was the renderer failing at the one job it was added for — in front of the person who supplied the data.

**What could NOT be done, and why:** the AI Gateway, GitHub App, Resend, and Blob providers still have never run against real credentials, because no credentials exist in this environment. That is not a coding gap; every one of them is implemented, typechecked, and behind an adapter with a labelled dev provider that production refuses. HANDOFF.md lists them as smoke-test items. Claiming otherwise would be the one thing worse than the gap.

**Known gaps (deliberate):** the durable path needs the WDK runtime (`next dev` with the plugin, or a Vercel deployment) and so has been exercised only via its fallback and unit tests; re-runs stay inline because they carry previous-run context across the workflow boundary; the citation checker reads links, not claims — a live URL that doesn't say what the document claims it says is still a human's job.

## Learnings

- **A deferred surface gets cheaper the longer you leave it, right up until it doesn't.** The stakeholder review surface was owed by three stories. By the time it was built, stakeholder magic links, the `Prose` renderer, the comments table, and the pacer all existed — it cost a fraction of what it would have in M3. That was luck as much as judgement, and it would have gone the other way if the review had needed to shape the schema.
- **Deriving the reviewable types from `reviewGate` rather than listing them** means the catalog is the single source of truth. Adding a stakeholder-reviewed agent later needs no edit here at all.
- **The coverage test earned its keep within an hour of existing.** It failed on the new `submitStakeholderReview` action, which is magic-link gated and genuinely belongs on the allow-list — but it made me write down *why*, which is exactly the decision it was built to force.
- **Three-valued checking, again.** The citation checker reuses the pattern from the GitHub existence checks for the same reason: reporting our own timeouts as bad citations would train reviewers to ignore the feature entirely. A 403 from a paywalled county report is a perfectly good citation for a human.
- **"Report, never rewrite" is the only defensible posture for checking agent output.** A document with a dead link plus a note is honest; a document quietly edited to hide one is worse than no check at all.
- **I drew a line in a comment and then crossed it, deliberately.** The markdown renderer said "if a document ever needs links, take a real dependency". Links turned out to be one regex, while a full Markdown parser would have brought an HTML-passthrough surface for *model-generated* content. The right move was to move the line and say why in the same comment — not to follow past-me off a cliff, and not to cross it silently.
