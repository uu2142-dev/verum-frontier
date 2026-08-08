'use client';
// ── LIVE GATE — real multi-model chat with receipts and seals ────────────
// Everything shown here is real: model responses, token counts from the
// provider, cost-plus receipts, SHA-256 hashes, timings. The bias gate is
// NOT wired yet and is labeled as such — no simulated numbers in this mode.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fmtUsd } from "@/lib/pricing";

// ── Types mirrored from /api/chat ─────────────────────────────────────────

interface ModelInfo {
  id: string; name: string; family: string; color: string;
  inPerM: number; outPerM: number; note: string;
  tier?: string; // "free" | "premium" — premium is credits-only, enforced server-side
  selfGrounds?: boolean; // has native web search — GROUND IT adds to it, never overrides it
}
interface Quota { used: number; limit: number; resetsAtUtc: string; }
interface Stage { label: string; detail: string; ms: number; }
interface Leaf { label: string; sha256: string; }
interface Receipt {
  priceSheetDate: string; model: string;
  rates: { inPerM: number; outPerM: number };
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens?: number };
  directUsd: number;
  uncachedInputTokens?: number; cachedInputTokens?: number; cacheRatePerM?: number;
  groundingUsd?: number; searchRequests?: number; searchUnitUsd?: number;
  infraUsd: number; supportUsd: number;
  supportSplit: { server: number; development: number; steward: number; reserve: number };
  totalUsd: number; chargedUsd: number; tier: string;
}
interface GroundingSource { title: string; uri: string; }
interface GroundingInfo { sources: GroundingSource[]; searchQueries: string[]; }
interface BiasResult {
  version: string;
  toxicity: number; toxicityPctile: number;
  framing: number; framingPctile: number;
  validated: { toxicityAuroc5fold: number; framingAurocOfficialSplit: number };
  scope: string;
}
interface SealSig { alg: string; keyId: string; signature: string; }
interface MemoryRecallInfo {
  injected: number; verified: number; unsigned: number; rejected: number; roots: string[];
}
interface Exchange {
  id: number;
  query: string;
  response: string;
  modelId: string;         // the model that ACTUALLY answered
  requestedModelId?: string; // what the user picked — differs when GROUND IT overrides
  receipt: Receipt;
  bias: BiasResult | null;
  memoryRecall?: MemoryRecallInfo | null;
  routing?: { mode: string; rule: string } | null;
  attachmentMeta?: { name: string; chars: number } | null;
  truncated?: boolean;
  outputCap?: number;
  grounded?: boolean;
  groundingRequested?: boolean;
  groundingMode?: string; // "off" | "relay" | "native"
  grounding?: GroundingInfo | null;
  groundingLabel?: string;
  stages: Stage[];
  seal: { algo: string; leaves: Leaf[]; root: string; sealedAt: string; sig?: SealSig };
  timingMs: { total: number; llm: number };
  chainHash: string; // client-side session chain: SHA-256(prev + root)
}

// ── ALICE routing — sovereign by construction ────────────────────────────
// The routing decision runs HERE, in the user's browser, with rules you can
// read. The server only echoes the choice as a labeled stage. The local
// decision history (which rules fired, what you kept, what you re-asked) is
// the seed data for the personal Eye/Soul — and it never leaves this device.

type RouterMode = "save" | "best" | null;

function routeQuery(q: string, mode: "save" | "best", models: ModelInfo[]): { modelId: string; rule: string } {
  const fallback = { modelId: models[0]?.id ?? "", rule: "default (first available model)" };
  if (!models.length) return fallback;
  if (mode === "save") {
    const cheapest = [...models].sort((a, b) => (a.inPerM + a.outPerM) - (b.inPerM + b.outPerM))[0];
    return { modelId: cheapest.id, rule: `cheapest blended rate ($${cheapest.inPerM}/$${cheapest.outPerM} per M)` };
  }
  const pick = (id: string, rule: string) =>
    models.some(m => m.id === id) ? { modelId: id, rule } : fallback;
  const ql = q.toLowerCase();
  if (/\b(code|function|bug|error|python|javascript|typescript|sql|regex|api|debug|compile|script)\b/.test(ql)) {
    return pick("gpt-oss-120b", "code/technical → strongest reasoning per dollar");
  }
  if (/\b(translate|translation|spanish|french|german|chinese|japanese|korean|arabic)\b/.test(ql)) {
    return pick("qwen3.6-27b", "multilingual → Qwen");
  }
  if (q.length > 1500 || /\b(summarize|summarise|analyze this|this document|attached)\b/.test(ql)) {
    return pick("gemini-2.5-flash", "long-context task → Gemini");
  }
  if (/\b(write|story|poem|creative|draft|essay|letter|rewrite)\b/.test(ql)) {
    return pick("llama-3.3-70b", "writing → Llama 70B");
  }
  return pick("llama-3.3-70b", "general question → Llama 70B default");
}

// Conversation archive: the session lives in YOUR browser (localStorage), not
// on a server — there is still no database behind this site.
const STORE_KEY = "vf_session_v1";

// Completed + in-progress sessions are archived here (keyed by startedAt,
// FIFO-capped) so a session you forgot to download is never lost — the Sealed
// Memories tab re-downloads from this. Same browser-only, no-server rule.
// Model chosen in the Models tab — read on boot so a pick made there survives
// the tab switch (the gate unmounts when you leave it).
const MODEL_KEY = "vf_model_v1";

const ARCHIVE_KEY = "vf_archive_v1";
const ARCHIVE_CAP = 60;

type SealKeyInfo = { alg: string; keyId: string; publicKeySpkiB64: string; signedPayloadFormat: string } | null;

// Single source of truth for the sealed-session export shape, shared by the
// live download AND the archive/re-download — so a re-download is byte-identical
// to a live export (same seals, receipts, sources, verify instructions).
function buildSessionPayload(startedAt: string, exchanges: Exchange[], chainRoot: string, sealKey: SealKeyInfo) {
  return {
    format: "verum-frontier-sealed-session/v1",
    site: "rabbitholeai.ai",
    startedAt,
    exportedAt: new Date().toISOString(),
    exchanges: exchanges.map(ex => ({
      query: ex.query,
      response: ex.response,
      model: ex.modelId,
      // Provenance: which model you PICKED vs which one answered. GROUND IT
      // overrides to Gemini, and a sealed record must never hide a substitution.
      requestedModel: ex.requestedModelId ?? ex.modelId,
      modelOverridden: !!(ex.requestedModelId && ex.requestedModelId !== ex.modelId),
      receipt: ex.receipt,
      biasScreen: ex.bias,
      grounded: ex.grounded ?? false,
      // Diagnostic: was retrieval REQUESTED, and how was it served (off/relay/
      // native)? Distinguishes "searched and found nothing" from "never searched".
      groundingRequested: ex.groundingRequested ?? false,
      groundingMode: ex.groundingMode ?? "off",
      grounding: ex.grounding ?? null,
      // The seal carries MEMORY and DOCUMENT leaves, so omitting these from the
      // export left two leaves whose preimage the holder never receives: the
      // file instructed a verifier to recompute content leaves it had no way to
      // recompute, and no reader could audit WHICH past exchanges shaped an
      // answer. Recall picking the wrong prior session is invisible without this.
      memoryRecall: ex.memoryRecall ?? null,
      attachmentMeta: ex.attachmentMeta ?? null,
      seal: ex.seal,
      timingMs: ex.timingMs,
      sessionChainHash: ex.chainHash,
    })),
    sessionChainRoot: chainRoot,
    sealPublicKey: sealKey,
    verify:
      "Leaves are SHA-256 hex digests produced server-side over the exchange " +
      "(see seal.leaves labels). The Merkle root pairs leaves left-to-right, " +
      "duplicating the last when odd, hashing hex-string concatenations. The session " +
      "chain is SHA-256(prevChainHash + seal.root), genesis = " +
      "SHA-256('VERUM_FRONTIER_SESSION_GENESIS' + startedAt). Any SHA-256 tool can re-verify. " +
      "Where seal.sig is present, it is an Ed25519 signature over " +
      "'VF-SEAL-v1|<root>|<sealedAt>' by sealPublicKey. " +
      // The three checks above bind HASHES, not the human-readable text beside them.
      // A signature over a Merkle root proves the root was sealed by this gate at that
      // time; on its own it does NOT prove the query/response strings you are reading
      // are the ones that produced it. Edit the visible text and all three still pass.
      // Step 4 is the one that catches that, so it is stated here rather than assumed.
      "IMPORTANT — those three checks prove the SEAL is authentic, not that the text " +
      "printed beside it is what was sealed. To bind the readable transcript to the " +
      "seal you must recompute the content leaves and confirm they appear in seal.leaves: " +
      "QUERY = SHA-256(JSON.stringify({q: <query>, ts: <seal.sealedAt>})), " +
      "RESPONSE = SHA-256(JSON.stringify({r: <response>, model: <model>})). " +
      // The other content leaves are only present when that kind of content rode
      // the turn. Their preimages are documented too, so every leaf in the file
      // can be recomputed rather than taken on trust.
      "Where present: " +
      "SOURCES = SHA-256(JSON.stringify(<grounding.sources URIs, in order>)), " +
      "MEMORY = SHA-256(JSON.stringify(<memoryRecall.roots>)), " +
      "DOCUMENT = SHA-256(JSON.stringify({name: <attachment name>, doc: <full attachment text>})) " +
      "— the attachment's text is NOT included in this export (it is yours and can be large), " +
      "so DOCUMENT is verifiable only against your own copy of the file you attached; " +
      "attachmentMeta records its name and character count. " +
      "Serialization is JSON.stringify semantics: keys in the order given, no whitespace, " +
      "non-ASCII characters NOT escaped, hashed as UTF-8. Without this step, altering the " +
      "visible text is undetectable. A pure-stdlib reference verifier that performs all " +
      "four checks is at github.com/uu2142-dev/alice-evidence (memory/verify_session.py).",
  };
}

function archiveSession(payload: ReturnType<typeof buildSessionPayload>) {
  try {
    const raw = localStorage.getItem(ARCHIVE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const arr: ReturnType<typeof buildSessionPayload>[] = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
    const idx = arr.findIndex(s => s.startedAt === payload.startedAt);
    if (idx >= 0) arr[idx] = payload; else arr.push(payload);
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify({ format: 1, sessions: arr.slice(-ARCHIVE_CAP) }));
  } catch { /* storage full or serialize issue — non-fatal, session still downloadable live */ }
}

// Prepaid credits wallet — credentials live only in this browser. The wallet
// token is issued exactly once at claim time; losing it means losing the
// wallet (by design: we hold balances, never identities).
const WALLET_KEY = "vf_wallet_v1";

interface WalletState {
  id: string;
  token: string;
  balanceUsd: number;
}

function loadWallet(): WalletState | null {
  try {
    const w = JSON.parse(localStorage.getItem(WALLET_KEY) ?? "null");
    return (w && typeof w.id === "string" && typeof w.token === "string") ? w : null;
  } catch {
    return null;
  }
}

function saveWallet(w: WalletState | null) {
  try {
    if (w) localStorage.setItem(WALLET_KEY, JSON.stringify(w));
    else localStorage.removeItem(WALLET_KEY);
  } catch { /* ignore */ }
}

// ── Wallet link codes ───────────────────────────────────────────────────
// The balance lives in the ledger; only the credential is device-local, which
// is why credits appeared to "not exist" on a phone after being bought on a
// desktop. A link code is just that credential, encoded to survive a copy-paste
// — so moving it moves the credits, with no account and no server-side identity.
// It is a BEARER credential: whoever holds it can spend the balance, and the UI
// says so plainly before revealing one.

function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): string {
  const t = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(t + "=".repeat((4 - (t.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}

function encodeLinkCode(w: WalletState): string {
  return "VFW1." + b64urlEncode(JSON.stringify({ i: w.id, t: w.token }));
}

function decodeLinkCode(code: string): { id: string; token: string } | null {
  const m = /^VFW1\.([A-Za-z0-9_-]+)$/.exec(code.trim());
  if (!m) return null;
  try {
    const o = JSON.parse(b64urlDecode(m[1]));
    return (typeof o?.i === "string" && typeof o?.t === "string" && o.i && o.t)
      ? { id: o.i, token: o.t }
      : null;
  } catch {
    return null;
  }
}

interface StoredSession {
  format: 1;
  startedAt: string;
  chain: string;
  nextId: number;
  exchanges: Exchange[];
}

function loadStoredSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as StoredSession;
    if (s.format !== 1 || !Array.isArray(s.exchanges) || typeof s.chain !== "string") return null;
    return s;
  } catch {
    return null;
  }
}

// ── Long-term memory: sealed exchanges across ALL sessions ──────────────
// NEW SESSION clears the active thread but keeps memory; FORGET MEMORY
// erases it — the user owns both. Capped FIFO for localStorage (v2 moves
// to IndexedDB). Recall = keyword overlap scoring; the server verifies
// each recalled memory's Ed25519 seal signature before injecting.

const MEMORY_KEY = "vf_memory_v1";
const MEMORY_CAP = 300;

interface MemoryItem {
  ts: string;
  query: string;
  response: string;
  modelId: string;
  sealedAt: string;
  root: string;
  leaves?: Leaf[]; // needed for server-side content verification of recalls
  sig?: SealSig;
}

function loadMemory(): MemoryItem[] {
  try {
    const raw = localStorage.getItem(MEMORY_KEY);
    if (!raw) return [];
    const m = JSON.parse(raw);
    return Array.isArray(m?.items) ? m.items : [];
  } catch {
    return [];
  }
}

function saveMemory(items: MemoryItem[]) {
  try {
    localStorage.setItem(MEMORY_KEY, JSON.stringify({ format: 1, items: items.slice(-MEMORY_CAP) }));
  } catch { /* storage full — oldest-first cap should prevent this */ }
}

const RECALL_STOP = new Set([
  "the", "and", "for", "are", "was", "you", "your", "with", "that", "this", "have",
  "has", "had", "not", "but", "what", "when", "where", "which", "who", "how", "why",
  "can", "could", "would", "should", "does", "did", "about", "than", "then", "them",
  "they", "there", "their", "its", "were", "will", "one", "two", "more", "please",
  "tell", "give", "make", "just", "like", "from", "into", "over", "also", "very",
]);

function recallTokens(s: string): Set<string> {
  return new Set(
    (s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter(w => !RECALL_STOP.has(w)),
  );
}

// Recall scoring. A raw shared-word count has two failure modes that showed up
// in a real session: a query about a subject discussed 18 minutes earlier was
// answered from a five-day-old session instead, on a premium model, grounded —
// one wrong answer for a dollar. Two corrections:
//
//   1. IDF weighting. Vocabulary the user employs constantly ("assessment",
//      "report") appears in nearly every memory and carries almost no signal;
//      a rare word ("caspian") is what actually identifies the right session.
//      Weighting each match by rarity stops generic words from deciding.
//   2. Recency weighting, not just a tiebreak. Previously recency only settled
//      exact score ties, so a stale memory beat a minutes-old one on the same
//      subject. An older memory must now be materially more relevant to win.
//
// Both are advisory ranking only — the server still verifies every recalled
// memory's Ed25519 seal before injecting it.
const RECALL_HALF_LIFE_HOURS = 72; // relevance halves every 3 days...
const RECALL_RECENCY_FLOOR = 0.4;  // ...but never decays below 40% of its score

function recallMemories(
  queryText: string,
  memory: MemoryItem[],
  excludeRoots: Set<string>,
  k = 3,
  now: number = Date.now(),
): MemoryItem[] {
  const q = recallTokens(queryText);
  if (!q.size) return [];
  const pool = memory.filter(m => !excludeRoots.has(m.root));
  if (!pool.length) return [];

  const toks = pool.map(m => recallTokens(m.query + " " + m.response));
  // Document frequency of each query word across the pool → inverse-frequency
  // weight. A word in every memory scores ~0; a word in one scores highest.
  const idf = new Map<string, number>();
  q.forEach(w => {
    let df = 0;
    toks.forEach(t => { if (t.has(w)) df += 1; });
    idf.set(w, Math.log(1 + pool.length / (1 + df)));
  });
  let maxWeight = 0;
  q.forEach(w => { maxWeight += idf.get(w) ?? 0; });
  if (maxWeight <= 0) maxWeight = 1;

  return pool
    .map((m, i) => {
      let matched = 0, weight = 0;
      q.forEach(w => { if (toks[i].has(w)) { matched += 1; weight += idf.get(w) ?? 0; } });
      const parsed = Date.parse(m.ts);
      const ageHours = Number.isFinite(parsed) ? Math.max(0, (now - parsed) / 3.6e6) : Infinity;
      const decay = Math.pow(0.5, ageHours / RECALL_HALF_LIFE_HOURS); // → 0 when age is Infinity
      const recency = RECALL_RECENCY_FLOOR + (1 - RECALL_RECENCY_FLOOR) * (Number.isFinite(decay) ? decay : 0);
      return { m, matched, score: (weight / maxWeight) * recency };
    })
    // A single strong content-word match is still enough — natural follow-ups
    // ("what about the second part?") rarely repeat two keywords.
    .filter(x => x.matched >= 1)
    .sort((a, b) => b.score - a.score || b.m.ts.localeCompare(a.m.ts))
    .slice(0, k)
    .map(x => x.m);
}

// ── Pre-send cost estimate ──────────────────────────────────────────────
// Grounded retrieval stacks tens of thousands of tokens of fetched pages into
// the input at the model's own rate, so the SAME question has cost $0.11 and
// $1.01 on this gate depending on how much the model chose to read. Publishing
// one confident predicted number would be a false promise from a product whose
// entire claim is that the receipt is the truth.
//
// So the estimate is drawn from receipts this browser has already been charged:
// the real range this model actually cost in this mode. Arithmetic is only the
// fallback when there is no such history, and then it says plainly that
// retrieval is not in the number.

// Past charged totals for a model+grounding combination, newest-agnostic and
// deduped by seal root (the live session is also mirrored into the archive).
function pastCosts(modelId: string, grounded: boolean, thread: Exchange[]): number[] {
  const seen = new Set<string>();
  const out: number[] = [];
  const add = (root: string | undefined, usd: unknown) => {
    if (!root || seen.has(root)) return;
    if (typeof usd !== "number" || !isFinite(usd) || usd <= 0) return;
    seen.add(root);
    out.push(usd);
  };
  thread.forEach(ex => {
    if (ex.modelId === modelId && (ex.grounded ?? false) === grounded) add(ex.seal?.root, ex.receipt?.totalUsd);
  });
  try {
    const parsed = JSON.parse(localStorage.getItem(ARCHIVE_KEY) ?? "null");
    const sessions: Array<{ exchanges?: unknown[] }> = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
    sessions.forEach(s => {
      (s?.exchanges ?? []).forEach(raw => {
        const ex = raw as { model?: string; grounded?: boolean; receipt?: { totalUsd?: unknown }; seal?: { root?: string } };
        if (ex?.model === modelId && !!ex?.grounded === grounded) add(ex.seal?.root, ex.receipt?.totalUsd);
      });
    });
  } catch { /* archive unreadable — fall through to the computed estimate */ }
  return out;
}

// Rough token count for text we are about to send. ~4 chars/token for English
// prose; deliberately approximate, and only ever used for the no-history case.
const approxTokens = (chars: number) => Math.ceil(chars / 4);
const TYPICAL_OUTPUT_TOKENS = 700;

// Relative age for the recall preview — users reason in "18m ago", not ISO.
function agoLabel(ts: string): string {
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return "";
  const mins = Math.max(0, (Date.now() - t) / 60000);
  if (mins < 60) return `${Math.round(mins)}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ── Receipt card ──────────────────────────────────────────────────────────

function ReceiptCard({ r, color }: { r: Receipt; color: string }) {
  return (
    <div style={{ fontFamily: "monospace", fontSize: 9, lineHeight: 1.9 }}>
      {/* Real heading, styled to look identical — the receipt/bias/seal panels
          were styled divs, leaving the whole document with a single h1 and no
          structure to navigate by. */}
      <h3 style={{ color: "rgba(255,255,255,0.3)", letterSpacing: "0.2em", fontSize: 7, marginBottom: 4, margin: "0 0 4px", fontWeight: "inherit" }}>
        COST-PLUS RECEIPT · PRICE SHEET {r.priceSheetDate}
      </h3>
      <Row k="DIRECT API COST" v={fmtUsd(r.directUsd)} strong color={color} />
      {r.cachedInputTokens && r.cachedInputTokens > 0 ? (
        <>
          <Sub k={`${(r.uncachedInputTokens ?? r.usage.inputTokens).toLocaleString()} in (fresh) × $${r.rates.inPerM.toFixed(2)}/M`} />
          <Sub k={`${r.cachedInputTokens.toLocaleString()} in (cached) × $${(r.cacheRatePerM ?? r.rates.inPerM).toFixed(2)}/M — provider cache discount`} />
        </>
      ) : (
        <Sub k={`${r.usage.inputTokens.toLocaleString()} in × $${r.rates.inPerM.toFixed(2)}/M`} />
      )}
      <Sub k={`${r.usage.outputTokens.toLocaleString()} out × $${r.rates.outPerM.toFixed(2)}/M`} />
      {!!r.groundingUsd && r.groundingUsd > 0 && (
        <>
          <Row k="RETRIEVAL (web search)" v={fmtUsd(r.groundingUsd)} color="#58a6ff" />
          <Sub k={`${r.searchRequests ?? 1} search${(r.searchRequests ?? 1) === 1 ? "" : "es"} × $${(r.searchUnitUsd ?? 0.035).toFixed(3)} — real retrieval, real cost`} />
        </>
      )}
      <Row k="INFRASTRUCTURE (5%)" v={fmtUsd(r.infraUsd)} />
      <Row k="PROJECT SUPPORT (15%)" v={fmtUsd(r.supportUsd)} />
      <Sub k={`server 30% · development 40% · steward 20% · reserve 10%`} />
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.12)", margin: "4px 0" }} />
      <Row k="YOUR COST" v={fmtUsd(r.totalUsd)} strong color="#c8941a" />
      <Row
        k="CHARGED"
        v={`${fmtUsd(r.chargedUsd)} — ${r.tier === "credits" ? "CREDITS" : "FREE TIER"}`}
        color={r.tier === "credits" ? "#c8941a" : "#2ecc71"}
      />
    </div>
  );
}
function Row({ k, v, strong, color }: { k: string; v: string; strong?: boolean; color?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <span style={{ color: "rgba(255,255,255,0.45)" }}>{k}</span>
      <span style={{ color: color ?? (strong ? "#fff" : "rgba(255,255,255,0.7)"), fontWeight: strong ? 700 : 400 }}>{v}</span>
    </div>
  );
}
function Sub({ k }: { k: string }) {
  return <div style={{ color: "rgba(255,255,255,0.25)", fontSize: 8, paddingLeft: 10 }}>{k}</div>;
}

// ── Bias screen view ──────────────────────────────────────────────────────

function BiasCard({ b }: { b: BiasResult | null }) {
  if (!b) return (
    <div style={{ fontFamily: "monospace", fontSize: 8, color: "rgba(255,255,255,0.3)", lineHeight: 1.8 }}>
      BIAS SCREEN: unreachable for this exchange — fail-open, answer not blocked.
    </div>
  );
  const bar = (pct: number, hot: boolean) => (
    <div style={{ height: 3, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden", marginTop: 2 }}>
      <div style={{
        height: "100%", width: `${pct}%`, borderRadius: 2,
        background: hot ? "linear-gradient(90deg,#7a1a1a,#e74c3c)" : "linear-gradient(90deg,#1a5a30,#2ecc71)",
      }} />
    </div>
  );
  return (
    <div style={{ fontFamily: "monospace", fontSize: 9, lineHeight: 1.8 }}>
      <h3 style={{ color: "rgba(200,148,26,0.6)", fontSize: 7, letterSpacing: "0.2em", margin: "0 0 4px", fontWeight: "inherit" }}>
        BIAS SCREEN · VALIDATED {b.version.toUpperCase()} · AUROC {b.validated.toxicityAuroc5fold?.toFixed(2)} tox / {b.validated.framingAurocOfficialSplit?.toFixed(2)} framing (held-out)
      </h3>
      <div style={{ display: "flex", justifyContent: "space-between", color: "rgba(255,255,255,0.45)" }}>
        <span>TOXICITY</span>
        <span style={{ color: b.toxicityPctile > 80 ? "#e74c3c" : "rgba(255,255,255,0.7)" }}>p{b.toxicityPctile}</span>
      </div>
      {bar(b.toxicityPctile, b.toxicityPctile > 80)}
      <div style={{ display: "flex", justifyContent: "space-between", color: "rgba(255,255,255,0.45)", marginTop: 6 }}>
        <span>FRAMING</span>
        <span style={{ color: b.framingPctile > 80 ? "#e74c3c" : "rgba(255,255,255,0.7)" }}>p{b.framingPctile}</span>
      </div>
      {bar(b.framingPctile, b.framingPctile > 80)}
      <div style={{ fontSize: 7, color: "rgba(255,255,255,0.25)", marginTop: 6, lineHeight: 1.6 }}>
        Percentiles vs the checker&apos;s training distribution. {b.scope}
      </div>
    </div>
  );
}

// ── Grounding view ────────────────────────────────────────────────────────
// The fix for "confident prose mistaken for a sourced document." A grounded
// answer shows the real web sources it was retrieved from; an ungrounded one
// says so plainly. Sources are sealed as a SOURCES Merkle leaf.

function sourceHost(uri: string): string {
  try { return new URL(uri).hostname.replace(/^www\./, ""); } catch { return uri.slice(0, 40); }
}

function GroundingView({ ex }: { ex: Exchange }) {
  const grounded = !!ex.grounded;
  return (
    <div style={{ fontFamily: "monospace", fontSize: 8, lineHeight: 1.8 }}>
      <div style={{
        color: grounded ? "#58a6ff" : "rgba(200,148,26,0.7)", fontSize: 7, letterSpacing: "0.2em", marginBottom: 4,
      }}>
        {grounded ? "🔎 GROUNDING · GOOGLE SEARCH" : "⚠ GROUNDING · NONE"}
      </div>
      <div style={{ color: grounded ? "rgba(88,166,255,0.85)" : "rgba(200,148,26,0.85)", marginBottom: grounded ? 5 : 0, lineHeight: 1.7 }}>
        {ex.groundingLabel ?? (grounded ? "GROUNDED" : "UNGROUNDED — generated from model training, not retrieved or verified")}
      </div>
      {grounded && ex.grounding && ex.grounding.sources.length > 0 && (
        <>
          {ex.grounding.searchQueries.length > 0 && (
            <div style={{ color: "rgba(255,255,255,0.3)", marginBottom: 3 }}>
              searched: {ex.grounding.searchQueries.join(" · ")}
            </div>
          )}
          {ex.grounding.sources.map((s, i) => (
            <div key={i} style={{ display: "flex", gap: 6 }}>
              <span style={{ color: "rgba(255,255,255,0.3)" }}>[{i + 1}]</span>
              <a href={s.uri} target="_blank" rel="noopener noreferrer"
                 style={{ color: "rgba(88,166,255,0.75)", textDecoration: "none", wordBreak: "break-all" }}>
                {s.title || sourceHost(s.uri)}
              </a>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ── Seal view ─────────────────────────────────────────────────────────────

function SealView({ ex }: { ex: Exchange }) {
  return (
    <div style={{ fontFamily: "monospace", fontSize: 8, lineHeight: 1.8 }}>
      <h3 style={{ color: "rgba(200,148,26,0.6)", fontSize: 7, letterSpacing: "0.2em", margin: "0 0 4px", fontWeight: "inherit" }}>
        MERKLE SEAL · REAL SHA-256
      </h3>
      {ex.seal.leaves.map(l => (
        <div key={l.label} style={{ display: "flex", gap: 8 }}>
          <span style={{ color: "rgba(255,255,255,0.3)", minWidth: 62 }}>{l.label}</span>
          <span style={{ color: "rgba(255,255,255,0.5)", wordBreak: "break-all" }}>{l.sha256.slice(0, 24)}…</span>
        </div>
      ))}
      <div style={{ marginTop: 4, color: "#c8941a" }}>ROOT {ex.seal.root.slice(0, 32)}…</div>
      <div style={{ color: ex.seal.sig ? "#2ecc71" : "rgba(255,255,255,0.3)" }}>
        {ex.seal.sig
          ? `SIGNED Ed25519 · key ${ex.seal.sig.keyId} · origin-attestable`
          : "UNSIGNED — sealed before signing keys, or key not configured"}
      </div>
      <div style={{ color: "rgba(255,255,255,0.3)" }}>CHAIN {ex.chainHash.slice(0, 32)}…</div>
      {ex.memoryRecall && ex.memoryRecall.injected > 0 && (
        <div style={{ color: "rgba(179,157,219,0.7)" }}>
          MEMORY {ex.memoryRecall.injected} recalled · {ex.memoryRecall.verified} verified
          {ex.memoryRecall.rejected ? ` · ${ex.memoryRecall.rejected} rejected` : ""}
          {" — "}{ex.memoryRecall.roots.map(r => r.slice(0, 8)).join(", ")}
        </div>
      )}
      <div style={{ color: "rgba(255,255,255,0.2)", marginTop: 2 }}>
        sealed {ex.seal.sealedAt.slice(0, 19)}Z · verify with any SHA-256 tool
      </div>
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────

export default function LiveGate({ onFallbackToDemo, onOpenMemories }: { onFallbackToDemo?: () => void; onOpenMemories?: () => void }) {
  const [models, setModels]     = useState<ModelInfo[]>([]);
  const [bootFailed, setBootFailed] = useState(false);
  const [modelId, setModelId]   = useState<string>("");
  const [quota, setQuota]       = useState<Quota | null>(null);
  const [thread, setThread]     = useState<Exchange[]>([]);
  const [input, setInput]       = useState("");
  const [sending, setSending]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [memCount, setMemCount] = useState(0);
  const [sealKey, setSealKey] = useState<{ alg: string; keyId: string; publicKeySpkiB64: string; signedPayloadFormat: string } | null>(null);
  const [payments, setPayments] = useState<{ enabled: boolean; testMode: boolean }>({ enabled: false, testMode: false });
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [buyOpen, setBuyOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);   // reveal THIS device's code
  const [linkPaste, setLinkPaste] = useState("");    // adopt another device's
  const [linkArmed, setLinkArmed] = useState(false); // 2-step when replacing funds
  const [linking, setLinking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [buying, setBuying] = useState(false);
  const [claimNote, setClaimNote] = useState<string | null>(null);
  const [routerMode, setRouterMode] = useState<RouterMode>(null);
  const [ground, setGround] = useState<{ available: boolean; via: string; surchargeUsd: number; modelId?: string }>({ available: false, via: "", surchargeUsd: 0 });
  const [groundOn, setGroundOn] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachment, setAttachment] = useState<{ name: string; text: string } | null>(null);
  const [attachPinned, setAttachPinned] = useState(false);
  const [lastAttachment, setLastAttachment] = useState<{ name: string; text: string } | null>(null);
  const [pasteBuf, setPasteBuf] = useState("");
  // Which sealed memories THIS query would pull in, shown before anything is
  // spent, plus an opt-out for the turn. Recall used to be invisible until the
  // answer came back — a wrong pick was only discoverable after paying for it.
  const [memPreview, setMemPreview] = useState<MemoryItem[]>([]);
  const [recallOff, setRecallOff] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const chainRef   = useRef<string>("");
  const startedRef = useRef<string>("");
  const nextId     = useRef(1);
  const scrollRef  = useRef<HTMLDivElement>(null);

  // Debounced so a 300-item archive isn't re-scored on every keystroke.
  useEffect(() => {
    const q = input.trim();
    if (!q) { setMemPreview([]); return; }
    const id = setTimeout(() => {
      const exclude = new Set(thread.slice(-3).map(ex => ex.seal.root));
      setMemPreview(recallMemories(q, loadMemory(), exclude));
    }, 250);
    return () => clearTimeout(id);
  }, [input, thread]);

  useEffect(() => {
    setMemCount(loadMemory().length);
    setWallet(loadWallet());

    // Returning from Stripe checkout: claim the session into a wallet.
    const params = new URLSearchParams(window.location.search);
    const cs = params.get("credit_session");
    if (cs) {
      window.history.replaceState(null, "", window.location.pathname);
      const existingWallet = loadWallet();
      fetch("/api/credits/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Send existing wallet credentials so a same-mode purchase TOPS UP
        // instead of replacing (the ledger refuses cross-mode merges).
        body: JSON.stringify({
          sessionId: cs,
          ...(existingWallet ? { wallet: { id: existingWallet.id, token: existingWallet.token } } : {}),
        }),
      })
        .then(r => r.json().then(d => ({ ok: r.ok, d })))
        .then(({ ok, d }) => {
          if (!ok) { setClaimNote(`⚠ ${d.error ?? "Claim failed."}`); return; }
          const current = loadWallet();
          if (d.merged && current && current.id === d.walletId) {
            const w = { ...current, balanceUsd: d.balanceUsd };
            saveWallet(w);
            setWallet(w);
            setClaimNote(`✓ Topped up — balance $${d.balanceUsd.toFixed(2)}${d.testMode ? " (TEST MODE)" : ""}`);
          } else if (d.walletToken) {
            const w = { id: d.walletId, token: d.walletToken, balanceUsd: d.balanceUsd };
            saveWallet(w);
            setWallet(w);
            setClaimNote(`✓ Credits claimed: $${d.balanceUsd.toFixed(2)}${d.testMode ? " (TEST MODE — no real charge)" : ""}`);
          } else if (current && current.id === d.walletId) {
            const w = { ...current, balanceUsd: d.balanceUsd };
            saveWallet(w);
            setWallet(w);
            setClaimNote(`✓ Wallet refreshed: $${d.balanceUsd.toFixed(2)}`);
          } else {
            setClaimNote("⚠ This checkout was already claimed in another browser — credits live where they were first claimed.");
          }
        })
        .catch(() => setClaimNote("⚠ Claim failed — your payment is safe; reload to retry."));
    }

    const saved = loadStoredSession();
    if (saved && saved.exchanges.length) {
      startedRef.current = saved.startedAt;
      chainRef.current = saved.chain;
      nextId.current = saved.nextId;
      setThread(saved.exchanges);
    } else {
      startedRef.current = new Date().toISOString();
      sha256Hex("VERUM_FRONTIER_SESSION_GENESIS" + startedRef.current).then(h => { chainRef.current = h; });
    }
    fetch("/api/chat")
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(d => {
        if (!d.models?.length) throw new Error("no models");
        setModels(d.models);
        // Honour a pick made in the Models tab, if it still exists in the boot list.
        let initial = d.models[0].id;
        try {
          const saved = localStorage.getItem(MODEL_KEY);
          if (saved && d.models.some((m: ModelInfo) => m.id === saved)) initial = saved;
        } catch { /* ignore */ }
        setModelId(initial);
        setQuota(d.quota ?? null);
        setSealKey(d.sealKey ?? null);
        setPayments(d.payments ?? { enabled: false, testMode: false });
        if (d.grounding) setGround(d.grounding);
      })
      .catch(() => {
        setBootFailed(true);
        setError("The live gate is unavailable right now (configuration or upstream issue).");
      });
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [thread, sending]);

  // Archive the session in the visitor's own browser after every exchange.
  useEffect(() => {
    if (!thread.length) return;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        format: 1,
        startedAt: startedRef.current,
        chain: chainRef.current,
        nextId: nextId.current,
        exchanges: thread,
      } satisfies StoredSession));
    } catch { /* storage full or blocked — session just won't persist */ }
  }, [thread]);

  const buyCredits = useCallback(async (amountUsd: number) => {
    setBuying(true);
    setError(null);
    try {
      const res = await fetch("/api/credits/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountUsd }),
      });
      const d = await res.json();
      if (!res.ok || !d.url) { setError(d.error ?? "Checkout failed."); return; }
      window.location.href = d.url; // Stripe-hosted checkout
    } catch {
      setError("Checkout failed — network error.");
    } finally {
      setBuying(false);
    }
  }, []);

  // Adopt a wallet issued on another device. The ledger is the authority: we
  // hand it the pasted credential and only store it here if it comes back valid.
  const linkDevice = useCallback(async () => {
    const parsed = decodeLinkCode(linkPaste);
    if (!parsed) {
      setClaimNote("✗ That is not a wallet link code — it should start with VFW1.");
      return;
    }
    setLinking(true);
    try {
      const res = await fetch("/api/credits/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      const d = await res.json();
      if (!res.ok) { setClaimNote(`✗ ${d.error ?? "Link failed."}`); return; }
      const w = { id: parsed.id, token: parsed.token, balanceUsd: d.balanceUsd };
      saveWallet(w);
      setWallet(w);
      setLinkPaste("");
      setLinkArmed(false);
      setClaimNote(`✓ Wallet linked — $${d.balanceUsd.toFixed(4)} available on this device.`);
    } catch {
      setClaimNote("✗ Network error — wallet not linked.");
    } finally {
      setLinking(false);
    }
  }, [linkPaste]);

  const newSession = useCallback(() => {
    try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
    setThread([]);
    setExpanded(null);
    setError(null);
    nextId.current = 1;
    startedRef.current = new Date().toISOString();
    sha256Hex("VERUM_FRONTIER_SESSION_GENESIS" + startedRef.current).then(h => { chainRef.current = h; });
  }, []);

  const model = models.find(m => m.id === modelId);
  const remaining = quota ? Math.max(0, quota.limit - quota.used) : null;
  // Credits bypass the free tier entirely — a funded wallet keeps the gate
  // open when the daily free quota is spent. (Free resets 00:00 UTC.)
  const creditsActive = !!(wallet && wallet.balanceUsd > 0.0001);
  const gateOpen = remaining !== 0 || creditsActive;

  // ONE predicate for "can this turn be sent", read by the SEND button, the
  // Enter key, and send() itself. They used to disagree: the button required
  // gateOpen, Enter called send() unconditionally, and send()'s own guard only
  // checked (!q || sending || !modelId). So Enter fired a send the button was
  // visibly refusing — with the composer emptied and nothing to show for it.
  const canSend = !sending && !!input.trim() && !!modelId && gateOpen;

  // Will THIS turn actually cost money? Premium is credits-only and always
  // charges; a free-council model only charges once the daily free tier is
  // spent and a funded wallet takes over. No charge, no estimate to show.
  const willCharge = !!model && (model.tier === "premium" || (remaining === 0 && creditsActive));

  const estimate = useMemo(() => {
    if (!model || !willCharge || !input.trim()) return null;
    const samples = pastCosts(model.id, groundOn, thread);
    if (samples.length > 0) {
      return { kind: "history" as const, lo: Math.min(...samples), hi: Math.max(...samples), n: samples.length };
    }
    // No receipts for this combination yet — price what we can actually count
    // (this prompt, the history and memories riding with it, any attachment)
    // and be explicit that retrieved pages are not in the number.
    const historyChars = thread.slice(-3).reduce((n, ex) => n + ex.query.length + ex.response.length, 0);
    const memChars = (recallOff ? [] : memPreview).reduce((n, m) => n + m.query.length + m.response.length, 0);
    const chars = input.length + historyChars + memChars + (attachment?.text.length ?? 0);
    const direct =
      (approxTokens(chars) / 1e6) * model.inPerM +
      (TYPICAL_OUTPUT_TOKENS / 1e6) * model.outPerM;
    return { kind: "computed" as const, usd: direct * 1.20 };
  }, [model, willCharge, input, thread, groundOn, memPreview, recallOff, attachment]);

  // Conversion moment: the instant free runs out, show the buy row.
  useEffect(() => {
    if (remaining === 0 && !creditsActive && payments.enabled) setBuyOpen(true);
  }, [remaining, creditsActive, payments.enabled]);

  const send = useCallback(async () => {
    const q = input.trim();
    // gateOpen belongs here too — without it this function would still accept a
    // send the UI is refusing, from any caller.
    if (!q || sending || !modelId || !gateOpen) return;
    setSending(true);
    setError(null);
    try {
      // Working memory: the last 3 exchanges ride along as history.
      // Older relevant context arrives via MEMORY RECALL instead — smaller
      // prompts, smaller receipts, and the archive does the remembering.
      const recent = thread.slice(-3);
      const history = recent.flatMap(ex => ([
        { role: "user" as const, content: ex.query },
        { role: "assistant" as const, content: ex.response },
      ]));
      const excludeRoots = new Set(recent.map(ex => ex.seal.root));
      // RECALL OFF sends this turn with no injected memories — the preview above
      // the composer is what the user is agreeing to, so honour a skip exactly.
      const recalled = recallOff ? [] : recallMemories(q, loadMemory(), excludeRoots);
      const routed = routerMode ? routeQuery(q, routerMode, models) : null;
      const sendModelId = routed ? routed.modelId : modelId;
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelId: sendModelId,
          ...(routed ? { routing: { mode: routerMode, rule: routed.rule } } : {}),
          ...(attachment ? { attachment } : {}),
          ...(groundOn ? { grounded: true } : {}),
          messages: [...history, { role: "user", content: q }],
          memories: recalled.map(m => ({
            query: m.query, response: m.response, modelId: m.modelId,
            sealedAt: m.sealedAt, root: m.root, leaves: m.leaves, sig: m.sig,
          })),
          ...(wallet && wallet.balanceUsd > 0 ? { wallet: { id: wallet.id, token: wallet.token } } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Gate error (${res.status}).`);
        if (data.quota) setQuota(data.quota);
        return;
      }
      const chainHash = await sha256Hex(chainRef.current + data.seal.root);
      chainRef.current = chainHash;
      setThread(t => [...t, {
        id: nextId.current++,
        query: q,
        response: data.text,
        modelId: data.modelId,
        requestedModelId: data.requestedModelId ?? data.modelId,
        receipt: data.receipt,
        bias: data.bias ?? null,
        memoryRecall: data.memoryRecall ?? null,
        routing: data.routing ?? null,
        attachmentMeta: data.attachmentMeta ?? null,
        truncated: data.truncated ?? false,
        outputCap: data.outputCap,
        grounded: data.grounded ?? false,
        groundingRequested: data.groundingRequested ?? false,
        groundingMode: data.groundingMode ?? "off",
        grounding: data.grounding ?? null,
        groundingLabel: data.groundingLabel,
        stages: data.stages,
        seal: data.seal,
        timingMs: data.timingMs,
        chainHash,
      }]);
      // Pinned attachments ride every question (each receipt shows the cost);
      // unpinned ones detach after their turn but stay one click away.
      if (!attachPinned && attachment) {
        setLastAttachment(attachment);
        setAttachment(null);
      }
      setPasteBuf("");
      setAttachOpen(false);
      // Long-term memory: every sealed exchange joins the archive.
      const mem = loadMemory();
      mem.push({
        ts: new Date().toISOString(),
        query: q, response: data.text, modelId: data.modelId,
        sealedAt: data.seal.sealedAt, root: data.seal.root,
        leaves: data.seal.leaves, sig: data.seal.sig,
      });
      saveMemory(mem);
      setMemCount(Math.min(mem.length, 300));
      setQuota(data.quota);
      if (data.wallet) {
        setWallet(w => {
          if (!w) return w;
          const nw = { ...w, balanceUsd: data.wallet.balanceUsd };
          saveWallet(nw);
          return nw;
        });
      }
      setInput("");
      setRecallOff(false); // opt-out is per-turn, never sticky
    } catch {
      setError("Network error — the query was not charged against your quota.");
    } finally {
      setSending(false);
    }
  }, [input, sending, modelId, thread, wallet, models, routerMode, attachment, attachPinned, groundOn, gateOpen, recallOff]);

  const downloadSession = useCallback(() => {
    const payload = buildSessionPayload(startedRef.current, thread, chainRef.current, sealKey);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `verum-session-${startedRef.current.slice(0, 19).replace(/[:T]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [thread, sealKey]);

  // Auto-archive the current session so it's re-downloadable from the Sealed
  // Memories tab even if the user forgets to download before NEW SESSION.
  useEffect(() => {
    if (!thread.length || !startedRef.current) return;
    archiveSession(buildSessionPayload(startedRef.current, thread, chainRef.current, sealKey));
  }, [thread, sealKey]);

  const last = thread[thread.length - 1];

  return (
    <div className="relative z-30 flex w-full" style={{ height: "calc(100dvh - 120px)" }}>

      {/* ── THREAD COLUMN ── */}
      <div className="flex flex-col flex-1 min-w-0 px-3 md:px-8 pt-3">

        {/* status strip */}
        <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
          <div style={{ fontSize: 8, letterSpacing: "0.25em", color: "#2ecc71", fontFamily: "monospace" }}>
            ● LIVE — REAL MODEL CALLS · REAL RECEIPTS · REAL SHA-256
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            {payments.enabled && (
              <button
                onClick={() => setBuyOpen(o => !o)}
                style={{
                  fontSize: 8, fontFamily: "monospace", letterSpacing: "0.15em", cursor: "pointer",
                  border: `1px solid ${wallet ? "rgba(200,148,26,0.5)" : "rgba(255,255,255,0.15)"}`,
                  background: wallet ? "rgba(200,148,26,0.08)" : "transparent",
                  color: wallet ? "#c8941a" : "rgba(255,255,255,0.45)", padding: "3px 8px",
                }}
              >
                💳 {wallet ? `$${wallet.balanceUsd.toFixed(4)} CREDITS` : "BUY CREDITS"}
                {payments.testMode ? " · TEST" : ""} {buyOpen ? "▲" : "▼"}
              </button>
            )}
            {onOpenMemories && (
              <button
                onClick={onOpenMemories}
                title="Open your sealed-memory vault — re-download any past session. Forgetting lives there now, behind a permanent-delete warning, so it can't be hit by accident."
                style={{
                  fontSize: 8, fontFamily: "monospace", letterSpacing: "0.15em", cursor: "pointer",
                  border: "1px solid rgba(179,157,219,0.4)", background: "rgba(179,157,219,0.08)",
                  color: "#b39ddb", padding: "3px 8px",
                }}
              >
                🧠 {memCount > 0 ? `${memCount} SEALED · ` : ""}MEMORIES ›
              </button>
            )}
            {thread.length > 0 && (
              <button onClick={newSession} style={{
                fontSize: 8, fontFamily: "monospace", letterSpacing: "0.15em", cursor: "pointer",
                border: "1px solid rgba(255,255,255,0.15)", background: "transparent",
                color: "rgba(255,255,255,0.45)", padding: "3px 8px",
              }}>
                ⟲ NEW SESSION
              </button>
            )}
            {quota && (
              <div style={{
                fontSize: 8, fontFamily: "monospace", letterSpacing: "0.15em",
                color: remaining === 0 && !creditsActive ? "#e74c3c" : "rgba(255,255,255,0.5)",
                border: "1px solid rgba(255,255,255,0.12)", padding: "3px 8px",
              }}>
                {remaining === 0 && creditsActive
                  ? "FREE TIER SPENT · RUNNING ON CREDITS"
                  : `FREE TIER · ${remaining}/${quota.limit} QUERIES LEFT TODAY`}
              </div>
            )}
          </div>
        </div>

        {/* buy credits row */}
        {buyOpen && payments.enabled && (
          <div style={{
            display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap",
            border: "1px solid rgba(200,148,26,0.3)", background: "rgba(200,148,26,0.05)",
            padding: "8px 10px", marginBottom: 8, fontFamily: "monospace",
          }}>
            <span style={{ fontSize: 8, letterSpacing: "0.15em", color: "rgba(255,255,255,0.5)" }}>
              PREPAID CREDITS · each answer debits its exact cost-plus total
            </span>
            {[5, 10, 25].map(a => (
              <button key={a} onClick={() => buyCredits(a)} disabled={buying} style={{
                fontSize: 9, fontFamily: "monospace", cursor: "pointer", padding: "4px 12px",
                border: "1px solid rgba(200,148,26,0.5)", background: "rgba(200,148,26,0.12)",
                color: "#c8941a", opacity: buying ? 0.4 : 1,
              }}>
                ${a}
              </button>
            ))}
            {payments.testMode && (
              <span style={{ fontSize: 8, color: "#e74c3c", letterSpacing: "0.08em" }}>
                STRIPE TEST MODE — no real charges. Test card 4242 4242 4242 4242, any future expiry, any CVC.
              </span>
            )}

            {/* Device linking. No accounts means a wallet lives where it was
                claimed; the balance itself is in the ledger, so handing the
                credential to another device hands it the credits. */}
            <div style={{
              width: "100%", borderTop: "1px solid rgba(255,255,255,0.1)",
              paddingTop: 8, marginTop: 2, display: "flex", flexDirection: "column", gap: 6,
            }}>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <span style={{ fontSize: 8, letterSpacing: "0.15em", color: "rgba(255,255,255,0.5)" }}>
                  CREDITS FOLLOW THE WALLET, NOT THE BROWSER — link a phone or laptop to spend the same balance
                </span>
                {wallet && (
                  <button
                    onClick={() => { setLinkOpen(o => !o); setCopied(false); }}
                    style={{
                      fontSize: 8, fontFamily: "monospace", cursor: "pointer", padding: "3px 10px",
                      letterSpacing: "0.1em", border: "1px solid rgba(200,148,26,0.5)",
                      background: "transparent", color: "#c8941a",
                    }}
                  >{linkOpen ? "HIDE CODE" : "LINK ANOTHER DEVICE"}</button>
                )}
              </div>

              {linkOpen && wallet && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ fontSize: 8, color: "#e74c3c", letterSpacing: "0.06em" }}>
                    ⚠ BEARER CODE — anyone who has it can spend your ${wallet.balanceUsd.toFixed(2)}. Send it to yourself only, and treat it like cash.
                  </div>
                  <div className="flex gap-2">
                    <input
                      readOnly
                      value={encodeLinkCode(wallet)}
                      onFocus={e => e.currentTarget.select()}
                      style={{
                        flex: 1, fontFamily: "monospace", fontSize: 9, padding: "4px 6px",
                        background: "rgba(0,0,0,0.4)", color: "rgba(255,255,255,0.75)",
                        border: "1px solid rgba(255,255,255,0.15)",
                      }}
                    />
                    <button
                      onClick={() => {
                        navigator.clipboard?.writeText(encodeLinkCode(wallet)).then(
                          () => setCopied(true),
                          () => setCopied(false),
                        );
                      }}
                      style={{
                        fontSize: 8, fontFamily: "monospace", cursor: "pointer", padding: "4px 10px",
                        letterSpacing: "0.1em", border: "1px solid rgba(200,148,26,0.5)",
                        background: "rgba(200,148,26,0.12)", color: "#c8941a",
                      }}
                    >{copied ? "COPIED" : "COPY"}</button>
                  </div>
                  <div style={{ fontSize: 8, color: "rgba(255,255,255,0.35)" }}>
                    On the other device: open this panel and paste the code below. The balance is not copied — both devices spend the same wallet.
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <input
                  value={linkPaste}
                  onChange={e => { setLinkPaste(e.target.value); setLinkArmed(false); }}
                  placeholder="Paste a wallet link code from another device (VFW1.…)"
                  style={{
                    flex: 1, fontFamily: "monospace", fontSize: 9, padding: "4px 6px",
                    background: "rgba(0,0,0,0.3)", color: "rgba(255,255,255,0.8)",
                    border: "1px solid rgba(255,255,255,0.15)",
                  }}
                />
                <button
                  onClick={() => {
                    // Replacing a funded wallet needs a second click: the old
                    // balance stays in the ledger, but only its own code reaches it.
                    if (wallet && wallet.balanceUsd > 0 && !linkArmed) { setLinkArmed(true); return; }
                    linkDevice();
                  }}
                  disabled={linking || !linkPaste.trim()}
                  style={{
                    fontSize: 8, fontFamily: "monospace", letterSpacing: "0.1em", padding: "4px 10px",
                    cursor: linking || !linkPaste.trim() ? "default" : "pointer",
                    border: `1px solid ${linkArmed ? "rgba(231,76,60,0.6)" : "rgba(255,255,255,0.2)"}`,
                    background: linkArmed ? "rgba(231,76,60,0.12)" : "transparent",
                    color: linkArmed ? "#e74c3c" : "rgba(255,255,255,0.6)",
                    opacity: linking || !linkPaste.trim() ? 0.4 : 1,
                  }}
                >{linking ? "LINKING…" : linkArmed ? `REPLACE $${wallet?.balanceUsd.toFixed(2)} WALLET?` : "LINK"}</button>
              </div>
            </div>
          </div>
        )}

        {/* claim result */}
        {claimNote && (
          <div style={{
            fontFamily: "monospace", fontSize: 9,
            color: claimNote.startsWith("✓") ? "#2ecc71" : "#e74c3c",
            border: `1px solid ${claimNote.startsWith("✓") ? "rgba(46,204,113,0.35)" : "rgba(231,76,60,0.35)"}`,
            background: claimNote.startsWith("✓") ? "rgba(46,204,113,0.06)" : "rgba(231,76,60,0.06)",
            padding: "6px 10px", marginBottom: 8,
            display: "flex", justifyContent: "space-between", gap: 10,
          }}>
            <span>{claimNote}</span>
            <button onClick={() => setClaimNote(null)} style={{
              background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: 10,
            }}>×</button>
          </div>
        )}

        {/* messages */}
        {/* Answers arrive asynchronously; without a live region a screen reader
            never announces them and the gate looks silent after SEND. */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto pr-1" style={{ scrollbarWidth: "thin" }}
             role="log" aria-live="polite" aria-relevant="additions text" aria-label="Conversation transcript">
          {thread.length === 0 && !sending && (
            <div style={{
              fontFamily: "monospace", color: "rgba(255,255,255,0.55)", fontSize: 11,
              lineHeight: 2, marginTop: "6vh", maxWidth: 580,
              background: "rgba(4,3,10,0.82)", border: "1px solid rgba(255,255,255,0.07)",
              padding: "16px 18px", backdropFilter: "blur(6px)",
            }}>
              <div style={{ color: "#c8941a", letterSpacing: "0.25em", fontSize: 9, marginBottom: 10 }}>
                THE GATE IS LIVE
              </div>
              Four model families — Meta, OpenAI (open weights), Alibaba, Google — answer
              through the Verum Frontier gate. Every response returns with a cost-plus
              receipt and a SHA-256 Merkle seal you can download and verify yourself.
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", marginTop: 12, lineHeight: 1.8 }}>
                WHAT&apos;S REAL HERE: model responses, token counts, costs, hashes, timings,<br />
                and a VALIDATED bias screen (toxicity AUROC 0.92 · framing 0.84, held-out) —<br />
                a triage label on every answer, never a filter. Nothing is simulated in live mode.<br />
                FREE TIER: {quota?.limit ?? 5} queries/day · answers to 1,024 tokens (4,096 with credits).<br />
                YOUR SESSION + MEMORY: stored in your browser only — no accounts, no server database.<br />
                MEMORY RECALL: relevant past exchanges return as verified context — the context
                window is working memory; your sealed archive is the long-term memory.<br />
                🔎 GROUND IT: route a factual question through Google Search — the answer comes back
                cited to real sources, sealed. Every other answer is stamped &quot;ungrounded&quot; so
                confident prose is never mistaken for a sourced document.
              </div>
            </div>
          )}

          {thread.map(ex => {
            const m = models.find(mm => mm.id === ex.modelId);
            const open = expanded === ex.id;
            return (
              <div key={ex.id} style={{ marginBottom: 18, fontFamily: "monospace" }}>
                {/* user */}
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
                  <div style={{
                    maxWidth: "85%", padding: "8px 12px", fontSize: 12, lineHeight: 1.6,
                    border: "1px solid rgba(200,148,26,0.4)", background: "rgba(26,19,5,0.92)",
                    color: "rgba(255,255,255,0.9)", whiteSpace: "pre-wrap",
                  }}>{ex.query}</div>
                </div>
                {/* model */}
                <div style={{ display: "flex", justifyContent: "flex-start" }}>
                  <div style={{
                    maxWidth: "85%", padding: "8px 12px",
                    border: `1px solid ${m?.color ?? "#888"}44`, background: "rgba(5,4,11,0.94)",
                  }}>
                    <div style={{ fontSize: 7, letterSpacing: "0.2em", color: m?.color, marginBottom: 4 }}>
                      {m?.name.toUpperCase()} · {m?.family.toUpperCase()} · {ex.timingMs.llm}ms
                      {ex.routing && <span style={{ color: "#58a6ff" }}> · 🐇 ALICE·{ex.routing.mode.toUpperCase()}</span>}
                    </div>
                    {ex.routing && (
                      <div style={{ fontSize: 8, color: "rgba(88,166,255,0.7)", marginBottom: 5, fontFamily: "monospace" }}>
                        routed in your browser: {ex.routing.rule}
                      </div>
                    )}
                    {ex.attachmentMeta && (
                      <div style={{ fontSize: 8, color: "rgba(88,166,255,0.7)", marginBottom: 5, fontFamily: "monospace" }}>
                        📎 {ex.attachmentMeta.name} · {ex.attachmentMeta.chars.toLocaleString()} chars · sealed as DOCUMENT leaf
                      </div>
                    )}
                    <div style={{ fontSize: 12, lineHeight: 1.65, color: "rgba(255,255,255,0.85)", whiteSpace: "pre-wrap" }}>
                      {ex.response}
                    </div>
                    {/* grounding honesty label — on every answer */}
                    {ex.grounded ? (
                      <div style={{
                        marginTop: 7, padding: "5px 9px", fontFamily: "monospace", fontSize: 8,
                        border: "1px solid rgba(88,166,255,0.4)", background: "rgba(88,166,255,0.07)",
                        color: "#58a6ff", lineHeight: 1.7, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center",
                      }}>
                        {(() => {
                          // The count and the chips must agree. This header used to print
                          // sources.length while rendering a hardcoded first six — a
                          // visible count mismatch on a product about receipts. It also
                          // said "via Google Search" for every grounded answer, including
                          // ones the model retrieved first-hand through its own provider.
                          const srcs = ex.grounding?.sources ?? [];
                          const shown = srcs.slice(0, 6);
                          const who = ex.groundingMode === "native"
                            ? `retrieved first-hand by ${models.find(m => m.id === ex.modelId)?.name ?? ex.modelId}`
                            : "via Gemini + Google Search";
                          return (
                            <>
                              <span>
                                🔎 GROUNDED · {srcs.length} source{srcs.length === 1 ? "" : "s"} {who}
                                {srcs.length > shown.length
                                  ? ` · showing ${shown.length}, all ${srcs.length} in the receipt:`
                                  : ":"}
                              </span>
                              {shown.map((s, i) => (
                                <a key={i} href={s.uri} target="_blank" rel="noopener noreferrer"
                                   style={{ color: "rgba(88,166,255,0.85)", textDecoration: "underline" }}>{s.title || sourceHost(s.uri)}</a>
                              ))}
                            </>
                          );
                        })()}
                      </div>
                    ) : (
                      <div style={{ marginTop: 6, fontFamily: "monospace", fontSize: 7.5, color: "rgba(255,255,255,0.3)", letterSpacing: "0.03em" }}>
                        ○ ungrounded — generated from model training, not retrieved or verified
                      </div>
                    )}
                    {ex.truncated && (
                      <div style={{
                        marginTop: 8, padding: "6px 10px", fontFamily: "monospace", fontSize: 9,
                        border: "1px solid rgba(200,148,26,0.4)", background: "rgba(200,148,26,0.07)",
                        color: "#c8941a", lineHeight: 1.7,
                      }}>
                        ⚠ Answer hit the {ex.outputCap?.toLocaleString() ?? "1,024"}-token cap and was cut off.
                        Say &quot;continue&quot; to get the rest{ex.receipt.tier === "free" ? " — credits raise the cap to 4,096 tokens" : ""}.
                      </div>
                    )}
                    {/* receipt summary line */}
                    <button
                      onClick={() => setExpanded(open ? null : ex.id)}
                      aria-expanded={open}
                      aria-label={`${open ? "Hide" : "Show"} the full cost-plus receipt, bias screen and Merkle seal for this answer`}
                      style={{
                        marginTop: 8, background: "none", border: "none", cursor: "pointer",
                        fontSize: 8, fontFamily: "monospace", color: "rgba(255,255,255,0.4)",
                        letterSpacing: "0.08em", padding: 0, textAlign: "left",
                      }}
                    >
                      🧾 {ex.receipt.usage.inputTokens.toLocaleString()} in / {ex.receipt.usage.outputTokens.toLocaleString()} out
                      · cost {fmtUsd(ex.receipt.totalUsd)} · charged {fmtUsd(ex.receipt.chargedUsd)}{" · "}
                      {ex.bias ? `bias tox p${ex.bias.toxicityPctile} / frame p${ex.bias.framingPctile}` : "bias n/a"}{" · seal "}
                      {ex.seal.root.slice(0, 10)}… {open ? "▲" : "▼"}
                    </button>
                    {open && (
                      <div style={{ marginTop: 8, borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 8, display: "grid", gap: 10 }}>
                        <ReceiptCard r={ex.receipt} color={m?.color ?? "#fff"} />
                        <GroundingView ex={ex} />
                        <BiasCard b={ex.bias} />
                        <SealView ex={ex} />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {sending && (
            <div style={{ fontFamily: "monospace", fontSize: 9, color: "#c8941a", letterSpacing: "0.2em" }}>
              ▶ GATE EXECUTING — {model?.name.toUpperCase()}<span className="blink">_</span>
            </div>
          )}
        </div>

        {/* error */}
        {error && (
          <div role="alert" aria-live="assertive" style={{
            fontFamily: "monospace", fontSize: 9, color: "#e74c3c",
            border: "1px solid rgba(231,76,60,0.35)", background: "rgba(231,76,60,0.06)",
            padding: "6px 10px", marginBottom: 6,
            display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
          }}>
            <span>⚠ {error}</span>
            {bootFailed && onFallbackToDemo && (
              <button onClick={onFallbackToDemo} style={{
                fontFamily: "monospace", fontSize: 8, letterSpacing: "0.15em", cursor: "pointer",
                padding: "4px 10px", border: "1px solid rgba(200,148,26,0.5)",
                background: "rgba(200,148,26,0.1)", color: "#c8941a", whiteSpace: "nowrap",
              }}>VIEW SIM DEMO INSTEAD</button>
            )}
          </div>
        )}

        {/* model chips */}
        <div className="flex gap-1.5 flex-wrap mb-2">
          {ground.available && (
            <button
              onClick={() => setGroundOn(g => !g)}
              title={`GROUND IT routes your query through ${ground.via} — real web sources, cited and sealed. Adds Google's search-grounding cost to the receipt. Overrides the selected model (only Gemini grounds).`}
              style={{
                fontFamily: "monospace", fontSize: 8, letterSpacing: "0.08em", cursor: "pointer",
                padding: "4px 8px",
                background: groundOn ? "rgba(88,166,255,0.18)" : "rgba(4,3,10,0.8)",
                border: `1px solid ${groundOn ? "#58a6ff" : "rgba(255,255,255,0.12)"}`,
                color: groundOn ? "#58a6ff" : "rgba(255,255,255,0.45)",
              }}
            >
              🔎 GROUND IT{groundOn ? " · ON" : ""}
            </button>
          )}
          {([["save", "🐇 ALICE · SAVE $"], ["best", "🐇 ALICE · BEST"]] as const).map(([m, label]) => (
            <button
              key={m}
              onClick={() => setRouterMode(r => (r === m ? null : m))}
              title="ALICE picks the model in YOUR browser — the rule that fired is shown on every answer. Sovereign routing."
              style={{
                fontFamily: "monospace", fontSize: 8, letterSpacing: "0.08em", cursor: "pointer",
                padding: "4px 8px",
                background: routerMode === m ? "rgba(88,166,255,0.14)" : "rgba(4,3,10,0.8)",
                border: `1px solid ${routerMode === m ? "#58a6ff" : "rgba(255,255,255,0.12)"}`,
                color: routerMode === m ? "#58a6ff" : "rgba(255,255,255,0.45)",
              }}
            >
              {label}
            </button>
          ))}
          {models.map(m => {
            const active = !routerMode && modelId === m.id;
            const premium = m.tier === "premium";
            const locked = premium && !creditsActive;
            // The same sentence goes to title AND aria-label: a native tooltip is
            // unreachable by keyboard and touch, so on its own it hides the
            // credits-only rule from exactly the users who most need it stated.
            const explain = premium
              ? `${m.name} — premium, credits only. ${locked
                  ? "Add credits to unlock it; the free council stays free."
                  : "Paid from your credits at exact cost-plus, receipted like everything else."}`
              : `${m.name} — free council.`;
            return (
              <button key={m.id} onClick={() => {
                  setModelId(m.id); setRouterMode(null);
                  try { localStorage.setItem(MODEL_KEY, m.id); } catch { /* ignore */ }
                  // Picking a credits-only model with no balance used to be a dead
                  // end whose only explanation was a hover tooltip. Open the buy
                  // row instead — keyboard- and touch-reachable, and the pre-send
                  // estimate then prices this exact model against the balance.
                  if (locked && payments.enabled) setBuyOpen(true);
                }}
                aria-pressed={active}
                aria-label={explain}
                title={explain}
                style={{
                fontFamily: "monospace", fontSize: 8, letterSpacing: "0.08em", cursor: "pointer",
                padding: "4px 8px", background: active ? `${m.color}18` : "rgba(4,3,10,0.8)",
                border: `1px solid ${active ? m.color : premium ? "rgba(200,148,26,0.35)" : "rgba(255,255,255,0.12)"}`,
                color: active ? m.color : "rgba(255,255,255,0.45)",
                opacity: routerMode ? 0.55 : locked ? 0.5 : 1,
              }}>
                {premium ? "💳 " : ""}{m.name.toUpperCase()}
                <span style={{ opacity: 0.55 }}> · {m.family} · ${m.inPerM.toFixed(2)}/${m.outPerM.toFixed(2)} per M</span>
              </button>
            );
          })}
        </div>

        {/* GROUND IT override warning. A silent model substitution is exactly
            what a provenance product must never do — if your pick is about to be
            overridden, you should know BEFORE you spend, not after. */}
        {groundOn && ground.modelId && modelId !== ground.modelId && !model?.selfGrounds && (
          <div style={{
            border: "1px solid rgba(200,148,26,0.5)", background: "rgba(200,148,26,0.08)",
            padding: "6px 10px", marginBottom: 8, fontFamily: "monospace", fontSize: 9,
            color: "#c8941a", lineHeight: 1.7,
          }}>
            ⚠ GROUND IT is ON — only Gemini can ground, so this answer will come from{" "}
            <strong>{models.find(m => m.id === ground.modelId)?.name ?? ground.modelId}</strong>
            {", not "}
            <strong>{model?.name ?? modelId}</strong>
            {". Both your pick and the answering model are recorded in the sealed download. "}
            Turn GROUND IT off to use {model?.name ?? "your selected model"}.
          </div>
        )}

        {/* attach panel */}
        {attachOpen && !attachment && (
          <div style={{
            border: "1px solid rgba(88,166,255,0.35)", background: "rgba(88,166,255,0.04)",
            padding: "10px 12px", marginBottom: 8, fontFamily: "monospace",
            display: "flex", flexDirection: "column", gap: 8,
          }}>
            <div style={{ fontSize: 8, letterSpacing: "0.15em", color: "rgba(255,255,255,0.5)" }}>
              ATTACH TEXT — rides this one question only (up to 24,000 chars) · sealed by hash · its token cost shows on the receipt
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button onClick={() => fileRef.current?.click()} style={{
                fontFamily: "monospace", fontSize: 9, cursor: "pointer", padding: "5px 12px",
                border: "1px solid rgba(88,166,255,0.5)", background: "rgba(88,166,255,0.1)", color: "#58a6ff",
              }}>CHOOSE FILE (.txt .md .csv .json)</button>
              <input
                ref={fileRef} type="file" accept=".txt,.md,.csv,.json,text/plain" style={{ display: "none" }}
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  f.text().then(t => setAttachment({ name: f.name.slice(0, 100), text: t.slice(0, 24_000) }));
                  e.target.value = "";
                }}
              />
              <span style={{ fontSize: 8, color: "rgba(255,255,255,0.3)" }}>or paste below:</span>
            </div>
            <textarea
              value={pasteBuf}
              onChange={e => setPasteBuf(e.target.value)}
              placeholder="Paste a large block of text here…"
              rows={4}
              style={{
                resize: "vertical", fontFamily: "monospace", fontSize: 11,
                background: "rgba(4,3,10,0.9)", border: "1px solid rgba(255,255,255,0.12)",
                color: "rgba(255,255,255,0.85)", padding: "8px 10px", outline: "none",
              }}
            />
            {pasteBuf.trim() && (
              <button onClick={() => { setAttachment({ name: "pasted-text.txt", text: pasteBuf.slice(0, 24_000) }); }} style={{
                alignSelf: "flex-start", fontFamily: "monospace", fontSize: 9, cursor: "pointer",
                padding: "5px 12px", border: "1px solid rgba(46,204,113,0.5)",
                background: "rgba(46,204,113,0.1)", color: "#2ecc71",
              }}>USE PASTED TEXT ({pasteBuf.length.toLocaleString()} chars{pasteBuf.length > 24_000 ? " — will trim to 24k" : ""})</button>
            )}
          </div>
        )}
        {attachment && (
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap",
            border: `1px solid ${attachPinned ? "rgba(200,148,26,0.5)" : "rgba(88,166,255,0.4)"}`,
            background: attachPinned ? "rgba(200,148,26,0.07)" : "rgba(88,166,255,0.06)",
            padding: "6px 10px", marginBottom: 8, fontFamily: "monospace", fontSize: 9,
            color: attachPinned ? "#c8941a" : "#58a6ff",
          }}>
            <span>
              {attachPinned ? "📌" : "📎"} {attachment.name} · {attachment.text.length.toLocaleString()} chars —{" "}
              {attachPinned
                ? "PINNED: rides every question until unpinned (each receipt shows its cost)"
                : "rides your next question only"}
            </span>
            <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button onClick={() => setAttachPinned(p => !p)} style={{
                background: "none", border: "1px solid currentColor", color: "inherit",
                cursor: "pointer", fontSize: 8, letterSpacing: "0.1em", padding: "2px 8px", fontFamily: "monospace",
              }}>{attachPinned ? "UNPIN" : "📌 PIN FOR SESSION"}</button>
              <button onClick={() => { setAttachment(null); setAttachPinned(false); setPasteBuf(""); }} style={{
                background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: 11,
              }}>✕</button>
            </span>
          </div>
        )}
        {!attachment && lastAttachment && (
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
            border: "1px dashed rgba(88,166,255,0.3)", padding: "5px 10px", marginBottom: 8,
            fontFamily: "monospace", fontSize: 9, color: "rgba(88,166,255,0.7)",
          }}>
            <span>📎 {lastAttachment.name} was detached after its turn (documents ride one question unless pinned)</span>
            <span style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setAttachment(lastAttachment)} style={{
                background: "none", border: "1px solid currentColor", color: "inherit",
                cursor: "pointer", fontSize: 8, letterSpacing: "0.1em", padding: "2px 8px", fontFamily: "monospace",
              }}>RE-ATTACH</button>
              <button onClick={() => setLastAttachment(null)} style={{
                background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: 11,
              }}>✕</button>
            </span>
          </div>
        )}

        {/* Recall preview — what this query will pull from the sealed archive,
            shown BEFORE sending so a wrong pick costs nothing to catch. */}
        {memPreview.length > 0 && gateOpen && (
          <div style={{
            fontFamily: "monospace", fontSize: 9, lineHeight: 1.7, marginBottom: 6,
            padding: "6px 8px",
            border: `1px solid ${recallOff ? "rgba(255,255,255,0.10)" : "rgba(179,157,219,0.35)"}`,
            background: recallOff ? "transparent" : "rgba(179,157,219,0.07)",
            color: recallOff ? "rgba(255,255,255,0.3)" : "rgba(179,157,219,0.9)",
          }}>
            <div className="flex items-center justify-between gap-3">
              <span style={{ letterSpacing: "0.12em" }}>
                🧠 {recallOff ? "RECALL OFF — no memories will be sent" : `WILL RECALL ${memPreview.length} SEALED ${memPreview.length === 1 ? "MEMORY" : "MEMORIES"}`}
              </span>
              <button
                onClick={() => setRecallOff(o => !o)}
                style={{
                  fontFamily: "monospace", fontSize: 8, cursor: "pointer", padding: "1px 6px",
                  letterSpacing: "0.1em", background: "transparent",
                  border: "1px solid rgba(255,255,255,0.2)",
                  color: recallOff ? "#b39ddb" : "rgba(255,255,255,0.45)",
                }}
              >{recallOff ? "USE RECALL" : "SKIP"}</button>
            </div>
            {!recallOff && memPreview.map(m => (
              <div key={m.root} style={{ opacity: 0.75, paddingLeft: 14 }}>
                · <span style={{ opacity: 0.6 }}>{agoLabel(m.ts)}</span>{" — "}
                {m.query.length > 84 ? m.query.slice(0, 84) + "…" : m.query}
              </div>
            ))}
          </div>
        )}

        {/* Pre-send cost. Grounded premium has run from $0.11 to $1.01 for the
            same question, so this quotes real past receipts where they exist
            rather than inventing a single confident number. */}
        {estimate && gateOpen && (() => {
          const over = estimate.kind === "history" && creditsActive && wallet && estimate.hi > wallet.balanceUsd;
          return (
            <div style={{
              fontFamily: "monospace", fontSize: 9, lineHeight: 1.7, marginBottom: 6,
              padding: "5px 8px",
              border: `1px solid ${over ? "rgba(231,76,60,0.4)" : "rgba(200,148,26,0.28)"}`,
              background: over ? "rgba(231,76,60,0.05)" : "rgba(200,148,26,0.05)",
              color: over ? "#e74c3c" : "#c8941a",
            }}>
              {estimate.kind === "history" ? (
                <>
                  <span style={{ letterSpacing: "0.1em" }}>
                    💰 {estimate.lo === estimate.hi
                      ? `≈ ${fmtUsd(estimate.hi)}`
                      : `${fmtUsd(estimate.lo)} – ${fmtUsd(estimate.hi)}`}
                  </span>
                  <span style={{ opacity: 0.72 }}>
                    {" — what "}{model?.name}{groundOn ? " grounded" : ""}{" actually cost you across "}
                    {estimate.n} past {estimate.n === 1 ? "answer" : "answers"}
                    {over ? ` · MAY EXCEED YOUR $${wallet!.balanceUsd.toFixed(2)} BALANCE` : ""}
                  </span>
                </>
              ) : (
                <>
                  <span style={{ letterSpacing: "0.1em" }}>
                    💰 {groundOn ? "≥ " : "≈ "}{fmtUsd(estimate.usd)}
                  </span>
                  <span style={{ opacity: 0.72 }}>
                    {" — from published rates and this prompt; no receipts for "}
                    {model?.name}{groundOn ? " grounded" : ""}{" yet"}
                    {groundOn ? " · RETRIEVED PAGES ARE BILLED ON TOP AND VARY WIDELY" : ""}
                  </span>
                </>
              )}
              <span style={{ opacity: 0.45 }}>{" · estimate — the receipt is the truth"}</span>
            </div>
          );
        })()}

        {/* input */}
        <div className="flex gap-2 pb-3">
          <button
            onClick={() => setAttachOpen(o => !o)}
            title="Attach a text file or paste a large block — sealed by hash, priced on the receipt"
            style={{
              fontFamily: "monospace", fontSize: 13, cursor: "pointer", padding: "0 12px",
              border: `1px solid ${attachment || attachOpen ? "rgba(88,166,255,0.5)" : "rgba(255,255,255,0.15)"}`,
              background: attachment ? "rgba(88,166,255,0.1)" : "transparent",
              color: attachment || attachOpen ? "#58a6ff" : "rgba(255,255,255,0.4)",
            }}
          >📎</button>
          <textarea
            id="vf-gate-input"
            name="query"
            aria-label="Ask through the gate"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                // Same predicate the button uses. If it refuses, do nothing at
                // all — never silently swallow what the user typed.
                if (canSend) send();
              }
            }}
            placeholder={
              !gateOpen
                ? "Free tier used for today (resets 00:00 UTC) — buy prepaid credits above to keep going, cost-plus receipts included."
                : creditsActive && remaining === 0
                  ? "Ask through the gate… (paying from credits — exact cost-plus per answer)"
                  : "Ask through the gate… (Enter to send)"
            }
            disabled={sending || !gateOpen}
            rows={2}
            maxLength={4000}
            style={{
              flex: 1, resize: "none", fontFamily: "monospace", fontSize: 12,
              background: "rgba(4,3,10,0.9)", border: "1px solid rgba(255,255,255,0.15)",
              color: "rgba(255,255,255,0.9)", padding: "10px 12px", outline: "none",
            }}
          />
          <button
            onClick={send}
            disabled={!canSend}
            style={{
              fontFamily: "monospace", fontSize: 9, letterSpacing: "0.2em", cursor: "pointer",
              padding: "0 18px", border: "1px solid rgba(200,148,26,0.5)",
              background: sending ? "rgba(200,148,26,0.05)" : "rgba(200,148,26,0.12)",
              color: "#c8941a", opacity: canSend ? 1 : 0.4,
            }}
          >{sending ? "…" : "SEND"}</button>
        </div>
      </div>

      {/* ── SIDE PANEL (desktop) ── */}
      <div className="hidden lg:flex flex-col w-[300px] flex-shrink-0 mr-4 mt-3 mb-3" style={{
        background: "rgba(4,3,10,0.94)", border: "1px solid rgba(255,255,255,0.08)",
        backdropFilter: "blur(16px)", overflowY: "auto",
      }}>
        <div style={{ padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <div style={{ fontSize: 8, letterSpacing: "0.25em", color: "rgba(255,255,255,0.3)", fontFamily: "monospace" }}>
            LIVE PIPELINE — LAST EXCHANGE
          </div>
        </div>
        <div style={{ padding: 14, flex: 1 }}>
          {!last ? (
            <div style={{ fontFamily: "monospace", fontSize: 9, color: "rgba(255,255,255,0.25)", lineHeight: 2 }}>
              AWAITING FIRST QUERY<span className="blink">_</span><br />
              <span style={{ fontSize: 8 }}>
                Stages, timings, token counts and hashes shown here are measured
                server-side per exchange — not simulated.
              </span>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 14 }}>
              <div>
                {last.stages.map((s, i) => (
                  <div key={i} style={{ borderLeft: "1px solid rgba(46,204,113,0.5)", paddingLeft: 10, marginBottom: 6, fontFamily: "monospace" }}>
                    <div style={{ fontSize: 9, color: "rgba(255,255,255,0.8)" }}>
                      <span style={{ color: "#2ecc71" }}>✓</span> [{String(i + 1).padStart(2, "0")}] {s.label}
                      <span style={{ color: "rgba(255,255,255,0.3)" }}> · {s.ms}ms</span>
                    </div>
                    <div style={{ fontSize: 8, color: "rgba(255,255,255,0.35)", marginTop: 1 }}>{s.detail}</div>
                  </div>
                ))}
              </div>
              <ReceiptCard r={last.receipt} color={models.find(m => m.id === last.modelId)?.color ?? "#fff"} />
              <GroundingView ex={last} />
              <BiasCard b={last.bias} />
              <SealView ex={last} />
            </div>
          )}
        </div>
        <div style={{ padding: 12, borderTop: "1px solid rgba(255,255,255,0.07)" }}>
          <button
            onClick={downloadSession}
            disabled={!thread.length}
            style={{
              width: "100%", fontFamily: "monospace", fontSize: 8, letterSpacing: "0.2em",
              padding: "8px 0", cursor: thread.length ? "pointer" : "default",
              border: "1px solid rgba(200,148,26,0.4)", background: "rgba(200,148,26,0.08)",
              color: "#c8941a", opacity: thread.length ? 1 : 0.35,
            }}
          >
            ⬇ DOWNLOAD SEALED SESSION ({thread.length} {thread.length === 1 ? "EXCHANGE" : "EXCHANGES"})
          </button>
        </div>
      </div>
    </div>
  );
}
