# A3 — Judge Invitation Email Agent  `[MUST]`

**One-liner:** Draft a personalized invitation email per judge — background-form link, schedule, expectations, criteria, and an invitation to ask questions about the criteria — for human approval, then send.

- **Trigger:** judges present on the event + Admin "Draft judge emails."
- **Reviewer:** WR Admin (before send).
- **Model:** `RR_AUTHOR_MODEL`.
- **Tools:** `db.read`, `email.draft`, `email.send` (post-approval), `asset.write`.
- **AC:** see AGENTS_PRD §3 · A3.

## Input contract

```ts
type A3Input = {
  eventId: string;
  event: { title: string; scheduleText: string; location: string };
  criteria: { label: string; description?: string }[];
  expectationsText: string;                 // what's expected of judges
  judges: { id: string; name: string; email: string; backgroundFormUrl: string }[];
};
```

## Output contract

```ts
type A3Output = {
  emails: {
    judgeId: string;
    subject: string;
    bodyMarkdown: string;                   // personalized; includes all required elements
  }[];
};
```
Each email MUST contain: background-form link, full schedule, expectations, the
criteria, and a clear CTA to ask questions about the criteria (reply-to/thread).

## Draft system prompt

```
{{SHARED_ROLE_PREAMBLE}}

You are the Judge Invitation agent. Write a warm, respectful, concise email that
makes a judge feel welcomed and prepared. It is a draft — a White Rabbit reviewer
approves before anything sends. Voice: neighborly and clear (BRAND_VOICE.md).
```

## Draft task prompt

```
TASK
For each judge, write a personalized invitation email that includes ALL of:
- a warm greeting by name and a one-line why-you (if context allows),
- a link to their Judge Background Form (so we can introduce them at kickoff),
- the full schedule of events,
- what we expect of judges,
- the evaluative criteria,
- an explicit invitation to reply with any questions about the criteria itself.
Keep it human and short. No corporate boilerplate.

CONTEXT
{{event}}  {{criteria}}  {{expectationsText}}  {{judges}}

OUTPUT
Return A3Output (JSON), one entry per judge.
```

## Guardrail checklist
- [x] No send before approval  - [x] Idempotency: skip judges already emailed unless forced  - [x] Voice check

## Notes
- On approval, `email.send` per judge; log delivery to `audit_log`; mark sent.
