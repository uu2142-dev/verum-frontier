'use client';
// ── MODELS — the browsable catalogue ─────────────────────────────────────
// The chip row was fine at four models; at ten it is clutter. This tab is the
// honest version of a pricing page: every model the gate can actually call,
// what it costs YOU at cost-plus, whether it retrieves first-hand, and which
// tier it belongs to. Nothing here is aspirational — the boot endpoint only
// lists models whose provider key is configured, so if you can see it, it runs.

import { useEffect, useState } from "react";

const MODEL_KEY = "vf_model_v1"; // shared with LiveGate

interface ModelInfo {
  id: string; name: string; family: string; color: string;
  inPerM: number; outPerM: number; note: string;
  tier?: string; selfGrounds?: boolean;
}

// A representative answer, so the per-million rates mean something. Deliberately
// labelled an ESTIMATE — the real number is always the receipt on the answer.
const EX_IN = 1000, EX_OUT = 700;
function exampleCost(m: ModelInfo): number {
  const direct = (EX_IN / 1e6) * m.inPerM + (EX_OUT / 1e6) * m.outPerM;
  return direct * 1.20; // +5% infra +15% support
}

export default function ModelCards({ onPick }: { onPick?: () => void }) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [picked, setPicked] = useState<string>("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    try { setPicked(localStorage.getItem(MODEL_KEY) ?? ""); } catch { /* ignore */ }
    fetch("/api/chat")
      .then(r => r.json())
      .then(d => setModels(d.models ?? []))
      .catch(() => setFailed(true));
  }, []);

  const choose = (id: string) => {
    try { localStorage.setItem(MODEL_KEY, id); } catch { /* ignore */ }
    setPicked(id);
    onPick?.();
  };

  const free = models.filter(m => m.tier !== "premium");
  const premium = models.filter(m => m.tier === "premium");

  const card = (m: ModelInfo) => {
    const isPremium = m.tier === "premium";
    const on = picked === m.id;
    return (
      <button
        key={m.id}
        onClick={() => choose(m.id)}
        style={{
          textAlign: "left", cursor: "pointer", padding: "12px 14px",
          background: on ? `${m.color}14` : "rgba(4,3,10,0.72)",
          border: `1px solid ${on ? m.color : "rgba(255,255,255,0.1)"}`,
          fontFamily: "monospace", display: "block", width: "100%",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
          <span style={{ fontSize: 11, color: m.color, letterSpacing: "0.06em" }}>
            {isPremium ? "💳 " : ""}{m.name}
          </span>
          <span style={{ fontSize: 8, color: "rgba(255,255,255,0.35)" }}>{m.family}</span>
        </div>

        <div style={{ fontSize: 8, color: "rgba(255,255,255,0.4)", marginTop: 6, lineHeight: 1.7 }}>
          ${m.inPerM.toFixed(2)} in / ${m.outPerM.toFixed(2)} out per 1M tokens
        </div>
        <div style={{ fontSize: 8, color: "#c8941a", marginTop: 2 }}>
          ≈ ${exampleCost(m).toFixed(4)} for a typical answer <span style={{ opacity: 0.6 }}>(estimate — the receipt is the truth)</span>
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
          <span style={{
            fontSize: 7, letterSpacing: "0.12em", padding: "2px 6px",
            border: `1px solid ${isPremium ? "rgba(200,148,26,0.45)" : "rgba(46,204,113,0.4)"}`,
            color: isPremium ? "#c8941a" : "#2ecc71",
          }}>{isPremium ? "CREDITS ONLY" : "FREE TIER"}</span>
          <span style={{
            fontSize: 7, letterSpacing: "0.12em", padding: "2px 6px",
            border: `1px solid ${m.selfGrounds ? "rgba(88,166,255,0.45)" : "rgba(255,255,255,0.12)"}`,
            color: m.selfGrounds ? "#58a6ff" : "rgba(255,255,255,0.3)",
          }}>
            {m.selfGrounds ? "🔎 SEARCHES FIRST-HAND" : "🔎 RELAYS TO GEMINI"}
          </span>
        </div>

        <div style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", marginTop: 8, lineHeight: 1.6 }}>
          {m.note}
        </div>
        {on && (
          <div style={{ fontSize: 7, letterSpacing: "0.2em", color: m.color, marginTop: 8 }}>
            ✓ SELECTED
          </div>
        )}
      </button>
    );
  };

  return (
    <div className="relative z-30 w-full overflow-y-auto" style={{ height: "calc(100dvh - 120px)" }}>
      <div className="mx-auto w-full max-w-4xl px-4 md:px-8 pt-4 pb-16" style={{ fontFamily: "monospace" }}>

        <h2 style={{ fontSize: 8, letterSpacing: "0.3em", color: "#8ab4f8", margin: 0, fontWeight: "inherit" }}>
          ⚙ MODELS · WHAT THE GATE CAN ACTUALLY CALL
        </h2>
        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.45)", marginTop: 6, lineHeight: 1.8, marginBottom: 14 }}>
          Only models with a configured provider key are listed — if you can see it here, it runs.
          Rates are the providers&apos; own published prices; your cost adds 5% infrastructure and
          15% project support, itemised on every answer. Pick one and it becomes your model in the
          Live Gate.
        </div>

        {failed && (
          <div style={{ fontSize: 9, color: "#e74c3c", border: "1px solid rgba(231,76,60,0.35)", padding: "10px 12px" }}>
            Could not reach the gate to list models. The Live Gate tab will show the same error detail.
          </div>
        )}

        {premium.length > 0 && (
          <>
            <div style={{ fontSize: 8, letterSpacing: "0.25em", color: "#c8941a", margin: "16px 0 8px" }}>
              PREMIUM · CREDITS ONLY
            </div>
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))" }}>
              {premium.map(card)}
            </div>
          </>
        )}

        <div style={{ fontSize: 8, letterSpacing: "0.25em", color: "#2ecc71", margin: "22px 0 8px" }}>
          FREE COUNCIL · NO CREDITS NEEDED
        </div>
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))" }}>
          {free.map(card)}
        </div>

        <div style={{
          fontSize: 8, color: "rgba(255,255,255,0.35)", lineHeight: 1.8, marginTop: 20,
          border: "1px solid rgba(88,166,255,0.2)", background: "rgba(88,166,255,0.04)", padding: "10px 12px",
        }}>
          <strong style={{ color: "#58a6ff" }}>On retrieval:</strong> models marked SEARCHES FIRST-HAND
          run their own web search and cite what they read, so GROUND IT adds to them rather than
          replacing them. The rest have no native search, so GROUND IT hands the question to Gemini
          instead — that substitution is announced before you send and recorded in the sealed download.
        </div>
      </div>
    </div>
  );
}
