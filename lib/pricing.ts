// ── Verum Frontier price sheet + cost-plus receipt ──────────────────────
//
// Cost-plus model per VERUM_FRONTIER_BRAIN.md:
//   Direct API cost (real token counts × published provider rates)
//   + Infrastructure 5%
//   + Project Support 15%  (server 30% / development 40% / steward 20% / reserve 10%)
//   = YOUR COST
//
// Provider rates pinned 2026-07-12 (on-demand, per 1M tokens):
//   groq.com/pricing, ai.google.dev/gemini-api/docs/pricing
// Update PRICE_SHEET_DATE whenever rates are re-verified.

export const PRICE_SHEET_DATE = "2026-07-12";

export type Provider = "groq" | "google";

export interface ModelSpec {
  id: string;            // our stable id used by the client
  providerModel: string; // model name at the provider API
  provider: Provider;
  name: string;          // display name
  family: string;        // model family / lab of origin
  color: string;         // UI accent
  inPerM: number;        // USD per 1M input tokens
  outPerM: number;       // USD per 1M output tokens
  note: string;
}

export const MODEL_REGISTRY: readonly ModelSpec[] = [
  {
    id: "llama-3.3-70b",
    providerModel: "llama-3.3-70b-versatile",
    provider: "groq",
    name: "Llama 3.3 70B",
    family: "Meta",
    color: "#c8a96e",
    inPerM: 0.30,
    outPerM: 0.40,
    note: "Open weights · served by Groq LPU",
  },
  {
    id: "gpt-oss-120b",
    providerModel: "openai/gpt-oss-120b",
    provider: "groq",
    name: "GPT-OSS 120B",
    family: "OpenAI (open weights)",
    color: "#81c784",
    inPerM: 0.15,
    outPerM: 0.60,
    note: "OpenAI open-weight model · served by Groq LPU",
  },
  {
    id: "qwen3-32b",
    providerModel: "qwen/qwen3-32b",
    provider: "groq",
    name: "Qwen3 32B",
    family: "Alibaba",
    color: "#b39ddb",
    inPerM: 0.29,
    outPerM: 0.59,
    note: "Open weights · served by Groq LPU",
  },
  {
    id: "gemini-2.5-flash",
    providerModel: "gemini-2.5-flash",
    provider: "google",
    name: "Gemini 2.5 Flash",
    family: "Google",
    color: "#8ab4f8",
    inPerM: 0.30,
    outPerM: 2.50,
    note: "Google AI Studio API",
  },
] as const;

export function getModel(id: string): ModelSpec | undefined {
  return MODEL_REGISTRY.find(m => m.id === id);
}

// ── Receipt ──────────────────────────────────────────────────────────────

export const INFRA_PCT = 0.05;
export const SUPPORT_PCT = 0.15;
export const SUPPORT_SPLIT = {
  server: 0.30,
  development: 0.40,
  steward: 0.20,
  reserve: 0.10,
} as const;

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface Receipt {
  priceSheetDate: string;
  model: string;
  rates: { inPerM: number; outPerM: number };
  usage: Usage;
  directUsd: number;
  infraUsd: number;      // 5% of direct
  supportUsd: number;    // 15% of direct
  supportSplit: { server: number; development: number; steward: number; reserve: number };
  totalUsd: number;      // direct × 1.20
  chargedUsd: number;    // 0 on the free tier
  tier: "free";
}

const usd = (v: number) => Number(v.toFixed(9));

export function buildReceipt(spec: ModelSpec, usage: Usage): Receipt {
  const direct = usd(
    (usage.inputTokens / 1_000_000) * spec.inPerM +
    (usage.outputTokens / 1_000_000) * spec.outPerM,
  );
  const infra = usd(direct * INFRA_PCT);
  const support = usd(direct * SUPPORT_PCT);
  return {
    priceSheetDate: PRICE_SHEET_DATE,
    model: spec.id,
    rates: { inPerM: spec.inPerM, outPerM: spec.outPerM },
    usage,
    directUsd: direct,
    infraUsd: infra,
    supportUsd: support,
    supportSplit: {
      server: usd(support * SUPPORT_SPLIT.server),
      development: usd(support * SUPPORT_SPLIT.development),
      steward: usd(support * SUPPORT_SPLIT.steward),
      reserve: usd(support * SUPPORT_SPLIT.reserve),
    },
    totalUsd: usd(direct + infra + support),
    chargedUsd: 0,
    tier: "free",
  };
}

// Format a USD amount with enough precision for sub-cent values.
export function fmtUsd(v: number): string {
  if (v === 0) return "$0.00";
  if (v < 0.01) return "$" + v.toFixed(6);
  return "$" + v.toFixed(4);
}
