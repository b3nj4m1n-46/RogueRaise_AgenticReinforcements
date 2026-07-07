# Rogue Raise — Agent Framework (Tentative Scaffold)

**Status:** Framework / reference only — **not runnable code.** This folder sketches *what each agent needs to do* — draft prompts, input/output contracts, tool grants, guardrail checklists — so the team can turn them into real code during the live build. Governed by `../AGENTS_PRD.md`; voice reference is `../brand/BRAND_VOICE.md`.

## Why this exists

The agents are Rogue Raise's labor force (see PRD §1.3.1). Before formal code, we want the *behavioral* design locked: prompts, the exact data each agent reads, the exact shape it returns, what it's allowed to touch, and what has to be true before its output reaches a human. That's what these files are. When the live build starts, each file becomes an agent module.

## Folder layout

```
agents/
  README.md              ← you are here
  _conventions.md        ← shared prompt assembly, I/O types, review gate, guardrails
  A1-context-research.md
  A2-repo-provisioning.md
  A3-judge-invitation-email.md
  A4-kickoff-deck.md
  A5-outreach.md
  A6-social-marketing.md
  A7-landing-faq.md
  A8-submission-categorizer.md
  A9-criteria-qa.md
```

Each `A#` file follows the same template (defined in `_conventions.md`):
one-liner · trigger · reviewer · input contract · output contract · tool grants ·
model · **draft system prompt** · **draft task prompt** · guardrail checklist ·
acceptance criteria (pointer to AGENTS_PRD).

## The golden rule (repeat on every agent)

**Draft, don't decide.** No agent output reaches a participant, judge, sponsor, or the public without a human **Approve / Edit / Reject** gate. These scaffolds are written to that rule.

## How to use during the live build

1. Read `_conventions.md` for the shared plumbing (prompt structure, `AgentRun`/`GeneratedAsset` shapes, review gate).
2. Pick an agent file. Its draft prompts + contracts are the starting point — refine live.
3. Wire it to the `agent_runs` / `generated_assets` tables (PRD Appendix A) and its tool adapters (`lib/rogue-raise/integrations/*`).
4. Keep the human review gate — always.

## Status legend

- **A1, A2, A3, A8** — `[MUST]` (MVP).
- **A4, A5, A6, A7** — `[SHOULD]`.
- **A9** — `[COULD]`.
