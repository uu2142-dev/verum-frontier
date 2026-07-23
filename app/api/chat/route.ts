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
import { MODEL_REGISTRY, getModel, buildReceipt, GROUNDING_COST_USD, type ModelSpec, type Usage } from "@/lib/pricing";
import { FREE_DAILY_LIMIT, QUOTA_COOKIE, decodeQuota, encodeQuota, quotaResetIso } from "@/lib/quota";
import { debitWallet, walletBalance } from "@/lib/ledger";
import { stripeConfigured, stripeTestMode } from "@/lib/stripe";

export const runtime = "nodejs";
export const maxDuration = 60;

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
    signal: AbortSignal.timeout(55_000),
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
      signal: AbortSignal.timeout(55_000),
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
      signal: AbortSignal.timeout(55_000),
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

// ── GET: model registry + quota status (client boot) ────────────────────

export async function GET(req: Request) {
  const cookie = getCookie(req, QUOTA_COOKIE);
  const q = decodeQuota(cookie);
  const k = signingKeys();
  return NextResponse.json({
    models: MODEL_REGISTRY.map(m => ({
      id: m.id, name: m.name, family: m.family, color: m.color,
      inPerM: m.inPerM, outPerM: m.outPerM, note: m.note,
    })),
    quota: { used: q.n, limit: FREE_DAILY_LIMIT, resetsAtUtc: quotaResetIso() },
    payments: { enabled: stripeConfigured(), testMode: stripeTestMode() },
    grounding: {
      available: !!process.env.GEMINI_API_KEY,
      via: "Gemini 2.5 Flash + Google Search",
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
  const groundingRequested = body.grounded === true;
  const geminiSpec = getModel(GROUNDING_MODEL_ID);
  const callSpec = (groundingRequested && geminiSpec) ? geminiSpec : spec;

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
  try {
    if (groundingRequested && geminiSpec) {
      const out = await callGeminiGrounded(callSpec, providerMessages, memoryContext, outputCap);
      text = out.text; usage = out.usage; truncated = out.truncated ?? false;
      grounding = { sources: out.sources, searchQueries: out.searchQueries };
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

  // [03] TOKEN ACCOUNTING + COST AUDIT — cost-plus receipt from real usage
  // (grounded queries carry Google's real search-grounding surcharge).
  const receipt = buildReceipt(callSpec, usage, isGrounded ? 1 : 0);
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
  const groundingLabel = isGrounded
    ? `GROUNDED · ${grounding!.sources.length} source${grounding!.sources.length === 1 ? "" : "s"} retrieved & cited via Google Search`
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
        label: "GROUNDING",
        detail: isGrounded
          ? `Google Search · ${grounding!.sources.length} source${grounding!.sources.length === 1 ? "" : "s"} cited — answer retrieved, not just generated`
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
