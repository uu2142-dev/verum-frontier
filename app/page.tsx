import Link from "next/link";
import SelfCheck from "@/components/SelfCheck";
import { BOOKING_URL, CONTACT_EMAIL, GITHUB_URL } from "@/lib/site";

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

const NAV = [
  { href: "#review", label: "Reconstructability review" },
  { href: "#self-check", label: "Self-check" },
  { href: "/sample-report", label: "Sample report" },
  { href: "/gate", label: "Live lab" },
  { href: "/verify", label: "Verify a file" },
  { href: GITHUB_URL, label: "GitHub", external: true },
];

/** The synthetic incident — every value below is invented for illustration. */
function IncidentCard() {
  const row = (k: string, v: string, color = C.dim) => (
    <div style={{ display: "flex", gap: 10, fontSize: 11.5, lineHeight: 1.8 }}>
      <span style={{ color: C.faint, minWidth: 118, flexShrink: 0 }}>{k}</span>
      <span style={{ color, wordBreak: "break-all" }}>{v}</span>
    </div>
  );
  return (
    <div style={{ border: "1px solid rgba(255,255,255,0.14)", marginTop: 14 }}>
      <div style={{ padding: "8px 14px", borderBottom: "1px solid rgba(255,255,255,0.1)", display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 9, letterSpacing: "0.18em", color: C.amber }}>ONE RECONSTRUCTED INCIDENT</span>
        <span style={{ fontSize: 9, letterSpacing: "0.14em", color: C.faint }}>SYNTHETIC EXAMPLE — INVENTED FOR ILLUSTRATION, NOT A CLIENT RECORD</span>
      </div>
      <div style={{ padding: "12px 14px", fontSize: 12.5, color: C.dim, lineHeight: 1.85 }}>
        A camera-analytics model flags a person on a perimeter feed at 02:14 and security dispatches a responder.
        The next morning, someone has to answer for it.
        <div style={{ marginTop: 10 }}>
          <span style={{ color: C.green }}>What most operators can prove today:</span> a dashboard screenshot.
        </div>
        <div>
          <span style={{ color: C.red }}>What they cannot prove:</span> which model version scored the frame, which frames
          it actually used, what the alert threshold was that night, and who approved the dispatch.
        </div>
      </div>
      <div style={{ padding: "12px 14px", borderTop: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.02)" }}>
        <div style={{ fontSize: 9, letterSpacing: "0.16em", color: C.dimmer, marginBottom: 8 }}>
          AFTER A SEALED RECORD, THOSE FOUR FIELDS EXIST — HASHED, DOWNLOADABLE, RECOMPUTABLE:
        </div>
        {row("MODEL", "percept-cam v3.2.1 (build 8841, weights sha256 ce41…a90f)")}
        {row("FRAMES", "cam-07 02:14:02–02:14:09 · 43 frames · sha256 7b2d…4c11")}
        {row("THRESHOLD", "person-confidence ≥ 0.83 (night profile, set 2026-03-02 by ops-lead)")}
        {row("AUTHORIZATION", "dispatch approved: badge S-114 at 02:15:37 · sealed leaf 9f0e…22ba", C.amber)}
        <div style={{ marginTop: 8, fontSize: 10.5, color: C.faint, lineHeight: 1.7 }}>
          Every field above is a Merkle leaf under one signed root — alter any one afterward and recomputation fails.
          The mechanism is real and running: <Link href="/gate" style={{ color: C.blue, textDecoration: "underline" }}>see it live</Link>{" "}
          or <Link href="/verify" style={{ color: C.blue, textDecoration: "underline" }}>verify a sealed file yourself</Link>.
          This incident, again, is synthetic.
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <main className="bg-black font-mono" style={{ padding: "0 24px 48px", height: "100dvh", overflowY: "auto" }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>

        {/* ── NAV ── */}
        <nav aria-label="Site" style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", padding: "18px 0", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/rhai-logo.png" alt="" className="w-5 h-5 rounded-sm" />
          <span style={{ fontSize: 10, letterSpacing: "0.25em", color: "#fff", textTransform: "uppercase", fontWeight: 700 }}>Rabbit Hole AI</span>
          <span style={{ flex: 1 }} />
          {NAV.map(n =>
            n.external ? (
              <a key={n.label} href={n.href} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: C.dimmer, textDecoration: "none", letterSpacing: "0.04em" }}>{n.label}</a>
            ) : (
              <Link key={n.label} href={n.href} style={{ fontSize: 10, color: C.dimmer, textDecoration: "none", letterSpacing: "0.04em" }}>{n.label}</Link>
            )
          )}
        </nav>

        {/* ── HERO ── */}
        <section id="review" style={{ paddingTop: 40 }}>
          <p style={{ fontSize: 9, color: C.faint, letterSpacing: "0.12em", marginBottom: 14 }}>
            AGENT RECORD AUDIT · FORENSIC RECORD &amp; PROVENANCE VERIFICATION FOR AUTONOMOUS SYSTEMS
          </p>
          <h1 style={{ color: "#fff", fontSize: 24, lineHeight: 1.5, fontWeight: 700, margin: "0 0 14px", letterSpacing: "0.01em" }}>
            If one of your AI agents harmed a third party tomorrow, could you prove what it did — and that the record
            wasn&apos;t altered afterward?
          </h1>
          <p style={{ ...S.p, fontSize: 14, color: "rgba(255,255,255,0.85)" }}>
            Under whose authority it acted, what information it had, which model produced the action, what actually
            executed. Most organizations find out the answer during the incident. That is the wrong time to find out.
          </p>

          {/* CTA row */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", margin: "22px 0 8px" }}>
            <a
              href={BOOKING_URL}
              style={{
                fontFamily: "monospace", fontSize: 12, letterSpacing: "0.08em", padding: "12px 20px",
                border: `1px solid ${C.amber}`, background: "rgba(200,148,26,0.14)", color: C.amber, textDecoration: "none",
              }}
            >BOOK A 90-MINUTE RECONSTRUCTABILITY REVIEW — $1,500 →</a>
            <a
              href="#self-check"
              style={{
                fontFamily: "monospace", fontSize: 11, letterSpacing: "0.08em", padding: "12px 16px",
                border: "1px solid rgba(255,255,255,0.25)", color: C.dim, textDecoration: "none",
              }}
            >RUN THE 8-QUESTION SELF-CHECK</a>
          </div>
          <div style={{ fontSize: 10.5, color: C.faint, lineHeight: 1.8 }}>
            The self-check runs in your browser — nothing leaves it. Small door:{" "}
            <Link href="/gate" style={{ color: C.dimmer, textDecoration: "underline" }}>open the live gate</Link>, the running
            instrument behind all of this.
          </div>

          {/* What $1,500 buys — honest unit */}
          <div style={{ border: "1px solid rgba(255,255,255,0.12)", padding: "12px 14px", marginTop: 20 }}>
            <div style={{ fontSize: 9, letterSpacing: "0.16em", color: C.dimmer, marginBottom: 6 }}>WHAT $1,500 BUYS — EXACTLY</div>
            <div style={{ fontSize: 12.5, color: C.dim, lineHeight: 1.8 }}>
              A 90-minute structured session against the Eight Questions with whoever owns your agent&apos;s logs, plus a
              2–3 page written findings memo you can forward internally. It is <strong style={{ color: "#fff" }}>not</strong>{" "}
              the full Baseline Review — the findings report, remediation sequence, and reproduction method are scoped and
              quoted after the session, in writing, before anything begins.
            </div>
          </div>
        </section>

        {/* ── THE INCIDENT ── */}
        <section>
          <h2 style={S.h2}>What a reconstructable record looks like</h2>
          <IncidentCard />
          <p style={{ ...S.p, fontSize: 12, color: C.dimmer, marginTop: 12 }}>
            The findings memo you receive follows the same discipline —{" "}
            <Link href="/sample-report" style={{ color: C.blue, textDecoration: "underline" }}>read a full sample report</Link>{" "}
            built from this synthetic incident, or{" "}
            <a href="/sample-report.pdf" download="RHAI-sample-findings-memo.pdf" style={{ color: C.blue, textDecoration: "underline" }}>download it as a PDF</a>.
          </p>
        </section>

        {/* ── SELF-CHECK ── */}
        <section>
          <h2 style={S.h2}>Start here — check your own records</h2>
          <p style={S.p}>
            Before any engagement, run the self-check. It is the same eight questions every audit answers, and it will
            show you where your evidentiary chain likely breaks — for free, and without sending us anything.
          </p>
          <SelfCheck />
        </section>

        {/* ── METHOD ── */}
        <section>
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

          <h2 style={S.h2}>What we will not claim</h2>
          <p style={S.p}>
            This is not a legal opinion — your counsel determines the legal significance of any finding. No architecture
            creates a safe harbor; a tamper-evident record does not make unauthorized conduct lawful. We do not certify
            claims we cannot substantiate, and our bias-screening research measures toxicity and framing signals — it is
            not a protected-class discrimination test and will not be represented as one.
          </p>
        </section>

        {/* ── SCOPE ── */}
        <section>
          <h2 style={S.h2}>Beyond the first session</h2>
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
            Scope and pricing for these are established after the initial session. No engagement begins before scope is
            agreed in writing. Every finding ships with the method used to reach it, so your own team can reproduce the
            test after remediation — the method transfers; you don&apos;t stay dependent on us.
          </p>
        </section>

        {/* ── TO START ── */}
        <section>
          <h2 style={S.h2}>To start</h2>
          <p style={S.p}>
            Bring one agent deployment and whoever owns its logs. We examine the Eight Questions. If your system already
            has good answers, we&apos;ll tell you. If it doesn&apos;t, we&apos;ll show you where the evidentiary chain
            breaks and what it would take to close the gap.
          </p>
          <a
            href={BOOKING_URL}
            style={{
              display: "inline-block", marginTop: 6, fontFamily: "monospace", fontSize: 12, letterSpacing: "0.1em",
              padding: "10px 20px", border: `1px solid ${C.amber}`, background: "rgba(200,148,26,0.12)", color: C.amber,
              textDecoration: "none",
            }}
          >BOOK THE 90-MINUTE REVIEW →</a>
        </section>

        {/* ── FOUNDER / TRUST BLOCK ── */}
        <footer style={{ margin: "34px 0 0", borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: 16 }}>
          <p style={{ fontSize: 12, color: C.dim, lineHeight: 1.85, marginBottom: 10 }}>
            Built by a former law-enforcement lieutenant after watching systems produce outputs nobody could reconstruct.
            Not a safety certificate. A record you can recompute.
          </p>
          <p style={{ fontSize: 11, color: C.faint, lineHeight: 1.8 }}>
            The verification behind this is a running artifact, not a promise: recompute a sealed session yourself at{" "}
            <Link href="/verify" style={{ color: C.blue, textDecoration: "underline" }}>rabbitholeai.ai/verify</Link>, and the
            reference implementation is MIT-licensed at{" "}
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" style={{ color: C.amber, textDecoration: "underline" }}>github.com/uu2142-dev/alice-evidence</a>.
            <br />
            Rabbit Hole AI · Jeremiah Dawson · <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: C.amber }}>{CONTACT_EMAIL}</a>
            {" · "}
            <Link href="/terms" style={{ color: C.dimmer, textDecoration: "underline" }}>Terms</Link>
            {" · "}
            <Link href="/privacy" style={{ color: C.dimmer, textDecoration: "underline" }}>Privacy</Link>
          </p>
        </footer>
      </div>
    </main>
  );
}
