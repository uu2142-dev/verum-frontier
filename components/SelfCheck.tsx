"use client";

import { useState } from "react";
import { BOOKING_CALENDAR_URL, CONTACT_EMAIL } from "@/lib/site";

const C = {
  amber: "#c8941a",
  green: "#2ecc71",
  red: "#e74c3c",
  blue: "#58a6ff",
  dim: "rgba(255,255,255,0.7)",
  dimmer: "rgba(255,255,255,0.45)",
  faint: "rgba(255,255,255,0.3)",
};

// The Eight Questions from the Agent Record Audit, phrased as a self-check.
export const QUESTIONS = [
  "Can you reconstruct the exact state your system was in when the agent acted — not inferred from a later transcript?",
  "Can you establish what information (sources, context, memory, tools) the agent actually had at that moment?",
  "Can you prove which model and version produced the proposed action — not just an application label?",
  "Can you reconstruct which policy, gate, or rule evaluated that action?",
  "Can you distinguish a proposed action from an authorized one, and an attempted one from an executed one?",
  "Can you establish which credentials and tools the agent could actually reach at that moment?",
  "Can you reconcile the claimed execution against independent upstream or downstream evidence?",
  "Can you prove who authored each field in the record — the model, the provider, the operator, or the harness?",
];

type Ans = "yes" | "partly" | "no";
/** "Q3", "Q3 and Q5", "Q3, Q4, and Q5" */
function listQs(idx: number[]): string {
  const qs = idx.map(i => `Q${i + 1}`);
  if (qs.length <= 1) return qs.join("");
  if (qs.length === 2) return `${qs[0]} and ${qs[1]}`;
  return `${qs.slice(0, -1).join(", ")}, and ${qs[qs.length - 1]}`;
}

const OPTS: { key: Ans; label: string; color: string }[] = [
  { key: "yes", label: "Yes", color: C.green },
  { key: "partly", label: "Partly", color: C.amber },
  { key: "no", label: "No", color: C.red },
];

/** Plain-text result the visitor can forward inside their org. */
function buildResultText(answers: (Ans | null)[]): string {
  const clean = answers.filter(a => a === "yes").length;
  const partial = answers.filter(a => a === "partly").length;
  const gaps = answers.filter(a => a === "no").length;
  const breaks = listQs(answers.map((a, i) => (a === "no" || a === "partly" ? i : -1)).filter(i => i >= 0));
  const lines = [
    "AGENT RECORD SELF-CHECK — www.rabbitholeai.ai",
    `Result: ${clean}/8 reconstructible · ${partial} partial · ${gaps} gap${gaps === 1 ? "" : "s"}`,
    breaks ? `Our chain breaks at ${breaks}.` : "All eight answered reconstructible (pending independent reconciliation).",
    "",
    ...answers.map((a, i) => `${a === "yes" ? "[OK]  " : a === "partly" ? "[~]   " : "[GAP] "}Q${i + 1}. ${QUESTIONS[i]}`),
    "",
    "Answered in-browser at www.rabbitholeai.ai — nothing was uploaded.",
    "The eight questions are the scope of the fixed-fee reconstructability review.",
  ];
  return lines.join("\n");
}

export default function SelfCheck() {
  const [answers, setAnswers] = useState<(Ans | null)[]>(Array(8).fill(null));
  const [copied, setCopied] = useState(false);
  const set = (i: number, v: Ans) => setAnswers(a => a.map((x, j) => (j === i ? v : x)));

  const answered = answers.filter(a => a !== null).length;
  const clean = answers.filter(a => a === "yes").length;
  const partial = answers.filter(a => a === "partly").length;
  const gaps = answers.filter(a => a === "no").length;
  const weakIdx = answers.map((a, i) => (a === "no" || a === "partly" ? i : -1)).filter(i => i >= 0);
  const done = answered === 8;

  let verdict: string;
  let verdictColor = C.dim;
  if (!done) {
    verdict = "Answer all eight to see where your evidentiary chain stands.";
    verdictColor = C.dimmer;
  } else if (gaps === 0 && partial === 0) {
    verdict =
      "All eight reconstructible. If that holds up when reconciled against independent evidence, your records are in strong shape — a review confirms it, or finds the edge you missed.";
    verdictColor = C.green;
  } else {
    verdict = `${clean} clean · ${partial} partial · ${gaps} gap${gaps === 1 ? "" : "s"}. Your chain breaks at ${listQs(weakIdx)} — exactly what a review closes.`;
    verdictColor = gaps > 0 ? C.red : C.amber;
  }

  const resultText = buildResultText(answers);
  const emailHref = `mailto:?subject=${encodeURIComponent("Agent record self-check result")}&body=${encodeURIComponent(resultText)}`;
  const bookHref =
    BOOKING_CALENDAR_URL ||
    `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Reconstructability review — booking")}&body=${encodeURIComponent(
      resultText + "\n\nWe'd like to book the 90-minute review.\n"
    )}`;

  const copyResult = async () => {
    try {
      await navigator.clipboard.writeText(resultText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* clipboard unavailable — the mailto path still works */
    }
  };

  const btn = (border: string, color: string, bg = "transparent") => ({
    fontFamily: "monospace",
    fontSize: 10,
    letterSpacing: "0.1em",
    cursor: "pointer",
    padding: "8px 14px",
    border: `1px solid ${border}`,
    background: bg,
    color,
    textDecoration: "none" as const,
    display: "inline-block",
  });

  return (
    <div id="self-check" style={{ border: `1px solid ${C.amber}33`, background: "rgba(200,148,26,0.03)", padding: "16px 16px 14px", marginTop: 8 }}>
      <div style={{ fontSize: 9, letterSpacing: "0.18em", color: C.amber, marginBottom: 4 }}>THE EIGHT QUESTIONS · SELF-CHECK</div>
      <p style={{ fontSize: 11, color: C.dimmer, lineHeight: 1.7, marginBottom: 16 }}>
        Answer these about your own agent deployment. This runs entirely in your browser —{" "}
        <strong style={{ color: C.dim }}>nothing is uploaded</strong>, and this is a self-assessment, not the audit. The audit
        reconciles your answers against independent evidence.
      </p>

      {QUESTIONS.map((q, i) => {
        const a = answers[i];
        const bad = a === "no" || a === "partly";
        return (
          <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "9px 0", borderTop: i === 0 ? "none" : "1px solid rgba(255,255,255,0.06)" }}>
            <span style={{ color: a ? (bad ? (a === "no" ? C.red : C.amber) : C.green) : C.faint, fontSize: 11, minWidth: 16, flexShrink: 0 }}>{i + 1}.</span>
            <span style={{ fontSize: 12.5, color: C.dim, lineHeight: 1.65, flex: 1 }}>{q}</span>
            <span style={{ display: "flex", gap: 5, flexShrink: 0 }}>
              {OPTS.map(o => {
                const on = a === o.key;
                return (
                  <button
                    key={o.key}
                    onClick={() => set(i, o.key)}
                    aria-pressed={on}
                    style={{
                      fontFamily: "monospace", fontSize: 10, letterSpacing: "0.05em", cursor: "pointer",
                      padding: "3px 9px", border: `1px solid ${on ? o.color : "rgba(255,255,255,0.18)"}`,
                      background: on ? `${o.color}1f` : "transparent",
                      color: on ? o.color : C.dimmer,
                    }}
                  >{o.label}</button>
                );
              })}
            </span>
          </div>
        );
      })}

      <div aria-live="polite" style={{ marginTop: 14, borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: 12 }}>
        <div style={{ fontSize: 12.5, color: verdictColor, lineHeight: 1.7 }}>{verdict}</div>

        {done && weakIdx.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 9, letterSpacing: "0.15em", color: C.dimmer, marginBottom: 6 }}>WHERE YOUR CHAIN LIKELY BREAKS</div>
            {weakIdx.map(i => (
              <div key={i} style={{ display: "flex", gap: 8, fontSize: 11.5, color: C.dimmer, lineHeight: 1.6, marginBottom: 4 }}>
                <span style={{ color: answers[i] === "no" ? C.red : C.amber, flexShrink: 0 }}>{answers[i] === "no" ? "✗" : "~"}</span>
                <span>Q{i + 1} — {QUESTIONS[i]}</span>
              </div>
            ))}
          </div>
        )}

        {done && (
          <div style={{ marginTop: 14, borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 12 }}>
            <div style={{ fontSize: 9, letterSpacing: "0.15em", color: C.dimmer, marginBottom: 8 }}>
              TAKE THE RESULT WITH YOU — it&apos;s how a second person inside your org sees the gap
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={copyResult} style={btn(copied ? C.green : "rgba(255,255,255,0.25)", copied ? C.green : C.dim)}>
                {copied ? "✓ COPIED" : "COPY RESULT"}
              </button>
              <a href={emailHref} style={btn("rgba(255,255,255,0.25)", C.dim)}>EMAIL ME THIS RESULT</a>
              <a href={bookHref} style={btn(C.amber, C.amber, "rgba(200,148,26,0.12)")}>
                BOOK THE $1,500 REVIEW →
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
