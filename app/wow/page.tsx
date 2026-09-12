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

  const [fb, setFb] = useState("");
  const [fbHandle, setFbHandle] = useState("");
  const [fbMsg, setFbMsg] = useState<string | null>(null);
  const [fbBusy, setFbBusy] = useState(false);

  async function sendFeedback() {
    setFbBusy(true);
    setFbMsg(null);
    try {
      const res = await fetch("/api/wow/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: fb, handle: fbHandle }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFbMsg(data.error || `Couldn't send (${res.status}).`);
      } else {
        setFbMsg(data.message || "Thanks — logged.");
        setFb("");
      }
    } catch {
      setFbMsg("Network error — try again.");
    } finally {
      setFbBusy(false);
    }
  }

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
    // body is overflow:hidden app-wide (globals.css), so this page must own its scroll
    <main style={{ height: "100dvh", overflowY: "auto", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
     <div style={{ maxWidth: 860, margin: "0 auto", padding: "40px 20px" }}>
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

      <section style={{ marginTop: 40, borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: 24 }}>
        <div style={{ fontSize: 9, letterSpacing: "0.18em", color: C.amber, marginBottom: 8 }}>SUGGESTIONS</div>
        <h2 style={{ fontSize: 18, margin: "0 0 8px", color: "#fff" }}>Tell us what to build or fix</h2>
        <p style={{ color: C.dimmer, fontSize: 12, lineHeight: 1.8, marginBottom: 14 }}>
          What&apos;s missing, wrong, or confusing? Every suggestion is screened (toxicity + prompt-injection),
          sealed to a tamper-evident log, and reviewed by ALICE and the council in batches. Optional handle
          so we can credit or follow up.
        </p>
        <textarea
          value={fb}
          onChange={(e) => setFb(e.target.value)}
          placeholder="e.g. add a dark-mode toggle; the Frost flask looks wrong; show me the route map…"
          maxLength={4000}
          style={{
            width: "100%", minHeight: 90, resize: "vertical", boxSizing: "border-box",
            background: "rgba(255,255,255,0.04)", color: C.dim, border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: 8, padding: 12, fontFamily: "ui-sans-serif, system-ui, sans-serif", fontSize: 13,
          }}
        />
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
          <input
            value={fbHandle}
            onChange={(e) => setFbHandle(e.target.value)}
            placeholder="handle (optional)"
            maxLength={40}
            style={{
              background: "rgba(255,255,255,0.04)", color: C.dim, border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 6, padding: "8px 10px", fontSize: 12, width: 180,
            }}
          />
          <button
            onClick={sendFeedback}
            disabled={fbBusy || fb.trim().length < 6}
            style={{
              padding: "9px 18px", border: `1px solid ${C.amber}`, borderRadius: 6,
              background: fbBusy || fb.trim().length < 6 ? "rgba(200,148,26,0.06)" : "rgba(200,148,26,0.16)",
              color: C.amber, fontSize: 13, cursor: fbBusy || fb.trim().length < 6 ? "default" : "pointer",
              opacity: fbBusy || fb.trim().length < 6 ? 0.6 : 1,
            }}
          >
            {fbBusy ? "Sending…" : "Send suggestion"}
          </button>
          {fbMsg && <span style={{ fontSize: 12, color: C.green }}>{fbMsg}</span>}
        </div>
      </section>

      <p style={{ color: C.dimmer, fontSize: 11, lineHeight: 1.7, marginTop: 24 }}>
        Your export string is read to produce this plan and is not stored by this page. The WoW Game Pack is a
        third-party companion; it never automates play and does nothing while you are in combat.
      </p>
      </div>
    </main>
  );
}
