"use client";

import Link from "next/link";
import { BOOKING_URL, CONTACT_EMAIL } from "@/lib/site";

/*
 * SAMPLE FINDINGS MEMO — every organization, system, person, timestamp, and
 * hash in this document is INVENTED. Nothing here derives from any client,
 * employer, or real deployment. The memo exists so a buyer can see the exact
 * shape of the deliverable before booking.
 *
 * On screen it keeps the site's dark terminal look; @media print flips it to
 * a clean black-on-white document, so "Print / Save as PDF" produces the
 * artifact you can attach to outreach email.
 */

const C = {
  amber: "#c8941a",
  blue: "#58a6ff",
  green: "#2ecc71",
  red: "#e74c3c",
  dim: "rgba(255,255,255,0.7)",
  dimmer: "rgba(255,255,255,0.45)",
  faint: "rgba(255,255,255,0.3)",
};

type Verdict = "OK" | "PARTIAL" | "GAP";
const VERDICT_COLOR: Record<Verdict, string> = { OK: C.green, PARTIAL: C.amber, GAP: C.red };

const EIGHT: { q: string; verdict: Verdict; note: string }[] = [
  { q: "Exact system state at the moment the agent acted", verdict: "PARTIAL", note: "Config recoverable from IaC history, but the night-profile threshold override lived only in a dashboard setting with no change record." },
  { q: "Information the agent actually had", verdict: "GAP", note: "Frame buffer is overwritten after 72 hours; the frames behind the 02:14 alert no longer exist. Only the annotated thumbnail survives." },
  { q: "Which model and version produced the action", verdict: "GAP", note: "Logs record the product name, not the model build. Vendor confirmed three model versions were live-swapped that quarter; which one scored the frame is unrecoverable." },
  { q: "Which policy or gate evaluated the action", verdict: "PARTIAL", note: "Alert-routing rules exist in the vendor console, but rule-version history is retained for 30 days and the incident predates the window." },
  { q: "Proposed vs authorized vs executed", verdict: "PARTIAL", note: "Dispatch SMS proves an action executed; nothing distinguishes operator approval from auto-dispatch — the approval UI writes no record." },
  { q: "Credentials and tools reachable at that moment", verdict: "OK", note: "Badge-system export and firewall logs establish reachable surface; reconciled cleanly." },
  { q: "Claimed execution vs independent evidence", verdict: "OK", note: "Guard patrol GPS log and gate-controller log corroborate the responder's movement; timestamps reconcile within 40 s." },
  { q: "Who authored each field of the record", verdict: "GAP", note: "The incident PDF exported for the insurer mixes model output, vendor-console templating, and operator edits with no authorship boundary. Nobody can say which sentences a human wrote." },
];

export default function SampleReportClient() {
  return (
    <main className="report-root bg-black font-mono" style={{ padding: "0 24px 48px", minHeight: "100dvh" }}>
      <style>{`
        .report-root { color: rgba(255,255,255,0.7); }
        @media print {
          .report-root { background: #fff !important; color: #1a1a1a !important; padding: 0 !important; }
          .report-root * { color: #1a1a1a !important; border-color: #999 !important; background: transparent !important; }
          .report-root .print-accent { color: #7a5a10 !important; }
          .report-root .no-print { display: none !important; }
          .report-root a { text-decoration: none !important; }
        }
      `}</style>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>

        <nav className="no-print" style={{ display: "flex", gap: 14, alignItems: "center", padding: "18px 0", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <Link href="/" style={{ fontSize: 10, letterSpacing: "0.2em", color: C.dimmer, textDecoration: "none" }}>← RABBIT HOLE AI</Link>
          <span style={{ flex: 1 }} />
          <button
            onClick={() => window.print()}
            style={{ fontFamily: "monospace", fontSize: 10, letterSpacing: "0.1em", cursor: "pointer", padding: "7px 14px", border: `1px solid ${C.amber}`, background: "rgba(200,148,26,0.12)", color: C.amber }}
          >PRINT / SAVE AS PDF</button>
        </nav>

        {/* ── Synthetic banner ── */}
        <div style={{ border: `1px solid ${C.amber}`, padding: "10px 14px", margin: "22px 0", fontSize: 11, lineHeight: 1.8 }}>
          <span className="print-accent" style={{ color: C.amber, letterSpacing: "0.15em" }}>SAMPLE — FULLY SYNTHETIC.</span>{" "}
          Every organization, system, person, timestamp, and hash in this memo is invented so you can see the exact shape
          of the deliverable. No client or employer data appears here, sanitized or otherwise.
        </div>

        {/* ── Memo header ── */}
        <header style={{ borderBottom: "1px solid rgba(255,255,255,0.15)", paddingBottom: 14 }}>
          <div className="print-accent" style={{ fontSize: 9, letterSpacing: "0.2em", color: C.amber }}>RABBIT HOLE AI · AGENT RECORD AUDIT</div>
          <h1 style={{ fontSize: 19, color: "#fff", margin: "8px 0 4px", letterSpacing: "0.03em" }}>Findings Memo — 90-Minute Reconstructability Review</h1>
          <div style={{ fontSize: 11, color: C.dimmer, lineHeight: 1.9 }}>
            Client: Northgate Logistics Co. (fictional) · System: perimeter camera analytics + dispatch agent<br />
            Session date: 2026-08-12 · Attendees: security director, SOC lead, IT ops owner · Prepared by: Jeremiah Dawson, Rabbit Hole AI
          </div>
        </header>

        {/* ── Summary ── */}
        <section style={{ marginTop: 22 }}>
          <h2 className="print-accent" style={{ fontSize: 12, letterSpacing: "0.15em", color: C.amber, textTransform: "uppercase", marginBottom: 8 }}>Summary</h2>
          <p style={{ fontSize: 12.5, lineHeight: 1.9 }}>
            We walked one real incident — a person-detection alert at 02:14 on 2026-07-30 that dispatched a responder —
            through the Eight Questions. <strong style={{ color: "#fff" }}>Result: 2 reconstructible, 3 partial, 3 gaps.</strong>{" "}
            If this incident were challenged today by an insurer or opposing counsel, Northgate could prove a responder
            was dispatched and where they went, but could not prove which model version raised the alert, what frames it
            saw, or which sentences of the incident report a human actually wrote. None of the gaps require new
            products to close; all three are retention and boundary-recording changes.
          </p>
        </section>

        {/* ── Eight questions table ── */}
        <section style={{ marginTop: 22 }}>
          <h2 className="print-accent" style={{ fontSize: 12, letterSpacing: "0.15em", color: C.amber, textTransform: "uppercase", marginBottom: 8 }}>The Eight Questions — verdicts</h2>
          {EIGHT.map((row, i) => (
            <div key={i} style={{ display: "flex", gap: 10, padding: "8px 0", borderTop: i === 0 ? "none" : "1px solid rgba(255,255,255,0.08)", fontSize: 12, lineHeight: 1.7 }}>
              <span style={{ minWidth: 20, flexShrink: 0, color: C.faint }}>{i + 1}.</span>
              <span style={{ flex: 1 }}>
                <span style={{ color: "#fff" }}>{row.q}.</span>{" "}
                <span style={{ color: C.dimmer }}>{row.note}</span>
              </span>
              <span style={{ flexShrink: 0, fontSize: 10, letterSpacing: "0.1em", color: VERDICT_COLOR[row.verdict], alignSelf: "flex-start", paddingTop: 2 }}>{row.verdict}</span>
            </div>
          ))}
        </section>

        {/* ── Key findings ── */}
        <section style={{ marginTop: 22 }}>
          <h2 className="print-accent" style={{ fontSize: 12, letterSpacing: "0.15em", color: C.amber, textTransform: "uppercase", marginBottom: 8 }}>Findings that matter most</h2>
          {[
            {
              t: "F-1 · The evidence your defense depends on is deleted on a 72-hour timer (Q2)",
              d: "The frames behind any alert are overwritten after 72 hours — faster than most claims, complaints, or subpoenas arrive. The record that would exonerate a correct dispatch is destroyed by default. Method: we reconciled the vendor's retention setting against the storage appliance's own overwrite log; both confirm 72h.",
            },
            {
              t: "F-2 · Model version is unknowable, and the vendor live-swaps models (Q3)",
              d: "Northgate's logs record “PerceptCam” — a product label, not a model. The vendor confirmed in writing that three model versions served traffic last quarter with no tenant-visible changelog. Any claim about why the system alerted is therefore an untestable guess. Method: log-schema review plus a vendor attestation request (template provided).",
            },
            {
              t: "F-3 · Human and machine authorship are indistinguishable in the official record (Q8)",
              d: "The incident PDF sent to the insurer interleaves model narrative, console boilerplate, and operator edits with no boundary. If any sentence is wrong, nobody can establish who authored it — which converts a tooling defect into a personal credibility problem for the operator who signed it. Method: field-by-field provenance walk of one exported report against console templates.",
            },
          ].map(f => (
            <div key={f.t} style={{ border: "1px solid rgba(255,255,255,0.12)", padding: "10px 14px", marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: "#fff", marginBottom: 5, lineHeight: 1.6 }}>{f.t}</div>
              <div style={{ fontSize: 12, color: C.dimmer, lineHeight: 1.8 }}>{f.d}</div>
            </div>
          ))}
        </section>

        {/* ── Recommended sequence ── */}
        <section style={{ marginTop: 22 }}>
          <h2 className="print-accent" style={{ fontSize: 12, letterSpacing: "0.15em", color: C.amber, textTransform: "uppercase", marginBottom: 8 }}>Recommended sequence</h2>
          <ol style={{ fontSize: 12.5, lineHeight: 2, paddingLeft: 20, color: C.dim }}>
            <li>Extend alert-frame retention from 72 hours to 13 months (matches the general-liability claim window). Storage delta is small: alert frames only, not continuous footage.</li>
            <li>Request the vendor's model-version field in the alert webhook — it exists in their API (confirmed in their docs) and is a support-ticket change, not a contract change.</li>
            <li>Record the approval: one timestamped row (who, when, alert id) written when a dispatch is approved. This is the cheapest fix on the list and closes the proposed/authorized boundary.</li>
            <li>Separate authorship in exported reports: model text, template text, and operator edits as distinct fields, joined at render time. Scope for this is the Baseline Review, if wanted.</li>
          </ol>
          <p style={{ fontSize: 11.5, color: C.dimmer, lineHeight: 1.8, marginTop: 8 }}>
            Items 1–3 are internal changes Northgate can make without us. That is deliberate: the method transfers, and the
            re-test is reproducible by your own team.
          </p>
        </section>

        {/* ── Boundaries ── */}
        <section style={{ marginTop: 22 }}>
          <h2 className="print-accent" style={{ fontSize: 12, letterSpacing: "0.15em", color: C.amber, textTransform: "uppercase", marginBottom: 8 }}>What this memo is not</h2>
          <p style={{ fontSize: 12, color: C.dimmer, lineHeight: 1.9 }}>
            Not a legal opinion — counsel determines the legal significance of any finding. Not a penetration test, not a
            model evaluation, not a certificate that the system is safe. It records what the system can currently prove
            and what it cannot, with the method used to establish each, so the findings can be independently re-derived.
          </p>
        </section>

        {/* ── Footer / CTA ── */}
        <footer style={{ margin: "28px 0 0", borderTop: "1px solid rgba(255,255,255,0.15)", paddingTop: 14 }}>
          <p style={{ fontSize: 11, color: C.faint, lineHeight: 1.9 }}>
            Rabbit Hole AI · Jeremiah Dawson · {CONTACT_EMAIL} · www.rabbitholeai.ai<br />
            Sealed-record mechanism (live, verify it yourself): www.rabbitholeai.ai/verify · MIT reference implementation: github.com/uu2142-dev/alice-evidence
          </p>
          <div className="no-print" style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <a href={BOOKING_URL} style={{ fontFamily: "monospace", fontSize: 11, letterSpacing: "0.08em", padding: "10px 16px", border: `1px solid ${C.amber}`, background: "rgba(200,148,26,0.12)", color: C.amber, textDecoration: "none" }}>
              BOOK YOUR OWN 90-MINUTE REVIEW — $1,500 →
            </a>
            <Link href="/#self-check" style={{ fontFamily: "monospace", fontSize: 11, letterSpacing: "0.08em", padding: "10px 16px", border: "1px solid rgba(255,255,255,0.25)", color: C.dim, textDecoration: "none" }}>
              RUN THE SELF-CHECK FIRST
            </Link>
          </div>
        </footer>
      </div>
    </main>
  );
}
