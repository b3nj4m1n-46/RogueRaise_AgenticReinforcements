# A8 — Submission Categorizer & LOC Agent  `[MUST]`

**One-liner:** After submissions close, compute lines of code and categorize each project, and produce the event-level "types of submissions" summary that powers the Phase 4 stakeholder dashboard.

- **Trigger:** submission window closes (Cron/Admin).
- **Reviewer:** Auto (Admin-visible; no external exposure).
- **Model:** `RR_FAST_MODEL` (classify/summarize).
- **Tools:** `github.app` (read repo stats/languages), `db.read`, `asset.write`, `db.write` (stats).
- **AC:** see AGENTS_PRD §3 · A8.

## Input contract

```ts
type A8Input = {
  eventId: string;
  submissions: { id: string; teamName: string; projectSummary: string; repoUrl: string }[];
  locDefinition: LocRule;     // resolve the open question first (see below)
};
```

## Output contract

```ts
type A8Output = {
  perSubmission: {
    submissionId: string;
    linesOfCode: number | null;        // null if repo unreachable
    languageBreakdown?: Record<string, number>;
    category: string;                  // e.g. "data pipeline", "web dashboard"
    categorySummary: string;           // 1–2 sentences
    repoStatus: 'ok' | 'private' | 'unreachable' | 'invalid';
  }[];
  eventSummary: {
    submissionCount: number;
    totalLinesOfCode: number;          // sum of reachable repos
    typesSummary: string;              // prose overview of the mix
  };
};
```

## Draft system + task prompt

```
{{SHARED_ROLE_PREAMBLE}}

You are the Submission Categorizer. You read each team's public repo, compute its
size per the given LOC rule, classify what kind of project it is, and summarize the
overall mix for the stakeholder dashboard. Be robust: if a repo is private or
missing, flag it and continue — never crash the batch.

TASK
For each submission repo: fetch stats (lines, languages) via the GitHub App, apply
the LOC rule, classify the project type, and write a 1–2 sentence summary. Then
produce an event-level summary: count, total LOC, and a prose "types of
submissions" overview. Write per-submission stats back to the submissions table.

CONTEXT
{{submissions}}  LOC rule: {{locDefinition}}

OUTPUT
Return A8Output (JSON).
```

## Guardrail checklist
- [x] Read-only on participant repos  - [x] Graceful on private/unreachable (flag, don't fail)  - [x] Idempotent (overwrite stats per submission, no dupes)

## Blocking open question — LOC rule
Resolve before build (AGENTS_PRD §7 #1 / PRD §16 #5):
```ts
type LocRule = {
  scope: 'default_branch_snapshot' | 'additions_only';
  excludeVendored: boolean;      // node_modules, vendored libs, lockfiles
  excludeGenerated: boolean;
  languageFilter?: string[];     // e.g., count only source langs
};
```
Suggested default: `default_branch_snapshot`, exclude vendored + generated, no language filter.
