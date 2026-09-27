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
//   • Free council per-token rates — 2026-09-25, from Groq's OWN published rate
//     card. groq.com/pricing now answers 308 → groq.com/ (the homepage, no rate
//     table), so the primary source is Groq's docs: the model table at
//     console.groq.com/docs/models plus the per-model pages
//     console.groq.com/docs/model/<provider>/<model>. Read that day:
//       openai/gpt-oss-120b  $0.15 in / $0.60 out  — RE-CONFIRMED, unchanged (Production)
//       openai/gpt-oss-20b   $0.075 in / $0.30 out — NEW budget chip (Production)
//       qwen/qwen3.8-27b     $0.80 in / $4.00 out  — NEW, replaces qwen/qwen3.6-27b.
//                            Listed under PREVIEW models ("may be discontinued
//                            at short notice") — the Alibaba seat is the least
//                            durable one; watch model health.
//     Groq's model pages also list a CACHED-input rate for GPT-OSS now ($0.075 for
//     120B, $0.037 for 20B). cacheMultiplier("groq") below is still 1.0, so any
//     cache-hit Groq reports is billed at the full input rate (over, never under).
//     Deliberately NOT changed in the 2026-09-25 model migration — see CHANGES.md.
//     Gemini 2.5 Flash $0.30 / $2.50 re-confirmed the same day at
//     ai.google.dev/gemini-api/docs/pricing (paid tier, text/image/video).
//     Retired from the live registry 2026-09-25 (see RETIRED_MODELS): Llama 3.3 70B
//     (Groq's model table now lists it Enterprise / "Contact Sales" and the
//     on-demand API returns 404 model_not_found) and Qwen 3.6 27B (404). Their last
//     pinned rates are kept in RETIRED_MODELS for the record; every old receipt
//     already carries the rates it was billed at.
//     (History: 07-14 correction — Llama 3.3 70B was $0.59/$0.79 on Groq's own page;
//     the $0.30/$0.40 pinned 07-12 came from stale secondary sources.)
//   • Premium council per-token rates — 2026-07-23; Claude Sonnet 5 and GPT-5.6 Sol
//     corrected 2026-09-25 from the providers' own pages (see PREMIUM_MODELS below).
//     Claude Opus 5.5 added and Claude Fable 5 superseded by Claude Fable 5.1 on
//     2026-09-27 — every Anthropic row re-read that day from the model pricing
//     table at platform.claude.com/docs/en/about-claude/pricing.
//   • Per-search retrieval rates — 2026-07-23/24 (searchUnitUsd).
//   • Cache-read multipliers — 2026-07-24 (cacheMultiplier), reconciled live
//     against the xAI console.
// PRICE_SHEET_DATE is the date the sheet last MATERIALLY changed — bump it on any
// rate/structure change so the date printed on every receipt matches reality.
// Always re-verify against the provider's own page before re-pinning.
//
// 2026-09-25: free-council migration (Llama 3.3 70B + Qwen 3.6 27B retired,
// Qwen 3.8 27B + GPT-OSS 20B added, GPT-OSS 120B re-confirmed) and two premium
// corrections (Sonnet 5 stays $2/$10 — the scheduled step was cancelled; GPT-5.6
// Sol $4/$20 promotional). Receipts sealed before this date keep the date and
// rates they were sealed with; nothing sealed is rewritten.
// 2026-09-27: Claude Opus 5.5 added ($4/$20), Claude Fable 5.1 replaces Fable 5
// (same $10/$50), and cache-read rates became per-model for Anthropic (Opus 5.5
// 0.05×, Fable 5.1 0.025× — see ModelSpec.cacheReadMultiplier).
export const PRICE_SHEET_DATE = "2026-09-27";

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
//   Anthropic cache-read = 0.10× on most models, but NOT all: Opus 5.5 is 0.05×
//             and Fable 5.1 0.025×, so those carry ModelSpec.cacheReadMultiplier,
//             which wins over this provider default. (Moot today — we send no
//             cache_control, so nothing caches; wired so it stays right if that
//             changes.)
//   Google  Gemini context cache ≈ 0.25×
//   Groq    no prompt caching → 1.0× (cached count is always 0 anyway)
// Writing a prompt into the cache costs MORE than not caching at all: 1.25× the
// input rate — Anthropic's at the 5-minute TTL (2× at the 1-hour TTL), OpenAI's
// on GPT-5.6 and later. Providers report those tokens in a separate field, and a
// receipt that ignores it would drop real billed tokens on the floor — the
// mirror image of the cache-read overcharge. Per provider:
//   Anthropic  always zero today — we send no cache_control (see the note on
//              cacheMultiplier); wired so the arithmetic stays right if it changes.
//   OpenAI     NOT zero. GPT-5.6 caches implicitly by default, writing through
//              the latest user message once the prompt reaches 1,024 visible
//              tokens (developers.openai.com/api/docs/guides/prompt-caching,
//              read 2026-09-27), so gpt-5.6-sol receipts carry the writes OpenAI
//              reports (cache_write_tokens, read in lib/usage.ts). 1.25 × $4.00
//              = $5.00, the published Sol cache-write rate.
//   Others     zero. xAI documents no cache-write field or charge (its caching
//              page, read 2026-09-27); the Google and Groq parsers never set one.
export const CACHE_WRITE_MULTIPLIER = 1.25;

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
  // under- or over-charges against a provider's scheduled price step — see
  // effectiveRates(). No model uses it as of 2026-09-25: its one user, Sonnet 5's
  // announced $3/$15 step, was cancelled by Anthropic (see PREMIUM_MODELS). Only set
  // it from a step the provider's OWN page still announces on the day you pin it.
  scheduledRate?: { from: string; inPerM: number; outPerM: number };
  // Cache-read price as a fraction of inPerM, when this model's differs from its
  // provider's default in cacheMultiplier(). Pin it from the provider's own page.
  cacheReadMultiplier?: number;
  // Anthropic output_config.effort, sent on every call when set. On models that
  // always think (Opus 5.5, Fable 5.1) effort is the ONLY control over how much
  // they reason — and reasoning is billed as output — so it is pinned here, in
  // one visible place, rather than left to a provider default that can move.
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
}

// The rates in force for a spec at a given moment. If a scheduledRate has come
// due, those win — so a provider's announced price step applies automatically
// instead of waiting on a manual re-pin. The receipt, the chips, and the estimates
// all read through this, so billing and display never diverge. The flip side,
// learned 2026-09-25: an announced step can be CANCELLED, and then this applies a
// price the provider no longer charges (Sonnet 5 billed $3/$15 from 2026-09-01
// although Anthropic kept it at $2/$10). Re-verify any scheduled step on its date.
export function effectiveRates(spec: ModelSpec, now: Date = new Date()): { inPerM: number; outPerM: number } {
  const sched = spec.scheduledRate;
  if (sched && now.getTime() >= Date.parse(sched.from + "T00:00:00Z")) {
    return { inPerM: sched.inPerM, outPerM: sched.outPerM };
  }
  return { inPerM: spec.inPerM, outPerM: spec.outPerM };
}

// The FREE COUNCIL — three model families as of 2026-09-25: OpenAI (open
// weights), Alibaba, Google. The first entry is the default pick and the ALICE
// router's fallback, so it must be the most dependable model (production tier).
// Every rate here is a PINNED, VERIFIED number: a model id is never swapped
// without re-pinning its rate from the provider's own page, which is why model
// ids live in code beside their prices instead of in env config. The env
// kill-switch VERUM_DISABLED_MODELS (see app/api/chat/route.ts) is what makes
// the next retirement a config change: it can hide a dead model instantly, it
// can never point a price at a different model.
export const MODEL_REGISTRY: readonly ModelSpec[] = [
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
    // Same family as GPT-OSS 120B (OpenAI open weights) — a cheaper, faster
    // sibling, NOT an extra family. Added 2026-09-25 at Groq's published rate.
    id: "gpt-oss-20b",
    providerModel: "openai/gpt-oss-20b",
    provider: "groq",
    name: "GPT-OSS 20B",
    family: "OpenAI (open weights)",
    color: "#aed581",
    inPerM: 0.075,
    outPerM: 0.30,
    note: "OpenAI open-weight · budget sibling of GPT-OSS 120B (same family) · served by Groq LPU",
  },
  {
    // Lineage of the Alibaba seat: qwen/qwen3-32b (decommissioned by Groq
    // 2026-07-17) → qwen/qwen3.6-27b (404 model_not_found, found 2026-09-25) →
    // qwen/qwen3.8-27b. Groq serves 3.8 as a PREVIEW model; if it disappears,
    // hide it with VERUM_DISABLED_MODELS and the council honestly shrinks to two
    // families (the gate's copy is derived from the boot list, so it stays true).
    id: "qwen3.8-27b",
    providerModel: "qwen/qwen3.8-27b",
    provider: "groq",
    name: "Qwen 3.8 27B",
    family: "Alibaba",
    color: "#b39ddb",
    inPerM: 0.80,
    outPerM: 4.00,
    note: "Open weights · Groq PREVIEW model (may be discontinued at short notice) · served by Groq LPU",
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
// Corrections re-pinned 2026-09-25 from the providers' own pages (details on
// each entry): Claude Sonnet 5 stays $2/$10 (the scheduled $3/$15 step was
// cancelled); GPT-5.6 Sol $4/$20 promotional — RE-CHECK ON 2026-11-21.
// xAI: grok-4.5 is $2/$6 under 200k context, $4/$12 above. Chat prompts here
// are capped far below 200k, so the under-200k rate is the honest one —
// revisit if a long-document mode ever lifts that cap.
//
// Adapter gotchas (verified against Anthropic's own API reference — these are
// 400s, not style notes, and callGemini's current shape would trip two of them):
//   • NO temperature / top_p / top_k. Removed on Opus 4.8, Opus 5.5, Sonnet 5 and
//     the Fable models — sending any of them returns 400. Steer with the prompt.
//   • Thinking is per-model: Opus 4.8 runs WITHOUT thinking unless you send
//     thinking:{type:"adaptive"} explicitly; Sonnet 5 runs adaptive by default;
//     Opus 5.5 and Fable 5.1 ALWAYS think and REJECT {type:"disabled"} (omit the
//     field). The old {type:"enabled",budget_tokens:N} is gone everywhere — 400.
//   • Depth is output_config:{effort:"low|medium|high|xhigh|max"}, not tokens —
//     pinned per model in ModelSpec.effort. Opus 5.5 defaults to "medium" when
//     it is omitted, one level below the other Opus models.
//   • Thinking tokens count against max_tokens even though their text is never
//     returned, so an always-thinking model needs cap room for thinking + reply
//     (MAX_OUTPUT_TOKENS_PREMIUM in route.ts).
//   • Opus 5.5 and Fable 5.1 return 400 on forced tool_choice (any/tool). The
//     gate never sends tool_choice, and never replays thinking blocks, so the
//     "preserved thinking" history checks cannot fire here.
//   • Fable 5.1 requires 30-day data retention (400 under ZDR), and every model
//     here can return HTTP 200 with stop_reason:"refusal" — check stop_reason
//     BEFORE reading content[0], or the gate throws on a refusal.
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
export const PREMIUM_MODELS: readonly ModelSpec[] = [
  {
    // Released 2026-09-22; Anthropic's recommended default model. Rates read
    // 2026-09-27 from platform.claude.com/docs/en/about-claude/pricing: $4 input,
    // $5 5-minute cache writes (1.25×), $0.20 cache hits, $20 output per MTok —
    // footnote: "Cache hits and refreshes on Claude Opus 5.5 are priced at 0.05x
    // the base input price." It always thinks, so effort is pinned: "high", for
    // the deep-dive work the premium tier is for (the API default is "medium").
    id: "claude-opus-5.5",
    providerModel: "claude-opus-5-5",
    provider: "anthropic",
    name: "Claude Opus 5.5",
    family: "Anthropic",
    color: "#f08a5d",
    inPerM: 4,
    outPerM: 20,
    cacheReadMultiplier: 0.05,
    effort: "high",
    note: "Newest Opus · always-on reasoning (effort high) for deep dives · credits only · native web-search $0.01/search",
    tier: "premium",
  },
  {
    // Anthropic lists Opus 4.8 as Legacy since Opus 5.5, but kept here on
    // purpose: Opus 5.5 ships stricter cybersecurity classifiers, and Anthropic
    // says most cybersecurity tasks get routed to Opus 4.8 — the security and
    // OSINT deep dives this gate is used for. Runs without thinking (field omitted).
    id: "claude-opus-4.8",
    providerModel: "claude-opus-4-8",
    provider: "anthropic",
    name: "Claude Opus 4.8",
    family: "Anthropic",
    color: "#d97757",
    inPerM: 5,
    outPerM: 25,
    note: "Frontier reasoning, no thinking · Anthropic's route for most cybersecurity work · credits only · native web-search $0.01/search",
    tier: "premium",
  },
  {
    id: "claude-sonnet-5",
    providerModel: "claude-sonnet-5",
    provider: "anthropic",
    name: "Claude Sonnet 5",
    family: "Anthropic",
    color: "#c98fb1",
    // $2/$10 is now the STANDARD price. Source: Anthropic's pricing page
    // (platform.claude.com/docs/en/about-claude/pricing), footnote read 2026-09-25:
    //   "The $2/$10 per million input/output token pricing for Claude Sonnet 5,
    //    announced at launch as introductory pricing through August 31, 2026, is
    //    now the standard price. The previously scheduled increase to $3/$15 per
    //    million input/output tokens on September 1, 2026 will not occur."
    // The scheduledRate step to $3/$15 (from 2026-09-01) was REMOVED 2026-09-25.
    // Until then it billed Sonnet 5 at $3/$15 — above Anthropic's price.
    inPerM: 2,
    outPerM: 10,
    note: "Balanced flagship · credits only",
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
    // Successor to Claude Fable 5 (GA 2026-09-01), which it replaces on the gate
    // at the same price. Rates read 2026-09-27 from platform.claude.com/docs/en/
    // about-claude/pricing: $10 input, $12.50 5-minute cache writes (1.25×), $0.25
    // cache hits, $50 output per MTok — footnote: "Cache hits and refreshes on
    // Claude Fable 5.1 and Claude Mythos 5.1 are priced at 0.025x the base input
    // price." Effort "high" is also the API default; pinned so it cannot drift.
    id: "claude-fable-5.1",
    providerModel: "claude-fable-5-1",
    provider: "anthropic",
    name: "Claude Fable 5.1",
    family: "Anthropic",
    color: "#e0b354",
    inPerM: 10,
    outPerM: 50,
    cacheReadMultiplier: 0.025,
    effort: "high",
    note: "Most capable · always-on reasoning (effort high) · credits only · native web-search $0.01/search",
    tier: "premium",
  },
  {
    id: "gpt-5.6-sol",
    providerModel: "gpt-5.6-sol",
    provider: "openai",
    name: "GPT-5.6 Sol",
    family: "OpenAI",
    color: "#74aa9c",
    // Re-pinned 2026-09-25 from developers.openai.com/api/docs/pricing (Standard,
    // short context): $4.00 input · $0.40 cached input · $5.00 cache writes ·
    // $20.00 output (was $5/$30). This is PROMOTIONAL pricing — the page says:
    //   "GPT-5.6 Sol's promotional pricing is available at least through
    //    November 21, 2026."
    // RE-CHECK ON 2026-11-21 and re-pin (bump PRICE_SHEET_DATE) if it changes.
    // Cached $0.40 = cacheMultiplier("openai") 0.10 × $4.00 and cache writes $5.00 =
    // CACHE_WRITE_MULTIPLIER 1.25 × $4.00, so no multiplier changes are needed.
    // A LONG-CONTEXT tier also exists ($8.00 in / $0.80 cached / $10.00 writes /
    // $30.00 out). Chat stays below it: prompts are capped by MAX_INPUT_CHARS +
    // MAX_HISTORY_CHARS + MAX_ATTACH_CHARS + 3 recalled memories (~52k characters,
    // roughly 13k tokens of English). The page as read did not state the threshold, and GROUNDED
    // calls add retrieved-page tokens server-side — if a receipt ever shows input
    // near the long-context threshold, re-check which tier OpenAI billed.
    inPerM: 4,
    outPerM: 20,
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

// ── RETIRED — sealed history only, never selectable ─────────────────────────
// Models the gate once served and no longer offers — because the provider
// withdrew them, or because the gate replaced them with a successor (the `why`
// says which, and never claims a withdrawal that did not happen). They are
// deliberately NOT in ALL_MODELS, so getModel() refuses them and nothing can be
// billed to them again. They stay listed so that everything already SEALED under
// their ids keeps its meaning: the boot list returns them as `retiredModels` so a
// restored session still shows who answered, and a request naming one gets an
// explanation (410) instead of "Unknown model.". The in-browser verifier keeps its
// own append-only id → providerModel map (lib/sealVerify.ts PROVIDER_MODEL), and
// server-side memory recall hashes the sealed model id verbatim without a registry
// lookup — retiring a model must never break a seal. Append-only: never delete one.
export interface RetiredModel {
  id: string;
  providerModel: string;
  name: string;
  family: string;
  color: string;
  retiredOn: string;    // day the gate stopped offering it (ISO date)
  why: string;
  lastRates?: { inPerM: number; outPerM: number }; // last pinned rate, for the record (when known)
}

export const RETIRED_MODELS: readonly RetiredModel[] = [
  {
    // The Alibaba seat before 2026-07-17 (the id is assumed to follow the same
    // pattern as its successors; harmless if nothing was ever sealed under it).
    id: "qwen3-32b",
    providerModel: "qwen/qwen3-32b",
    name: "Qwen3 32B",
    family: "Alibaba",
    color: "#b39ddb",
    retiredOn: "2026-07-17",
    why: "Groq decommissioned qwen/qwen3-32b on 2026-07-17 (deprecation email 2026-07-14); succeeded by qwen/qwen3.6-27b",
  },
  {
    id: "llama-3.3-70b",
    providerModel: "llama-3.3-70b-versatile",
    name: "Llama 3.3 70B",
    family: "Meta",
    color: "#c8a96e",
    retiredOn: "2026-09-25",
    why: "Groq's on-demand API returns 404 model_not_found; Groq's model table now lists it as Enterprise / Contact Sales only",
    lastRates: { inPerM: 0.59, outPerM: 0.79 },
  },
  {
    id: "qwen3.6-27b",
    providerModel: "qwen/qwen3.6-27b",
    name: "Qwen 3.6 27B",
    family: "Alibaba",
    color: "#b39ddb",
    retiredOn: "2026-09-25",
    why: "Groq's on-demand API returns 404 model_not_found; succeeded by qwen/qwen3.8-27b",
    lastRates: { inPerM: 0.60, outPerM: 3.00 },
  },
  {
    // NOT withdrawn by Anthropic — Fable 5 is still served (listed Legacy). The
    // gate replaced it with its successor at the same price, so the seat moved.
    id: "claude-fable-5",
    providerModel: "claude-fable-5",
    name: "Claude Fable 5",
    family: "Anthropic",
    color: "#e0b354",
    retiredOn: "2026-09-27",
    why: "replaced on the gate by Claude Fable 5.1 at the same $10/$50 rate; Anthropic still serves Fable 5 as a Legacy model",
    lastRates: { inPerM: 10, outPerM: 50 },
  },
] as const;

export function getRetiredModel(id: string): RetiredModel | undefined {
  return RETIRED_MODELS.find(m => m.id === id);
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
  outputTokens: number;      // ALL billed output: visible answer + reasoning, counted once (see lib/usage.ts)
  reasoningTokens?: number;  // the reasoning PART of outputTokens, as reported — shown, never added again
  cachedInputTokens?: number; // the cache-hit portion of inputTokens, billed at the cache rate
  cacheWriteTokens?: number;  // the portion written INTO the cache, billed ABOVE the input rate
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
  cacheWriteTokens: number;    // input written into the cache (billed above full rate)
  cacheWriteRatePerM: number;  // the cache-write rate applied to those tokens
  groundingUsd: number;  // retrieval surcharge (0 when ungrounded)
  searchRequests: number;  // how many real searches were billed
  searchUnitUsd: number;   // price per search for THIS provider
  infraUsd: number;      // 5% of (direct + grounding)
  supportUsd: number;    // 15% of (direct + grounding)
  supportSplit: { server: number; development: number; steward: number; reserve: number };
  totalUsd: number;      // (direct + grounding) × 1.20
  chargedUsd: number;    // 0 on the free tier; exact totalUsd when paid from credits
  tier: "free" | "credits";
  // Present ONLY when the provider declined the turn (buildDeclinedReceipt).
  // Absent on every answered turn, so those receipts — and their RECEIPT leaf —
  // keep exactly the shape they had.
  refusal?: {
    category: string | null;  // stop_details.category as sent (null = no named category)
    preOutput: boolean;       // declined before any output (empty content)
    providerBilled: boolean;  // did the PROVIDER bill this call, per its published rules
    usageLabel: string;       // what the usage counts on this receipt mean
  };
}

const usd = (v: number) => Number(v.toFixed(9));

export function buildReceipt(spec: ModelSpec, usage: Usage, searchRequests = 0, now: Date = new Date()): Receipt {
  // Rates in force at the moment of the query — a scheduled price step (see
  // ModelSpec.scheduledRate) applies automatically, so the receipt tracks what
  // the provider charges.
  const { inPerM, outPerM } = effectiveRates(spec, now);
  // Split input into cache-hits (billed cheap) and uncached (billed full), exactly
  // as the provider does. Billing everything at the full input rate over-charged
  // long/grounded/recall-heavy queries, where most of the context is cached.
  // Input splits three ways, each billed at its own rate: cache-hits (cheap),
  // cache-writes (dearer than uncached), and everything else at the full rate.
  const cached = Math.max(0, Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens));
  const written = Math.max(0, Math.min(usage.cacheWriteTokens ?? 0, usage.inputTokens - cached));
  const uncached = usage.inputTokens - cached - written;
  const cacheRatePerM = usd(inPerM * (spec.cacheReadMultiplier ?? cacheMultiplier(spec.provider)));
  const cacheWriteRatePerM = usd(inPerM * CACHE_WRITE_MULTIPLIER);
  const direct = usd(
    (uncached / 1_000_000) * inPerM +
    (cached / 1_000_000) * cacheRatePerM +
    (written / 1_000_000) * cacheWriteRatePerM +
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
    cacheWriteTokens: written,
    cacheWriteRatePerM,
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

// ── Provider-declined turns (Anthropic refusals) ─────────────────────────
//
// Anthropic returns a safety decline as HTTP 200 with stop_reason "refusal",
// empty content and token counts in usage — and whether IT bills that call
// depends on the refusal category. Pinned from Anthropic's own page,
// platform.claude.com/docs/en/build-with-claude/refusals-and-fallback
// ("How refusals are billed" + the "Billed before any output" column),
// read 2026-09-27:
//   "a refusal that arrives before any output is billed when its
//    stop_details.category is "bio", "frontier_llm", or "reasoning_extraction"
//    ... A refusal before any output in any other category, or with a null
//    category, is not billed."
//   cyber No · bio Yes · frontier_llm Yes · reasoning_extraction Yes · general_harms No
// Anthropic says "The billed categories may change" — that table is the source
// of truth; re-check it and re-date this block on any change. A category NOT in
// this list (including one added after this date) is treated as unbilled: if
// that is wrong, the gate absorbs the cost instead of charging a visitor for a
// refusal the provider may never have billed us for.
//
// A MID-OUTPUT refusal is billed differently: "A mid-stream refusal bills the
// input tokens and the output already streamed at normal rates", in any
// category. The gate doesn't stream. The marker the page gives for a pre-output
// refusal is that `content` is empty, so that is the test: a decline counts as
// mid-output only when partial output is actually present in `content`.
// output_tokens is deliberately NOT the test — every Fable 5 decline in the
// credits ledger (seq 68, 79, 80; 2026-08-02/08) reports 3–7 output tokens, and
// the page says nothing about what those count. If that reading is wrong, the
// gate absorbs a few output tokens rather than billing a visitor for a refusal.
export const BILLED_PREOUTPUT_REFUSAL_CATEGORIES: readonly string[] = ["bio", "frontier_llm", "reasoning_extraction"];

export function providerBillsRefusal(category: string | null, preOutput: boolean): boolean {
  if (!preOutput) return true; // declined after output began — billed at normal rates
  return category !== null && BILLED_PREOUTPUT_REFUSAL_CATEGORIES.includes(category);
}

// The receipt for a turn the provider declined. When the provider billed it,
// this is the ordinary cost-plus receipt. When it didn't, every dollar figure is
// zero — there is no provider cost to pass through, so there is nothing to mark
// up — while the reported token counts stay on the receipt, labeled as reported
// rather than billed. Either way the `refusal` block says which case applied.
export function buildDeclinedReceipt(
  spec: ModelSpec, usage: Usage, category: string | null, preOutput: boolean, now: Date = new Date(),
): Receipt {
  const providerBilled = providerBillsRefusal(category, preOutput);
  const r = buildReceipt(spec, usage, 0, now);
  if (providerBilled) {
    return {
      ...r,
      refusal: {
        category,
        preOutput,
        providerBilled,
        usageLabel: preOutput
          ? "billed by provider — pre-output refusal in a billed category"
          : "billed by provider — declined after output began (normal rates, any category)",
      },
    };
  }
  return {
    ...r,
    directUsd: 0,
    groundingUsd: 0,
    infraUsd: 0,
    supportUsd: 0,
    supportSplit: { server: 0, development: 0, steward: 0, reserve: 0 },
    totalUsd: 0,
    chargedUsd: 0,
    refusal: { category, preOutput, providerBilled, usageLabel: "reported, not billed by provider" },
  };
}

// Format a USD amount with enough precision for sub-cent values.
export function fmtUsd(v: number): string {
  if (v === 0) return "$0.00";
  if (v < 0.01) return "$" + v.toFixed(6);
  return "$" + v.toFixed(4);
}
