/**
 * AI model access seam. Runs through the Vercel AI Gateway using
 * `"provider/model"` strings (PRD §3 / §11) — the AI SDK resolves a bare
 * provider/model string through the gateway when `AI_GATEWAY_API_KEY` is set.
 *
 * Two providers, selected from the environment exactly like the email and blob
 * seams:
 *
 *   - **gateway** — the real thing, when `AI_GATEWAY_API_KEY` is present.
 *   - **dev** — a deterministic stand-in used when it isn't, so the whole agent
 *     pipeline (run → asset → review) is runnable and testable on a laptop with
 *     no credentials. Its output is deliberately, visibly placeholder text: a
 *     draft that silently looked plausible would be far worse than one that
 *     announces itself.
 *
 * Production refuses the dev provider outright — an agent quietly producing
 * placeholder documents for a real event is the failure mode worth preventing.
 */
import { anthropic } from "@ai-sdk/anthropic";
import { generateText, stepCountIs } from "ai";

/**
 * Default models. Authoring/research gets the most capable Claude model;
 * classification and categorization get the faster tier (PRD §3).
 */
export const AI_MODELS = {
  authoring: process.env.RR_AI_MODEL_AUTHORING ?? "anthropic/claude-opus-5",
  fast: process.env.RR_AI_MODEL_FAST ?? "anthropic/claude-haiku-4-5",
} as const;

export interface GenerateInput {
  /** `"provider/model"`; defaults to the authoring model. */
  model?: string;
  system?: string;
  prompt: string;
  maxOutputTokens?: number;
  /**
   * Turn on **live web research** (PRD §5.3.1: research the sponsor's problem
   * domain, with verifiable citations).
   *
   * This attaches Anthropic's *server-side* web search tool — the search runs on
   * the provider's infrastructure, so there is no crawler to host and no API key
   * beyond the gateway's. The model decides what to search for and returns the
   * pages it used as `sources`, which is what makes the citations in the
   * resulting document real rather than recalled.
   *
   * Without it, a research agent writes from the intake plus whatever it
   * remembers — which produces confident, plausible, occasionally invented
   * references. That is the specific failure this exists to prevent, and why
   * `agents/citations.ts` checks the output regardless.
   */
  webSearch?: { maxUses?: number };
}

export interface GenerateUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/** A page the model actually consulted, when web search was on. */
export interface GenerateSource {
  url: string;
  title?: string;
}

export interface GenerateResult {
  text: string;
  usage: GenerateUsage;
  model: string;
  provider: "gateway" | "dev";
  /** Empty unless `webSearch` was requested and the model used it. */
  sources: GenerateSource[];
}

export interface AiAdapter {
  readonly provider: "gateway" | "dev";
  generate(input: GenerateInput): Promise<GenerateResult>;
}

/**
 * Enough to check a few claims; low enough that a re-run isn't expensive.
 * A research document that needed thirty searches is a sign the intake was thin,
 * not that this should be raised.
 */
export const DEFAULT_WEB_SEARCH_USES = 8;

/**
 * Anthropic's server-side web search, taken from the provider package rather
 * than hand-written as a `provider-defined` literal.
 *
 * The dated name is part of the tool's contract, not decoration — Anthropic
 * ships revisions under new dates and older models only accept older ones. Using
 * the factory means the SDK owns that mapping, and a model that rejects this
 * revision produces a clear provider error rather than a malformed request.
 *
 * The model is still routed through the AI Gateway by its `"provider/model"`
 * string; only the tool DEFINITION comes from this package.
 */
function webSearchTool(maxUses: number) {
  return {
    web_search: anthropic.tools.webSearch_20260209({ maxUses }),
  };
}

const gatewayAdapter: AiAdapter = {
  provider: "gateway",
  async generate(input) {
    const model = input.model ?? AI_MODELS.authoring;
    const result = await generateText({
      model,
      system: input.system,
      prompt: input.prompt,
      maxOutputTokens: input.maxOutputTokens,
      ...(input.webSearch
        ? {
            tools: webSearchTool(
              input.webSearch.maxUses ?? DEFAULT_WEB_SEARCH_USES,
            ),
            // The model searches, reads, and THEN writes, in one call. Without
            // this the generation stops at the first tool result and returns no
            // document at all.
            stopWhen: stepCountIs(12),
          }
        : {}),
    });
    const inputTokens = result.usage?.inputTokens ?? 0;
    const outputTokens = result.usage?.outputTokens ?? 0;
    return {
      text: result.text,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: result.usage?.totalTokens ?? inputTokens + outputTokens,
      },
      model,
      provider: "gateway",
      sources: (result.sources ?? [])
        .filter((source) => source.sourceType === "url")
        .map((source) => ({ url: source.url, title: source.title })),
    };
  },
};

/** Marker every dev-provider output carries. Asserted in tests; visible in review. */
export const DEV_ASSET_BANNER =
  "[PLACEHOLDER — generated without an AI provider configured. Not a real draft.]";

/**
 * Deterministic stand-in. Same prompt in, same text out — which is what makes
 * the pipeline testable. It echoes the prompt back so a developer can see the
 * agent wired up the right context, and estimates usage by the usual ~4
 * characters-per-token rule of thumb (an estimate, and labelled as one).
 */
const devAdapter: AiAdapter = {
  provider: "dev",
  async generate(input) {
    const model = input.model ?? AI_MODELS.authoring;
    const text = [
      DEV_ASSET_BANNER,
      "",
      `Model that would have been used: ${model}`,
      "",
      input.webSearch
        ? "Web research was requested. The dev provider cannot search; a real draft would cite pages it actually read."
        : "",
      input.system ? `## Instructions given\n\n${input.system.trim()}\n` : "",
      "## Context the agent supplied",
      "",
      input.prompt.trim(),
    ]
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    const estimate = (value: string) => Math.ceil(value.length / 4);
    const inputTokens = estimate((input.system ?? "") + input.prompt);
    const outputTokens = estimate(text);
    return {
      text,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
      model,
      provider: "dev",
      // Never fabricate a source: an empty list is the honest answer, and the
      // handler's log says the search didn't happen.
      sources: [],
    };
  },
};

let adapter: AiAdapter | undefined;

export function getAiAdapter(): AiAdapter {
  if (adapter) return adapter;
  if (process.env.AI_GATEWAY_API_KEY) {
    adapter = gatewayAdapter;
  } else if (process.env.NODE_ENV === "production") {
    // Placeholder documents must never be produced for a real event.
    throw new Error(
      "AI Gateway not configured (set AI_GATEWAY_API_KEY). The dev provider is refused in production — it emits placeholder text.",
    );
  } else {
    adapter = devAdapter;
  }
  return adapter;
}

/** Test seam — resets the memoized provider selection. */
export function resetAiAdapter(): void {
  adapter = undefined;
}
