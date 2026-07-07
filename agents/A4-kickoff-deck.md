# A4 — Kickoff Deck Agent  `[SHOULD]`

**One-liner:** Generate the Friday kickoff `.pptx` — topic, sponsors, pain/need, opportunities, judges, criteria, schedule — themed to White Rabbit, for Admin review.

- **Trigger:** `events.status = repo_approved`, or Admin "Generate kickoff deck."
- **Reviewer:** WR Admin.
- **Model:** `RR_AUTHOR_MODEL` (narrative) → render.
- **Tools:** `db.read`, `pptx.generate`, `blob.write`, `asset.write`.
- **AC:** see AGENTS_PRD §3 · A4.

## Input contract

```ts
type A4Input = {
  eventId: string;
  event: { title: string; topic: string; scheduleText: string; location: string };
  sponsors: { orgName: string; painNeed: string; opportunities: string }[];
  criteria: { label: string; description?: string }[];
  judges: { name: string; title?: string; bio?: string; introPreference?: string }[];
};
```

## Output contract

```ts
type A4Output = {
  outline: { slideTitle: string; bullets: string[]; speakerNotes?: string }[];
  pptxBlobUrl: string;        // rendered, WR-themed
};
```
Slides must cover: title · the problem/topic · sponsor intro(s) · sponsor pain/need ·
opportunities · evaluative criteria · judges (from background data) · schedule · location.

## Draft system prompt

```
{{SHARED_ROLE_PREAMBLE}}

You are the Kickoff Deck agent. Produce a warm, clear opening-ceremony deck that
sets up the weekend: why this problem matters, who the sponsors are, what a win
looks like, and who's judging. Community over spectacle. It is a draft for a WR
reviewer. Voice per BRAND_VOICE.md; whimsy at most one light touch.
```

## Draft task prompt

```
TASK
Draft a slide outline (title + bullets + brief speaker notes) covering: topic,
sponsor intro(s), sponsor pain/need, opportunities, criteria, judges (use their
intro preference), schedule (Fri kickoff / Sat-Sun build / Sun 4pm pitches / 6pm
winners), and location. Keep bullets tight and human. Then render a WR-themed pptx.

CONTEXT
{{event}}  {{sponsors}}  {{criteria}}  {{judges}}

OUTPUT
Return A4Output (JSON).
```

## Guardrail checklist
- [x] Voice check  - [x] No PII beyond what judges chose to share (intro preference)  - [x] Regenerable on request

## Notes
- Open question (AGENTS_PRD §7 #6): render `.pptx` directly vs. Markdown→deck converter. Default: direct `.pptx` for fidelity; keep the outline editable.
