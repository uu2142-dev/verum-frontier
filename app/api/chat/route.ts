// ── /api/chat — the real gate ────────────────────────────────────────────
// Server-side calls to free-tier council models (Groq: Meta/OpenAI-OSS/Qwen,
// Google: Gemini). Returns the model's answer plus:
//   - real token usage from the provider
//   - a cost-plus receipt (direct + 5% infra + 15% support)
//   - a validated bias screen (dual-head: toxicity AUROC 0.92 5-fold,
//     media/framing 0.84 official-split; a triage LABEL, never a filter —
//     fail-open if the checker is unreachable, answers are never blocked)
//   - real SHA-256 leaf hashes + Merkle root over the exchange
//   - stage timings measured server-side
// Everything returned here is real. Anything illustrative stays in DEMO mode.

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from "node:crypto";
import { NextResponse } from "next/server";
import { MODEL_REGISTRY, PREMIUM_MODELS, getModel, buildReceipt, GROUNDING_COST_USD, ANTHROPIC_SEARCH_COST_USD, type ModelSpec, type Usage } from "@/lib/pricing";
import { FREE_DAILY_LIMIT, QUOTA_COOKIE, decodeQuota, encodeQuota, quotaResetIso } from "@/lib/quota";
import { debitWallet, walletBalance } from "@/lib/ledger";
import { stripeConfigured, stripeTestMode } from "@/lib/stripe";

export const runtime = "nodejs";
// Vercel Hobby's real function ceiling is 300s with fluid compute (default),
// NOT 60s — the earlier Fable-5 timeout was this cap set too low, not the plan.
// Grounded premium (deep reasoning + multi-search) needs the headroom; grounded
// Opus already measured ~46s. Raise to Pro's 800s only if a single answer ever
// needs to run longer than 5 minutes (none currently do).
export const maxDuration = 300;

// One provider-call timeout, comfortably under maxDuration so a slow grounded
// answer completes but a hung provider still frees the function with room to
// spare for the bias screen, seal, and debit that run after it.
const PROVIDER_TIMEOUT_MS = 250_000;

const MAX_INPUT_CHARS = 4000;
const MAX_HISTORY_CHARS = 12000;
const MAX_HISTORY_MESSAGES = 20;
const MAX_OUTPUT_TOKENS_FREE = 1024;
const MAX_OUTPUT_TOKENS_PAID = 4096; // paying customers get room; cost-plus bills it honestly
const MAX_ATTACH_CHARS = 24_000; // attached text rides ONE turn; its cost shows on the receipt
const GROUNDING_MODEL_ID = "gemini-2.5-flash"; // only Gemini has built-in Google Search grounding

// Models must know WHO they are: the gate lets users switch models
// mid-conversation ("same question for Gemini"), so each model is told its
// own identity and that earlier answers may come from other models.
function systemPrompt(spec: ModelSpec): string {
  return (
    `You are ${spec.name}, a ${spec.family} model, answering through the ` +
    "Verum Frontier gate (Rabbit Hole AI). The user can address different " +
    "models within one conversation — earlier answers in the history may be " +
    `from other models, and when the user names "${spec.name}" or your family, they mean you. ` +
    "When the user attaches a document, its FULL TEXT is included inline in their message " +
    "between BEGIN/END DOCUMENT markers — you can read it directly; never claim you cannot access attachments. " +
    "Be direct and honest. State uncertainty explicitly — if you do not know, say so. " +
    "Prefer concise answers (under ~300 words) unless the user asks for depth."
  );
}

interface ChatMessage { role: "user" | "assistant"; content: string; }

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

// ── Ed25519 seal signing ─────────────────────────────────────────────────
// The gate signs each Merkle root so exported sessions are externally
// attestable: origin (this gate) + integrity (the hashes), verifiable by
// anyone holding the published public key. Fail-open: no key → seals ship
// unsigned and say so.

const SIGNED_PREFIX = "VF-SEAL-v1";

let _keys: { priv: KeyObject; pub: KeyObject; spkiB64: string; keyId: string } | null | undefined;

function signingKeys() {
  if (_keys !== undefined) return _keys;
  const b64 = process.env.SEAL_SIGNING_KEY;
  if (!b64) { _keys = null; return null; }
  try {
    const priv = createPrivateKey({ key: Buffer.from(b64, "base64"), format: "der", type: "pkcs8" });
    const pub = createPublicKey(priv);
    const spki = pub.export({ format: "der", type: "spki" }) as Buffer;
    _keys = {
      priv, pub,
      spkiB64: spki.toString("base64"),
      keyId: createHash("sha256").update(spki).digest("hex").slice(0, 16),
    };
  } catch {
    _keys = null;
  }
  return _keys;
}

function signRoot(root: string, sealedAt: string) {
  const k = signingKeys();
  if (!k) return null;
  const sig = cryptoSign(null, Buffer.from(`${SIGNED_PREFIX}|${root}|${sealedAt}`), k.priv);
  return { alg: "Ed25519", keyId: k.keyId, signature: sig.toString("base64") };
}

function verifySealSig(root: string, sealedAt: string, signature: string): boolean {
  const k = signingKeys();
  if (!k) return false;
  try {
    return cryptoVerify(
      null,
      Buffer.from(`${SIGNED_PREFIX}|${root}|${sealedAt}`),
      k.pub,
      Buffer.from(signature, "base64"),
    );
  } catch {
    return false;
  }
}

// ── Recalled memories (client-side archive → server-verified) ───────────
// The archive lives in the visitor's browser; the client recalls relevant
// past exchanges and sends them here. We verify each one's Ed25519 seal
// signature before injecting: verified and legacy-unsigned memories are
// injected (labeled), memories that FAIL verification are rejected.

interface MemoryIn {
  query: string;
  response: string;
  modelId: string;
  sealedAt: string;
  root: string;
  leaves?: Array<{ label: string; sha256: string }>;
  sig?: { alg?: string; keyId?: string; signature?: string };
}

const MAX_MEMORIES = 3;
const MEM_QUERY_CHARS = 300;
const MEM_RESPONSE_CHARS = 900;

// Full content verification of a recalled memory. The Ed25519 signature only
// proves "this ROOT was sealed by this gate at this time" — so we also prove
// the TEXT belongs to that root: recompute the QUERY/RESPONSE leaf hashes
// from the claimed text, confirm they appear in the provided leaves, and
// confirm the leaves recompute to the signed root. Tampered text fails here.
function verifyMemoryContent(m: MemoryIn): boolean {
  if (!m.sig?.signature || !Array.isArray(m.leaves) || !m.leaves.length) return false;
  if (!verifySealSig(m.root, m.sealedAt, m.sig.signature)) return false;
  if (merkleRoot(m.leaves.map(l => l.sha256)) !== m.root) return false;
  const qLeaf = m.leaves.find(l => l.label === "QUERY")?.sha256;
  const rLeaf = m.leaves.find(l => l.label === "RESPONSE")?.sha256;
  if (!qLeaf || !rLeaf) return false;
  if (sha256(JSON.stringify({ q: m.query, ts: m.sealedAt })) !== qLeaf) return false;
  if (sha256(JSON.stringify({ r: m.response, model: m.modelId })) !== rLeaf) return false;
  return true;
}

export interface BiasResult {
  version: string;
  toxicity: number;
  toxicityPctile: number;
  framing: number;
  framingPctile: number;
  validated: { toxicityAuroc5fold: number; framingAurocOfficialSplit: number };
  scope: string;
}

// Post-answer triage label from the validated dual-head checker on RHAI infra.
// Fail-open by design: if the screen is down, the answer still ships, honestly
// labeled as unscreened. The screen annotates — it never censors.
async function screenBias(text: string): Promise<BiasResult | null> {
  const endpoint = process.env.BIAS_ENDPOINT;
  const token = process.env.BIAS_TOKEN;
  if (!endpoint || !token || !text) return null;
  try {
    const res = await fetch(`${endpoint}/score`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ texts: [text.slice(0, 4000)] }),
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const r = data.results?.[0];
    if (!r) return null;
    return {
      version: data.version,
      toxicity: r.toxicity,
      toxicityPctile: r.toxicity_pctile,
      framing: r.framing,
      framingPctile: r.framing_pctile,
      validated: {
        toxicityAuroc5fold: data.validated?.toxicity_auroc_5fold,
        framingAurocOfficialSplit: data.validated?.framing_auroc_official_split,
      },
      scope: data.honest_scope,
    };
  } catch {
    return null;
  }
}

function merkleRoot(leaves: string[]): string {
  let level = [...leaves];
  while (level.length > 1) {
    if (level.length % 2) level.push(level[level.length - 1]);
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(sha256(level[i] + level[i + 1]));
    level = next;
  }
  return level[0];
}

// ── Providers ────────────────────────────────────────────────────────────

async function callGroq(spec: ModelSpec, messages: ChatMessage[], memoryContext: string | null, maxTokens: number) {
  const base = systemPrompt(spec);
  const sys = memoryContext ? `${base}\n\n${memoryContext}` : base;
  const body: Record<string, unknown> = {
    model: spec.providerModel,
    messages: [{ role: "system", content: sys }, ...messages],
    max_completion_tokens: maxTokens,
    temperature: 0.7,
  };
  if (spec.providerModel.startsWith("qwen/")) body.reasoning_format = "hidden";

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Groq ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = await res.json();
  let text: string = data.choices?.[0]?.message?.content ?? "";
  text = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const usage: Usage = {
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
  };
  return { text, usage, truncated: data.choices?.[0]?.finish_reason === "length" };
}

async function callGemini(spec: ModelSpec, messages: ChatMessage[], memoryContext: string | null, maxTokens: number) {
  const base = systemPrompt(spec);
  const sys = memoryContext ? `${base}\n\n${memoryContext}` : base;
  const contents = messages.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${spec.providerModel}:generateContent`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": process.env.GEMINI_API_KEY ?? "",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: sys }] },
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature: 0.7,
          // gemini-2.5-flash is a thinking model; without this it can spend
          // the whole output budget on reasoning and return empty text.
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Gemini ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = await res.json();
  const parts: Array<{ text?: string }> = data.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map(p => p.text ?? "").join("").trim();
  const um = data.usageMetadata ?? {};
  const usage: Usage = {
    inputTokens: um.promptTokenCount ?? 0,
    outputTokens: (um.candidatesTokenCount ?? 0) + (um.thoughtsTokenCount ?? 0),
  };
  return { text, usage, truncated: data.candidates?.[0]?.finishReason === "MAX_TOKENS" };
}

export interface GroundingSource { title: string; uri: string; }

// GROUNDED path: Gemini + built-in Google Search. Returns the answer plus the
// real web sources it retrieved, so an answer is CITED rather than generated.
// This is the fix for the failure mode where confident model prose gets
// mistaken for a sourced document — grounded answers carry their receipts.
async function callGeminiGrounded(spec: ModelSpec, messages: ChatMessage[], memoryContext: string | null, maxTokens: number) {
  const base = systemPrompt(spec) +
    " You have Google Search. Ground your answer in the retrieved results and " +
    "rely only on what they support; if the results do not substantiate a claim, " +
    "say so plainly rather than filling the gap.";
  const sys = memoryContext ? `${base}\n\n${memoryContext}` : base;
  const contents = messages.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${spec.providerModel}:generateContent`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": process.env.GEMINI_API_KEY ?? "",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: sys }] },
        tools: [{ google_search: {} }],
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.4 },
      }),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Gemini (grounded) ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = await res.json();
  const parts: Array<{ text?: string }> = data.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map(p => p.text ?? "").join("").trim();
  const um = data.usageMetadata ?? {};
  const usage: Usage = {
    inputTokens: um.promptTokenCount ?? 0,
    outputTokens: (um.candidatesTokenCount ?? 0) + (um.thoughtsTokenCount ?? 0),
  };
  const gm = data.candidates?.[0]?.groundingMetadata ?? {};
  const chunks: Array<{ web?: { uri?: string; title?: string } }> = gm.groundingChunks ?? [];
  const seen = new Set<string>();
  const sources: GroundingSource[] = [];
  for (const c of chunks) {
    const uri = c.web?.uri;
    if (!uri || seen.has(uri)) continue;
    seen.add(uri);
    sources.push({ title: c.web?.title || uri, uri });
  }
  const searchQueries: string[] = gm.webSearchQueries ?? [];
  return {
    text, usage,
    truncated: data.candidates?.[0]?.finishReason === "MAX_TOKENS",
    sources, searchQueries,
  };
}

// ── Premium providers (credits only) ─────────────────────────────────────

// A model is only advertised when its provider key exists — the boot list must
// never offer a model the gate can't actually call.
function providerConfigured(p: ModelSpec["provider"]): boolean {
  switch (p) {
    case "groq":      return !!process.env.GROQ_API_KEY;
    case "google":    return !!process.env.GEMINI_API_KEY;
    case "anthropic": return !!process.env.ANTHROPIC_API_KEY;
    case "openai":    return !!process.env.OPENAI_API_KEY;
    case "xai":       return !!process.env.XAI_API_KEY;
    default:          return false;
  }
}

// Anthropic Messages API. Deliberately minimal: NO temperature/top_p/top_k —
// those are REMOVED on Opus 4.8 / Sonnet 5 / Fable 5 and return 400, so the
// Gemini adapter's shape must NOT be copied here. Thinking config differs per
// model, so it is opt-in per id rather than assumed.
async function callAnthropic(
  spec: ModelSpec,
  messages: ChatMessage[],
  memoryContext: string | null,
  maxTokens: number,
  grounded = false,
) {
  const base = systemPrompt(spec) + (grounded
    ? "\n\nYou have a web search tool. Search before answering when the question " +
      "turns on facts you cannot verify from training alone, and cite what you " +
      "actually read. If the sources do not settle a claim, say so plainly rather " +
      "than filling the gap."
    : "");
  const sys = memoryContext ? `${base}\n\n${memoryContext}` : base;
  const body: Record<string, unknown> = {
    model: spec.providerModel,
    max_tokens: maxTokens,
    system: sys,
    messages,
  };
  if (grounded) {
    // NATIVE retrieval: the answering model searches for itself, so grounding is
    // ADDITIVE — the model you picked stays the model that answers. No relay,
    // no second-hand synthesis, and the citations are first-hand.
    // Dynamic-filtering variant needs Opus 4.6+/Sonnet 4.6+; Haiku 4.5 is
    // older-generation and takes the basic tool. (Fable 5 is newer than the
    // cutoff so it gets the new variant — confirm on its first live call.)
    body.tools = [{
      type: spec.providerModel === "claude-haiku-4-5" ? "web_search_20250305" : "web_search_20260209",
      name: "web_search",
    }];
  }
  // Sonnet 5 runs adaptive thinking BY DEFAULT — for chat we want predictable,
  // cheap, honestly-priced receipts, so turn it off explicitly (accepted there).
  // Opus 4.8 and Haiku 4.5 run without thinking when the field is omitted.
  // Fable 5 is always-on and REJECTS any thinking config — never send it one.
  if (spec.providerModel === "claude-sonnet-5") body.thinking = { type: "disabled" };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Anthropic ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = await res.json();
  const usage: Usage = {
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
  };
  // A safety decline arrives as HTTP 200 with stop_reason "refusal" and empty
  // content. Check stop_reason BEFORE reading content, or the gate throws on a
  // refusal instead of reporting it honestly.
  if (data.stop_reason === "refusal") {
    return {
      text: "This model declined to answer under its own safety policy (stop_reason: refusal). " +
        "No content was generated. The receipt below reflects what was actually billed.",
      usage,
      truncated: false,
      sources: [] as GroundingSource[],
      searchRequests: 0,
    };
  }
  const blocks: Array<{ type?: string; text?: string; content?: unknown }> = data.content ?? [];
  const text = blocks.filter(b => b.type === "text").map(b => b.text ?? "").join("").trim();

  // First-hand citations: the model's own search results, deduped by URL.
  const sources: GroundingSource[] = [];
  const seenUrls = new Set<string>();
  for (const b of blocks) {
    if (b.type !== "web_search_tool_result" || !Array.isArray(b.content)) continue;
    for (const r of b.content as Array<{ url?: string; title?: string }>) {
      if (!r?.url || seenUrls.has(r.url)) continue;
      seenUrls.add(r.url);
      sources.push({ title: r.title || r.url, uri: r.url });
    }
  }
  // Real billed search count from the provider — never inferred from source count
  // (one search can return many results, and a repeated search still costs).
  const searchRequests: number = data.usage?.server_tool_use?.web_search_requests ?? 0;

  // pause_turn = the server-side tool loop hit its cap mid-task. The answer is
  // incomplete, so label it rather than presenting a stopped answer as finished.
  const truncated = data.stop_reason === "max_tokens" || data.stop_reason === "pause_turn";
  return { text, usage, truncated, sources, searchRequests };
}

// OpenAI and xAI both speak the OpenAI chat-completions shape, so one adapter
// covers both. Kept SEPARATE from callGroq on purpose: the free council is live
// and taking real traffic, and refactoring it into a shared path would risk the
// working receipt math for no user-visible gain.
// No temperature — current OpenAI reasoning models reject non-default sampling.
async function callOpenAICompatible(
  spec: ModelSpec,
  messages: ChatMessage[],
  memoryContext: string | null,
  maxTokens: number,
  grounded = false,
) {
  const base = systemPrompt(spec) + (grounded
    ? "\n\nYou have a web search tool. Search before answering when the question " +
      "turns on facts you cannot verify from training alone, and cite what you " +
      "actually read. If the sources do not settle a claim, say so plainly."
    : "");
  const sys = memoryContext ? `${base}\n\n${memoryContext}` : base;
  const cfg = spec.provider === "xai"
    ? { url: "https://api.x.ai/v1/chat/completions", key: process.env.XAI_API_KEY, label: "xAI" }
    : { url: "https://api.openai.com/v1/chat/completions", key: process.env.OPENAI_API_KEY, label: "OpenAI" };

  const reqBody: Record<string, unknown> = {
    model: spec.providerModel,
    messages: [{ role: "system", content: sys }, ...messages],
    max_completion_tokens: maxTokens,
  };
  // No search on this endpoint for ANY provider now. Field-tested twice on xAI:
  // tools:[{type:web_search}] was silently ignored, then search_parameters
  // returned 410 "Live search is deprecated. Please switch to the Agent Tools
  // API" — which is the Responses surface. Grounded OpenAI AND grounded xAI
  // both go through callOpenAIResponses; this adapter is ungrounded-only.
  void grounded;

  const res = await fetch(cfg.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.key ?? ""}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(reqBody),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${cfg.label} ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = await res.json();
  const text: string = (data.choices?.[0]?.message?.content ?? "").trim();
  const usage: Usage = {
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
  };

  // xAI citations. The docs show `citations` but are not explicit about the exact
  // location or the billed-count field on the raw API, so both plausible spots
  // are read and entries may be bare URL strings or objects.
  const sources: GroundingSource[] = [];
  const seenUrls = new Set<string>();
  const rawCites: unknown[] = Array.isArray(data.citations)
    ? data.citations
    : Array.isArray(data.choices?.[0]?.message?.citations)
      ? data.choices[0].message.citations
      : [];
  for (const c of rawCites) {
    const url = typeof c === "string" ? c : (c as { url?: string })?.url;
    if (!url || seenUrls.has(url)) continue;
    seenUrls.add(url);
    const title = typeof c === "string" ? "" : (c as { title?: string })?.title;
    sources.push({ title: title || url, uri: url });
  }
  // Prefer a provider-reported count. If xAI does not report one, fall back to a
  // MINIMUM of 1 billed call rather than guessing high — and searchCountExact
  // tells the receipt whether the number is measured or a floor.
  const reported = data.usage?.num_sources_used ?? data.usage?.num_searches ?? null;
  const searchCountExact = typeof reported === "number";
  const searchRequests: number = searchCountExact
    ? reported
    : (sources.length > 0 ? 1 : 0);

  return {
    text,
    usage,
    truncated: data.choices?.[0]?.finish_reason === "length",
    sources,
    searchRequests,
    searchCountExact,
  };
}

// RESPONSES API — where gpt-5.6-sol AND grok-4.5 search natively. OpenAI's
// shape (`instructions` + `input` + `max_output_tokens`, web_search server
// tool) — VERIFIED LIVE for OpenAI (12 searches, receipt matched). xAI's Agent
// Tools API is the same surface at api.x.ai/v1/responses (their 410 on the old
// search_parameters points here); xAI additionally returns a top-level
// `citations` array, parsed as a fallback. Used ONLY for grounded calls; the
// ungrounded path stays on the proven Chat Completions adapter. Search bills
// per CALL at the provider's pinned rate, counted from web_search_call items.
// Parsing stays defensive: a shape mismatch yields empty sources + an honest
// label, never a crash.
async function callOpenAIResponses(spec: ModelSpec, messages: ChatMessage[], memoryContext: string | null, maxTokens: number, grounded: boolean) {
  const base = systemPrompt(spec) + (grounded
    ? "\n\nYou have a web search tool. Search before answering when the question " +
      "turns on facts you cannot verify from training alone, and cite what you read."
    : "");
  const sys = memoryContext ? `${base}\n\n${memoryContext}` : base;
  const body: Record<string, unknown> = {
    model: spec.providerModel,
    instructions: sys,
    input: messages,
    max_output_tokens: maxTokens,
  };
  if (grounded) body.tools = [{ type: "web_search" }];

  const cfg = spec.provider === "xai"
    ? { url: "https://api.x.ai/v1/responses", key: process.env.XAI_API_KEY, label: "xAI (responses)" }
    : { url: "https://api.openai.com/v1/responses", key: process.env.OPENAI_API_KEY, label: "OpenAI (responses)" };
  const res = await fetch(cfg.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.key ?? ""}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${cfg.label} ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = await res.json();

  const items: Array<{ type?: string; content?: unknown }> = Array.isArray(data.output) ? data.output : [];
  let text = "";
  const sources: GroundingSource[] = [];
  const seen = new Set<string>();
  let searchRequests = 0;
  for (const it of items) {
    if (it.type === "web_search_call") { searchRequests += 1; continue; }
    if (it.type !== "message" || !Array.isArray(it.content)) continue;
    for (const c of it.content as Array<{ type?: string; text?: string; annotations?: Array<{ type?: string; url?: string; title?: string }> }>) {
      if (typeof c.text === "string") text += c.text;
      for (const a of c.annotations ?? []) {
        if (a?.url && !seen.has(a.url)) { seen.add(a.url); sources.push({ title: a.title || a.url, uri: a.url }); }
      }
    }
  }
  // Convenience field on some responses; fall back to it only if item-walk found nothing.
  if (!text && typeof data.output_text === "string") text = data.output_text;
  text = text.trim();

  // xAI fallback: its Agent Tools API "automatically returns source URLs" in a
  // top-level `citations` array (strings or {url,title}); merge any not already
  // captured from annotations.
  if (Array.isArray(data.citations)) {
    for (const c of data.citations as unknown[]) {
      const url = typeof c === "string" ? c : (c as { url?: string })?.url;
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const title = typeof c === "string" ? "" : (c as { title?: string })?.title;
      sources.push({ title: title || url, uri: url });
    }
  }
  // If sources prove a search happened but no web_search_call item was counted
  // (shape drift), bill a floor of ONE call rather than zero or a guess.
  if (searchRequests === 0 && sources.length > 0) searchRequests = 1;

  const usage: Usage = {
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
  };
  const truncated = data.status === "incomplete";
  return { text, usage, truncated, sources, searchRequests };
}

// ── GET: model registry + quota status (client boot) ────────────────────

export async function GET(req: Request) {
  const cookie = getCookie(req, QUOTA_COOKIE);
  const q = decodeQuota(cookie);
  const k = signingKeys();
  return NextResponse.json({
    // Free council always; premium only where the provider key is configured.
    models: [
      ...MODEL_REGISTRY,
      ...PREMIUM_MODELS.filter(m => providerConfigured(m.provider)),
    ].map(m => ({
      id: m.id, name: m.name, family: m.family, color: m.color,
      inPerM: m.inPerM, outPerM: m.outPerM, note: m.note,
      tier: m.tier ?? "free",
      // Native retrieval: GROUND IT is additive for these, not a substitution.
      selfGrounds: m.provider === "anthropic" || m.provider === "openai" || m.provider === "xai",
    })),
    quota: { used: q.n, limit: FREE_DAILY_LIMIT, resetsAtUtc: quotaResetIso() },
    payments: { enabled: stripeConfigured(), testMode: stripeTestMode() },
    grounding: {
      available: !!process.env.GEMINI_API_KEY,
      via: "Gemini 2.5 Flash + Google Search",
      modelId: GROUNDING_MODEL_ID, // client warns when this would override a pick
      surchargeUsd: GROUNDING_COST_USD,
    },
    sealKey: k
      ? {
          alg: "Ed25519", keyId: k.keyId, publicKeySpkiB64: k.spkiB64,
          signedPayloadFormat: `${SIGNED_PREFIX}|<merkleRootHex>|<sealedAtIso>`,
        }
      : null,
  });
}

// ── POST: run the gate ───────────────────────────────────────────────────

export async function POST(req: Request) {
  const t0 = Date.now();

  // [01] INTENT CHECK v1 — format + length validation only (honestly scoped)
  let body: {
    modelId?: string;
    messages?: ChatMessage[];
    memories?: MemoryIn[];
    wallet?: { id?: string; token?: string };
    // ALICE routing happens CLIENT-SIDE (sovereign — the user's browser picks
    // the model and can show the rule); we echo it as a labeled stage.
    routing?: { mode?: string; rule?: string };
    attachment?: { name?: string; text?: string };
    grounded?: boolean; // GROUND IT — route through Gemini + Google Search, cite sources
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const spec = getModel(body.modelId ?? "");
  if (!spec) return NextResponse.json({ error: "Unknown model." }, { status: 400 });

  const messages = (body.messages ?? []).slice(-MAX_HISTORY_MESSAGES);
  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return NextResponse.json({ error: "Last message must be from the user." }, { status: 400 });
  }
  for (const m of messages) {
    if (typeof m.content !== "string" || (m.role !== "user" && m.role !== "assistant")) {
      return NextResponse.json({ error: "Malformed message." }, { status: 400 });
    }
  }
  const latest = messages[messages.length - 1].content;
  if (!latest.trim()) return NextResponse.json({ error: "Empty query." }, { status: 400 });
  if (latest.length > MAX_INPUT_CHARS) {
    return NextResponse.json({ error: `Query too long (max ${MAX_INPUT_CHARS} chars).` }, { status: 400 });
  }
  const totalChars = messages.reduce((s, m) => s + m.content.length, 0);
  if (totalChars > MAX_HISTORY_CHARS) {
    return NextResponse.json({ error: "Conversation too long — start a new session." }, { status: 400 });
  }

  // Attached text/document: rides this ONE turn only (the archive remembers
  // by hash, not by resending). Sealed as its own DOCUMENT Merkle leaf.
  let attachment: { name: string; text: string } | null = null;
  if (body.attachment?.text && typeof body.attachment.text === "string") {
    const name = String(body.attachment.name ?? "attached.txt").slice(0, 100);
    const docText = body.attachment.text.slice(0, MAX_ATTACH_CHARS);
    if (docText.trim()) attachment = { name, text: docText };
  }
  const providerLatest = attachment
    ? `${latest}\n\n--- BEGIN DOCUMENT ("${attachment.name}") — full text provided by the user; read it directly ---\n${attachment.text}\n--- END DOCUMENT ---`
    : latest;
  const providerMessages: ChatMessage[] = attachment
    ? [...messages.slice(0, -1), { role: "user", content: providerLatest }]
    : messages;

  // Client-side ALICE routing echo (labeled as client-asserted, because it is)
  const routing = (body.routing?.mode === "save" || body.routing?.mode === "best")
    ? { mode: body.routing.mode, rule: String(body.routing.rule ?? "").slice(0, 140) }
    : null;

  // GROUNDING — only Gemini has built-in Google Search, so GROUND IT overrides
  // the selected model to Gemini-grounded. callSpec is who actually answers.
  // Models with NATIVE search retrieve for themselves, so grounding is ADDITIVE:
  // the model you picked stays the model that answers, reasoning over sources it
  // read first-hand. Only models without native search fall back to the Gemini
  // relay — and that substitution is warned about up front and recorded in the
  // sealed export, never silent.
  const groundingRequested = body.grounded === true;
  // Self-grounding = native web search on the endpoint we call for grounding.
  // Anthropic (Messages) + OpenAI (Responses) verified live; xAI via Chat
  // Completions search_parameters (confirmed shape, per-source billing) — its
  // first live grounded round-trip is the verification.
  const selfGrounds = spec.provider === "anthropic" || spec.provider === "openai" || spec.provider === "xai";
  const geminiSpec = getModel(GROUNDING_MODEL_ID);
  const useRelay = groundingRequested && !selfGrounds && !!geminiSpec;
  const callSpec = useRelay && geminiSpec ? geminiSpec : spec;

  // Free-tier quota
  // Paid path: wallet credentials are verified against the ledger BEFORE the
  // LLM call (so fake credentials can't bypass the free-tier gate), and the
  // exact cost-plus total is debited after the answer.
  const wallet = (body.wallet?.id && body.wallet?.token)
    ? { id: String(body.wallet.id), token: String(body.wallet.token) }
    : null;
  let paid = false;
  if (wallet) {
    const b = await walletBalance(wallet.id, wallet.token);
    paid = !!(b.ok && b.data && b.data.balance_usd >= 0.01);
  }

  const q = decodeQuota(getCookie(req, QUOTA_COOKIE));
  if (!paid && q.n >= FREE_DAILY_LIMIT) {
    return NextResponse.json(
      {
        error: wallet
          ? "Wallet is empty or invalid, and the free tier is exhausted for today."
          : "Free tier exhausted for today.",
        quota: { used: q.n, limit: FREE_DAILY_LIMIT, resetsAtUtc: quotaResetIso() },
      },
      { status: 429 },
    );
  }
  // Premium is CREDITS ONLY, enforced before the LLM call so a free-tier
  // visitor can never spend our money on a $30-per-million-output model.
  // Checked on callSpec, not spec: GROUND IT overrides to free Gemini, and in
  // that case no premium model is billed.
  if (callSpec.tier === "premium" && !paid) {
    return NextResponse.json(
      {
        error: `${callSpec.name} is a premium model — it runs on prepaid credits, not the free tier. ` +
          `Add credits to unlock it; the free council stays free.`,
        premiumLocked: true,
        quota: { used: q.n, limit: FREE_DAILY_LIMIT, resetsAtUtc: quotaResetIso() },
      },
      { status: 402 },
    );
  }
  // (The Fable-5-grounding block was removed once maxDuration was raised to 300s
  // — the 60s wall was our own config, not the plan. Grounded Fable 5 now runs;
  // if a provider call still overruns 250s it returns 502 uncharged, not a
  // silent timeout after a debit.)
  const tIntent = Date.now();

  // [02] MEMORY RECALL — client-recalled sealed memories, server-verified.
  // Verified + legacy-unsigned memories are injected (labeled); memories
  // failing signature verification are REJECTED.
  const rawMems = (body.memories ?? []).slice(0, MAX_MEMORIES);
  const accepted: Array<MemoryIn & { status: "verified" | "unsigned" }> = [];
  let rejected = 0;
  for (const m of rawMems) {
    if (typeof m?.query !== "string" || typeof m?.response !== "string" ||
        typeof m?.root !== "string" || typeof m?.sealedAt !== "string" ||
        typeof m?.modelId !== "string") continue;
    if (m.sig?.signature) {
      if (verifyMemoryContent(m)) {
        accepted.push({ ...m, status: "verified" });
      } else {
        rejected += 1; // claims a gate seal but content/signature doesn't hold up
      }
    } else {
      accepted.push({ ...m, status: "unsigned" });
    }
  }
  const memoryContext = accepted.length
    ? "Recalled memories from this user's sealed local archive (older exchanges " +
      "retrieved by relevance — treat as prior conversation context):\n" +
      accepted.map(m =>
        `[MEMORY ${m.sealedAt.slice(0, 16)}Z · seal ${m.root.slice(0, 12)} · ${m.status}]\n` +
        `User asked: ${m.query.slice(0, MEM_QUERY_CHARS)}\n` +
        `Answer was: ${m.response.slice(0, MEM_RESPONSE_CHARS)}`,
      ).join("\n\n")
    : null;
  const memoryRecall = (rawMems.length || rejected)
    ? {
        injected: accepted.length,
        verified: accepted.filter(m => m.status === "verified").length,
        unsigned: accepted.filter(m => m.status === "unsigned").length,
        rejected,
        roots: accepted.map(m => m.root),
      }
    : null;
  const tMem = Date.now();

  // [03] LLM CALL — the real thing. Paying customers get 4x the answer room;
  // cost-plus bills the extra tokens honestly either way. GROUND IT routes to
  // Gemini + Google Search and returns cited sources.
  const outputCap = paid ? MAX_OUTPUT_TOKENS_PAID : MAX_OUTPUT_TOKENS_FREE;
  let text: string, usage: Usage, truncated = false;
  let grounding: { sources: GroundingSource[]; searchQueries: string[] } | null = null;
  let searchRequests = 0;
  try {
    if (useRelay) {
      // Relay: Gemini retrieves AND answers. Second-hand for the model you picked.
      const out = await callGeminiGrounded(callSpec, providerMessages, memoryContext, outputCap);
      text = out.text; usage = out.usage; truncated = out.truncated ?? false;
      grounding = { sources: out.sources, searchQueries: out.searchQueries };
      searchRequests = 1;
    } else if (callSpec.provider === "anthropic") {
      // Native: the selected model searches and reasons in one turn.
      const out = await callAnthropic(callSpec, providerMessages, memoryContext, outputCap, groundingRequested);
      text = out.text; usage = out.usage; truncated = out.truncated ?? false;
      searchRequests = out.searchRequests;
      if (groundingRequested && out.sources.length) {
        grounding = { sources: out.sources, searchQueries: [] };
      }
    } else if (callSpec.provider === "openai") {
      // OpenAI grounds only on the Responses API; the proven Chat Completions
      // path handles the ungrounded case unchanged.
      const out = groundingRequested
        ? await callOpenAIResponses(callSpec, providerMessages, memoryContext, outputCap, true)
        : await callOpenAICompatible(callSpec, providerMessages, memoryContext, outputCap);
      text = out.text; usage = out.usage; truncated = out.truncated ?? false;
      searchRequests = out.searchRequests;
      if (groundingRequested && out.sources.length) {
        grounding = { sources: out.sources, searchQueries: [] };
      }
    } else if (callSpec.provider === "xai") {
      // xAI grounds via its Agent Tools API (Responses surface) — the old
      // Chat-Completions Live Search is 410-dead. Ungrounded stays on the
      // proven Chat Completions path.
      const out = groundingRequested
        ? await callOpenAIResponses(callSpec, providerMessages, memoryContext, outputCap, true)
        : await callOpenAICompatible(callSpec, providerMessages, memoryContext, outputCap);
      text = out.text; usage = out.usage; truncated = out.truncated ?? false;
      searchRequests = out.searchRequests;
      if (groundingRequested && out.sources.length) {
        grounding = { sources: out.sources, searchQueries: [] };
      }
    } else {
      const out = callSpec.provider === "groq"
        ? await callGroq(callSpec, providerMessages, memoryContext, outputCap)
        : await callGemini(callSpec, providerMessages, memoryContext, outputCap);
      text = out.text; usage = out.usage; truncated = out.truncated ?? false;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Provider call failed.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
  const tLlm = Date.now();
  const isGrounded = grounding !== null;

  // [03] TOKEN ACCOUNTING + COST AUDIT — cost-plus receipt from real usage.
  // Retrieval bills per REAL search at the answering provider's own rate
  // (Anthropic native $0.01, Google relay $0.035) — never an assumed count.
  const receipt = buildReceipt(callSpec, usage, searchRequests);
  const tReceipt = Date.now();

  // [04] BIAS SCREEN — validated dual-head triage label (fail-open)
  const bias = await screenBias(text);
  const tBias = Date.now();

  // [06] CREDITS DEBIT (paid path) — exact cost-plus total from the ledger.
  // Failure modes never bill the visitor: ledger down or drained mid-flight
  // means the answer ships uncharged with an honest label.
  let walletOut: { balanceUsd: number; insufficient?: boolean } | null = null;
  let debitDetail: string | null = null;
  if (paid && wallet) {
    const d = await debitWallet(
      wallet.id, wallet.token, receipt.totalUsd,
      `chat ${callSpec.id}${isGrounded ? "+grounded" : ""} ${usage.inputTokens}in/${usage.outputTokens}out`,
    );
    if (d.ok && d.data) {
      receipt.chargedUsd = d.data.debited_usd;
      receipt.tier = "credits";
      walletOut = { balanceUsd: d.data.balance_usd };
      debitDetail = `charged ${d.data.debited_usd.toFixed(6)} USD · balance $${d.data.balance_usd.toFixed(6)}`;
    } else if (d.status === 402) {
      walletOut = { balanceUsd: 0, insufficient: true };
      debitDetail = "balance drained mid-flight — NOT charged; top up to stay on credits";
    } else {
      walletOut = null;
      debitDetail = "ledger unreachable — NOT charged (our loss, not yours)";
    }
  }
  const tDebit = Date.now();

  // [07] MERKLE SEAL — real SHA-256 over the exchange, Ed25519-signed
  const sealedAt = new Date().toISOString();
  const leaves = [
    { label: "QUERY",    sha256: sha256(JSON.stringify({ q: latest, ts: sealedAt })) },
    ...(attachment ? [{ label: "DOCUMENT", sha256: sha256(JSON.stringify({ name: attachment.name, doc: attachment.text })) }] : []),
    { label: "RESPONSE", sha256: sha256(JSON.stringify({ r: text, model: callSpec.id })) },
    ...(grounding ? [{ label: "SOURCES", sha256: sha256(JSON.stringify(grounding.sources.map(s => s.uri))) }] : []),
    { label: "RECEIPT",  sha256: sha256(JSON.stringify(receipt)) },
    ...(bias ? [{ label: "BIAS", sha256: sha256(JSON.stringify(bias)) }] : []),
    ...(memoryRecall ? [{ label: "MEMORY", sha256: sha256(JSON.stringify(memoryRecall.roots)) }] : []),
    { label: "TIMING",   sha256: sha256(JSON.stringify({ model: callSpec.providerModel, llmMs: tLlm - tMem })) },
  ];
  const root = merkleRoot(leaves.map(l => l.sha256));
  const sig = signRoot(root, sealedAt);
  const t1 = Date.now();

  // Paid queries do not consume the free-tier quota.
  const newQuota = paid ? { d: q.d, n: q.n } : { d: q.d, n: q.n + 1 };
  const nSrc = grounding?.sources.length ?? 0;
  const plural = nSrc === 1 ? "" : "s";
  const groundingLabel = isGrounded
    ? (useRelay
        ? `GROUNDED (relayed) · ${nSrc} source${plural} retrieved by Gemini via Google Search — ` +
          `${callSpec.name} both searched and answered`
        : `GROUNDED (first-hand) · ${callSpec.name} ran ${searchRequests} search${searchRequests === 1 ? "" : "es"} ` +
          `and cited ${nSrc} source${plural} it read itself`)
    : groundingRequested
      ? "UNGROUNDED — retrieval was requested but no search was run for this answer"
      : "UNGROUNDED — generated from model training, not retrieved or verified";

  const res = NextResponse.json({
    text,
    modelId: callSpec.id,
    requestedModelId: spec.id,
    usage,
    receipt,
    bias,
    memoryRecall,
    grounded: isGrounded,
    // Was retrieval ASKED for? Without this, a session file can't distinguish
    // "search ran and found nothing" from "search was never requested" — which
    // makes a whole class of grounding bug undiagnosable from the artifact.
    groundingRequested,
    groundingMode: !groundingRequested ? "off" : useRelay ? "relay" : "native",
    grounding: grounding ? { sources: grounding.sources, searchQueries: grounding.searchQueries } : null,
    groundingLabel,
    wallet: walletOut,
    attachmentMeta: attachment ? { name: attachment.name, chars: attachment.text.length } : null,
    routing,
    truncated,
    outputCap,
    stages: [
      { label: "INTENT CHECK v1", detail: "format + length validation", ms: tIntent - t0 },
      ...(routing ? [{
        label: "ALICE ROUTING (client-side)",
        detail: `${routing.mode.toUpperCase()} → ${spec.name} · ${routing.rule} — decided in your browser, sovereign`,
        ms: 0,
      }] : []),
      ...(attachment ? [{
        label: "DOCUMENT ATTACHED",
        detail: `${attachment.name} · ${attachment.text.length.toLocaleString()} chars — rides this turn only, sealed by hash`,
        ms: 0,
      }] : []),
      {
        label: "MEMORY RECALL (client archive)",
        detail: memoryRecall
          ? `${memoryRecall.injected} sealed memories injected · ${memoryRecall.verified} verified` +
            (memoryRecall.unsigned ? ` · ${memoryRecall.unsigned} legacy-unsigned` : "") +
            (memoryRecall.rejected ? ` · ${memoryRecall.rejected} REJECTED (bad signature)` : "")
          : "no relevant memories recalled",
        ms: tMem - tIntent,
      },
      { label: `LLM CALL — ${callSpec.name}${isGrounded ? " (grounded)" : ""}`, detail: `${callSpec.providerModel} via ${callSpec.provider}${groundingRequested && callSpec.id !== spec.id ? ` (GROUND IT overrode ${spec.name})` : ""} · output cap ${outputCap.toLocaleString()}${truncated ? " — CAP HIT, answer truncated" : ""}`, ms: tLlm - tMem },
      {
        label: isGrounded && !useRelay ? "GROUNDING — NATIVE (first-hand)" : "GROUNDING",
        detail: isGrounded
          ? (useRelay
              ? `Gemini + Google Search · ${nSrc} source${plural} cited · $${GROUNDING_COST_USD}/search — ` +
                `retrieval RELAYED: Gemini answered on behalf of ${spec.name}`
              : `${callSpec.name} native web search · ${searchRequests} search${searchRequests === 1 ? "" : "es"} × ` +
                `$${ANTHROPIC_SEARCH_COST_USD} · ${nSrc} source${plural} — the answering model read these itself`)
          : "UNGROUNDED — answer generated from model training, not retrieved or verified",
        ms: 0,
      },
      { label: "TOKEN ACCOUNTING + COST AUDIT", detail: `${usage.inputTokens} in / ${usage.outputTokens} out${isGrounded ? " + 1 grounded search" : ""}`, ms: tReceipt - tLlm },
      {
        label: "BIAS SCREEN (validated v1)",
        detail: bias
          ? `toxicity p${bias.toxicityPctile} · framing p${bias.framingPctile} — triage label, not a filter`
          : "screen unreachable — fail-open, answer not blocked",
        ms: tBias - tReceipt,
      },
      ...(debitDetail !== null
        ? [{ label: "CREDITS DEBIT (prepaid ledger)", detail: debitDetail, ms: tDebit - tBias }]
        : []),
      {
        label: "MERKLE SEAL (SHA-256)",
        detail: `root ${root.slice(0, 16)}…${sig ? ` · signed Ed25519 (key ${sig.keyId})` : " · unsigned (no signing key)"}`,
        ms: t1 - tDebit,
      },
    ],
    seal: { algo: "SHA-256", leaves, root, sealedAt, ...(sig ? { sig } : {}) },
    timingMs: { total: t1 - t0, llm: tLlm - tMem },
    quota: { used: newQuota.n, limit: FREE_DAILY_LIMIT, resetsAtUtc: quotaResetIso() },
  });
  res.cookies.set(QUOTA_COOKIE, encodeQuota(newQuota), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 172800,
  });
  return res;
}

function getCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}
