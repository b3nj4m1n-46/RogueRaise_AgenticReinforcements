# Rogue Raise — Preparation Plan

Working notes for preparing a White Rabbit (WR) code-a-thon "Rogue Raise," transcribed
from the planning whiteboard. Two main tracks: **standing up a new raise** and **managing
a raise in flight**.

## New Raise

### 1. Sign-Up Form

Intake form for an org proposing a raise.

- Org name
- Project opportunities (pains)
- Goals / needs
- Stakeholder(s) — who takes control of the project?
- Financial commitment range?

### 2. Eval Dashboard [WR]

Where WR reviews incoming sign-ups.

- Curate: approve / deny
- Define what the approval criteria are

### 3. Follow-Up Forms

Sent once a raise is approved. Captures the details needed to run it.

- Judges
- Eval criteria
- Dates
- Sponsors
- Awards / budget
- Supplementary info / data
- Stakeholder preferences

### 4. WR Agents

Agents that act on the form data.

1. **Research agent** — use form data as context for research with web tools, then route
   findings to **stakeholder feedback** (approve / edit / reject).
2. **Copy agent** — tool to create copy for sponsor solicitation, specific to the raise.

### 5. WR Setup

- Create GitHub (GH) org/repo
  - Research
  - Example PRDs

## Management of Raise

- **Participant sign-up** → (GH settings) → participant submits GH repo
- Sponsor credits?
- Tooling? — APIs
- Judge sign-up — background
- Judge eval forms
- Outbound marketing
  - Social
  - Press kit
  - WR website copy

## Flow Summary

```
Sign-Up Form ──▶ Eval Dash [WR] ──(if approved)──▶ Follow-Up Forms
                                                        │
                                                        ▼
                                                    WR Agents
                                          ┌─────────────┴─────────────┐
                                          ▼                           ▼
                              1. Research w/ web tools      2. Sponsor solicitation
                                 → stakeholder feedback         copy generation
                                   (approve/edit/reject)
```

## Open Questions

- What exactly are the eval / approval criteria?
- Financial commitment range for orgs?
- Sponsor credits — how do they work?
- What tooling / APIs are needed?
