# A2 — Repo Provisioning Agent  `[MUST]`

**One-liner:** Assemble A1's research into the event's GitHub context repo (README, research, stakeholder prefs, example PRDs, setup instructions), push a PR, and gate it behind human review before going public.

- **Trigger:** A1 assets ready (chained), or Admin "Provision repo."
- **Reviewer:** WR Admin + Stakeholders (per-file Approve/Edit/Reject).
- **Model:** `RR_AUTHOR_MODEL` (writes READMEs, example PRDs, setup instructions).
- **Tools:** `github.app`, `blob.write`, `db.read`, `asset.write`.
- **AC:** see AGENTS_PRD §3 · A2.

## Input contract

```ts
type A2Input = {
  eventId: string;
  event: { title: string; topic: string; slug: string;
           confirmedFridayKickoffAt?: string; location: string };
  a1: A1Output;                         // research + stakeholder prefs + context
  techSponsors?: { name: string; offering: string }[]; // creds are OBTAINED, never inlined
};
```

## Output contract

```ts
type A2Output = {
  repoTree: { path: string; content: string }[];  // full file set to commit
  githubRepoUrl: string;
  openPrUrl: string;
  defaultBranch: string;
  isPublic: false;                                  // stays private until approved
};
```

Required paths in `repoTree`:
`README.md`, `research/*`, `stakeholder-preferences.md`, `context/*`,
`prds/*` (≥2 example PRDs, varying ambition), `setup-agent-instructions.md`,
`tools/*` (how to obtain tech-sponsor creds — never the creds).

## Draft system prompt

```
{{SHARED_ROLE_PREAMBLE}}

You are the Repo Provisioning agent. You assemble the participant-facing context
repo. It must let a first-time hackathon participant start building immediately:
clear problem statement, ready research, concrete build-toward parameters, and
EXAMPLE PRDs they can imitate.

NEVER commit secrets, tokens, or credentials. For any technical-sponsor offering,
write INSTRUCTIONS to obtain access, not the access itself. The repo stays PRIVATE
until a human approves it.
```

## Draft task prompt

```
TASK
Build the repo file tree:
- README.md: problem statement, schedule (Fri kickoff / Sat-Sun build / Sun 4pm
  pitches / 6pm winners), location, how to use this repo, links.
- research/: A1 research docs with citations.
- stakeholder-preferences.md: the build-toward parameters (standalone).
- context/: A1 context files.
- prds/: at least 2 example PRDs at different ambition levels, in plain language,
  so a newcomer can pick one and go.
- setup-agent-instructions.md: instructions an agent can follow to spin up a PUBLIC
  project repo for a team with sensible parameters.
- tools/: how to request/obtain any technical-sponsor credentials.

Then: secret-scan everything, create the repo (private) in {{RR_GITHUB_ORG}}, push
to a branch, open a PR. Do not make it public.

CONTEXT
{{event}}  {{a1}}  {{techSponsors}}

OUTPUT
Return A2Output (JSON).
```

## Guardrail checklist
- [x] Secret scan (blocks commit)  - [x] No secrets in `tools/`  - [x] Idempotency (reuse `context_repos.github_repo_url`; new branch on re-run)  - [x] Repo private until approved

## Notes
- On reviewer Edit/Reject of a file: re-run A2 (or A1 for content gaps) with the note; re-open/refresh the PR; `version+1`.
- Only after approval: set repo public, `events.status → repo_approved`.
