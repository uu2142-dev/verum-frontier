"use client";

// /wow — a drop-zone for the ALICE Verum WoW gear planner (test).
// Paste the /alice export string; get a deterministic, cited gear path back.
// Nothing here is a model or a payment — it is the same deterministic planner
// the in-game addon runs, served so testers can try it without the addon.
import Link from "next/link";
import { useState } from "react";

const C = {
  amber: "#c8941a",
  blue: "#58a6ff",
  green: "#2ecc71",
  red: "#e74c3c",
  dim: "rgba(255,255,255,0.7)",
  dimmer: "rgba(255,255,255,0.45)",
};

export default function WowGearDemo() {
  const [exp, setExp] = useState("");
  const [text, setText] = useState<string | null>(null);
  const [charKey, setCharKey] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setErr(null);
    setText(null);
    setCharKey(null);
    try {
      const res = await fetch("/api/wow/gearplan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ export: exp }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error || `Request failed (${res.status}).`);
      } else {
        setText(data.text || "(no plan returned)");
        setCharKey(data.char_key || null);
      }
    } catch {
      setErr("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "40px 20px", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <nav style={{ marginBottom: 22 }}>
        <Link href="/" style={{ fontSize: 11, color: C.dimmer, textDecoration: "none", letterSpacing: "0.04em" }}>← rabbitholeai.ai</Link>
      </nav>

      <div style={{ fontSize: 9, letterSpacing: "0.18em", color: C.amber, marginBottom: 8 }}>ALICE VERUM · WOW GAME PACK · TEST</div>
      <h1 style={{ fontSize: 24, margin: "0 0 12px", color: "#fff" }}>Gear path from your export string</h1>
      <p style={{ color: C.dim, fontSize: 13, lineHeight: 1.85, marginBottom: 8 }}>
        In game, run <code style={{ color: C.amber }}>/alice export</code> and copy the whole string, then paste it below.
        You get the same deterministic, cited plan the in-game panel shows: your next item-level gate, the biggest
        reachable jumps, your weakest slots, your stat priority, and your best trinkets.
      </p>
      <p style={{ color: C.dimmer, fontSize: 12, lineHeight: 1.8, marginBottom: 20 }}>
        No model, no payment, nothing computed in combat. Item level is the signal for the climb; stat scores and
        trinket ranks are a Pawn-style approximation (Bloodmallet / SimulationCraft), not a live sim — sim your own
        gear near best-in-slot. Sources are listed in the plan.
      </p>

      <textarea
        value={exp}
        onChange={(e) => setExp(e.target.value)}
        placeholder="ALICEVERUM1D:..."
        spellCheck={false}
        style={{
          width: "100%", minHeight: 110, resize: "vertical", boxSizing: "border-box",
          background: "rgba(255,255,255,0.04)", color: C.dim, border: "1px solid rgba(255,255,255,0.15)",
          borderRadius: 8, padding: 12, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12,
        }}
      />
      <div style={{ display: "flex", gap: 12, alignItems: "center", margin: "12px 0 24px" }}>
        <button
          onClick={run}
          disabled={busy || !exp.trim()}
          style={{
            padding: "10px 20px", border: `1px solid ${C.amber}`, borderRadius: 6,
            background: busy || !exp.trim() ? "rgba(200,148,26,0.06)" : "rgba(200,148,26,0.16)",
            color: C.amber, fontSize: 13, letterSpacing: "0.04em",
            cursor: busy || !exp.trim() ? "default" : "pointer", opacity: busy || !exp.trim() ? 0.6 : 1,
          }}
        >
          {busy ? "Reading your gear…" : "Get my gear path"}
        </button>
        {charKey && <span style={{ fontSize: 12, color: C.dimmer }}>character: {charKey}</span>}
      </div>

      {err && (
        <div style={{ border: `1px solid ${C.red}`, background: "rgba(231,76,60,0.1)", color: C.red, borderRadius: 8, padding: "12px 14px", fontSize: 13 }}>
          {err}
        </div>
      )}

      {text && (
        <pre style={{
          whiteSpace: "pre-wrap", wordBreak: "break-word", background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: 16,
          color: C.dim, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12, lineHeight: 1.7,
        }}>
          {text}
        </pre>
      )}

      <p style={{ color: C.dimmer, fontSize: 11, lineHeight: 1.7, marginTop: 24 }}>
        Your export string is read to produce this plan and is not stored by this page. The WoW Game Pack is a
        third-party companion; it never automates play and does nothing while you are in combat.
      </p>
    </main>
  );
}
