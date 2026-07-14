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

import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { MODEL_REGISTRY, getModel, buildReceipt, type ModelSpec, type Usage } from "@/lib/pricing";
import { FREE_DAILY_LIMIT, QUOTA_COOKIE, decodeQuota, encodeQuota, quotaResetIso } from "@/lib/quota";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_INPUT_CHARS = 4000;
const MAX_HISTORY_CHARS = 12000;
const MAX_HISTORY_MESSAGES = 20;
const MAX_OUTPUT_TOKENS = 1024;

const SYSTEM_PROMPT =
  "You are answering through the Verum Frontier gate (Rabbit Hole AI). " +
  "Be direct and honest. State uncertainty explicitly — if you do not know, say so. " +
  "Prefer concise answers (under ~300 words) unless the user asks for depth.";

interface ChatMessage { role: "user" | "assistant"; content: string; }

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
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

async function callGroq(spec: ModelSpec, messages: ChatMessage[]) {
  const body: Record<string, unknown> = {
    model: spec.providerModel,
    messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
    max_completion_tokens: MAX_OUTPUT_TOKENS,
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
  return { text, usage };
}

async function callGemini(spec: ModelSpec, messages: ChatMessage[]) {
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
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        generationConfig: {
          maxOutputTokens: MAX_OUTPUT_TOKENS,
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
  return { text, usage };
}

// ── GET: model registry + quota status (client boot) ────────────────────

export async function GET(req: Request) {
  const cookie = getCookie(req, QUOTA_COOKIE);
  const q = decodeQuota(cookie);
  return NextResponse.json({
    models: MODEL_REGISTRY.map(m => ({
      id: m.id, name: m.name, family: m.family, color: m.color,
      inPerM: m.inPerM, outPerM: m.outPerM, note: m.note,
    })),
    quota: { used: q.n, limit: FREE_DAILY_LIMIT, resetsAtUtc: quotaResetIso() },
  });
}

// ── POST: run the gate ───────────────────────────────────────────────────

export async function POST(req: Request) {
  const t0 = Date.now();

  // [01] INTENT CHECK v1 — format + length validation only (honestly scoped)
  let body: { modelId?: string; messages?: ChatMessage[] };
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

  // Free-tier quota
  const q = decodeQuota(getCookie(req, QUOTA_COOKIE));
  if (q.n >= FREE_DAILY_LIMIT) {
    return NextResponse.json(
      {
        error: "Free tier exhausted for today.",
        quota: { used: q.n, limit: FREE_DAILY_LIMIT, resetsAtUtc: quotaResetIso() },
      },
      { status: 429 },
    );
  }
  const tIntent = Date.now();

  // [02] LLM CALL — the real thing
  let text: string, usage: Usage;
  try {
    const out = spec.provider === "groq"
      ? await callGroq(spec, messages)
      : await callGemini(spec, messages);
    text = out.text;
    usage = out.usage;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Provider call failed.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
  const tLlm = Date.now();

  // [03] TOKEN ACCOUNTING + COST AUDIT — cost-plus receipt from real usage
  const receipt = buildReceipt(spec, usage);
  const tReceipt = Date.now();

  // [04] BIAS SCREEN — validated dual-head triage label (fail-open)
  const bias = await screenBias(text);
  const tBias = Date.now();

  // [05] MERKLE SEAL — real SHA-256 over the exchange
  const sealedAt = new Date().toISOString();
  const leaves = [
    { label: "QUERY",    sha256: sha256(JSON.stringify({ q: latest, ts: sealedAt })) },
    { label: "RESPONSE", sha256: sha256(JSON.stringify({ r: text, model: spec.id })) },
    { label: "RECEIPT",  sha256: sha256(JSON.stringify(receipt)) },
    ...(bias ? [{ label: "BIAS", sha256: sha256(JSON.stringify(bias)) }] : []),
    { label: "TIMING",   sha256: sha256(JSON.stringify({ model: spec.providerModel, llmMs: tLlm - tIntent })) },
  ];
  const root = merkleRoot(leaves.map(l => l.sha256));
  const t1 = Date.now();

  const newQuota = { d: q.d, n: q.n + 1 };
  const res = NextResponse.json({
    text,
    modelId: spec.id,
    usage,
    receipt,
    bias,
    stages: [
      { label: "INTENT CHECK v1", detail: "format + length validation", ms: tIntent - t0 },
      { label: `LLM CALL — ${spec.name}`, detail: `${spec.providerModel} via ${spec.provider}`, ms: tLlm - tIntent },
      { label: "TOKEN ACCOUNTING + COST AUDIT", detail: `${usage.inputTokens} in / ${usage.outputTokens} out`, ms: tReceipt - tLlm },
      {
        label: "BIAS SCREEN (validated v1)",
        detail: bias
          ? `toxicity p${bias.toxicityPctile} · framing p${bias.framingPctile} — triage label, not a filter`
          : "screen unreachable — fail-open, answer not blocked",
        ms: tBias - tReceipt,
      },
      { label: "MERKLE SEAL (SHA-256)", detail: `root ${root.slice(0, 16)}…`, ms: t1 - tBias },
    ],
    seal: { algo: "SHA-256", leaves, root, sealedAt },
    timingMs: { total: t1 - t0, llm: tLlm - tIntent },
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
