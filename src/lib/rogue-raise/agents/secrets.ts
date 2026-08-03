/**
 * Credential detection for generated assets.
 *
 * PRD §11 is absolute: "No secret material is ever emitted into a public repo or
 * asset." Technical-sponsor credentials are documented as *instructions* — "ask
 * Acme for an API key and put it in `.env`" — never as the key itself.
 *
 * This is a **hard stop, not a redaction.** Silently mangling a document would
 * leave a reviewer approving something nobody wrote, and would hide the fact
 * that a secret reached the pipeline at all. A hit fails the run loudly so the
 * prompt that produced it gets fixed.
 *
 * It is deliberately tuned to catch *shapes of real credentials* rather than the
 * word "key". The tests pin both directions: it must catch a real-looking token,
 * and it must not fire on ordinary prose about credentials, which every one of
 * these documents is expected to contain.
 */

export interface SecretFinding {
  /** What kind of credential the pattern matches — never the matched text. */
  kind: string;
  /** 1-based line number, so a reviewer can be pointed at it. */
  line: number;
}

interface SecretPattern {
  kind: string;
  pattern: RegExp;
}

/**
 * Each pattern requires credential-shaped *entropy or structure*, not just a
 * keyword. `sk-` alone is prose; `sk-` followed by 20+ random characters is a key.
 */
const PATTERNS: SecretPattern[] = [
  { kind: "private key block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { kind: "OpenAI-style key", pattern: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { kind: "Anthropic key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { kind: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}/ },
  { kind: "Slack token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { kind: "AWS access key id", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { kind: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{30,}/ },
  { kind: "Vercel Blob token", pattern: /\bvercel_blob_rw_[A-Za-z0-9_]{20,}/ },
  { kind: "JSON web token", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { kind: "bearer token", pattern: /\bBearer\s+[A-Za-z0-9._-]{24,}/ },
  {
    // An assignment whose value is a long unbroken credential-ish string. The
    // value must have no spaces and enough length to not be a placeholder like
    // `API_KEY=your-key-here` (which is exactly what these docs should say).
    kind: "credential assignment",
    // No leading \b: the key name is usually a suffix of a longer identifier
    // (`RESEND_API_KEY`), and `_` is a word character, so \b never matches there.
    pattern:
      /(?:api[_-]?key|secret|token|password|passwd)\s*[:=]\s*["']?([A-Za-z0-9+/_-]{24,})["']?/i,
  },
];

/**
 * Values that look like credentials but are the *instructions* these documents
 * are supposed to contain. Checked against the captured value, not the line.
 */
const PLACEHOLDER_VALUES =
  /^(?:your|my|the|a)?[_-]?(?:api[_-]?key|secret|token|password|value|here|xxx+|placeholder|redacted|example|changeme|todo|tbd)/i;

function isPlaceholder(value: string | undefined): boolean {
  if (!value) return false;
  if (PLACEHOLDER_VALUES.test(value)) return true;
  // `<...>`, `{{...}}`, and all-same-character runs are obviously templates.
  if (/^[<{[]/.test(value)) return true;
  if (/^(.)\1+$/.test(value)) return true;
  return false;
}

/**
 * Scan asset content for credential material. Returns every finding so an error
 * message can name all of them at once — but never returns the matched text,
 * which would just move the secret into the logs.
 */
export function findSecrets(content: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const lines = content.split(/\r?\n/);

  lines.forEach((line, index) => {
    for (const { kind, pattern } of PATTERNS) {
      const match = pattern.exec(line);
      if (!match) continue;
      if (isPlaceholder(match[1])) continue;
      findings.push({ kind, line: index + 1 });
    }
  });

  return findings;
}

export function containsSecret(content: string): boolean {
  return findSecrets(content).length > 0;
}

/** Error message naming the kinds and lines — safe to log and to show staff. */
export function describeSecretFindings(findings: SecretFinding[]): string {
  const parts = findings.map((f) => `${f.kind} (line ${f.line})`);
  return `Refusing to store generated content containing credential material: ${parts.join(", ")}.`;
}
