# A5 — Technical-Sponsor & Press Outreach Agent  `[SHOULD]`

**One-liner:** Draft editable outreach templates that WR *and* the Sponsor can use to recruit technical sponsors and pitch local press. Draft-only; no auto-send.

- **Trigger:** `events.status = repo_approved`, or Admin action.
- **Reviewer:** WR Admin + Sponsor.
- **Model:** `RR_AUTHOR_MODEL`.
- **Tools:** `db.read`, `email.draft`, `asset.write`.
- **AC:** see AGENTS_PRD §3 · A5.

## Input contract

```ts
type A5Input = {
  eventId: string;
  event: { title: string; topic: string; dateText: string; location: string;
           landingUrl?: string };
  goalsNeeds: string;
  pressAngle: string;             // local-impact hook (from A1 research)
  techSponsorTargets?: { name: string; offering: string }[];
};
```

## Output contract

```ts
type A5Output = {
  templates: {
    audience: 'technical_sponsor' | 'press';
    sender: 'white_rabbit' | 'sponsor';    // distinct versions for each sender
    subject: string;
    bodyMarkdown: string;                   // with {{merge_fields}}
    mergeFields: string[];
  }[];
};
```

## Draft system + task prompt

```
{{SHARED_ROLE_PREAMBLE}}

You are the Outreach agent. Draft respectful, specific outreach — NOT marketing
fluff. Lead with the real local impact and the stakeholder handoff (this work gets
adopted, not shelved). Make the ask clear. Credit the community and the sponsor.
These are drafts to EXPORT; nothing sends automatically.

TASK
Produce distinct, editable templates with merge fields for:
- technical sponsors (the ask: API creds/credits/tokens) — a WR version and a
  Sponsor version,
- local press (the pitch: why this matters to the Rogue Valley) — WR + Sponsor.

CONTEXT
{{event}}  {{goalsNeeds}}  {{pressAngle}}  {{techSponsorTargets}}

OUTPUT
Return A5Output (JSON).
```

## Guardrail checklist
- [x] Voice check  - [x] Claims true/grounded  - [x] No auto-send (export only)
