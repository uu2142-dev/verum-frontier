'use client';
// ── SEALED MEMORIES — the vault tab ──────────────────────────────────────
// Every sealed session is archived in THIS browser (localStorage, no server),
// so a session you forgot to download is never lost — come here and re-download
// it, byte-identical to the live download. FORGET lives at the bottom, behind a
// deliberate two-step "this is permanent" gate, so it can never be hit by
// accident while you're hunting for a past conversation.

import { useEffect, useState } from "react";
import { fmtUsd } from "@/lib/pricing";

// Keys shared with LiveGate — must match exactly.
const ARCHIVE_KEY = "vf_archive_v1";
const MEMORY_KEY = "vf_memory_v1";

interface ArchivedReceipt {
  totalUsd?: number;
  chargedUsd?: number;
  tier?: string;
}
interface ArchivedExchange {
  query?: string;
  response?: string;
  model?: string;
  receipt?: ArchivedReceipt;
  grounded?: boolean;
  seal?: { root?: string; sealedAt?: string };
}
interface ArchivedSession {
  format?: string;
  site?: string;
  startedAt: string;
  exportedAt?: string;
  exchanges: ArchivedExchange[];
  sessionChainRoot?: string;
  sealPublicKey?: unknown;
  verify?: string;
}

function loadArchive(): ArchivedSession[] {
  try {
    const raw = localStorage.getItem(ARCHIVE_KEY);
    if (!raw) return [];
    const a = JSON.parse(raw);
    const sessions: ArchivedSession[] = Array.isArray(a?.sessions) ? a.sessions : [];
    return sessions
      .filter(s => s && typeof s.startedAt === "string" && Array.isArray(s.exchanges) && s.exchanges.length > 0)
      .sort((x, y) => y.startedAt.localeCompare(x.startedAt));
  } catch {
    return [];
  }
}

function memoryCount(): number {
  try {
    const raw = localStorage.getItem(MEMORY_KEY);
    if (!raw) return 0;
    const m = JSON.parse(raw);
    return Array.isArray(m?.items) ? m.items.length : 0;
  } catch {
    return 0;
  }
}

function downloadSession(s: ArchivedSession) {
  // Re-download the archived bundle exactly as stored (it already carries its
  // seals, receipts, sources and the verify instructions). Refresh exportedAt
  // so the file records when this copy was pulled.
  const payload = { ...s, exportedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `verum-session-${s.startedAt.slice(0, 19).replace(/[:T]/g, "-")}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function SealedMemories({ onBack }: { onBack?: () => void }) {
  const [sessions, setSessions] = useState<ArchivedSession[]>([]);
  const [memCount, setMemCount] = useState(0);
  const [confirmForget, setConfirmForget] = useState(false);

  useEffect(() => {
    setSessions(loadArchive());
    setMemCount(memoryCount());
  }, []);

  const forgetAll = () => {
    if (!confirmForget) {
      setConfirmForget(true);
      setTimeout(() => setConfirmForget(false), 5000);
      return;
    }
    try { localStorage.removeItem(ARCHIVE_KEY); } catch { /* ignore */ }
    try { localStorage.removeItem(MEMORY_KEY); } catch { /* ignore */ }
    setSessions([]);
    setMemCount(0);
    setConfirmForget(false);
  };

  const totalExchanges = sessions.reduce((n, s) => n + s.exchanges.length, 0);

  return (
    <div className="relative z-30 w-full overflow-y-auto" style={{ height: "calc(100dvh - 120px)" }}>
      <div className="mx-auto w-full max-w-3xl px-4 md:px-8 pt-4 pb-16" style={{ fontFamily: "monospace" }}>

        {/* header */}
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <div>
            <div style={{ fontSize: 8, letterSpacing: "0.3em", color: "#b39ddb" }}>
              🧠 SEALED MEMORIES · YOUR VAULT
            </div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginTop: 4, lineHeight: 1.7 }}>
              {sessions.length} sealed {sessions.length === 1 ? "session" : "sessions"} · {totalExchanges}{" "}
              {totalExchanges === 1 ? "exchange" : "exchanges"} · {memCount} recall{" "}
              {memCount === 1 ? "memory" : "memories"} — stored in this browser only, no server.
            </div>
          </div>
          {onBack && (
            <button onClick={onBack} style={{
              fontSize: 8, letterSpacing: "0.2em", cursor: "pointer", padding: "5px 12px",
              border: "1px solid rgba(46,204,113,0.4)", background: "rgba(46,204,113,0.08)", color: "#2ecc71",
            }}>← BACK TO LIVE GATE</button>
          )}
        </div>

        <div style={{
          fontSize: 9, color: "rgba(255,255,255,0.4)", lineHeight: 1.8, marginBottom: 16,
          border: "1px solid rgba(179,157,219,0.2)", background: "rgba(179,157,219,0.04)", padding: "10px 12px",
        }}>
          Forgot to download a conversation before starting a new one? It&apos;s here. Every sealed
          session is archived automatically — re-download any of them below, verifiable by the same
          SHA-256 + Ed25519 seals as a live export. Nothing here ever left your device.
        </div>

        {/* session list */}
        {sessions.length === 0 ? (
          <div style={{
            fontSize: 10, color: "rgba(255,255,255,0.3)", lineHeight: 2, textAlign: "center",
            padding: "40px 12px", border: "1px dashed rgba(255,255,255,0.12)",
          }}>
            NO SEALED SESSIONS YET<span className="blink">_</span><br />
            <span style={{ fontSize: 9 }}>Your sealed conversations will appear here as you use the Live Gate.</span>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {sessions.map((s, i) => {
              const models = Array.from(new Set(s.exchanges.map(e => e.model).filter(Boolean))) as string[];
              const groundedCount = s.exchanges.filter(e => e.grounded).length;
              const totalCost = s.exchanges.reduce((sum, e) => sum + (e.receipt?.totalUsd ?? 0), 0);
              const chargedCost = s.exchanges.reduce((sum, e) => sum + (e.receipt?.chargedUsd ?? 0), 0);
              const firstQ = s.exchanges[0]?.query ?? "";
              return (
                <div key={s.startedAt + i} style={{
                  border: "1px solid rgba(255,255,255,0.1)", background: "rgba(4,3,10,0.7)", padding: "12px 14px",
                }}>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.85)" }}>
                        {s.startedAt.slice(0, 10)}{" "}
                        <span style={{ color: "rgba(255,255,255,0.4)" }}>{s.startedAt.slice(11, 19)}Z</span>
                        <span style={{ color: "rgba(255,255,255,0.3)" }}>
                          {" · "}{s.exchanges.length} {s.exchanges.length === 1 ? "exchange" : "exchanges"}
                        </span>
                      </div>
                      <div style={{
                        fontSize: 9, color: "rgba(255,255,255,0.5)", marginTop: 4, lineHeight: 1.5,
                        overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box",
                        WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                      }}>
                        “{firstQ.slice(0, 180)}{firstQ.length > 180 ? "…" : ""}”
                      </div>
                      <div style={{ fontSize: 8, color: "rgba(255,255,255,0.35)", marginTop: 6, letterSpacing: "0.05em" }}>
                        {models.join(" · ") || "—"}
                        {groundedCount > 0 && (
                          <span style={{ color: "#58a6ff" }}> · 🔎 {groundedCount} grounded</span>
                        )}
                        <span style={{ color: "#c8941a" }}> · cost {fmtUsd(totalCost)}</span>
                        {chargedCost > 0 && (
                          <span style={{ color: "#c8941a" }}> · charged {fmtUsd(chargedCost)}</span>
                        )}
                      </div>
                    </div>
                    <button onClick={() => downloadSession(s)} style={{
                      fontSize: 8, letterSpacing: "0.15em", cursor: "pointer", padding: "6px 12px",
                      border: "1px solid rgba(200,148,26,0.45)", background: "rgba(200,148,26,0.1)",
                      color: "#c8941a", whiteSpace: "nowrap", flexShrink: 0,
                    }}>⬇ DOWNLOAD</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* forget zone — at the bottom, deliberately hard to hit by accident */}
        {(sessions.length > 0 || memCount > 0) && (
          <div style={{
            marginTop: 28, paddingTop: 16, borderTop: "1px solid rgba(231,76,60,0.2)",
          }}>
            <div style={{ fontSize: 8, letterSpacing: "0.25em", color: "rgba(231,76,60,0.7)", marginBottom: 6 }}>
              ⚠ DANGER ZONE
            </div>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.45)", lineHeight: 1.8, marginBottom: 10 }}>
              Forgetting erases every sealed session and recall memory in this browser. There is no
              server backup and no undo. Download anything you want to keep first.
            </div>
            <button
              onClick={forgetAll}
              style={{
                fontSize: 9, letterSpacing: "0.15em", cursor: "pointer", padding: "8px 16px",
                border: `1px solid ${confirmForget ? "#e74c3c" : "rgba(231,76,60,0.4)"}`,
                background: confirmForget ? "rgba(231,76,60,0.18)" : "transparent",
                color: "#e74c3c", fontWeight: confirmForget ? 700 : 400,
              }}
            >
              {confirmForget
                ? "⚠ SURE? THIS IS PERMANENT — CLICK AGAIN TO FORGET EVERYTHING"
                : "🗑 FORGET ALL SEALED MEMORIES"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
