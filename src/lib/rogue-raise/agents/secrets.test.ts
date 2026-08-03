import { describe, expect, it } from "vitest";

import { containsSecret, describeSecretFindings, findSecrets } from "./secrets";

/**
 * Every value here is synthetic. The vendor *prefixes* have to be real — they
 * are what the patterns match on — but the filler after them is deliberately
 * readable rather than random.
 *
 * That is not cosmetic. GitHub's push protection scans commit contents, not
 * intent, and it scores on entropy: a fixture that reads like an issued key
 * blocks the push for everyone who ever pushes this history, WR included. Two
 * of these did exactly that. If you tighten a pattern and need a longer
 * fixture, stretch the `not-a-real-token` filler; don't reach for something
 * that looks issued.
 */
describe("findSecrets — catches real credential shapes", () => {
  const cases: [string, string][] = [
    ["private key block", "-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n"],
    ["OpenAI-style key", "Use sk-proj-abc123def456ghi789jkl012mno for the demo."],
    ["GitHub token", "token: ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"],
    ["Slack token", "xoxb-not-a-real-token-0000000000"],
    ["AWS access key id", "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE"],
    ["Google API key", "key=AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r"],
    [
      "JSON web token",
      "Authorization uses eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk",
    ],
    ["bearer token", "curl -H 'Bearer not-a-real-token-0000000000'"],
    [
      "credential assignment",
      'RESEND_API_KEY = "re_9fK2mNpQ4rTvWxYz7aBcDeFgHiJkLmNo"',
    ],
  ];

  it.each(cases)("flags a %s", (_kind, content) => {
    expect(containsSecret(content)).toBe(true);
  });

  it("reports the line number so a reviewer can be pointed at it", () => {
    const content = ["intro", "more text", "sk-proj-abc123def456ghi789jkl012mno"].join("\n");
    const [finding] = findSecrets(content);
    expect(finding.line).toBe(3);
  });

  it("never echoes the matched secret in its own message", () => {
    const secret = "ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";
    const message = describeSecretFindings(findSecrets(`token: ${secret}`));
    expect(message).not.toContain(secret);
    expect(message).toContain("GitHub token");
  });
});

describe("findSecrets — leaves credential *instructions* alone", () => {
  // Every one of these documents is supposed to talk about credentials. If the
  // scanner fires on prose, agents can't write the documents they exist to write.
  const allowed = [
    "Ask Acme for an API key and put it in your .env as ACME_API_KEY.",
    "ACME_API_KEY=your-api-key-here",
    "OPENAI_API_KEY=<your key>",
    "SECRET=changeme",
    "password: TODO",
    "Set the token in Vercel's dashboard — never commit it.",
    "The sponsor will provide credentials separately; do not paste them here.",
    "Store secrets in environment variables, not in the repository.",
    "API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "See the Bearer token docs for how authentication works.",
  ];

  it.each(allowed)("allows %j", (content) => {
    expect(findSecrets(content)).toEqual([]);
  });

  it("allows a whole realistic setup document", () => {
    const doc = [
      "# Setup",
      "",
      "1. Copy `.env.example` to `.env`.",
      "2. Ask the Jackson County team for their API key and set:",
      "",
      "   ```",
      "   JCHD_API_KEY=your-key-here",
      "   ```",
      "",
      "3. Never commit `.env` — it is gitignored for a reason.",
      "",
      "The password for the shared demo account is handed out at kickoff, in person.",
    ].join("\n");
    expect(findSecrets(doc)).toEqual([]);
  });
});

describe("findSecrets", () => {
  it("returns every finding, not just the first", () => {
    const content = [
      "sk-proj-abc123def456ghi789jkl012mno",
      "ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8",
    ].join("\n");
    expect(findSecrets(content)).toHaveLength(2);
  });

  it("finds nothing in empty content", () => {
    expect(findSecrets("")).toEqual([]);
  });
});
