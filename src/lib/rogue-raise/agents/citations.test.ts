import { describe, expect, it } from "vitest";

import {
  buildCitationNote,
  checkCitations,
  describeReport,
  extractCitations,
  summarize,
  type CitationResult,
} from "./citations";

describe("extractCitations", () => {
  it("finds markdown links and keeps their label", () => {
    const found = extractCitations(
      "See [the county report](https://example.org/report.pdf) for detail.",
    );
    expect(found).toEqual([
      { url: "https://example.org/report.pdf", line: 1, label: "the county report" },
    ]);
  });

  it("finds bare URLs", () => {
    const found = extractCitations("Source: https://example.org/data");
    expect(found).toEqual([
      { url: "https://example.org/data", line: 1, label: null },
    ]);
  });

  it("records the line so a reviewer can find it", () => {
    const found = extractCitations(
      ["# Title", "", "First: https://a.example", "", "Second: https://b.example"].join(
        "\n",
      ),
    );
    expect(found.map((c) => c.line)).toEqual([3, 5]);
  });

  it("does not double-count a markdown link as a bare URL too", () => {
    const found = extractCitations("[label](https://example.org/x)");
    expect(found).toHaveLength(1);
  });

  it("strips trailing sentence punctuation from a pasted URL", () => {
    const found = extractCitations("Published at https://example.org/report.");
    expect(found[0].url).toBe("https://example.org/report");
  });

  it("de-duplicates a URL cited more than once", () => {
    const found = extractCitations(
      ["https://example.org/a", "https://example.org/a"].join("\n"),
    );
    expect(found).toHaveLength(1);
  });

  it("ignores non-http schemes", () => {
    expect(extractCitations("mailto:someone@example.org and ftp://x.example")).toEqual(
      [],
    );
  });

  it("returns nothing for a document with no links", () => {
    expect(extractCitations("Plain prose with no sources at all.")).toEqual([]);
  });
});

describe("checkCitations", () => {
  const citation = { url: "https://example.org/x", line: 1, label: null };

  function fakeFetch(handler: (url: string, method: string) => Response | Error) {
    return (async (url: string | URL | Request, init?: RequestInit) => {
      const result = handler(String(url), init?.method ?? "GET");
      if (result instanceof Error) throw result;
      return result;
    }) as unknown as typeof fetch;
  }

  it("marks a 200 reachable", async () => {
    const [result] = await checkCitations([citation], {
      fetchImpl: fakeFetch(() => new Response(null, { status: 200 })),
    });
    expect(result.status).toBe("reachable");
    expect(result.httpStatus).toBe(200);
  });

  it("marks a 404 unreachable", async () => {
    const [result] = await checkCitations([citation], {
      fetchImpl: fakeFetch(() => new Response(null, { status: 404 })),
    });
    expect(result.status).toBe("unreachable");
  });

  it("falls back to GET when the server doesn't implement HEAD", async () => {
    const methods: string[] = [];
    const [result] = await checkCitations([citation], {
      fetchImpl: fakeFetch((_url, method) => {
        methods.push(method);
        return new Response(null, { status: method === "HEAD" ? 405 : 200 });
      }),
    });
    // Plenty of servers 405 a HEAD; calling that citation dead would be wrong.
    expect(methods).toEqual(["HEAD", "GET"]);
    expect(result.status).toBe("reachable");
  });

  it("treats a 403 as UNKNOWN, not dead", async () => {
    const [result] = await checkCitations([citation], {
      fetchImpl: fakeFetch(() => new Response(null, { status: 403 })),
    });
    // A bot-blocked or paywalled page is a perfectly good citation for a human.
    expect(result.status).toBe("unknown");
    expect(result.detail).toContain("browser");
  });

  it("treats a rate limit as unknown", async () => {
    const [result] = await checkCitations([citation], {
      fetchImpl: fakeFetch(() => new Response(null, { status: 429 })),
    });
    expect(result.status).toBe("unknown");
  });

  it("treats a timeout as unknown rather than a failed citation", async () => {
    const [result] = await checkCitations([citation], {
      fetchImpl: fakeFetch(() => new Error("The operation was aborted due to timeout")),
    });
    // Reporting our own network trouble as a bad citation would train reviewers
    // to ignore this whole feature.
    expect(result.status).toBe("unknown");
  });

  it("treats a DNS failure as UNREACHABLE — that IS evidence", async () => {
    const [result] = await checkCitations([citation], {
      fetchImpl: fakeFetch(() => new Error("getaddrinfo ENOTFOUND nope.example")),
    });
    expect(result.status).toBe("unreachable");
    expect(result.detail).toContain("doesn't resolve");
  });

  it("checks every citation given", async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      url: `https://example.org/${i}`,
      line: i + 1,
      label: null,
    }));
    const results = await checkCitations(many, {
      fetchImpl: fakeFetch(() => new Response(null, { status: 200 })),
    });
    expect(results).toHaveLength(12);
  });
});

describe("summarize / describeReport", () => {
  const results: CitationResult[] = [
    { url: "a", line: 1, label: null, status: "reachable", httpStatus: 200, detail: "" },
    { url: "b", line: 2, label: null, status: "unreachable", httpStatus: 404, detail: "" },
    { url: "c", line: 3, label: null, status: "unknown", httpStatus: null, detail: "" },
  ];

  it("counts each status", () => {
    expect(summarize(results)).toMatchObject({
      reachable: 1,
      unreachable: 1,
      unknown: 1,
    });
  });

  it("leads with the bad news", () => {
    // A reviewer scanning a wall of agent output shouldn't hunt for it.
    expect(describeReport(summarize(results)).indexOf("DEAD")).toBeLessThan(
      describeReport(summarize(results)).indexOf("reachable"),
    );
  });

  it("says so plainly when there are no citations", () => {
    expect(describeReport(summarize([]))).toContain("No citations");
  });
});

describe("buildCitationNote", () => {
  it("is null when every citation answered — no noise on a clean document", () => {
    expect(
      buildCitationNote(
        summarize([
          {
            url: "a",
            line: 1,
            label: null,
            status: "reachable",
            httpStatus: 200,
            detail: "",
          },
        ]),
      ),
    ).toBeNull();
  });

  it("is null for a document with no citations at all", () => {
    expect(buildCitationNote(summarize([]))).toBeNull();
  });

  it("names each problem link with its line and label", () => {
    const note = buildCitationNote(
      summarize([
        {
          url: "https://gone.example/report",
          line: 42,
          label: "County report",
          status: "unreachable",
          httpStatus: 404,
          detail: "Answered 404.",
        },
      ]),
    );
    expect(note).toContain("**Dead:**");
    expect(note).toContain("County report");
    expect(note).toContain("line 42");
    expect(note).toContain("Answered 404.");
  });

  it("distinguishes unverified from dead", () => {
    const note = buildCitationNote(
      summarize([
        {
          url: "https://blocked.example",
          line: 1,
          label: null,
          status: "unknown",
          httpStatus: 403,
          detail: "Refused.",
        },
      ]),
    );
    expect(note).toContain("Unverified:");
    expect(note).not.toContain("**Dead:**");
  });

  it("states that nothing was removed or rewritten", () => {
    // The whole posture of the feature: report, never silently edit.
    const note = buildCitationNote(
      summarize([
        {
          url: "x",
          line: 1,
          label: null,
          status: "unreachable",
          httpStatus: 404,
          detail: "",
        },
      ]),
    );
    expect(note).toContain("Nothing was removed or rewritten");
  });
});
