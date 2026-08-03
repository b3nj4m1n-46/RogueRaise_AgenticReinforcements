<!--
metadata:
  created_at:   2026-07-27T22:16:00-07:00
  activated_at: 2026-07-27T22:16:00-07:00
  planned_at:   2026-07-27T22:16:00-07:00
  finished_at:  2026-07-27T22:20:00-07:00
  updated_at:   2026-07-27T22:20:00-07:00
-->

# Story: Marketing & Solicitation Agents

## Summary

AS a WR Admin
I WANT drafts of the outreach, the social posts, and the landing page copy
SO THAT announcing a Rogue Raise doesn't cost a day of writing, and everything public still passes through a person

## Acceptance Criteria

- **Technical-sponsor & press outreach**: two per-audience templates with merge fields, never guessed names, saved as an editable asset.
- **Social marketing**: one draft per platform — Instagram, Facebook, X, Reddit (/r/ashland) — each shaped to its platform, plus a suggested cadence. No auto-posting.
- **Landing page content & FAQ**: page copy and an FAQ, as two assets, written to be rendered by a real route rather than repeating the schedule.
- All three trigger at `repo_approved` and go through the standard review gate.
- Each social platform's draft is **independently reviewable** — approving the Reddit post must not require approving the Instagram one.
- Every prompt forbids inventing statistics, quotes, partners, or people.

## Implementation Plan

One shared brief builder, three handlers, and a marker-based splitter per multi-part output (`## TEMPLATE:`, `## POST: <platform>`). Social posts use `generated_assets.platform`, which required the version key to become (event, type, platform).

## Review

**Date:** 2026-07-27 · **Commit:** 4533d08 · **Status: all 6 ACs met; 2 defects found and fixed**

**Defect 1 — the version counter was keyed too coarsely.** Four social posts written in one run would have been versions 1–4 of one asset type, reading as revisions of each other rather than one draft per platform. The key is now (event, type, platform), applied consistently in the writer, the review gate, the edit path, the asset page, and the console grouping. Caught by asking "what does the console show after this runs?" while writing the handler, and pinned by an integration test.

**Defect 2 — the social splitter stopped at any non-POST heading**, so a single unknown platform swallowed every valid post after it. Caught by a unit test written for exactly that case. It now ends the current post and keeps scanning.

**Known gaps (deliberate):** no auto-posting, which the PRD explicitly excludes from MVP; output quality unverifiable while the dev provider is the only one configured; and the `admin_and_sponsor` gate on outreach has no sponsor-facing surface — the third gate now owed one.

## Learnings

- Reaching for a column that has been in the schema since M0 (`platform`) surfaced a versioning assumption that had been correct for five stories and stopped being correct the moment one run produced several assets of one type. The lesson isn't "the key was wrong" — it was right for its inputs — it's that a *derived key* like this should be re-checked whenever a new caller violates the shape the original callers had.
- Fixing the key in one place would have been a bug: five separate places decide "is this the latest version?", and they all had to move together. Grepping for the old key was the whole fix.
- Three agents took under an hour because M3's machinery already owned lifecycle, versioning, attribution, auditing, review, and the secret scan. This is what that story was for, and it's the first time the payoff was this visible.
- Carry-forward for **M7**: the landing page content and FAQ assets are what `/events/[slug]` renders, and the page must render the schedule from the event record — never from the copy, which is deliberately written without it.
