/**
 * The AI seam, with attention to the web-search wiring (PRD §5.3.1).
 *
 * `generateText` is mocked: these prove what we ASK the gateway for and what we
 * do with what it returns. Whether Anthropic's search tool behaves as
 * documented is a smoke test against a real key, and is listed as one in
 * HANDOFF.md rather than pretended at here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { generateTextMock } = vi.hoisted(() => ({ generateTextMock: vi.fn() }));

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return { ...actual, generateText: generateTextMock };
});

import {
  DEFAULT_WEB_SEARCH_USES,
  DEV_ASSET_BANNER,
  getAiAdapter,
  resetAiAdapter,
} from "./ai-gateway";

const ORIGINAL_ENV = { ...process.env };

function gatewayResult(overrides: Record<string, unknown> = {}) {
  return {
    text: "A document.",
    usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    sources: [],
    ...overrides,
  };
}

beforeEach(() => {
  resetAiAdapter();
  generateTextMock.mockReset().mockResolvedValue(gatewayResult());
  process.env.AI_GATEWAY_API_KEY = "test-key";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  resetAiAdapter();
});

describe("gateway provider", () => {
  it("does NOT attach a search tool unless asked", async () => {
    await getAiAdapter().generate({ prompt: "Write something." });
    const call = generateTextMock.mock.calls[0][0];
    // Most agents write from the intake; paying for search they didn't ask for
    // would be both slower and worse.
    expect(call.tools).toBeUndefined();
    expect(call.stopWhen).toBeUndefined();
  });

  it("attaches the search tool and lets the model finish writing", async () => {
    await getAiAdapter().generate({ prompt: "Research this.", webSearch: {} });
    const call = generateTextMock.mock.calls[0][0];
    expect(call.tools).toHaveProperty("web_search");
    // Without a stop condition the generation ends at the first tool result and
    // returns no document at all.
    expect(call.stopWhen).toBeDefined();
  });

  it("honours a caller's search budget, and has a default", async () => {
    await getAiAdapter().generate({ prompt: "x", webSearch: {} });
    await getAiAdapter().generate({ prompt: "x", webSearch: { maxUses: 2 } });
    expect(DEFAULT_WEB_SEARCH_USES).toBeGreaterThan(0);
    expect(generateTextMock).toHaveBeenCalledTimes(2);
  });

  it("returns the pages the model actually read", async () => {
    generateTextMock.mockResolvedValue(
      gatewayResult({
        sources: [
          {
            type: "source",
            sourceType: "url",
            id: "1",
            url: "https://example.org/report",
            title: "The report",
          },
        ],
      }),
    );
    const result = await getAiAdapter().generate({
      prompt: "Research this.",
      webSearch: {},
    });
    expect(result.sources).toEqual([
      { url: "https://example.org/report", title: "The report" },
    ]);
  });

  it("ignores non-URL sources rather than inventing a link for them", async () => {
    generateTextMock.mockResolvedValue(
      gatewayResult({
        sources: [
          {
            type: "source",
            sourceType: "document",
            id: "2",
            mediaType: "application/pdf",
            title: "An attachment",
          },
        ],
      }),
    );
    const result = await getAiAdapter().generate({ prompt: "x", webSearch: {} });
    expect(result.sources).toEqual([]);
  });

  it("survives a provider that reports no sources at all", async () => {
    generateTextMock.mockResolvedValue(gatewayResult({ sources: undefined }));
    const result = await getAiAdapter().generate({ prompt: "x", webSearch: {} });
    expect(result.sources).toEqual([]);
  });
});

describe("dev provider", () => {
  beforeEach(() => {
    delete process.env.AI_GATEWAY_API_KEY;
    resetAiAdapter();
  });

  it("never fabricates a source", async () => {
    const result = await getAiAdapter().generate({ prompt: "x", webSearch: {} });
    // An empty list is the honest answer; a plausible-looking one would be the
    // exact failure the citation machinery exists to prevent.
    expect(result.sources).toEqual([]);
    expect(result.provider).toBe("dev");
  });

  it("says out loud that it could not search", async () => {
    const result = await getAiAdapter().generate({ prompt: "x", webSearch: {} });
    expect(result.text).toContain(DEV_ASSET_BANNER);
    expect(result.text).toContain("cannot search");
  });

  it("stays silent about search when none was asked for", async () => {
    const result = await getAiAdapter().generate({ prompt: "x" });
    expect(result.text).not.toContain("cannot search");
  });

  it("is refused in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    resetAiAdapter();
    expect(() => getAiAdapter()).toThrow(/AI Gateway not configured/);
    vi.unstubAllEnvs();
  });
});
