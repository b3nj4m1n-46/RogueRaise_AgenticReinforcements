/**
 * GitHub seam. A **GitHub App** (never a PAT) creates repos in the WR org,
 * commits files, opens PRs, and flips visibility at event time (PRD §3, §5.3.1).
 *
 * Two providers, selected from the environment like every other seam:
 *
 *   - **app** — the real thing, when the `RR_GITHUB_APP_*` credentials are set.
 *     Authenticates by signing a short-lived RS256 JWT as the App, exchanging it
 *     for an installation token, and calling the REST API.
 *   - **local** — writes the same file tree under `RR_LOCAL_GITHUB_DIR` (default
 *     `.rr-github/`, gitignored) so the whole provisioning flow is runnable and
 *     testable with no credentials. Production refuses it: a "repository" that
 *     is really a folder on an ephemeral disk would be a silent failure at
 *     exactly the moment participants need the repo.
 *
 * ⚠️ The **app provider has never run against real credentials.** It follows the
 * documented REST API and is typechecked, but every test exercises the local
 * provider. See HANDOFF.md — smoke-test it when the App is first installed.
 */
import { createSign } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export interface CreateRepoInput {
  name: string;
  description?: string;
  isPrivate: boolean;
}

export interface GithubRepoRef {
  /** Browser URL, e.g. `https://github.com/org/repo`. */
  url: string;
  defaultBranch: string;
  /** `org/repo`, for subsequent API calls. */
  fullName: string;
}

/** `path → UTF-8 content`. Paths are repo-relative and always use `/`. */
export type RepoFiles = Record<string, string>;

export interface PullRequestRef {
  url: string;
  number: number;
}

export interface GithubAdapter {
  readonly provider: "app" | "local";
  createRepo(input: CreateRepoInput): Promise<GithubRepoRef>;
  /** Commit every file on `branch`, creating the branch if needed. */
  putFiles(input: {
    fullName: string;
    branch: string;
    baseBranch: string;
    message: string;
    files: RepoFiles;
  }): Promise<void>;
  openPullRequest(input: {
    fullName: string;
    head: string;
    base: string;
    title: string;
    body: string;
  }): Promise<PullRequestRef>;
  setVisibility(input: { fullName: string; isPrivate: boolean }): Promise<void>;
}

// ---------------------------------------------------------------------------
// Real provider — GitHub App
// ---------------------------------------------------------------------------

const GITHUB_API = "https://api.github.com";

interface AppConfig {
  appId: string;
  privateKey: string;
  installationId: string;
  org: string;
}

function readAppConfig(): AppConfig | null {
  const appId = process.env.RR_GITHUB_APP_ID;
  const privateKey = process.env.RR_GITHUB_APP_PRIVATE_KEY;
  const installationId = process.env.RR_GITHUB_APP_INSTALLATION_ID;
  const org = process.env.RR_GITHUB_ORG;
  if (!appId || !privateKey || !installationId || !org) return null;
  return {
    appId,
    // Env vars can't hold real newlines; the PEM is stored with `\n` escapes.
    privateKey: privateKey.replace(/\\n/g, "\n"),
    installationId,
    org,
  };
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

/**
 * Sign the App JWT. GitHub requires RS256 and a lifetime under 10 minutes; the
 * clock is skewed back 30s because GitHub rejects a token issued in its future.
 */
function signAppJwt(config: AppConfig, now = Date.now()): string {
  const issuedAt = Math.floor(now / 1000) - 30;
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({ iat: issuedAt, exp: issuedAt + 540, iss: config.appId }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  const signature = signer.sign(config.privateKey).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

/** Installation tokens last an hour; cached just under that. */
let cachedToken: { token: string; expiresAt: number } | null = null;

async function installationToken(config: AppConfig): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }
  const response = await fetch(
    `${GITHUB_API}/app/installations/${config.installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${signAppJwt(config)}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
    },
  );
  if (!response.ok) {
    throw new Error(
      `GitHub App auth failed (${response.status}). Check RR_GITHUB_APP_ID, the private key, and the installation id.`,
    );
  }
  const body = (await response.json()) as { token: string; expires_at: string };
  cachedToken = {
    token: body.token,
    expiresAt: new Date(body.expires_at).getTime(),
  };
  return body.token;
}

async function githubFetch<T>(
  config: AppConfig,
  url: string,
  init: RequestInit & { body?: string } = {},
): Promise<T> {
  const token = await installationToken(config);
  const response = await fetch(url.startsWith("http") ? url : `${GITHUB_API}${url}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `GitHub API ${init.method ?? "GET"} ${url} failed (${response.status}): ${detail.slice(0, 300)}`,
    );
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

function appAdapter(config: AppConfig): GithubAdapter {
  return {
    provider: "app",

    async createRepo(input) {
      const repo = await githubFetch<{
        html_url: string;
        default_branch: string;
        full_name: string;
      }>(config, `/orgs/${config.org}/repos`, {
        method: "POST",
        body: JSON.stringify({
          name: input.name,
          description: input.description,
          private: input.isPrivate,
          // A repo with no commit has no default branch to branch from.
          auto_init: true,
        }),
      });
      return {
        url: repo.html_url,
        defaultBranch: repo.default_branch,
        fullName: repo.full_name,
      };
    },

    async putFiles({ fullName, branch, baseBranch, message, files }) {
      // Branch from the base's tip, creating it only if it doesn't exist.
      const base = await githubFetch<{ object: { sha: string } }>(
        config,
        `/repos/${fullName}/git/ref/heads/${baseBranch}`,
      );
      try {
        await githubFetch(config, `/repos/${fullName}/git/refs`, {
          method: "POST",
          body: JSON.stringify({
            ref: `refs/heads/${branch}`,
            sha: base.object.sha,
          }),
        });
      } catch {
        // Already exists — a re-provision pushes onto the same branch.
      }

      for (const [filePath, content] of Object.entries(files)) {
        // The Contents API needs the blob sha to update an existing file.
        let sha: string | undefined;
        try {
          const existing = await githubFetch<{ sha: string }>(
            config,
            `/repos/${fullName}/contents/${encodeURI(filePath)}?ref=${branch}`,
          );
          sha = existing.sha;
        } catch {
          sha = undefined; // new file
        }
        await githubFetch(config, `/repos/${fullName}/contents/${encodeURI(filePath)}`, {
          method: "PUT",
          body: JSON.stringify({
            message,
            content: Buffer.from(content, "utf8").toString("base64"),
            branch,
            ...(sha ? { sha } : {}),
          }),
        });
      }
    },

    async openPullRequest({ fullName, head, base, title, body }) {
      const pr = await githubFetch<{ html_url: string; number: number }>(
        config,
        `/repos/${fullName}/pulls`,
        { method: "POST", body: JSON.stringify({ title, body, head, base }) },
      );
      return { url: pr.html_url, number: pr.number };
    },

    async setVisibility({ fullName, isPrivate }) {
      await githubFetch(config, `/repos/${fullName}`, {
        method: "PATCH",
        body: JSON.stringify({ private: isPrivate }),
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Local provider — writes the same tree to disk
// ---------------------------------------------------------------------------

function localRoot(): string {
  return path.resolve(process.env.RR_LOCAL_GITHUB_DIR ?? ".rr-github");
}

/** Repo and file names are generated, but never build a path from one blindly. */
function safeSegment(value: string): string {
  if (!value || value.includes("..") || value.includes("\\") || value.startsWith("/")) {
    throw new Error(`Unsafe repository path segment: "${value}"`);
  }
  return value;
}

const localAdapter: GithubAdapter = {
  provider: "local",

  async createRepo(input) {
    const org = process.env.RR_GITHUB_ORG ?? "white-rabbit-local";
    const dir = path.join(localRoot(), safeSegment(input.name));
    await mkdir(dir, { recursive: true });
    return {
      url: `file://${dir}`,
      defaultBranch: "main",
      fullName: `${org}/${input.name}`,
    };
  },

  async putFiles({ fullName, branch, files }) {
    const repoName = fullName.split("/").pop() ?? fullName;
    const root = path.join(localRoot(), safeSegment(repoName), safeSegment(branch));
    for (const [filePath, content] of Object.entries(files)) {
      for (const segment of filePath.split("/")) safeSegment(segment);
      const target = path.join(root, filePath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
    }
  },

  async openPullRequest({ fullName, head }) {
    return {
      url: `file://${path.join(localRoot(), fullName.split("/").pop() ?? fullName, head)}`,
      number: 1,
    };
  },

  async setVisibility() {
    // Nothing to do on disk; visibility is a GitHub concept.
  },
};

let adapter: GithubAdapter | undefined;

export function getGithubAdapter(): GithubAdapter {
  if (adapter) return adapter;
  const config = readAppConfig();
  if (config) {
    adapter = appAdapter(config);
  } else if (process.env.NODE_ENV === "production") {
    throw new Error(
      "GitHub App not configured (set RR_GITHUB_APP_ID, RR_GITHUB_APP_PRIVATE_KEY, RR_GITHUB_APP_INSTALLATION_ID, RR_GITHUB_ORG). The local provider writes to disk and is refused in production.",
    );
  } else {
    adapter = localAdapter;
  }
  return adapter;
}

/**
 * Does this GitHub account exist?
 *
 * Deliberately NON-BLOCKING and three-valued. GitHub's user endpoint is rate
 * limited (heavily so unauthenticated), and a registration form that turns a
 * rate limit into "your username is wrong" would turn our problem into the
 * participant's. So: `true` / `false` when we actually know, `"unknown"` when
 * we couldn't find out — and the caller lets `"unknown"` through.
 */
/** `https://github.com/owner/repo(.git)` → its parts, or null. */
function parseRepoUrl(url: string): { owner: string; repo: string } | null {
  const match = /github\.com\/([^/\s]+)\/([^/\s?#]+?)(?:\.git)?\/?$/i.exec(
    url.trim(),
  );
  return match ? { owner: match[1], repo: match[2] } : null;
}

export async function checkGithubUser(
  username: string,
): Promise<true | false | "unknown"> {
  const config = readAppConfig();
  try {
    const headers: Record<string, string> = {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
    };
    // An installation token raises the rate limit substantially; without one
    // the unauthenticated endpoint still answers, just less often.
    if (config) {
      headers.authorization = `Bearer ${await installationToken(config)}`;
    }
    const response = await fetch(
      `${GITHUB_API}/users/${encodeURIComponent(username)}`,
      { headers, signal: AbortSignal.timeout(4000) },
    );
    if (response.status === 404) return false;
    if (response.ok) return true;
    return "unknown";
  } catch {
    // Network failure, timeout, or a rate limit — all "we don't know".
    return "unknown";
  }
}

/**
 * Does this repository exist and is it reachable?
 *
 * Same three-valued, non-blocking contract as `checkGithubUser`: a rate limit
 * or timeout is `"unknown"`, and callers let `"unknown"` through. A team who
 * just built something for two days must not be blocked from submitting by our
 * API quota.
 *
 * Returns `false` only on a definite 404 — which for a private repo is
 * indistinguishable from "doesn't exist", so the caller's copy has to say so.
 */
export async function checkGithubRepo(
  url: string,
): Promise<true | false | "unknown"> {
  const parsed = parseRepoUrl(url);
  if (!parsed) return false;
  const { owner, repo } = parsed;

  const config = readAppConfig();
  try {
    const headers: Record<string, string> = {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
    };
    if (config) {
      headers.authorization = `Bearer ${await installationToken(config)}`;
    }
    const response = await fetch(
      `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      { headers, signal: AbortSignal.timeout(4000) },
    );
    if (response.status === 404) return false;
    if (response.ok) return true;
    return "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Repository statistics for the handoff dashboard (PRD §8.1).
 *
 * **What "lines of code" actually means here.** GitHub has no endpoint that
 * returns a line count. `stats/code_frequency` returns weekly additions and
 * deletions for the repo's whole history, and summing them gives net lines
 * currently in the repository — which is the closest honest answer, and it is
 * what the portal must label it as. It counts everything committed, including
 * vendored files and generated lock files, so it is a scale indicator rather
 * than a measure of effort. The portal says so rather than implying otherwise.
 *
 * Every field is independently nullable, and the reasons are all real ones
 * observed against the live API:
 *
 *   - **202** — GitHub is computing the statistics; asking again later works.
 *   - **422** — the repository is too large for GitHub to compute at all. This
 *     one never resolves, however many times it is re-run.
 *   - **404** — private, or gone. Indistinguishable from here.
 *   - **403** — rate limited.
 *
 * A missing number is shown as "not counted", never as zero: zero would tell a
 * sponsor a team wrote nothing.
 */
export interface RepoStats {
  /** Net lines across the repo's history, or null when GitHub wouldn't say. */
  linesOfCode: number | null;
  /** Bytes per language, GitHub's own breakdown, or null. */
  languages: Record<string, number> | null;
}

export async function fetchRepoStats(url: string): Promise<RepoStats> {
  const parsed = parseRepoUrl(url);
  if (!parsed) return { linesOfCode: null, languages: null };
  const { owner, repo } = parsed;

  const config = readAppConfig();
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  };
  if (config) {
    try {
      headers.authorization = `Bearer ${await installationToken(config)}`;
    } catch {
      // Fall through unauthenticated — a lower rate limit still beats nothing.
    }
  }

  const base = `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  // Stats generation is slow on GitHub's side, so this timeout is longer than
  // the existence checks'.
  const options = { headers, signal: AbortSignal.timeout(10_000) };

  const [frequency, languages] = await Promise.allSettled([
    fetch(`${base}/stats/code_frequency`, options),
    fetch(`${base}/languages`, options),
  ]);

  return {
    linesOfCode: await readLinesOfCode(frequency),
    languages: await readLanguages(languages),
  };
}

async function readLinesOfCode(
  result: PromiseSettledResult<Response>,
): Promise<number | null> {
  // 202 arrives "ok" with an empty body, so the array check below is doing real
  // work rather than being defensive noise.
  if (result.status === "rejected" || !result.value.ok) return null;
  try {
    const weeks = await result.value.json();
    if (!Array.isArray(weeks) || weeks.length === 0) return null;
    let total = 0;
    for (const week of weeks) {
      // [unixTimestamp, additions, deletions] — deletions arrive negative.
      if (!Array.isArray(week) || week.length < 3) continue;
      total += Number(week[1] ?? 0) + Number(week[2] ?? 0);
    }
    return Number.isFinite(total) ? Math.max(0, Math.round(total)) : null;
  } catch {
    return null;
  }
}

async function readLanguages(
  result: PromiseSettledResult<Response>,
): Promise<Record<string, number> | null> {
  if (result.status === "rejected" || !result.value.ok) return null;
  try {
    const body = await result.value.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return null;
    const entries = Object.entries(body).filter(
      ([, bytes]) => typeof bytes === "number" && bytes > 0,
    ) as [string, number][];
    return entries.length > 0 ? Object.fromEntries(entries) : null;
  } catch {
    return null;
  }
}

/** Test seam — resets provider selection and the cached installation token. */
export function resetGithubAdapter(): void {
  adapter = undefined;
  cachedToken = null;
}
