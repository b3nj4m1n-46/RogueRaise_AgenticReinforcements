<!--
metadata:
  created_at:   2026-07-27T21:58:00-07:00
  activated_at: 2026-07-27T21:58:00-07:00
  planned_at:   2026-07-27T21:58:00-07:00
  finished_at:  2026-07-27T22:02:00-07:00
  updated_at:   2026-07-27T22:02:00-07:00
-->

# Story: Repo Review & Publishing

## Summary

AS a WR Admin
I WANT to read the pushed repository file by file, comment on any of it, and then publish or send it back
SO THAT nothing participants read goes public without a person having actually read it

## Acceptance Criteria

- `/admin/events/[id]/repo-review` shows every file in the pushed tree with its content.
- Each file takes **comments**, and a file's comments read as a **thread** (append-only, oldest first) rather than one overwritten note.
- Files that came from a reviewable draft **link to that draft**; generated wrappers say the platform wrote them.
- **Approve** makes the repository public and moves the event to `repo_approved`, after confirming — publishing is the last irreversible step before participants can see it.
- **Send back** records the feedback and re-runs the research agent with **every comment so far**, producing new draft versions to review.
- Approving is refused outside `repo_review`, so a repo can't be published twice.
- The missing stakeholder-facing review view is stated on the page, not implied away.

## Implementation Plan

`repo_review_comments` (append-only, `event_id` + nullable `file_path` + author role + body + optional decision) is the only schema addition. `repo/review.ts` re-derives the tree with the same pure `buildRepoFiles` the push used, threads comments under their files, and owns the two decisions. `repo/review-actions.ts` is the `"use server"` wrapper. `provision.ts` and `review.ts` share one `latestApprovedAssets` reader so they can't disagree about what's in the repo.

## Review

**Date:** 2026-07-27 · **Commit reviewed:** (this commit) · **Status: all 7 ACs met**

Integration-tested against real Postgres with the local GitHub provider: the review view lists every pushed file and links the draft-backed ones; comments thread per file with general feedback kept separate; approving publishes and transitions with an audit row; approving twice is refused; sending back re-runs the agent and the agent receives both the earlier file comments and the new feedback.

**Known gaps (deliberate):** no stakeholder-facing view and no stakeholder identity — stated on the page; the tree is re-derived rather than read back from GitHub, which is correct while the inputs haven't changed and is why re-provisioning exists; the App provider still hasn't run against real credentials.

## Learnings

- Re-deriving the tree from the same pure function the push used avoided a whole read-back API and made the review page testable. It holds because `buildRepoFiles` is pure — the moment it weren't, this would quietly lie.
- Extracting `latestApprovedAssets` when the *second* caller appeared, rather than guessing at the first, put the shared rule in one place at exactly the moment it became a rule.
- Sending the whole comment history to the re-run, not just the latest note, is the difference between "the agent got the feedback" and "the agent got the last thing someone typed".
- Carry-forward: the stakeholder review surface is now owed by two stories (asset review and repo review). It should be built once, as a magic-link-gated read-and-comment view, reusing the intake token pattern.
