/**
 * AI model access seam. Runs through the Vercel AI Gateway using "provider/model"
 * strings (PRD §3 / §11). Default to the latest, most capable Claude models for
 * authoring/research and a faster tier for classification.
 */
export const AI_MODELS = {
  authoring: process.env.RR_AI_MODEL_AUTHORING ?? "anthropic/claude-opus-4-8",
  fast: process.env.RR_AI_MODEL_FAST ?? "anthropic/claude-haiku-4-5",
} as const;

export interface AiGatewayConfig {
  apiKey: string;
}

export function getAiGatewayConfig(): AiGatewayConfig {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) {
    throw new Error(
      "AI Gateway not configured (set AI_GATEWAY_API_KEY). Agent runs require it.",
    );
  }
  return { apiKey };
}
