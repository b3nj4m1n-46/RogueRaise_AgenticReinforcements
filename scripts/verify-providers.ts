/**
 * Smoke-tests every external provider against REAL credentials.
 *
 *     npm run verify:providers            # check whatever is configured
 *     npm run verify:providers -- --write # also do the write-side checks
 *
 * ## Why this exists
 *
 * Four integrations — AI Gateway, GitHub App, Resend, Vercel Blob — are
 * implemented, typechecked, and covered by tests against their dev providers.
 * None of them has ever run against a real key, because no key exists in the
 * environment they were built in. That is a genuine gap, and the honest way to
 * close it is not to write a test that pretends: it is to make the first real
 * run take one command and produce a clear verdict.
 *
 * So this is the HANDOFF checklist as executable code. Run it the moment
 * credentials exist. Everything it reports is a real call to a real service.
 *
 * ## What it will and won't do
 *
 * Read-side checks always run. **Write-side checks (sending an email, creating
 * a repo, uploading a blob) only run with `--write`**, because they have
 * effects someone has to clean up, and a verification script that quietly
 * emailed a real person on first run would deserve everything it got.
 */
import "dotenv/config";

const WRITE = process.argv.includes("--write");

type Status = "pass" | "fail" | "skip";

interface Check {
  provider: string;
  name: string;
  status: Status;
  detail: string;
  /** What to do about a failure — the reason this beats a bare stack trace. */
  hint?: string;
}

const results: Check[] = [];

function record(check: Check): void {
  results.push(check);
  const mark = check.status === "pass" ? "✓" : check.status === "fail" ? "✗" : "–";
  console.log(`${mark} ${check.provider}: ${check.name} — ${check.detail}`);
  if (check.hint && check.status === "fail") console.log(`    → ${check.hint}`);
}

async function attempt(
  provider: string,
  name: string,
  hint: string,
  fn: () => Promise<string>,
): Promise<void> {
  try {
    record({ provider, name, status: "pass", detail: await fn() });
  } catch (err) {
    record({
      provider,
      name,
      status: "fail",
      detail: err instanceof Error ? err.message : String(err),
      hint,
    });
  }
}

function skip(provider: string, name: string, detail: string): void {
  record({ provider, name, status: "skip", detail });
}

// --- AI Gateway ------------------------------------------------------------

async function verifyAiGateway(): Promise<void> {
  if (!process.env.AI_GATEWAY_API_KEY) {
    return skip("AI Gateway", "generate", "AI_GATEWAY_API_KEY is not set");
  }
  const { getAiAdapter, resetAiAdapter, AI_MODELS } = await import(
    "../src/lib/rogue-raise/integrations/ai-gateway"
  );
  resetAiAdapter();

  await attempt(
    "AI Gateway",
    `generate (${AI_MODELS.authoring})`,
    "Check AI_GATEWAY_API_KEY, and that RR_AI_MODEL_AUTHORING names a model the gateway serves.",
    async () => {
      const result = await getAiAdapter().generate({
        prompt: "Reply with exactly: ok",
        maxOutputTokens: 16,
      });
      if (!result.text.trim()) throw new Error("Model returned empty text.");
      return `${result.usage.totalTokens} tokens, replied ${JSON.stringify(result.text.trim().slice(0, 20))}`;
    },
  );

  // The one most likely to break: the search tool's id is dated and
  // model-specific, so this is the check that earns the script its keep.
  await attempt(
    "AI Gateway",
    "live web search",
    "The web-search tool revision is dated (webSearch_20260209) and model-specific. If the model rejects it, find the revision it accepts in @ai-sdk/anthropic and update integrations/ai-gateway.ts — do NOT drop the tool, or research documents go back to citing from recall.",
    async () => {
      const result = await getAiAdapter().generate({
        prompt:
          "What is the population of Ashland, Oregon? Search for it and cite your source.",
        maxOutputTokens: 400,
        webSearch: { maxUses: 2 },
      });
      if (result.sources.length === 0) {
        throw new Error(
          "The call succeeded but returned no sources — search did not actually run.",
        );
      }
      return `read ${result.sources.length} page(s), e.g. ${result.sources[0].url}`;
    },
  );
}

// --- GitHub App ------------------------------------------------------------

async function verifyGithub(): Promise<void> {
  const configured =
    process.env.RR_GITHUB_APP_ID &&
    process.env.RR_GITHUB_APP_INSTALLATION_ID &&
    process.env.RR_GITHUB_APP_PRIVATE_KEY &&
    process.env.RR_GITHUB_ORG;
  if (!configured) {
    return skip(
      "GitHub App",
      "installation token",
      "RR_GITHUB_APP_* / RR_GITHUB_ORG not fully set",
    );
  }

  const { getGithubAdapter, resetGithubAdapter, checkGithubRepo } = await import(
    "../src/lib/rogue-raise/integrations/github"
  );
  resetGithubAdapter();

  const adapter = getGithubAdapter();
  record({
    provider: "GitHub App",
    name: "provider selection",
    status: adapter.provider === "app" ? "pass" : "fail",
    detail: `selected "${adapter.provider}"`,
    hint: "Credentials are set but the local provider was chosen — check readAppConfig() in integrations/github.ts.",
  });

  // Exercises the JWT → installation-token exchange, which is the part most
  // likely to be wrong (clock skew, PEM newline escaping, wrong installation).
  await attempt(
    "GitHub App",
    "authenticated read",
    "Check the PEM has literal \\n escapes, the app is installed on RR_GITHUB_ORG, and the installation id matches that install.",
    async () => {
      const reachable = await checkGithubRepo(
        `https://github.com/${process.env.RR_GITHUB_ORG}/.github`,
      );
      // "unknown" means the token exchange or the request failed silently.
      if (reachable === "unknown") {
        throw new Error(
          "Reachability came back unknown — the installation token exchange probably failed.",
        );
      }
      return `org is reachable (repo probe: ${reachable})`;
    },
  );

  if (!WRITE) {
    return skip("GitHub App", "create repo", "write checks need --write");
  }
  skip(
    "GitHub App",
    "create repo",
    "not automated: creating a repo leaves an artifact in the WR org. Provision one real event from the console instead, then delete the repo.",
  );
}

// --- Resend ----------------------------------------------------------------

async function verifyResend(): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    return skip("Resend", "send", "RESEND_API_KEY is not set");
  }
  const { getEmailAdapter, resetEmailAdapter } = await import(
    "../src/lib/rogue-raise/integrations/email"
  );
  resetEmailAdapter();

  const to = process.env.RR_ADMIN_NOTIFY_EMAIL;
  if (!WRITE) {
    return skip("Resend", "send", "write checks need --write");
  }
  if (!to) {
    return skip(
      "Resend",
      "send",
      "set RR_ADMIN_NOTIFY_EMAIL to the address this should send to",
    );
  }

  await attempt(
    "Resend",
    `send to ${to}`,
    "Check RESEND_API_KEY and that RR_EMAIL_FROM is a verified sending domain in Resend.",
    async () => {
      const result = await getEmailAdapter().send({
        to,
        subject: "Rogue Raise provider check",
        text: "If you are reading this, Resend is wired correctly. Nothing else to do.",
        html: "<p>If you are reading this, Resend is wired correctly. Nothing else to do.</p>",
      });
      return `accepted${result?.id ? ` (${result.id})` : ""} — confirm it actually arrives`;
    },
  );
}

// --- Vercel Blob -----------------------------------------------------------

async function verifyBlob(): Promise<void> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return skip("Vercel Blob", "round trip", "BLOB_READ_WRITE_TOKEN is not set");
  }
  if (!WRITE) {
    return skip("Vercel Blob", "round trip", "write checks need --write");
  }

  const { getBlobAdapter, resetBlobAdapter } = await import(
    "../src/lib/rogue-raise/integrations/blob"
  );
  resetBlobAdapter();
  const adapter = getBlobAdapter();
  const key = `provider-check/${Date.now()}.txt`;
  const payload = "rogue-raise-provider-check";

  await attempt(
    "Vercel Blob",
    "put → get → del",
    "Check BLOB_READ_WRITE_TOKEN belongs to the store this project is linked to.",
    async () => {
      const { ref } = await adapter.put({
        key,
        body: payload,
        contentType: "text/plain",
      });
      const { body } = await adapter.get(ref);
      if (body.toString("utf8") !== payload) {
        throw new Error("Blob round-tripped with different content.");
      }
      await adapter.del(ref);
      return `wrote, read back, and deleted ${key}`;
    },
  );
}

// --- Report ----------------------------------------------------------------

async function main() {
  console.log(
    `Rogue Raise provider check — ${WRITE ? "read AND write" : "read-only (pass --write for the rest)"}\n`,
  );

  await verifyAiGateway();
  await verifyGithub();
  await verifyResend();
  await verifyBlob();

  const failed = results.filter((r) => r.status === "fail");
  const skipped = results.filter((r) => r.status === "skip");
  const passed = results.filter((r) => r.status === "pass");

  console.log(
    `\n${passed.length} passed, ${failed.length} failed, ${skipped.length} skipped.`,
  );

  if (skipped.length > 0 && failed.length === 0) {
    console.log(
      "\nSkipped checks are NOT passes. Until each provider has run here at least\nonce, treat it as unverified in HANDOFF.md.",
    );
  }

  // Non-zero on failure so this can gate a deploy.
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
