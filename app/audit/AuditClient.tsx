"use client";

import { useState } from "react";
import Link from "next/link";

const C = {
  amber: "#c8941a",
  blue: "#58a6ff",
  green: "#2ecc71",
  red: "#e74c3c",
  dim: "rgba(255,255,255,0.7)",
  dimmer: "rgba(255,255,255,0.45)",
  faint: "rgba(255,255,255,0.3)",
};

const S = {
  h2: { color: C.amber, letterSpacing: "0.15em", fontSize: 12, textTransform: "uppercase" as const, margin: "34px 0 10px" },
  p: { color: C.dim, fontSize: 13, lineHeight: 1.9, marginBottom: 12 },
};

// The Eight Questions from the Agent Record Audit, phrased as a self-check.
const QUESTIONS = [
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
const OPTS: { key: Ans; label: string; color: string }[] = [
  { key: "yes", label: "Yes", color: C.green },
  { key: "partly", label: "Partly", color: C.amber },
  { key: "no", label: "No", color: C.red },
];

function SelfAssessment() {
  const [answers, setAnswers] = useState<(Ans | null)[]>(Array(8).fill(null));
  const set = (i: number, v: Ans) => setAnswers(a => a.map((x, j) => (j === i ? v : x)));

  const answered = answers.filter(a => a !== null).length;
  const clean = answers.filter(a => a === "yes").length;
  const partial = answers.filter(a => a === "partly").length;
  const gaps = answers.filter(a => a === "no").length;
  const weakIdx = answers.map((a, i) => (a === "no" || a === "partly" ? i : -1)).filter(i => i >= 0);

  let verdict: string;
  let verdictColor = C.dim;
  if (answered < 8) {
    verdict = "Answer all eight to see where your evidentiary chain stands.";
    verdictColor = C.dimmer;
  } else if (gaps === 0 && partial === 0) {
    verdict = "All eight reconstructible. If that holds up when reconciled against independent evidence, your records are in strong shape — a review confirms it, or finds the edge you missed.";
    verdictColor = C.green;
  } else {
    verdict = `${clean} clean · ${partial} partial · ${gaps} gap${gaps === 1 ? "" : "s"}. The partials and gaps below are where the chain likely breaks — exactly what a review closes.`;
    verdictColor = gaps > 0 ? C.red : C.amber;
  }

  return (
    <div style={{ border: `1px solid ${C.amber}33`, background: "rgba(200,148,26,0.03)", padding: "16px 16px 14px", marginTop: 8 }}>
      <div style={{ fontSize: 9, letterSpacing: "0.18em", color: C.amber, marginBottom: 4 }}>THE EIGHT QUESTIONS · SELF-CHECK</div>
      <p style={{ fontSize: 11, color: C.dimmer, lineHeight: 1.7, marginBottom: 16 }}>
        Answer these about your own agent deployment. This runs entirely in your browser — <strong style={{ color: C.dim }}>nothing is uploaded</strong>, and this is a self-assessment, not the audit. The audit reconciles your answers against independent evidence.
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
        {answered === 8 && weakIdx.length > 0 && (
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
      </div>
    </div>
  );
}

const MAILTO = "mailto:jtdawson015@gmail.com?subject=Agent%20Record%20Audit%20%E2%80%94%20scoping";

export default function AuditClient() {
  return (
    <main className="bg-black font-mono" style={{ padding: "48px 24px", height: "100dvh", overflowY: "auto" }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <Link href="/" style={{ fontSize: 9, letterSpacing: "0.25em", color: C.dimmer }}>← VERUM FRONTIER</Link>

        <h1 style={{ color: "#fff", fontSize: 20, letterSpacing: "0.16em", margin: "18px 0 4px", textTransform: "uppercase" }}>
          Agent Record Audit
        </h1>
        <p style={{ fontSize: 9, color: C.faint, letterSpacing: "0.12em", marginBottom: 22 }}>
          FORENSIC RECORD &amp; PROVENANCE VERIFICATION FOR AUTONOMOUS SYSTEMS
        </p>

        <p style={{ ...S.p, fontSize: 15, color: "rgba(255,255,255,0.85)", lineHeight: 1.85 }}>
          If one of your AI agents took an action tomorrow that harmed a third party, could you prove what it did,
          under whose authority, what information it had, which model produced it, what actually executed —
          and that the record was not altered afterward?
        </p>
        <p style={S.p}>
          Most organizations find out the answer during the incident. That is the wrong time to find out. This is a
          fixed-scope review of one thing: whether your autonomous system produces records that can reconstruct a
          consequential event under scrutiny — from an insurer, a regulator, opposing counsel, your board, or your
          own incident-response team.
        </p>

        <h2 style={S.h2}>Start here — check your own records</h2>
        <p style={S.p}>
          Before any engagement, run the self-check. It is the same eight questions every audit answers, and it will
          show you where your evidentiary chain likely breaks — for free, and without sending us anything.
        </p>
        <SelfAssessment />

        <h2 style={S.h2}>What it is — and is not</h2>
        <p style={S.p}>
          The method is reconciliation: we take what your system <em>claims</em> happened and reconcile it against
          what independently verifiable sources say happened — provider billing, upstream and downstream logs,
          execution records, cryptographic recomputation. The goal is to find where the chain of events cannot be
          independently reconstructed.
        </p>
        <p style={S.p}>
          It is <strong style={{ color: "#fff" }}>not</strong> a penetration test, not a model evaluation, and not a
          certificate that your system is &ldquo;safe.&rdquo; It does not manufacture a defense. It tells you what your
          system can actually prove — and where it cannot.
        </p>

        <h2 style={S.h2}>Scope options</h2>
        {[
          { t: "Baseline Review", d: "One agent system, one environment. The Eight Questions assessment, a findings report, an evidentiary assessment, a remediation sequence, and a reproduction method your own team can re-run." },
          { t: "Extended Review", d: "Multiple systems or environments, with deeper reconciliation against provider billing, upstream logs, and execution records where access is available." },
          { t: "Retained Review", d: "Periodic re-verification for deployments that change frequently, or organizations under ongoing operational, regulatory, insurance, or counterparty scrutiny." },
        ].map(x => (
          <div key={x.t} style={{ border: "1px solid rgba(255,255,255,0.12)", padding: "12px 14px", marginBottom: 8 }}>
            <div style={{ color: C.amber, fontSize: 12, letterSpacing: "0.08em", marginBottom: 5 }}>{x.t}</div>
            <div style={{ fontSize: 12.5, color: C.dim, lineHeight: 1.75 }}>{x.d}</div>
          </div>
        ))}
        <p style={{ ...S.p, fontSize: 12, color: C.dimmer }}>
          Scope and pricing are established after an initial scoping conversation. No engagement begins before scope is
          agreed in writing. Every finding ships with the method used to reach it, so your own team can reproduce the
          test after remediation — the method transfers; you don&apos;t stay dependent on us.
        </p>

        <h2 style={S.h2}>What we will not claim</h2>
        <p style={S.p}>
          This is not a legal opinion — your counsel determines the legal significance of any finding. No architecture
          creates a safe harbor; a tamper-evident record does not make unauthorized conduct lawful. We do not certify
          claims we cannot substantiate, and our bias-screening research measures toxicity and framing signals — it is
          not a protected-class discrimination test and will not be represented as one.
        </p>

        <h2 style={S.h2}>To start</h2>
        <p style={S.p}>
          Bring one agent deployment and whoever owns its logs. We examine the Eight Questions. If your system already
          has good answers, we&apos;ll tell you. If it doesn&apos;t, we&apos;ll show you where the evidentiary chain
          breaks and what it would take to close the gap.
        </p>
        <a
          href={MAILTO}
          style={{
            display: "inline-block", marginTop: 6, fontFamily: "monospace", fontSize: 12, letterSpacing: "0.1em",
            padding: "10px 20px", border: `1px solid ${C.amber}`, background: "rgba(200,148,26,0.12)", color: C.amber,
            textDecoration: "none",
          }}
        >REQUEST A SCOPING CONVERSATION →</a>

        <p style={{ fontSize: 11, color: C.faint, lineHeight: 1.8, margin: "26px 0 0", borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: 14 }}>
          The verification behind this is a running artifact, not a promise: recompute a sealed session yourself at{" "}
          <Link href="/verify" style={{ color: C.blue, textDecoration: "underline" }}>rabbitholeai.ai/verify</Link>, and
          the reference implementation is MIT-licensed at{" "}
          <a href="https://github.com/uu2142-dev/alice-evidence" target="_blank" rel="noopener noreferrer" style={{ color: C.amber, textDecoration: "underline" }}>github.com/uu2142-dev/alice-evidence</a>.
          Rabbit Hole AI · Jeremiah Dawson · <a href="mailto:jtdawson015@gmail.com" style={{ color: C.amber }}>jtdawson015@gmail.com</a>
        </p>
      </div>
    </main>
  );
}
