/**
 * Citation extraction and reachability checking (PRD §5.3.1: research documents
 * must carry *"verifiable, reachable citations"*).
 *
 * The problem this exists for is specific and serious: a model asked to research
 * a county's homelessness data will happily produce a plausible URL for a report
 * that does not exist. A volunteer reads it on a Saturday morning, can't find
 * the data, and concludes the whole document is untrustworthy. Worse, a sponsor
 * sees their own domain cited for something they never published.
 *
 * So the rule is **check, then report — never silently rewrite**. This module
 * does not edit the document, does not drop a bad link, and does not "fix" a
 * URL. It tells a human which citations answered, which didn't, and which
 * couldn't be reached from here, and the review gate does the rest. A document
 * with a dead link is still worth publishing with a note; a document that has
 * been quietly edited to hide one is not.
 */

/** A link found in the document, with enough context to find it again. */
export interface Citation {
  url: string;
  /** 1-based line number in the source document. */
  line: number;
  /** Markdown link text, when the citation was written as `[text](url)`. */
  label: string | null;
}

export type CitationStatus =
  /** Answered with a success status. */
  | "reachable"
  /** Answered with 4xx/5xx, or the host does not resolve. */
  | "unreachable"
  /**
   * We could not tell: a timeout, a network failure, or a site that blocks
   * automated requests. NOT a failure of the citation — reporting it as one
   * would train reviewers to ignore this whole feature.
   */
  | "unknown";

export interface CitationResult extends Citation {
  status: CitationStatus;
  /** HTTP status when there was one, for the reviewer's judgement. */
  httpStatus: number | null;
  /** Short human-readable reason, never a raw stack. */
  detail: string;
}

/** Markdown `[label](url)` first, so the label travels with the link. */
const MARKDOWN_LINK = /\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g;
/** Bare URLs, for documents that just paste them. */
const BARE_URL = /(?<![("[])\bhttps?:\/\/[^\s<>"')\]]+/g;

/** Trailing punctuation a sentence leaves stuck to a pasted URL. */
function trimUrl(url: string): string {
  return url.replace(/[.,;:!?)\]]+$/, "");
}

export function extractCitations(document: string): Citation[] {
  const found: Citation[] = [];
  const seen = new Set<string>();

  document.split(/\r?\n/).forEach((text, index) => {
    const line = index + 1;

    for (const match of text.matchAll(MARKDOWN_LINK)) {
      const url = trimUrl(match[2]);
      if (seen.has(url)) continue;
      seen.add(url);
      found.push({ url, line, label: match[1].trim() || null });
    }

    // Bare URLs on the same line, skipping any already captured above.
    for (const match of text.matchAll(BARE_URL)) {
      const url = trimUrl(match[0]);
      if (seen.has(url)) continue;
      // A bare match that is really the tail of a markdown link.
      if (text.includes(`](${url}`)) continue;
      seen.add(url);
      found.push({ url, line, label: null });
    }
  });

  return found;
}

export interface CheckOptions {
  timeoutMs?: number;
  /** Injected in tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 6000;

async function checkOne(
  citation: Citation,
  options: CheckOptions,
): Promise<CitationResult> {
  const doFetch = options.fetchImpl ?? fetch;
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const attempt = async (method: "HEAD" | "GET") =>
    doFetch(citation.url, {
      method,
      redirect: "follow",
      signal: AbortSignal.timeout(timeout),
      // Plenty of sites 403 an unrecognized agent; identifying ourselves
      // honestly gets a better answer than pretending to be a browser.
      headers: { "user-agent": "RogueRaise-CitationCheck/1.0 (+White Rabbit)" },
    });

  try {
    let response = await attempt("HEAD");
    // Many servers don't implement HEAD and answer 405/501; a GET is the
    // fallback rather than calling the citation dead.
    if (response.status === 405 || response.status === 501) {
      response = await attempt("GET");
    }

    if (response.ok) {
      return {
        ...citation,
        status: "reachable",
        httpStatus: response.status,
        detail: `Answered ${response.status}.`,
      };
    }

    // 401/403 mean the page exists but won't talk to us — a paywalled report or
    // a bot-blocked site is a perfectly good citation for a human.
    if (response.status === 401 || response.status === 403 || response.status === 429) {
      return {
        ...citation,
        status: "unknown",
        httpStatus: response.status,
        detail:
          response.status === 429
            ? "The site rate-limited us; it may well be fine."
            : "The site refused an automated request. It may still be fine in a browser.",
      };
    }

    return {
      ...citation,
      status: "unreachable",
      httpStatus: response.status,
      detail: `Answered ${response.status}.`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A DNS failure is the one network error that IS evidence about the
    // citation: the host does not exist.
    const dnsFailure = /ENOTFOUND|getaddrinfo|EAI_AGAIN|could not be resolved/i.test(
      message,
    );
    return {
      ...citation,
      status: dnsFailure ? "unreachable" : "unknown",
      httpStatus: null,
      detail: dnsFailure
        ? "That domain doesn't resolve."
        : "We couldn't reach it from here — timeout or network error.",
    };
  }
}

/** How many links to check at once. Polite, and enough for a research doc. */
const CONCURRENCY = 5;

export async function checkCitations(
  citations: Citation[],
  options: CheckOptions = {},
): Promise<CitationResult[]> {
  const results: CitationResult[] = [];
  for (let i = 0; i < citations.length; i += CONCURRENCY) {
    const batch = citations.slice(i, i + CONCURRENCY);
    results.push(...(await Promise.all(batch.map((c) => checkOne(c, options)))));
  }
  return results;
}

export interface CitationReport {
  results: CitationResult[];
  reachable: number;
  unreachable: number;
  unknown: number;
}

export function summarize(results: CitationResult[]): CitationReport {
  return {
    results,
    reachable: results.filter((r) => r.status === "reachable").length,
    unreachable: results.filter((r) => r.status === "unreachable").length,
    unknown: results.filter((r) => r.status === "unknown").length,
  };
}

/**
 * The line an admin reads in the run log. Leads with the bad news, because a
 * reviewer scanning a wall of agent output should not have to hunt for it.
 */
export function describeReport(report: CitationReport): string {
  if (report.results.length === 0) {
    return "No citations found in this document.";
  }
  const parts: string[] = [];
  if (report.unreachable > 0) {
    parts.push(`${report.unreachable} DEAD`);
  }
  parts.push(`${report.reachable} reachable`);
  if (report.unknown > 0) {
    parts.push(`${report.unknown} couldn't be checked`);
  }
  return `Citations: ${parts.join(", ")} (of ${report.results.length}).`;
}

/**
 * A note appended to the reviewed document. It names the dead links inline so
 * the reviewer doesn't have to cross-reference the run log — and so the record
 * of what was checked travels with the document into the repo.
 */
export function buildCitationNote(report: CitationReport): string | null {
  const problems = report.results.filter((r) => r.status !== "reachable");
  if (report.results.length === 0 || problems.length === 0) return null;

  const lines = [
    "",
    "---",
    "",
    "## Citation check",
    "",
    `Checked ${report.results.length} link${report.results.length === 1 ? "" : "s"} when this was drafted.`,
    "",
  ];

  for (const problem of problems) {
    const marker = problem.status === "unreachable" ? "**Dead:**" : "Unverified:";
    lines.push(
      `- ${marker} ${problem.label ? `${problem.label} — ` : ""}${problem.url} (line ${problem.line}) — ${problem.detail}`,
    );
  }

  lines.push(
    "",
    "_Nothing was removed or rewritten. A link that couldn't be checked is often still good; a dead one needs a human to find the real source or drop the claim._",
  );

  return lines.join("\n");
}
