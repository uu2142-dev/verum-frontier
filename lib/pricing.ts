// ── Verum Frontier price sheet + cost-plus receipt ──────────────────────
//
// Cost-plus model per VERUM_FRONTIER_BRAIN.md:
//   Direct API cost (real token counts × published provider rates)
//   + Infrastructure 5%
//   + Project Support 15%  (server 30% / development 40% / steward 20% / reserve 10%)
//   = YOUR COST
//
// Provider rates pinned 2026-07-14 (on-demand, per 1M tokens), read directly
// from the PRIMARY sources: groq.com/pricing, ai.google.dev/gemini-api/docs/pricing.
// (2026-07-14 correction: Llama 3.3 70B is $0.59/$0.79 on Groq's own page —
// the $0.30/$0.40 pinned on 07-12 came from stale secondary sources and
// understated receipts. Always re-verify against the provider's page.)
// Update PRICE_SHEET_DATE whenever rates are re-verified.

export const PRICE_SHEET_DATE = "2026-07-14";

// Google Search grounding surcharge — Google bills grounded requests separately
// from tokens ($35 / 1,000 requests = $0.035/request, pinned from
// ai.google.dev/gemini-api/docs/pricing). A grounded answer costs real money to
// retrieve-and-cite; the receipt shows it so nothing hides.
export const GROUNDING_COST_USD = 0.035;

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
    inPerM: 0.59,
    outPerM: 0.79,
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
    // qwen3-32b decommissioned by Groq 2026-07-17 (deprecation email 07-14);
    // swapped to its successor to keep the Alibaba family in the council.
    id: "qwen3.6-27b",
    providerModel: "qwen/qwen3.6-27b",
    provider: "groq",
    name: "Qwen 3.6 27B",
    family: "Alibaba",
    color: "#b39ddb",
    inPerM: 0.60,
    outPerM: 3.00,
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
  directUsd: number;     // token cost (real counts × rates)
  groundingUsd: number;  // Google Search grounding surcharge (0 when ungrounded)
  infraUsd: number;      // 5% of (direct + grounding)
  supportUsd: number;    // 15% of (direct + grounding)
  supportSplit: { server: number; development: number; steward: number; reserve: number };
  totalUsd: number;      // (direct + grounding) × 1.20
  chargedUsd: number;    // 0 on the free tier; exact totalUsd when paid from credits
  tier: "free" | "credits";
}

const usd = (v: number) => Number(v.toFixed(9));

export function buildReceipt(spec: ModelSpec, usage: Usage, groundingRequests = 0): Receipt {
  const direct = usd(
    (usage.inputTokens / 1_000_000) * spec.inPerM +
    (usage.outputTokens / 1_000_000) * spec.outPerM,
  );
  const grounding = usd(groundingRequests * GROUNDING_COST_USD);
  const base = direct + grounding;
  const infra = usd(base * INFRA_PCT);
  const support = usd(base * SUPPORT_PCT);
  return {
    priceSheetDate: PRICE_SHEET_DATE,
    model: spec.id,
    rates: { inPerM: spec.inPerM, outPerM: spec.outPerM },
    usage,
    directUsd: direct,
    groundingUsd: grounding,
    infraUsd: infra,
    supportUsd: support,
    supportSplit: {
      server: usd(support * SUPPORT_SPLIT.server),
      development: usd(support * SUPPORT_SPLIT.development),
      steward: usd(support * SUPPORT_SPLIT.steward),
      reserve: usd(support * SUPPORT_SPLIT.reserve),
    },
    totalUsd: usd(base + infra + support),
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
