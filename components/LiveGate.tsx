'use client';
// ── LIVE GATE — real multi-model chat with receipts and seals ────────────
// Everything shown here is real: model responses, token counts from the
// provider, cost-plus receipts, SHA-256 hashes, timings. The bias gate is
// NOT wired yet and is labeled as such — no simulated numbers in this mode.

import { useCallback, useEffect, useRef, useState } from "react";
import { fmtUsd } from "@/lib/pricing";

// ── Types mirrored from /api/chat ─────────────────────────────────────────

interface ModelInfo {
  id: string; name: string; family: string; color: string;
  inPerM: number; outPerM: number; note: string;
}
interface Quota { used: number; limit: number; resetsAtUtc: string; }
interface Stage { label: string; detail: string; ms: number; }
interface Leaf { label: string; sha256: string; }
interface Receipt {
  priceSheetDate: string; model: string;
  rates: { inPerM: number; outPerM: number };
  usage: { inputTokens: number; outputTokens: number };
  directUsd: number; infraUsd: number; supportUsd: number;
  supportSplit: { server: number; development: number; steward: number; reserve: number };
  totalUsd: number; chargedUsd: number; tier: string;
}
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
  modelId: string;
  receipt: Receipt;
  bias: BiasResult | null;
  memoryRecall?: MemoryRecallInfo | null;
  stages: Stage[];
  seal: { algo: string; leaves: Leaf[]; root: string; sealedAt: string; sig?: SealSig };
  timingMs: { total: number; llm: number };
  chainHash: string; // client-side session chain: SHA-256(prev + root)
}

// Conversation archive: the session lives in YOUR browser (localStorage), not
// on a server — there is still no database behind this site.
const STORE_KEY = "vf_session_v1";

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

function recallMemories(queryText: string, memory: MemoryItem[], excludeRoots: Set<string>, k = 3): MemoryItem[] {
  const q = recallTokens(queryText);
  if (!q.size) return [];
  return memory
    .filter(m => !excludeRoots.has(m.root))
    .map(m => {
      const t = recallTokens(m.query + " " + m.response);
      let overlap = 0;
      q.forEach(w => { if (t.has(w)) overlap += 1; });
      return { m, overlap };
    })
    .filter(x => x.overlap >= 2)
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, k)
    .map(x => x.m);
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ── Receipt card ──────────────────────────────────────────────────────────

function ReceiptCard({ r, color }: { r: Receipt; color: string }) {
  return (
    <div style={{ fontFamily: "monospace", fontSize: 9, lineHeight: 1.9 }}>
      <div style={{ color: "rgba(255,255,255,0.3)", letterSpacing: "0.2em", fontSize: 7, marginBottom: 4 }}>
        COST-PLUS RECEIPT · PRICE SHEET {r.priceSheetDate}
      </div>
      <Row k="DIRECT API COST" v={fmtUsd(r.directUsd)} strong color={color} />
      <Sub k={`${r.usage.inputTokens.toLocaleString()} in × $${r.rates.inPerM.toFixed(2)}/M`} />
      <Sub k={`${r.usage.outputTokens.toLocaleString()} out × $${r.rates.outPerM.toFixed(2)}/M`} />
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
      <div style={{ color: "rgba(200,148,26,0.6)", fontSize: 7, letterSpacing: "0.2em", marginBottom: 4 }}>
        BIAS SCREEN · VALIDATED {b.version.toUpperCase()} · AUROC {b.validated.toxicityAuroc5fold?.toFixed(2)} tox / {b.validated.framingAurocOfficialSplit?.toFixed(2)} framing (held-out)
      </div>
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

// ── Seal view ─────────────────────────────────────────────────────────────

function SealView({ ex }: { ex: Exchange }) {
  return (
    <div style={{ fontFamily: "monospace", fontSize: 8, lineHeight: 1.8 }}>
      <div style={{ color: "rgba(200,148,26,0.6)", fontSize: 7, letterSpacing: "0.2em", marginBottom: 4 }}>
        MERKLE SEAL · REAL SHA-256
      </div>
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

export default function LiveGate({ onFallbackToDemo }: { onFallbackToDemo?: () => void }) {
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
  const [confirmForget, setConfirmForget] = useState(false);
  const [sealKey, setSealKey] = useState<{ alg: string; keyId: string; publicKeySpkiB64: string; signedPayloadFormat: string } | null>(null);
  const [payments, setPayments] = useState<{ enabled: boolean; testMode: boolean }>({ enabled: false, testMode: false });
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [buyOpen, setBuyOpen] = useState(false);
  const [buying, setBuying] = useState(false);
  const [claimNote, setClaimNote] = useState<string | null>(null);
  const chainRef   = useRef<string>("");
  const startedRef = useRef<string>("");
  const nextId     = useRef(1);
  const scrollRef  = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMemCount(loadMemory().length);
    setWallet(loadWallet());

    // Returning from Stripe checkout: claim the session into a wallet.
    const params = new URLSearchParams(window.location.search);
    const cs = params.get("credit_session");
    if (cs) {
      window.history.replaceState(null, "", window.location.pathname);
      fetch("/api/credits/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: cs }),
      })
        .then(r => r.json().then(d => ({ ok: r.ok, d })))
        .then(({ ok, d }) => {
          if (!ok) { setClaimNote(`⚠ ${d.error ?? "Claim failed."}`); return; }
          if (d.walletToken) {
            const w = { id: d.walletId, token: d.walletToken, balanceUsd: d.balanceUsd };
            saveWallet(w);
            setWallet(w);
            setClaimNote(`✓ Credits claimed: $${d.balanceUsd.toFixed(2)}${d.testMode ? " (TEST MODE — no real charge)" : ""}`);
          } else {
            const existing = loadWallet();
            if (existing && existing.id === d.walletId) {
              const w = { ...existing, balanceUsd: d.balanceUsd };
              saveWallet(w);
              setWallet(w);
              setClaimNote(`✓ Wallet refreshed: $${d.balanceUsd.toFixed(2)}`);
            } else {
              setClaimNote("⚠ This checkout was already claimed in another browser — credits live where they were first claimed.");
            }
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
        setModelId(d.models[0].id);
        setQuota(d.quota ?? null);
        setSealKey(d.sealKey ?? null);
        setPayments(d.payments ?? { enabled: false, testMode: false });
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

  // Conversion moment: the instant free runs out, show the buy row.
  useEffect(() => {
    if (remaining === 0 && !creditsActive && payments.enabled) setBuyOpen(true);
  }, [remaining, creditsActive, payments.enabled]);

  const send = useCallback(async () => {
    const q = input.trim();
    if (!q || sending || !modelId) return;
    setSending(true);
    setError(null);
    try {
      // Working memory: only the last 2 exchanges ride along as history.
      // Older relevant context arrives via MEMORY RECALL instead — smaller
      // prompts, smaller receipts, and the archive does the remembering.
      const recent = thread.slice(-2);
      const history = recent.flatMap(ex => ([
        { role: "user" as const, content: ex.query },
        { role: "assistant" as const, content: ex.response },
      ]));
      const excludeRoots = new Set(recent.map(ex => ex.seal.root));
      const recalled = recallMemories(q, loadMemory(), excludeRoots);
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelId,
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
        receipt: data.receipt,
        bias: data.bias ?? null,
        memoryRecall: data.memoryRecall ?? null,
        stages: data.stages,
        seal: data.seal,
        timingMs: data.timingMs,
        chainHash,
      }]);
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
    } catch {
      setError("Network error — the query was not charged against your quota.");
    } finally {
      setSending(false);
    }
  }, [input, sending, modelId, thread, wallet]);

  const downloadSession = useCallback(() => {
    const payload = {
      format: "verum-frontier-sealed-session/v1",
      site: "rabbitholeai.ai",
      startedAt: startedRef.current,
      exportedAt: new Date().toISOString(),
      exchanges: thread.map(ex => ({
        query: ex.query,
        response: ex.response,
        model: ex.modelId,
        receipt: ex.receipt,
        biasScreen: ex.bias,
        seal: ex.seal,
        timingMs: ex.timingMs,
        sessionChainHash: ex.chainHash,
      })),
      sessionChainRoot: chainRef.current,
      sealPublicKey: sealKey,
      verify:
        "Leaves are SHA-256 hex digests produced server-side over the exchange " +
        "(see seal.leaves labels). The Merkle root pairs leaves left-to-right, " +
        "duplicating the last when odd, hashing hex-string concatenations. The session " +
        "chain is SHA-256(prevChainHash + seal.root), genesis = " +
        "SHA-256('VERUM_FRONTIER_SESSION_GENESIS' + startedAt). Any SHA-256 tool can re-verify. " +
        "Where seal.sig is present, it is an Ed25519 signature over " +
        "'VF-SEAL-v1|<root>|<sealedAt>' by sealPublicKey — proving the exchange " +
        "was sealed by rabbitholeai.ai and not altered since.",
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `verum-session-${startedRef.current.slice(0, 19).replace(/[:T]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [thread]);

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
            {memCount > 0 && (
              <button
                onClick={() => {
                  if (!confirmForget) {
                    setConfirmForget(true);
                    setTimeout(() => setConfirmForget(false), 3000);
                    return;
                  }
                  try { localStorage.removeItem(MEMORY_KEY); } catch { /* ignore */ }
                  setMemCount(0);
                  setConfirmForget(false);
                }}
                title="Long-term memory lives only in this browser. Forgetting is permanent."
                style={{
                  fontSize: 8, fontFamily: "monospace", letterSpacing: "0.15em", cursor: "pointer",
                  border: `1px solid ${confirmForget ? "rgba(231,76,60,0.6)" : "rgba(255,255,255,0.15)"}`,
                  background: confirmForget ? "rgba(231,76,60,0.1)" : "transparent",
                  color: confirmForget ? "#e74c3c" : "rgba(255,255,255,0.45)", padding: "3px 8px",
                }}
              >
                {confirmForget ? "⚠ CLICK AGAIN TO FORGET ALL" : `🧠 ${memCount} SEALED ${memCount === 1 ? "MEMORY" : "MEMORIES"} · FORGET`}
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
        <div ref={scrollRef} className="flex-1 overflow-y-auto pr-1" style={{ scrollbarWidth: "thin" }}>
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
                FREE TIER: {quota?.limit ?? 5} queries/day · answers capped at 1,024 tokens.<br />
                YOUR SESSION + MEMORY: stored in your browser only — no accounts, no server database.<br />
                MEMORY RECALL: relevant past exchanges return as verified context — the context
                window is working memory; your sealed archive is the long-term memory.
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
                    </div>
                    <div style={{ fontSize: 12, lineHeight: 1.65, color: "rgba(255,255,255,0.85)", whiteSpace: "pre-wrap" }}>
                      {ex.response}
                    </div>
                    {/* receipt summary line */}
                    <button
                      onClick={() => setExpanded(open ? null : ex.id)}
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
          <div style={{
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
          {models.map(m => (
            <button key={m.id} onClick={() => setModelId(m.id)} style={{
              fontFamily: "monospace", fontSize: 8, letterSpacing: "0.08em", cursor: "pointer",
              padding: "4px 8px", background: modelId === m.id ? `${m.color}18` : "rgba(4,3,10,0.8)",
              border: `1px solid ${modelId === m.id ? m.color : "rgba(255,255,255,0.12)"}`,
              color: modelId === m.id ? m.color : "rgba(255,255,255,0.45)",
            }}>
              {m.name.toUpperCase()}
              <span style={{ opacity: 0.55 }}> · {m.family} · ${m.inPerM.toFixed(2)}/${m.outPerM.toFixed(2)} per M</span>
            </button>
          ))}
        </div>

        {/* input */}
        <div className="flex gap-2 pb-3">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
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
            disabled={sending || !input.trim() || !gateOpen}
            style={{
              fontFamily: "monospace", fontSize: 9, letterSpacing: "0.2em", cursor: "pointer",
              padding: "0 18px", border: "1px solid rgba(200,148,26,0.5)",
              background: sending ? "rgba(200,148,26,0.05)" : "rgba(200,148,26,0.12)",
              color: "#c8941a", opacity: (sending || !input.trim() || !gateOpen) ? 0.4 : 1,
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
