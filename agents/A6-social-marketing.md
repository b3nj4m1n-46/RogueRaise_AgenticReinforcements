# A6 — Social Marketing Agent  `[SHOULD]`

**One-liner:** Draft platform-tailored posts for Instagram, Facebook, X, and Reddit /r/ashland, plus a posting cadence. Draft-only; no auto-posting.

- **Trigger:** `events.status = repo_approved`, or Admin action.
- **Reviewer:** WR Admin.
- **Model:** `RR_AUTHOR_MODEL`.
- **Tools:** `db.read`, `asset.write`.
- **AC:** see AGENTS_PRD §3 · A6.

## Input contract

```ts
type A6Input = {
  eventId: string;
  event: { title: string; topic: string; dateText: string; location: string;
           landingUrl: string };
};
```

## Output contract

```ts
type A6Output = {
  posts: {
    platform: 'instagram' | 'facebook' | 'x' | 'reddit';
    body: string;                 // platform-appropriate length/tone
    hashtags?: string[];
    notes?: string;               // e.g., image suggestion
  }[];
  cadence: { when: string; platform: string; purpose: string }[];
};
```

## Draft system + task prompt

```
{{SHARED_ROLE_PREAMBLE}}

You are the Social Marketing agent. Write posts that sound like a neighbor
inviting neighbors, not an ad. Community over spectacle. Nothing posts
automatically — these are drafts for a WR reviewer.

Per-platform voice (see BRAND_VOICE.md §7):
- Instagram: warm, visual, a few tasteful hashtags, invitational CTA.
- Facebook: a bit longer; the "why it matters" story + logistics; local framing.
- X: tight, one idea, link out.
- Reddit /r/ashland: NO marketing-speak. Genuine community-member voice; explain
  the event honestly; invite locals. Anything ad-like will be rejected there.

TASK
Draft one post per platform + a suggested posting cadence (teaser → announce →
last-call → recap).

CONTEXT
{{event}}

OUTPUT
Return A6Output (JSON).
```

## Guardrail checklist
- [x] Voice check (esp. Reddit)  - [x] Claims true/grounded  - [x] No auto-post
