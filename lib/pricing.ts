// ── Verum Frontier price sheet + cost-plus receipt ──────────────────────
//
// Cost-plus model per VERUM_FRONTIER_BRAIN.md:
//   Direct API cost (real token counts × published provider rates)
//   + Infrastructure 5%
//   + Project Support 15%  (server 30% / development 40% / steward 20% / reserve 10%)
//   = YOUR COST
//
// Provider rates (on-demand, per 1M tokens) read directly from PRIMARY sources.
// The sheet is layered — each block records when it was last verified:
//   • Free council per-token rates — 2026-07-14, groq.com/pricing +
//     ai.google.dev/gemini-api/docs/pricing. (07-14 correction: Llama 3.3 70B is
//     $0.59/$0.79 on Groq's own page — the $0.30/$0.40 pinned 07-12 came from
//     stale secondary sources and understated receipts.)
//   • Premium council per-token rates — 2026-07-23 (see PREMIUM_MODELS below).
//   • Per-search retrieval rates — 2026-07-23/24 (searchUnitUsd).
//   • Cache-read multipliers — 2026-07-24 (cacheMultiplier), reconciled live
//     against the xAI console.
// PRICE_SHEET_DATE is the date the sheet last MATERIALLY changed — bump it on any
// rate/structure change so the date printed on every receipt matches reality.
// Always re-verify against the provider's own page before re-pinning.

export const PRICE_SHEET_DATE = "2026-07-24";

// Google Search grounding surcharge — Google bills grounded requests separately
// from tokens ($35 / 1,000 requests = $0.035/request, pinned from
// ai.google.dev/gemini-api/docs/pricing). A grounded answer costs real money to
// retrieve-and-cite; the receipt shows it so nothing hides.
export const GROUNDING_COST_USD = 0.035;

// Anthropic's NATIVE web search — the answering model retrieves and cites for
// itself, so there is no relay through another model's synthesis. $10 / 1,000
// searches = $0.01/search, pinned from platform.claude.com/docs → Pricing ·
// Web search tool. Cheaper than Google's $0.035 AND first-hand: the citations
// point at what the answering model actually read.
export const ANTHROPIC_SEARCH_COST_USD = 0.01;

// Native search on the other premium providers, each pinned 2026-07-23:
//   OpenAI  $10.00 / 1k calls (developers.openai.com → Pricing · Built-in tools).
//           gpt-5.6-sol grounds via the RESPONSES API (a different endpoint shape
//           from Chat Completions) with the web_search server tool — the adapter
//           exists and is verified live, so OpenAI grounds first-hand, NOT via the
//           Gemini relay. Ungrounded GPT still uses Chat Completions.
//   xAI     $5.00 / 1k calls (docs.x.ai → Pricing · Tools) — cheapest of all.
// Both wired via the RESPONSES surface: OpenAI verified live (12 searches,
// receipt matched); xAI through its Agent Tools API at api.x.ai/v1/responses —
// the old Chat-Completions Live Search is dead (410 "deprecated", field-tested
// 2026-07-24), and its per-source num_sources_used metric died with it. Agent
// Tools web search bills per CALL: $5/1k = XAI_SEARCH_COST_USD $0.005/call.
// Verification = first live grounded Grok query, reconciled against the xAI
// console charge.
export const OPENAI_SEARCH_COST_USD = 0.01;
export const XAI_SEARCH_COST_USD = 0.005;

export type Provider = "groq" | "google" | "anthropic" | "openai" | "xai";

// What ONE web search costs, by whoever actually ran it. These differ by 7x
// across providers, so a single blended "grounding cost" would misreport every
// query. The receipt bills the rate of the provider that did the searching.
export function searchUnitUsd(provider: Provider): number {
  switch (provider) {
    case "anthropic": return ANTHROPIC_SEARCH_COST_USD;
    case "openai":    return OPENAI_SEARCH_COST_USD;
    case "xai":       return XAI_SEARCH_COST_USD;
    default:          return GROUNDING_COST_USD; // Gemini relay via Google
  }
}

// CACHED input tokens are billed far below the full input rate — providers cache
// repeated context (system prompt, conversation history, recalled memories) and
// charge cache-hits at a fraction. Billing cached tokens at the FULL rate was a
// real overcharge, caught by reconciling a live receipt against the xAI console
// (79.9K of 122K input tokens were cache-hits, billed at ~1/7th). This returns
// the cache-read fraction of the input rate, per provider, each pinned from the
// provider's own pricing page (2026-07-24):
//   OpenAI  cached $0.50/M vs $5/M input = 0.10×
//   xAI     cached $0.30/M vs $2/M input = 0.15×
//   Anthropic cache-read = 0.10× (moot — we send no cache_control, so nothing
//             caches; wired anyway for correctness if that changes)
//   Google  Gemini context cache ≈ 0.25×
//   Groq    no prompt caching → 1.0× (cached count is always 0 anyway)
export function cacheMultiplier(provider: Provider): number {
  switch (provider) {
    case "openai":    return 0.10;
    case "xai":       return 0.15;
    case "anthropic": return 0.10;
    case "google":    return 0.25;
    default:          return 1.0; // groq — no caching
  }
}

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
  // A pre-announced rate change that takes effect ON/AFTER `from` (ISO date, UTC).
  // The gate flips to these rates automatically on that date so it never silently
  // under- or over-charges against a provider's scheduled price step. Used for
  // Sonnet 5's intro-pricing expiry — see effectiveRates().
  scheduledRate?: { from: string; inPerM: number; outPerM: number };
}

// The rates in force for a spec at a given moment. If a scheduledRate has come
// due, those win — so a provider's announced price step (e.g. Sonnet 5's intro
// pricing ending 2026-08-31) applies automatically instead of waiting on a manual
// re-pin. The receipt, the chips, and the estimates all read through this, so
// billing and display never diverge from what the provider actually charges.
export function effectiveRates(spec: ModelSpec, now: Date = new Date()): { inPerM: number; outPerM: number } {
  const sched = spec.scheduledRate;
  if (sched && now.getTime() >= Date.parse(sched.from + "T00:00:00Z")) {
    return { inPerM: sched.inPerM, outPerM: sched.outPerM };
  }
  return { inPerM: spec.inPerM, outPerM: spec.outPerM };
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

// ── PREMIUM TIER — credits only ──────────────────────────────────────────
// Every rate below was pinned 2026-07-23 from the provider's OWN pricing page:
//   Anthropic  platform.claude.com/docs → Pricing · Model pricing
//   OpenAI     developers.openai.com/api/docs/pricing
//   xAI        docs.x.ai/docs/models
// Not one number came from a model's say-so — the same rule the gate applies
// to its own answers, and the same discipline as GROUNDING_COST_USD.
//
// Two invariants enforced in app/api/chat/route.ts, not here:
//   1. A premium model is never advertised unless its provider key is set.
//   2. tier === "premium" ⇒ credits only. Never billed to the free tier.
//
// Re-pin: Sonnet 5 steps $2/$10 → $3/$15 on 2026-09-01.
// xAI: grok-4.5 is $2/$6 under 200k context, $4/$12 above. Chat prompts here
// are capped far below 200k, so the under-200k rate is the honest one —
// revisit if a long-document mode ever lifts that cap.
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
export const PREMIUM_MODELS: readonly ModelSpec[] = [
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
    inPerM: 2,   // introductory thru 2026-08-31
    outPerM: 10, // introductory thru 2026-08-31
    // Anthropic's announced step; the gate flips to it automatically on this date
    // so Sonnet is never silently under-billed after intro pricing ends.
    scheduledRate: { from: "2026-09-01", inPerM: 3, outPerM: 15 },
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
    color: "#e0b354",
    inPerM: 10,
    outPerM: 50,
    note: "Most capable · always-on reasoning · credits only",
    tier: "premium",
  },
  {
    id: "gpt-5.6-sol",
    providerModel: "gpt-5.6-sol",
    provider: "openai",
    name: "GPT-5.6 Sol",
    family: "OpenAI",
    color: "#74aa9c",
    inPerM: 5,
    outPerM: 30,
    note: "OpenAI flagship · credits only",
    tier: "premium",
  },
  {
    id: "grok-4.5",
    providerModel: "grok-4.5",
    provider: "xai",
    name: "Grok 4.5",
    family: "xAI",
    color: "#a8b3c4",
    inPerM: 2,
    outPerM: 6,
    note: "xAI flagship · credits only · <200k context rate",
    tier: "premium",
  },
] as const;

// Free council + premium council. Order matters for the client's chip row.
export const ALL_MODELS: readonly ModelSpec[] = [...MODEL_REGISTRY, ...PREMIUM_MODELS];

export function getModel(id: string): ModelSpec | undefined {
  return ALL_MODELS.find(m => m.id === id);
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
  inputTokens: number;       // TOTAL prompt tokens (cached + uncached)
  outputTokens: number;      // completion tokens (includes reasoning where the provider folds it in)
  cachedInputTokens?: number; // the cache-hit portion of inputTokens, billed at the cache rate
}

export interface Receipt {
  priceSheetDate: string;
  model: string;
  rates: { inPerM: number; outPerM: number };
  usage: Usage;
  directUsd: number;     // token cost (real counts × rates, cached billed at cache rate)
  uncachedInputTokens: number; // input billed at full rate
  cachedInputTokens: number;   // input billed at the cache rate (cache-hits)
  cacheRatePerM: number;       // the cache-read rate applied to cached tokens
  groundingUsd: number;  // retrieval surcharge (0 when ungrounded)
  searchRequests: number;  // how many real searches were billed
  searchUnitUsd: number;   // price per search for THIS provider
  infraUsd: number;      // 5% of (direct + grounding)
  supportUsd: number;    // 15% of (direct + grounding)
  supportSplit: { server: number; development: number; steward: number; reserve: number };
  totalUsd: number;      // (direct + grounding) × 1.20
  chargedUsd: number;    // 0 on the free tier; exact totalUsd when paid from credits
  tier: "free" | "credits";
}

const usd = (v: number) => Number(v.toFixed(9));

export function buildReceipt(spec: ModelSpec, usage: Usage, searchRequests = 0, now: Date = new Date()): Receipt {
  // Rates in force at the moment of the query — a scheduled price step (e.g.
  // Sonnet 5's intro pricing ending Aug 31) applies automatically, so the receipt
  // never diverges from what the provider actually charges.
  const { inPerM, outPerM } = effectiveRates(spec, now);
  // Split input into cache-hits (billed cheap) and uncached (billed full), exactly
  // as the provider does. Billing everything at the full input rate over-charged
  // long/grounded/recall-heavy queries, where most of the context is cached.
  const cached = Math.max(0, Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens));
  const uncached = usage.inputTokens - cached;
  const cacheRatePerM = usd(inPerM * cacheMultiplier(spec.provider));
  const direct = usd(
    (uncached / 1_000_000) * inPerM +
    (cached / 1_000_000) * cacheRatePerM +
    (usage.outputTokens / 1_000_000) * outPerM,
  );
  // Retrieval is priced per search, and the rate depends on WHO searched:
  // a model with native search bills its provider's rate; the Gemini relay
  // bills Google's. Never blend the two into one invented number.
  const searchUnit = searchUnitUsd(spec.provider);
  const grounding = usd(searchRequests * searchUnit);
  const base = direct + grounding;
  const infra = usd(base * INFRA_PCT);
  const support = usd(base * SUPPORT_PCT);
  return {
    priceSheetDate: PRICE_SHEET_DATE,
    model: spec.id,
    rates: { inPerM, outPerM },
    usage,
    directUsd: direct,
    uncachedInputTokens: uncached,
    cachedInputTokens: cached,
    cacheRatePerM,
    groundingUsd: grounding,
    searchRequests,
    searchUnitUsd: searchUnit,
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
