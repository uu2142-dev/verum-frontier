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
interface Exchange {
  id: number;
  query: string;
  response: string;
  modelId: string;
  receipt: Receipt;
  stages: Stage[];
  seal: { algo: string; leaves: Leaf[]; root: string; sealedAt: string };
  timingMs: { total: number; llm: number };
  chainHash: string; // client-side session chain: SHA-256(prev + root)
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
      <Row k="CHARGED TODAY" v={`${fmtUsd(r.chargedUsd)} — FREE TIER`} color="#2ecc71" />
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
      <div style={{ color: "rgba(255,255,255,0.3)" }}>CHAIN {ex.chainHash.slice(0, 32)}…</div>
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
  const chainRef   = useRef<string>("");
  const startedRef = useRef<string>("");
  const nextId     = useRef(1);
  const scrollRef  = useRef<HTMLDivElement>(null);

  useEffect(() => {
    startedRef.current = new Date().toISOString();
    sha256Hex("VERUM_FRONTIER_SESSION_GENESIS" + startedRef.current).then(h => { chainRef.current = h; });
    fetch("/api/chat")
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(d => {
        if (!d.models?.length) throw new Error("no models");
        setModels(d.models);
        setModelId(d.models[0].id);
        setQuota(d.quota ?? null);
      })
      .catch(() => {
        setBootFailed(true);
        setError("The live gate is unavailable right now (configuration or upstream issue).");
      });
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [thread, sending]);

  const model = models.find(m => m.id === modelId);
  const remaining = quota ? Math.max(0, quota.limit - quota.used) : null;

  const send = useCallback(async () => {
    const q = input.trim();
    if (!q || sending || !modelId) return;
    setSending(true);
    setError(null);
    try {
      const history = thread.flatMap(ex => ([
        { role: "user" as const, content: ex.query },
        { role: "assistant" as const, content: ex.response },
      ]));
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId, messages: [...history, { role: "user", content: q }] }),
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
        stages: data.stages,
        seal: data.seal,
        timingMs: data.timingMs,
        chainHash,
      }]);
      setQuota(data.quota);
      setInput("");
    } catch {
      setError("Network error — the query was not charged against your quota.");
    } finally {
      setSending(false);
    }
  }, [input, sending, modelId, thread]);

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
        seal: ex.seal,
        timingMs: ex.timingMs,
        sessionChainHash: ex.chainHash,
      })),
      sessionChainRoot: chainRef.current,
      verify:
        "Leaves are SHA-256 hex digests produced server-side over the exchange " +
        "(see seal.leaves labels). The Merkle root pairs leaves left-to-right, " +
        "duplicating the last when odd, hashing hex-string concatenations. The session " +
        "chain is SHA-256(prevChainHash + seal.root), genesis = " +
        "SHA-256('VERUM_FRONTIER_SESSION_GENESIS' + startedAt). Any SHA-256 tool can re-verify.",
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
          {quota && (
            <div style={{
              fontSize: 8, fontFamily: "monospace", letterSpacing: "0.15em",
              color: remaining === 0 ? "#e74c3c" : "rgba(255,255,255,0.5)",
              border: "1px solid rgba(255,255,255,0.12)", padding: "3px 8px",
            }}>
              FREE TIER · {remaining}/{quota.limit} QUERIES LEFT TODAY
            </div>
          )}
        </div>

        {/* messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto pr-1" style={{ scrollbarWidth: "thin" }}>
          {thread.length === 0 && !sending && (
            <div style={{
              fontFamily: "monospace", color: "rgba(255,255,255,0.4)", fontSize: 11,
              lineHeight: 2, marginTop: "8vh", maxWidth: 560,
            }}>
              <div style={{ color: "#c8941a", letterSpacing: "0.25em", fontSize: 9, marginBottom: 10 }}>
                THE GATE IS LIVE
              </div>
              Four model families — Meta, OpenAI (open weights), Alibaba, Google — answer
              through the Verum Frontier gate. Every response returns with a cost-plus
              receipt and a SHA-256 Merkle seal you can download and verify yourself.
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", marginTop: 12, lineHeight: 1.8 }}>
                WHAT&apos;S REAL HERE: model responses, token counts, costs, hashes, timings.<br />
                NOT YET WIRED: the validated bias gate (in progress) — nothing is simulated in live mode.<br />
                FREE TIER: {quota?.limit ?? 5} queries/day · answers capped at 1,024 tokens.
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
                    border: "1px solid rgba(200,148,26,0.35)", background: "rgba(200,148,26,0.06)",
                    color: "rgba(255,255,255,0.85)", whiteSpace: "pre-wrap",
                  }}>{ex.query}</div>
                </div>
                {/* model */}
                <div style={{ display: "flex", justifyContent: "flex-start" }}>
                  <div style={{
                    maxWidth: "85%", padding: "8px 12px",
                    border: `1px solid ${m?.color ?? "#888"}44`, background: "rgba(4,3,10,0.85)",
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
                      · cost {fmtUsd(ex.receipt.totalUsd)} · charged $0.00
                      · seal {ex.seal.root.slice(0, 10)}… {open ? "▲" : "▼"}
                    </button>
                    {open && (
                      <div style={{ marginTop: 8, borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 8, display: "grid", gap: 10 }}>
                        <ReceiptCard r={ex.receipt} color={m?.color ?? "#fff"} />
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
            placeholder={remaining === 0 ? "Free tier used for today — resets 00:00 UTC. Paid credits (cost-plus) coming." : "Ask through the gate… (Enter to send)"}
            disabled={sending || remaining === 0}
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
            disabled={sending || !input.trim() || remaining === 0}
            style={{
              fontFamily: "monospace", fontSize: 9, letterSpacing: "0.2em", cursor: "pointer",
              padding: "0 18px", border: "1px solid rgba(200,148,26,0.5)",
              background: sending ? "rgba(200,148,26,0.05)" : "rgba(200,148,26,0.12)",
              color: "#c8941a", opacity: (sending || !input.trim() || remaining === 0) ? 0.4 : 1,
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
                <div style={{ fontFamily: "monospace", fontSize: 8, color: "rgba(255,255,255,0.3)", paddingLeft: 10 }}>
                  BIAS GATE: not yet wired — validated detector in progress. Labeled, not faked.
                </div>
              </div>
              <ReceiptCard r={last.receipt} color={models.find(m => m.id === last.modelId)?.color ?? "#fff"} />
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
