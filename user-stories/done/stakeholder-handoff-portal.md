<!--
metadata:
  created_at:   2026-07-27T23:00:00-07:00
  activated_at: 2026-07-27T23:00:00-07:00
  planned_at:   2026-07-27T23:02:00-07:00
  finished_at:  2026-07-27T23:15:00-07:00
  updated_at:   2026-07-27T23:15:00-07:00
-->

# Story: Stakeholder Handoff Portal

## Summary

AS the person at the sponsoring organization who brought us the problem
I WANT one page with everything the weekend produced — the code, the people, the evaluations — and a way to say what happens to each project now
SO THAT the work actually goes home with someone, without me having to chase White Rabbit for any of it

Covers PRD §8.1 (dashboard), §8.2 (submission cards), §8.3 (handoff bridge), and the Phase 4 agent in §11.2 — milestone M9.

## Acceptance Criteria

- `/portal/[eventId]` is magic-link gated per stakeholder and strictly scoped: their event, their projects, nothing else. A token for another event is refused.
- Access needs **two** things: a valid token *and* `can_access_portal`. Being named on an event is not being let in.
- The portal refuses to open before the event is `completed`, so nobody reads scores that are still moving.
- Dashboard shows submission count, **total lines of code computed from the real repos**, a categorization of what got built, and the announced winners.
- A count we couldn't get is shown as "not counted", **never as zero**, everywhere it appears — dashboard, project card, and the generated document.
- One card per project: team name, summary, **participant contact details** (mailto + GitHub), the **judges' evaluations**, a link to the repo, and a **download**.
- Only **announced** awards appear; an assigned-but-unannounced winner must not leak.
- Judges' **draft** cards never appear in the evaluations a sponsor reads.
- The categorizer's prose reaches the portal only after **WR Admin approval**, like everything else that leaves the building.
- Each project can be marked **adopted / stewarded / archived**, reversibly, audited to the named stakeholder who chose.
- The admin console opens the portal in one action: grant + link + email, idempotent, with a matching revoke.

## Implementation Plan

`fetchRepoStats` joins the GitHub adapter alongside the existing three-valued checks, reading `stats/code_frequency` for lines and `languages` for the breakdown, with every field independently nullable. The categorizer is a normal agent handler with one extension: `AgentResult.submissionStats` lets it hand numbers back for `runs.ts` to persist in the same transaction as the run — preserving the "handlers never write" invariant rather than punching a hole in it. `portal/queries.ts` is a plain module (participant PII and evaluations must never be a POST endpoint). `portal/invite.ts` grants and sends in one transaction per stakeholder. `portal/markdown.ts` is a deliberately tiny reader so agent prose renders as typography.

## Review

**Date:** 2026-07-27 · **Commit reviewed:** (this commit) · **Status: all 11 ACs met**

36 new tests (24 integration against real Postgres, 12 unit) covering scoping, the two-key gate, revocation, draft exclusion, unannounced-award suppression, the null-not-zero rule, hallucinated-id rejection, and stewardship reversibility. 462 tests pass; build clean.

Browser verification against real GitHub found three defects:

1. The generated document printed **"0 lines of code"** when nothing could be counted — precisely the failure the null handling exists to prevent, leaking through the one path that formats rather than displays. Regression test added.
2. The sponsor was shown **raw Markdown** (`**2 projects submitted.**`). Every prior consumer of agent prose was WR staff, who don't mind; the portal is the first external one.
3. The catalog described the categorizer as `reviewGate: "auto"` — true when it only wrote numbers, wrong once it also drafted prose a sponsor reads. Now `admin`.

It also confirmed the real API behaviour worth knowing: `stats/code_frequency` returns **422** for repositories too large to compute (permanent) and **202** while computing (transient). A repo that returned 202 on the first run counted 735,495 lines on the re-run — the documented retry path, observed working.

**Known gaps (deliberate):** stakeholders authenticate by magic link only, with no Better Auth session (the same gap as every other external role); the portal has no in-app messaging, so "contact the participant" is `mailto:`; download is GitHub's own zip rather than an archive we build; nothing schedules the categorizer — an admin runs it, which is honest while agent runs aren't durable.

## Learnings

- **The null-not-zero rule needed enforcing in three places, not one.** The query returns null, the card renders "—", and the *generated document* still wrote "0 lines of code". A rule that lives in one layer's head isn't a rule; it has to be re-stated wherever the value gets formatted, and tested at each.
- **Extending `AgentResult` beat weakening "handlers never write."** The categorizer's output is numbers, and the obvious move was to let it update rows. Handing the numbers back for `runs.ts` to persist in the same transaction kept run-auditing and the secret scan unbypassable, and cost one optional field.
- **A review gate is a claim about who reads the output.** `auto` was right when the agent only computed statistics and became a lie the moment it also drafted prose for the sponsor. Worth re-checking a gate whenever an agent's outputs change shape.
- **The first external reader of an internal format finds its rough edges.** Markdown had been "fine" through five milestones because only staff saw it.
- **Two independent keys for the portal (token + `can_access_portal`) turned out to be worth it.** It let "the portal isn't open yet" be a distinct, honest message rather than an indistinguishable "invalid link", and it means opening the portal is a decision with its own audit row.
- Carry-forward: the stakeholder-facing *review* surface is still owed by three stories. This story built stakeholder magic-link access and a stakeholder-facing page — the pieces that review surface needs — so it is now substantially cheaper than when it was first deferred.
