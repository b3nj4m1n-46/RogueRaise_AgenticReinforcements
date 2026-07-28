/**
 * Structural check: every privileged server action authorizes itself.
 *
 * This reads source rather than behaviour on purpose. The behavioural tests in
 * `guard.test.ts` prove the guard is correct; this one proves it is *reached*,
 * including from actions that don't exist yet. A new admin action added without
 * a guard fails here, which is the only way this property survives contact with
 * future work — nobody remembers a convention six months on.
 *
 * The allow-list below is the interesting artifact: it is the complete, written
 * -down set of server actions that are deliberately NOT admin-gated, each with
 * the reason. Adding to it should feel like a decision.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = join(process.cwd(), "src/lib/rogue-raise");

/**
 * Server actions that must NOT require an admin, and why. Anything reachable
 * without a WR sign-in is here; anything else has to prove it guards.
 */
const PUBLIC_OR_TOKEN_GATED: Record<string, string> = {
  // Public forms — the front door.
  "sponsors/actions.ts::createSponsorApplication":
    "the public sponsor application form; spam-guarded, not auth-gated",
  "participants/actions.ts::registerParticipant":
    "the public registration form; spam-guarded, not auth-gated",

  // Magic-link gated: each re-verifies its own token, scoped to one event.
  "intake/actions.ts::saveIntake": "sponsor POC magic link",
  "intake/actions.ts::uploadIntakeAttachment": "sponsor POC magic link",
  "intake/actions.ts::removeIntakeAttachment": "sponsor POC magic link",
  "judges/actions.ts::saveJudgeBackground": "judge magic link",
  "judging/actions.ts::saveScorecard": "judge magic link",
  "submissions/actions.ts::submitProject": "participant magic link",
  "portal/actions.ts::markStewardship": "stakeholder magic link",
  "stakeholders/review-actions.ts::submitStakeholderReview":
    "stakeholder magic link (review, which predates portal access)",

  // Auth itself.
  "admin/sign-in-actions.ts::signInAdmin":
    "the sign-in form; requiring a session to sign in would be a deadlock",
  "admin/sign-in-actions.ts::signOutAdmin":
    "signing out must work even from a session the guard would reject",
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith(".ts") && !full.endsWith(".test.ts") ? [full] : [];
  });
}

interface ActionRef {
  key: string;
  file: string;
  name: string;
  body: string;
  /** The whole module, for checks that a shared helper satisfies. */
  source: string;
}

/** Every exported async function in a module carrying `"use server"`. */
function collectServerActions(): ActionRef[] {
  const actions: ActionRef[] = [];

  for (const file of walk(ROOT)) {
    const source = readFileSync(file, "utf8");
    // The directive, not a mention of it in a comment.
    if (!/^"use server";/m.test(source)) continue;

    const relative = file.slice(ROOT.length + 1);
    const pattern = /export async function (\w+)\(/g;
    for (const match of source.matchAll(pattern)) {
      const name = match[1];
      const start = match.index ?? 0;
      // Up to the next exported function, or the end of the file.
      const nextExport = source.indexOf("\nexport ", start + 1);
      const body = source.slice(start, nextExport === -1 ? undefined : nextExport);
      actions.push({
        key: `${relative}::${name}`,
        file: relative,
        name,
        body,
        source,
      });
    }
  }

  return actions;
}

const ACTIONS = collectServerActions();

describe("server action inventory", () => {
  it("finds the server actions at all", () => {
    // Guards against the collector silently matching nothing and every
    // assertion below passing vacuously.
    expect(ACTIONS.length).toBeGreaterThan(20);
  });

  it("has no stale entries in the allow-list", () => {
    const keys = new Set(ACTIONS.map((a) => a.key));
    for (const allowed of Object.keys(PUBLIC_OR_TOKEN_GATED)) {
      expect(keys, `${allowed} is allow-listed but no longer exists`).toContain(
        allowed,
      );
    }
  });
});

describe("every privileged server action authorizes itself", () => {
  const privileged = ACTIONS.filter((a) => !(a.key in PUBLIC_OR_TOKEN_GATED));

  it("covers a meaningful number of actions", () => {
    expect(privileged.length).toBeGreaterThan(15);
  });

  it.each(privileged.map((a) => [a.key, a] as const))(
    "%s calls the admin guard",
    (_key, action) => {
      const guards =
        /adminOrError\(\)/.test(action.body) || /requireAdmin\(\)/.test(action.body);
      expect(
        guards,
        `${action.key} is a server action with no admin check. Either call ` +
          `adminOrError()/requireAdmin(), or add it to PUBLIC_OR_TOKEN_GATED ` +
          `in this file with the reason it is safe without one.`,
      ).toBe(true);
    },
  );
});

describe("token-gated actions verify their token", () => {
  const tokenGated = Object.keys(PUBLIC_OR_TOKEN_GATED).filter((key) =>
    PUBLIC_OR_TOKEN_GATED[key].includes("magic link"),
  );

  it.each(tokenGated)("%s redeems a token", (key) => {
    const action = ACTIONS.find((a) => a.key === key);
    expect(action).toBeDefined();
    // Module-level rather than function-level: several of these (the intake
    // actions) redeem via a shared `authorize…` helper in the same file, which
    // is the better factoring. Being on the allow-list is a claim; this checks
    // the module makes good on it.
    expect(/redeem\w*Token\(/.test(action!.source)).toBe(true);
  });
});
