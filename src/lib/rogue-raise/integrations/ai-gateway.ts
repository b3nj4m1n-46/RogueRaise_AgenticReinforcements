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
import { generateText } from "ai";

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
}

export interface GenerateUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface GenerateResult {
  text: string;
  usage: GenerateUsage;
  model: string;
  provider: "gateway" | "dev";
}

export interface AiAdapter {
  readonly provider: "gateway" | "dev";
  generate(input: GenerateInput): Promise<GenerateResult>;
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
