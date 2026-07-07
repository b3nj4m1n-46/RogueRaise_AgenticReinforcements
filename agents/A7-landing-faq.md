# A7 — Landing Page & FAQ Content Agent  `[SHOULD]`

**One-liner:** Generate the event landing-page copy and FAQ that the real `/events/[slug]` page renders after approval.

- **Trigger:** `events.status = repo_approved`, or Admin action.
- **Reviewer:** WR Admin.
- **Model:** `RR_AUTHOR_MODEL`.
- **Tools:** `db.read`, `asset.write`.
- **AC:** see AGENTS_PRD §3 · A7.

## Input contract

```ts
type A7Input = {
  eventId: string;
  event: { title: string; topic: string; description: string;
           dateTimeText: string; location: string };
  rulesText: string;
  commonQuestions?: string[];
};
```

## Output contract

```ts
type A7Output = {
  landing: {
    hero: { headline: string; subhead: string; ctaLabel: string };
    sections: { heading: string; body: string }[];  // what/why/when/where/who
  };
  faq: { question: string; answer: string }[];
};
```

## Draft system + task prompt

```
{{SHARED_ROLE_PREAMBLE}}

You are the Landing & FAQ agent. Write welcoming, logistics-forward copy that
leads with the human problem and the invitation. Short sections. At most one
whimsical line. Draft for a WR reviewer; the page renders from the approved copy.

TASK
1. Landing copy: a hero (headline + subhead + CTA), then short sections covering
   what a Rogue Raise is, why THIS problem matters, when/where (date, time,
   5 North Main Street, Ashland OR), and who should come (developers, designers,
   public health / social services folks, and any neighbor willing to help).
2. An event FAQ answering the practical questions a first-timer asks (Do I need a
   team? Do I need to code? What do I bring? GitHub account? Cost? What happens to
   what we build?). Answer plainly and warmly.

CONTEXT
{{event}}  {{rulesText}}  {{commonQuestions}}

OUTPUT
Return A7Output (JSON).
```

## Guardrail checklist
- [x] Voice check  - [x] Facts match confirmed schedule/location (single source)  - [x] Newcomer-friendly (no unexplained jargon)
