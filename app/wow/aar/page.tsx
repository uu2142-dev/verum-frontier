"use client";

// /wow/aar — the ALICE After Action Report (test). Paste (or drop) a
// WoWCombatLog.txt segment from a wipe; get back "the truth" (facts from your
// own log, sealed) kept visibly separate from "what could help" (cited
// remediation from the raid corpus), with an optional council debrief.
// Post-hoc only: this reads the log the game already wrote — nothing live, in
// combat, or automated. Private by default: the pull id is the key to share it.
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

const MAX = 3_000_000;

type Hit = { spell?: string; source?: string; amount?: number; overkill?: number };
type Death = { name?: string; killing_blow?: Hit | null; largest_hit?: Hit | null };
type Match = { spell?: string; cause?: string; mechanic?: string; remediation?: string; source_ids?: string[]; matched?: string };
type AAR = {
  pull_id?: string; boss?: string; verdict?: string; death_count?: number;
  truth?: { deaths?: Death[]; fight_time_s?: number };
  remediation?: { boss?: string | null; matches?: Match[]; note?: string | null };
  council?: { answers?: { label?: string; text?: string; ok?: boolean; abstained?: boolean; error?: string }[]; tier?: string } | null;
  sealed?: { new?: boolean; links?: number; valid?: boolean; tip_hash?: string };
  error?: string;
};

function mmss(s?: number) {
  if (!s && s !== 0) return "?";
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}
function hit(h?: Hit | null) {
  if (!h) return "?";
  const ov = h.overkill ? `, ${h.overkill.toLocaleString()} overkill` : "";
  return `${h.spell} from ${h.source} (${(h.amount || 0).toLocaleString()}${ov})`;
}

export default function WowAAR() {
  const [log, setLog] = useState("");
  const [council, setCouncil] = useState(false);
  const [res, setRes] = useState<AAR | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await f.text();
    // a whole session log can be huge; the report uses the most recent pull, so
    // keep the tail (which contains it) and let the service cap the rest
    setLog(text.length > MAX ? text.slice(text.length - MAX) : text);
  }

  async function run() {
    setBusy(true);
    setErr(null);
    setRes(null);
    try {
      const r = await fetch("/api/wow/aar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ log, council }),
      });
      const data: AAR = await r.json();
      if (!r.ok) setErr(data.error || `Request failed (${r.status}).`);
      else setRes(data);
    } catch {
      setErr("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  const debrief = res?.council?.answers?.find((a) => a.ok && !a.abstained)?.text;

  const panel: React.CSSProperties = {
    background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 8, padding: 16, marginTop: 14,
  };

  return (
    <main style={{ height: "100dvh", overflowY: "auto", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
     <div style={{ maxWidth: 860, margin: "0 auto", padding: "40px 20px" }}>
      <nav style={{ marginBottom: 22, display: "flex", gap: 16 }}>
        <Link href="/" style={{ fontSize: 11, color: C.dimmer, textDecoration: "none", letterSpacing: "0.04em" }}>← rabbitholeai.ai</Link>
        <Link href="/wow" style={{ fontSize: 11, color: C.dimmer, textDecoration: "none", letterSpacing: "0.04em" }}>gear path →</Link>
      </nav>

      <div style={{ fontSize: 9, letterSpacing: "0.18em", color: C.amber, marginBottom: 8 }}>ALICE VERUM · AFTER ACTION REPORT · TEST</div>
      <h1 style={{ fontSize: 24, margin: "0 0 12px", color: "#fff" }}>What happened on that pull — and what could help</h1>
      <p style={{ color: C.dim, fontSize: 13, lineHeight: 1.85, marginBottom: 8 }}>
        Paste (or drop) a segment of your <code style={{ color: C.amber }}>WoWCombatLog.txt</code> from a wipe. ALICE reads
        your own log — the same file Warcraft Logs reads — and gives you <b>the truth</b> (who died to what, sealed and
        re-derivable) kept separate from <b>what could help</b> (cited fixes from the raid strategy corpus). The most
        recent pull in the segment is used.
      </p>
      <p style={{ color: C.dimmer, fontSize: 12, lineHeight: 1.8, marginBottom: 20 }}>
        Post-hoc only: nothing here is live, in combat, or automated. Turn on advanced combat logging first
        (<code style={{ color: C.amber }}>/console advancedCombatLogging 1</code> then <code style={{ color: C.amber }}>/combatlog</code>) so
        cause-of-death is captured. Healer throughput isn&apos;t judged. It&apos;s an arbiter, not a blame tool.
      </p>

      <textarea
        value={log}
        onChange={(e) => setLog(e.target.value)}
        placeholder={"9/13 20:03:41.000  ENCOUNTER_START,...\n...\nENCOUNTER_END,...,0"}
        spellCheck={false}
        style={{
          width: "100%", minHeight: 120, resize: "vertical", boxSizing: "border-box",
          background: "rgba(255,255,255,0.04)", color: C.dim, border: "1px solid rgba(255,255,255,0.15)",
          borderRadius: 8, padding: 12, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12,
        }}
      />
      <div style={{ display: "flex", gap: 14, alignItems: "center", margin: "12px 0 24px", flexWrap: "wrap" }}>
        <button
          onClick={run}
          disabled={busy || log.trim().length < 32}
          style={{
            padding: "10px 20px", border: `1px solid ${C.amber}`, borderRadius: 6,
            background: busy || log.trim().length < 32 ? "rgba(200,148,26,0.06)" : "rgba(200,148,26,0.16)",
            color: C.amber, fontSize: 13, letterSpacing: "0.04em",
            cursor: busy || log.trim().length < 32 ? "default" : "pointer", opacity: busy || log.trim().length < 32 ? 0.6 : 1,
          }}
        >
          {busy ? "Reading your log…" : "Build the report"}
        </button>
        <label style={{ fontSize: 12, color: C.dimmer, cursor: "pointer" }}>
          <input type="file" accept=".txt,text/plain" onChange={onFile} style={{ display: "none" }} />
          <span style={{ borderBottom: `1px dotted ${C.dimmer}` }}>…or upload WoWCombatLog.txt</span>
        </label>
        <label style={{ fontSize: 12, color: C.dim, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <input type="checkbox" checked={council} onChange={(e) => setCouncil(e.target.checked)} />
          add a council debrief
        </label>
      </div>

      {err && (
        <div style={{ border: `1px solid ${C.red}`, background: "rgba(231,76,60,0.1)", color: C.red, borderRadius: 8, padding: "12px 14px", fontSize: 13 }}>
          {err}
        </div>
      )}

      {res && (
        <div>
          <div style={{ fontSize: 16, color: "#fff", marginBottom: 4 }}>
            {res.boss || "Encounter"}{" "}
            <span style={{ color: res.verdict === "kill" ? C.green : C.red, fontSize: 13 }}>[{(res.verdict || "?").toUpperCase()}]</span>
            <span style={{ color: C.dimmer, fontSize: 12 }}> · {res.death_count ?? 0} death(s) · {mmss(res.truth?.fight_time_s)}</span>
          </div>

          <div style={panel}>
            <div style={{ fontSize: 9, letterSpacing: "0.18em", color: C.blue, marginBottom: 10 }}>THE TRUTH · FROM YOUR COMBAT LOG</div>
            {(!res.truth?.deaths || res.truth.deaths.length === 0) && <div style={{ color: C.dim, fontSize: 13 }}>No player deaths recorded.</div>}
            {res.truth?.deaths?.map((d, i) => (
              <div key={i} style={{ color: C.dim, fontSize: 13, lineHeight: 1.7, marginBottom: 6 }}>
                <b style={{ color: "#fff" }}>{d.name}</b>:{" "}
                {!d.killing_blow && !d.largest_hit
                  ? <span style={{ color: C.dimmer }}>cause unavailable (no damage lines — was advanced combat logging on?)</span>
                  : <>killing blow = {hit(d.killing_blow)}
                      {d.largest_hit && (!d.killing_blow || (d.largest_hit.amount || 0) > (d.killing_blow.amount || 0)) &&
                        <>; <span style={{ color: C.amber }}>largest hit taken</span> = {hit(d.largest_hit)}</>}
                    </>}
              </div>
            ))}
          </div>

          <div style={panel}>
            <div style={{ fontSize: 9, letterSpacing: "0.18em", color: C.green, marginBottom: 10 }}>WHAT COULD HELP · CITED, SEPARATE FROM THE FACTS</div>
            {(!res.remediation?.matches || res.remediation.matches.length === 0) && (
              <div style={{ color: C.dim, fontSize: 13 }}>{res.remediation?.note || "No corpus match — truth only."}</div>
            )}
            {res.remediation?.matches?.map((m, i) => (
              <div key={i} style={{ color: C.dim, fontSize: 13, lineHeight: 1.7, marginBottom: 8 }}>
                <b style={{ color: "#fff" }}>{m.spell}</b> → {m.cause || m.mechanic}
                <div style={{ color: C.dim }}>{m.remediation}
                  {m.source_ids && m.source_ids.length > 0 && <span style={{ color: C.dimmer }}> [{m.source_ids.join(", ")}]</span>}
                </div>
              </div>
            ))}
          </div>

          {debrief && (
            <div style={panel}>
              <div style={{ fontSize: 9, letterSpacing: "0.18em", color: C.amber, marginBottom: 10 }}>
                COUNCIL DEBRIEF{res.council?.tier ? ` · ${res.council.tier}` : ""}
              </div>
              <div style={{ color: C.dim, fontSize: 13, lineHeight: 1.8, whiteSpace: "pre-wrap" }}>{debrief}</div>
            </div>
          )}

          {res.sealed && res.pull_id && (
            <p style={{ color: C.dimmer, fontSize: 11, lineHeight: 1.7, marginTop: 14 }}>
              Sealed as <code style={{ color: C.blue }}>{res.pull_id}</code>{" "}
              ({res.sealed.valid ? "chain valid" : "unverified"}, {res.sealed.links} links). That id is the key to this
              report — share it to share the AAR; it&apos;s private by default. Verify:{" "}
              <code style={{ color: C.dimmer }}>/wow/aar/verify/{res.pull_id}</code>
            </p>
          )}
        </div>
      )}

      <p style={{ color: C.dimmer, fontSize: 11, lineHeight: 1.7, marginTop: 28 }}>
        The truth is what your log shows, sealed to its own hash so anyone can re-derive it. &quot;What could help&quot; is
        cited guidance, not blame. Your log is read to produce this report and is not stored by this page. The WoW Game
        Pack is a third-party companion; it never automates play and does nothing while you are in combat.
      </p>
     </div>
    </main>
  );
}
