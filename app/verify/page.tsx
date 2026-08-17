"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { verifySession, type SessionResult, type ExchangeResult } from "@/lib/sealVerify";
import { segmentResponse, hasProcessNarration } from "@/lib/processNarration";

const C = {
  green: "#2ecc71",
  red: "#e74c3c",
  amber: "#c8941a",
  blue: "#58a6ff",
  model: "#e8d9a8",
  violet: "#b98cff",
  teal: "#57c6b0",
  dim: "rgba(255,255,255,0.45)",
  dimmer: "rgba(255,255,255,0.3)",
};

function short(h: string, n = 12) {
  return h.length > n * 2 + 1 ? `${h.slice(0, n)}…${h.slice(-6)}` : h;
}

export default function VerifyPage() {
  const [result, setResult] = useState<SessionResult | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [responses, setResponses] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const run = useCallback(async (text: string, name: string) => {
    setBusy(true); setError(null); setResult(null); setResponses([]); setFileName(name);
    try {
      const doc = JSON.parse(text);
      const r = await verifySession(doc);
      setResult(r);
      // Display-only: keep the readable response text (already in the file) so the
      // page can show it with tool-loop working-notes dimmed. Never touches the seal.
      setResponses(
        Array.isArray(doc?.exchanges)
          ? doc.exchanges.map((e: { response?: unknown }) => (typeof e?.response === "string" ? e.response : ""))
          : []
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that file as a sealed session.");
    } finally {
      setBusy(false);
    }
  }, []);

  const onFile = useCallback((f: File) => {
    const reader = new FileReader();
    reader.onload = () => run(String(reader.result ?? ""), f.name);
    reader.onerror = () => setError("Could not read that file.");
    reader.readAsText(f);
  }, [run]);

  const loadSample = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/sample-sealed-session.json");
      if (!res.ok) throw new Error("Sample not found.");
      await run(await res.text(), "sample-sealed-session.json (a real session from the gate)");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the sample.");
      setBusy(false);
    }
  }, [run]);

  return (
    <main className="bg-black font-mono" style={{ padding: "48px 24px", height: "100dvh", overflowY: "auto" }}>
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <Link href="/" style={{ fontSize: 10, letterSpacing: "0.25em", color: C.dim }}>← VERUM FRONTIER</Link>

        <h1 style={{ color: "#fff", fontSize: 18, letterSpacing: "0.18em", margin: "18px 0 4px", textTransform: "uppercase" }}>
          Verify a sealed session
        </h1>
        <p style={{ fontSize: 10, color: C.dimmer, letterSpacing: "0.08em", marginBottom: 20 }}>
          RECOMPUTED ENTIRELY IN YOUR BROWSER · NOTHING IS UPLOADED
        </p>

        <p style={{ color: "rgba(255,255,255,0.72)", fontSize: 13, lineHeight: 1.8, marginBottom: 10 }}>
          Every answer the gate returns ships with a downloadable record: SHA-256 leaf hashes over the query,
          the response, the receipt, and the rest; a Merkle root over those leaves; and an Ed25519 signature
          over the root. This page recomputes all of it from the file you give it and shows you each check
          pass or fail. It runs on your machine — the file is read locally and never leaves the page.
        </p>
        <p style={{ color: "rgba(255,255,255,0.72)", fontSize: 13, lineHeight: 1.8, marginBottom: 22 }}>
          What a green result proves: the record is the one this gate sealed, at the time it claims, and the
          readable text beside it is the text that was sealed. What it does <strong>not</strong> prove: that any
          model was correct. That distinction is the point — verify the artifact, don&apos;t trust the vendor.
        </p>
        <p style={{ color: "rgba(255,255,255,0.72)", fontSize: 13, lineHeight: 1.8, marginBottom: 22 }}>
          Every exchange also carries its <strong>attribution</strong> — the division of labor behind the answer:
          what you wrote, what the model produced, what the gate substituted, what was retrieved or recalled, each
          tied to the part of the record that seals it. A signature proves a record wasn&apos;t altered;
          attribution shows <em>who authored which part</em>. Different questions — both answered here.
        </p>

        {/* drop zone */}
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
          style={{
            border: `1px dashed ${dragging ? C.blue : "rgba(255,255,255,0.2)"}`,
            background: dragging ? "rgba(88,166,255,0.06)" : "rgba(255,255,255,0.02)",
            padding: "26px 18px", textAlign: "center", marginBottom: 12,
          }}
        >
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", marginBottom: 12 }}>
            Drop a <code>verum-session-*.json</code> here, or
          </div>
          <div className="flex" style={{ gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <button
              onClick={() => inputRef.current?.click()}
              style={{
                fontFamily: "monospace", fontSize: 11, letterSpacing: "0.1em", cursor: "pointer",
                padding: "7px 16px", border: `1px solid ${C.blue}`, background: "rgba(88,166,255,0.12)", color: C.blue,
              }}
            >CHOOSE A FILE</button>
            <button
              onClick={loadSample}
              style={{
                fontFamily: "monospace", fontSize: 11, letterSpacing: "0.1em", cursor: "pointer",
                padding: "7px 16px", border: "1px solid rgba(255,255,255,0.25)", background: "transparent", color: C.dim,
              }}
            >LOAD A SAMPLE SESSION</button>
          </div>
          <input
            ref={inputRef} type="file" accept=".json,application/json"
            aria-label="Choose a sealed session file to verify"
            onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); }}
            style={{ display: "none" }}
          />
        </div>

        <div aria-live="polite">
          {busy && <p style={{ fontSize: 12, color: C.amber }}>Recomputing hashes…</p>}
          {error && (
            <div role="alert" style={{ fontSize: 12, color: C.red, border: `1px solid rgba(231,76,60,0.4)`, background: "rgba(231,76,60,0.06)", padding: "10px 12px" }}>
              ⚠ {error}
            </div>
          )}
          {result && <Results result={result} fileName={fileName} responses={responses} />}
        </div>

        <CanonRules />
      </div>
    </main>
  );
}

function Verdict({ result }: { result: SessionResult }) {
  const green = result.ok;
  const color = green ? C.green : C.red;
  return (
    <div role="status" style={{
      border: `1px solid ${color}`, background: green ? "rgba(46,204,113,0.07)" : "rgba(231,76,60,0.07)",
      padding: "12px 14px", marginBottom: 14,
    }}>
      <div style={{ fontSize: 14, letterSpacing: "0.1em", color }}>
        {green ? "✓ VERIFIED" : "✗ VERIFICATION FAILED"}
      </div>
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", lineHeight: 1.7, marginTop: 5 }}>
        {green
          ? `All ${result.exchangeCount} exchange${result.exchangeCount === 1 ? "" : "s"} recompute exactly: every ` +
            `content hash matches, every Merkle root matches, the session chain links end to end` +
            (result.webCryptoEd25519 ? ", and every Ed25519 signature is valid." : ". (Your browser could not run Ed25519 — the hash chain still verifies.)")
          : "At least one recomputed value does not match what the file claims. The mismatches are marked in red below — the record was altered after it was sealed, or the file is not a genuine session from this gate."}
        {result.anySkipped && green && (
          <span style={{ color: C.dim }}> Some leaves were skipped because they can only be checked against data not included in the export (see the notes below).</span>
        )}
      </div>
    </div>
  );
}

function Results({ result, fileName, responses }: { result: SessionResult; fileName: string | null; responses: string[] }) {
  return (
    <div style={{ marginTop: 4 }}>
      {fileName && <div style={{ fontSize: 10, color: C.dimmer, marginBottom: 8 }}>FILE: {fileName}</div>}
      <Verdict result={result} />
      <div style={{ fontSize: 11, color: C.dim, marginBottom: 8 }}>
        SESSION CHAIN ROOT: <span style={{ color: result.chainRootOk ? C.green : C.red }}>{result.chainRootOk ? "links end-to-end ✓" : "BROKEN ✗"}</span>
      </div>
      {result.exchanges.map(ex => <ExchangeCard key={ex.index} ex={ex} response={responses[ex.index] ?? ""} />)}
    </div>
  );
}

function Attribution({ ex, hasNarration }: { ex: ExchangeResult; hasNarration: boolean }) {
  const has = (lbl: string) => ex.leaves.some(l => l.label === lbl);
  const rows: { who: string; color: string; what: string }[] = [
    { who: "YOU", color: C.blue, what: "the question you asked" },
  ];
  if (has("DOCUMENT")) rows.push({ who: "YOU", color: C.blue, what: "a document you attached" });
  if (ex.declined) {
    rows.push({ who: "THE MODEL", color: C.dim, what: `${ex.model} — declined this request` });
    rows.push({ who: "THE GATE", color: C.amber, what: "wrote the note in the answer slot — not the model. The record is flagged so it can never be replayed as the model's words." });
  } else {
    rows.push({ who: "THE MODEL", color: C.model, what: `${ex.model} — the answer` });
    if (hasNarration) {
      rows.push({ who: "THE MODEL", color: C.dim, what: `${ex.model} — plus its tool-loop working notes (searching, retrying, parsing): the model's own between-search narration, sealed in the same RESPONSE and not separated from the answer` });
    }
  }
  if (has("SOURCES")) rows.push({ who: "RETRIEVAL", color: C.violet, what: "web sources the answer was grounded on" });
  if (has("MEMORY")) rows.push({ who: "RECALL", color: C.teal, what: "prior sealed memories the gate surfaced" });
  const sys = ["RECEIPT", "TIMING", "BIAS"].filter(has).map(s => s.toLowerCase());
  if (sys.length) rows.push({ who: "THE SYSTEM", color: C.dim, what: `${sys.join(" · ")} — measured by the harness, not authored` });
  return (
    <div style={{ border: `1px solid ${C.blue}22`, background: "rgba(88,166,255,0.03)", padding: "9px 11px", marginBottom: 12 }}>
      <div style={{ fontSize: 9, letterSpacing: "0.18em", color: C.dim, marginBottom: 7 }}>
        WHO AUTHORED WHAT — THE DIVISION OF LABOR
      </div>
      {rows.map((r, i) => (
        <div key={i} style={{ display: "flex", gap: 9, marginBottom: 4, alignItems: "baseline" }}>
          <span style={{ color: r.color, fontSize: 10, letterSpacing: "0.07em", minWidth: 84, flexShrink: 0 }}>{r.who}</span>
          <span style={{ color: "rgba(255,255,255,0.66)", fontSize: 10, lineHeight: 1.6 }}>{r.what}</span>
        </div>
      ))}
      <div style={{ color: C.dimmer, fontSize: 9, marginTop: 7, lineHeight: 1.6 }}>
        Attribution is component-level — which part each party produced, not who wrote which word. A signature proves the record wasn&apos;t altered; this shows who authored each part.
      </div>
    </div>
  );
}

function ExchangeCard({ ex, response }: { ex: ExchangeResult; response: string }) {
  const [open, setOpen] = useState(true);
  const hasNarration = !ex.declined && hasProcessNarration(response);
  const bad = !ex.rootOk || !ex.chainOk || ex.sigStatus === "invalid" || ex.leaves.some(l => l.status === "mismatch");
  const edge = bad ? C.red : C.green;
  return (
    <div style={{ border: `1px solid ${edge}33`, marginBottom: 8 }}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        style={{
          width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer",
          padding: "9px 11px", fontFamily: "monospace", fontSize: 11, color: "rgba(255,255,255,0.8)",
          display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center",
        }}
      >
        <span>
          <span style={{ color: edge }}>{bad ? "✗" : "✓"}</span>{" "}
          <span style={{ color: C.dim }}>[{ex.index}]</span> {ex.model}
          {ex.declined && <span style={{ color: C.amber }}> · declined</span>}
          {ex.truncated && <span style={{ color: C.amber }}> · truncated</span>}
          <span style={{ color: C.dimmer }}> — {ex.queryPreview}{ex.queryPreview.length >= 100 ? "…" : ""}</span>
        </span>
        <span style={{ color: C.dim }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div style={{ padding: "2px 11px 11px", fontSize: 10, lineHeight: 1.9 }}>
          <Attribution ex={ex} hasNarration={hasNarration} />
          {hasNarration && <ResponseViewer response={response} />}
          <div style={{ fontSize: 9, letterSpacing: "0.18em", color: C.dim, marginBottom: 6 }}>PROOF — EACH PART IS INTACT</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 420 }}>
              <thead>
                <tr style={{ color: C.dimmer, textAlign: "left" }}>
                  <th style={{ padding: "2px 8px 2px 0", fontWeight: "inherit" }}>LEAF</th>
                  <th style={{ padding: "2px 8px", fontWeight: "inherit" }}>RECOMPUTED</th>
                  <th style={{ padding: "2px 8px", fontWeight: "inherit" }}>CLAIMED</th>
                  <th style={{ padding: "2px 0", fontWeight: "inherit" }}></th>
                </tr>
              </thead>
              <tbody>
                {ex.leaves.map((l, i) => {
                  const c = l.status === "match" ? C.green : l.status === "mismatch" ? C.red : C.dimmer;
                  return (
                    <tr key={i} style={{ color: "rgba(255,255,255,0.6)" }}>
                      <td style={{ padding: "2px 8px 2px 0", color: "rgba(255,255,255,0.75)" }}>{l.label}</td>
                      <td style={{ padding: "2px 8px" }}>{l.computed ? short(l.computed) : "—"}</td>
                      <td style={{ padding: "2px 8px" }}>{short(l.claimed)}</td>
                      <td style={{ padding: "2px 0", color: c }}>
                        {l.status === "match" ? "✓" : l.status === "mismatch" ? "✗ MISMATCH" : "skip"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {ex.leaves.some(l => l.note) && (
            <div style={{ color: C.dimmer, marginTop: 4 }}>
              {ex.leaves.filter(l => l.note).map((l, i) => <div key={i}>· {l.label}: {l.note}</div>)}
            </div>
          )}
          <div style={{ marginTop: 8, color: "rgba(255,255,255,0.6)" }}>
            <div>MERKLE ROOT: <span style={{ color: ex.rootOk ? C.green : C.red }}>{ex.rootOk ? "recomputes from the leaves ✓" : "does NOT match ✗"}</span></div>
            <div style={{ color: C.dimmer }}>{short(ex.computedRoot, 18)}</div>
            <div style={{ marginTop: 4 }}>
              ED25519 SIGNATURE:{" "}
              <span style={{ color: ex.sigStatus === "valid" ? C.green : ex.sigStatus === "invalid" ? C.red : C.dim }}>
                {ex.sigStatus === "valid" ? "valid, signed by the published key ✓"
                  : ex.sigStatus === "invalid" ? "INVALID ✗"
                  : ex.sigStatus === "unsigned" ? "unsigned"
                  : "your browser can't run Ed25519 — hashes still verify"}
              </span>
              {ex.keyIdMatch === true && <span style={{ color: C.dimmer }}> · key fingerprint matches the file&apos;s published key</span>}
              {ex.keyIdMatch === false && <span style={{ color: C.red }}> · key fingerprint MISMATCH</span>}
            </div>
            <div style={{ marginTop: 4 }}>
              CHAIN LINK: <span style={{ color: ex.chainOk ? C.green : C.red }}>{ex.chainOk ? "links to the previous exchange ✓" : "BROKEN ✗"}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Display-only reading aid: shows the full sealed response verbatim with the
// model's tool-loop working-notes de-emphasized. Seals nothing, removes nothing.
function ResponseViewer({ response }: { response: string }) {
  const [open, setOpen] = useState(false);
  const segments = open ? segmentResponse(response) : [];
  return (
    <div style={{ border: `1px solid ${C.amber}22`, background: "rgba(200,148,26,0.03)", padding: "9px 11px", marginBottom: 12 }}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        style={{ background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: "monospace",
          fontSize: 9, letterSpacing: "0.16em", color: C.amber }}
      >
        {open ? "▲" : "▼"} SEALED RESPONSE — WORKING NOTES DIMMED (READING AID)
      </button>
      {open && (
        <>
          <p style={{ fontSize: 9.5, color: C.dimmer, lineHeight: 1.7, margin: "8px 0 10px" }}>
            The full text below is exactly what this exchange&apos;s RESPONSE leaf seals — the hash you verified
            above covers every character of it. The dimmed spans are what looks like the model&apos;s own
            between-search working notes (searching, retrying, parsing), shown here only as a reading aid.
            Nothing is removed, relabeled in the record, or re-sealed; this is a display heuristic, and it errs
            toward leaving text bright rather than dimming the answer.
          </p>
          <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 11, lineHeight: 1.7, color: "rgba(255,255,255,0.82)" }}>
            {segments.map((s, i) =>
              s.note
                ? <span key={i} style={{ color: C.dimmer, fontStyle: "italic", opacity: 0.75 }} title="looks like the model's tool-loop working notes — model-authored, sealed, not the answer">{s.text}</span>
                : <span key={i}>{s.text}</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function CanonRules() {
  const [open, setOpen] = useState(false);
  const P = (s: string) => <code style={{ color: "rgba(255,255,255,0.75)" }}>{s}</code>;
  return (
    <div style={{ marginTop: 26, borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: 16 }}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        style={{ background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: "monospace",
          fontSize: 11, letterSpacing: "0.1em", color: C.dim }}
      >
        {open ? "▲" : "▼"} HOW EACH HASH IS COMPUTED (so you can rebuild this yourself)
      </button>
      {open && (
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", lineHeight: 1.9, marginTop: 10 }}>
          <p style={{ marginBottom: 8 }}>
            Every leaf is {P("SHA-256")} over a {P("JSON.stringify")} preimage: keys in the order given, no
            whitespace, non-ASCII characters left unescaped, hashed as UTF-8. The exact preimages:
          </p>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", minWidth: 460 }}>
              <tbody>
                {[
                  ["QUERY", `{q: <query>, ts: <seal.sealedAt>}`],
                  ["RESPONSE", `{r: <response>, model: <model>}`],
                  ["SOURCES", `[<grounding.sources URIs, in order>]`],
                  ["RECEIPT", `<the receipt object, verbatim>`],
                  ["BIAS", `<the biasScreen object, verbatim>`],
                  ["MEMORY", `<memoryRecall.roots>`],
                  ["TIMING", `{model: <provider model id>, llmMs: <timingMs.llm>}`],
                  ["DOCUMENT", `{name: <attachment name>, doc: <attachment text>}`],
                ].map(([k, v]) => (
                  <tr key={k}>
                    <td style={{ padding: "2px 14px 2px 0", color: "rgba(255,255,255,0.8)", verticalAlign: "top" }}>{k}</td>
                    <td style={{ padding: "2px 0" }}>{P(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ margin: "10px 0 6px" }}>
            The Merkle root pairs leaf hashes left to right, duplicating the last when the count is odd, and
            hashes the concatenation of the two hex strings, level by level, up to a single root. The session
            chain is {P("SHA-256(prevChainHash + seal.root)")}, starting from{" "}
            {P("SHA-256('VERUM_FRONTIER_SESSION_GENESIS' + startedAt)")}. The signature is Ed25519 over{" "}
            {P("'VF-SEAL-v1|' + root + '|' + sealedAt")}, by the published key.
          </p>
          <p style={{ color: C.dimmer }}>
            Two leaves may show as skipped rather than checked. DOCUMENT&apos;s preimage includes the full text of
            a file you attached, which the export deliberately does not carry — verify it against your own copy.
            TIMING is hashed over the provider&apos;s model name; this page maps the display id to it from a public
            table. A pure-standard-library reference implementation is at{" "}
            <a href="https://github.com/uu2142-dev/alice-evidence" target="_blank" rel="noopener noreferrer" style={{ color: C.amber, textDecoration: "underline" }}>
              github.com/uu2142-dev/alice-evidence
            </a>.
          </p>
        </div>
      )}
    </div>
  );
}
