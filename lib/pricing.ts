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

export type Provider = "groq" | "google" | "anthropic";

// "free"    → eligible for the daily free tier (the current open-weight council)
// "premium" → credits-only; too expensive to give away, gated behind a funded
//             wallet. Premium models never appear until their provider key is
//             configured AND an adapter exists (see PREMIUM_MODELS_PENDING).
export type ModelTier = "free" | "premium";

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
  tier?: ModelTier;      // undefined = "free"
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

// ── PREMIUM TIER (pending go-live) ───────────────────────────────────────
// Real Anthropic prices, pinned 2026-07-23 from the PRIMARY source
// (platform.claude.com/docs → Pricing · Model pricing table). USD per 1M
// tokens, standard on-demand rates. These are NOT invented — unlike the
// specs a certain ungrounded model volunteered, every number here traces to
// the provider's own page, the same discipline as GROUNDING_COST_USD.
//
// NOT yet merged into MODEL_REGISTRY: the boot must not advertise a model the
// gate can't call. Go-live checklist (each a real, verifiable step):
//   1. Add ANTHROPIC_API_KEY to Vercel env.
//   2. Add a callAnthropic() adapter in app/api/chat/route.ts (Messages API:
//      POST /v1/messages, headers x-api-key + anthropic-version, body
//      { model, max_tokens, system, messages }; usage.input_tokens /
//      usage.output_tokens; stop_reason === "max_tokens" ⇒ truncated).
//   3. Env-gate: only surface these when process.env.ANTHROPIC_API_KEY is set
//      (same pattern as grounding availability).
//   4. Enforce tier === "premium" ⇒ credits-only (no free-tier debit).
//   5. Verify a real Opus 4.8 call returns sealed, on the FIRST live call —
//      do not trust the adapter until a genuine round-trip is receipted.
//
// Adapter gotchas (verified against Anthropic's own API reference — these are
// 400s, not style notes, and callGemini's current shape would trip two of them):
//   • NO temperature / top_p / top_k. Removed on Opus 4.8, Sonnet 5, Fable 5 —
//     sending any of them returns 400. Steer with the prompt instead.
//   • Thinking is per-model: Opus 4.8 runs WITHOUT thinking unless you send
//     thinking:{type:"adaptive"} explicitly; Sonnet 5 runs adaptive by default;
//     Fable 5 is always-on and REJECTS any thinking config (omit the field).
//     The old {type:"enabled",budget_tokens:N} is gone everywhere — 400.
//   • Depth is output_config:{effort:"low|medium|high|xhigh|max"}, not tokens.
//   • Fable 5 also: requires 30-day data retention (400 under ZDR), and can
//     return HTTP 200 with stop_reason:"refusal" — check stop_reason BEFORE
//     reading content[0], or the gate throws on a refusal.
//   • Stream anything over ~16k max_tokens or the request hits HTTP timeout.
//
// Grounding a Claude tier later: Anthropic's native web search is a server tool
// (web_search_20260209 on Opus 4.8 / Sonnet 5) at $10/1,000 searches = $0.01 per
// search — CHEAPER than Gemini's $0.035. Worth its own pinned constant then.
//
// Tokenizer note: Opus 4.7+, Fable 5, Sonnet 5 use a newer tokenizer that
// yields ~30% more tokens for the same text. The receipt counts REAL returned
// tokens, so it stays honest automatically — the higher counts are expected,
// not a bug.
//
// Sonnet 5 carries introductory pricing ($2/$10) through 2026-08-31; it steps
// to $3/$15 on 2026-09-01. Re-verify and re-pin then (bump PRICE_SHEET_DATE).
export const PREMIUM_MODELS_PENDING: readonly ModelSpec[] = [
  {
    id: "claude-opus-4.8",
    providerModel: "claude-opus-4-8",
    provider: "anthropic",
    name: "Claude Opus 4.8",
    family: "Anthropic",
    color: "#d97757",
    inPerM: 5,
    outPerM: 25,
    note: "Frontier reasoning · credits only · native web-search grounding $0.01/search",
    tier: "premium",
  },
  {
    id: "claude-sonnet-5",
    providerModel: "claude-sonnet-5",
    provider: "anthropic",
    name: "Claude Sonnet 5",
    family: "Anthropic",
    color: "#c98fb1",
    inPerM: 2,   // introductory thru 2026-08-31; → $3 on 2026-09-01
    outPerM: 10, // introductory thru 2026-08-31; → $15 on 2026-09-01
    note: "Balanced flagship · credits only · intro pricing thru Aug 31 2026",
    tier: "premium",
  },
  {
    id: "claude-haiku-4.5",
    providerModel: "claude-haiku-4-5",
    provider: "anthropic",
    name: "Claude Haiku 4.5",
    family: "Anthropic",
    color: "#8fc9b1",
    inPerM: 1,
    outPerM: 5,
    note: "Fast + inexpensive premium · credits only",
    tier: "premium",
  },
  {
    id: "claude-fable-5",
    providerModel: "claude-fable-5",
    provider: "anthropic",
    name: "Claude Fable 5",
    family: "Anthropic",
    color: "#c8a96e",
    inPerM: 10,
    outPerM: 50,
    note: "Premium creative · credits only",
    tier: "premium",
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
