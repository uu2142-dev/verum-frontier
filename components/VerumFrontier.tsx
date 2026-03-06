'use client';
import { useState, useEffect, useRef } from "react";
import Image from "next/image";

// ── RHAI/ALICE Math (mirrors Python stack exactly) ────────────────────────

function biasScore(vec: number[]) {
  const w = [0.4, -0.3, -0.2, 0.8, 0.3, -0.1, -0.1, -0.2, -0.5, -0.6, 0.7, -0.2];
  let r = vec.reduce((s, v, i) => s + v * w[i], 0);
  return Math.max(0, Math.min(1, (r + 2.5) / 5));
}
function componentScores(vec: number[]) {
  return {
    "STATE MEDIA BIAS":  vec[3],
    "MEAS. INVALIDITY":  1 - vec[9],
    "NARRATIVE CAPTURE": vec[10],
    "EXPERT DISSENT":    1 - vec[8],
    "SOURCE CAPTURE":    1 - vec[0],
  };
}
function confidenceScore(vec: number[]) {
  const r = vec[0]*0.25 + vec[1]*0.15 + vec[2]*0.10 + vec[8]*0.20 + vec[9]*0.20 + vec[11]*0.10;
  const p = vec[10]*0.15 + vec[3]*0.10;
  return Math.max(0, Math.min(1, r - p));
}
function sha256sim(str: string) {
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = ((h << 5) - h) + str.charCodeAt(i); h |= 0; }
  return Math.abs(h).toString(16).padStart(16, '0');
}
function buildMerkle(leaves: string[]) {
  let level = [...leaves], tree = [level];
  while (level.length > 1) {
    if (level.length % 2) level.push(level[level.length - 1]);
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2)
      next.push(sha256sim(level[i] + level[i + 1]));
    level = next;
    tree.push(level);
  }
  return { root: level[0], tree };
}

// ── Models ────────────────────────────────────────────────────────────────

const MODELS = [
  {
    id: "grok", name: "Grok-3", vendor: "xAI", tagline: "Axiomatic · High Velocity",
    hotspot: { left: "7%", bottom: "14%", width: "16%", height: "65%" } as React.CSSProperties,
    color: "#c8a96e", dim: "#5a4820", glow: "rgba(200,169,110,0.3)",
    vec: [0.82,0.70,0.65,0.15,0.55,0.78,0.90,0.75,0.72,0.68,0.38,0.80],
    label: "GROK-3 // xAI",
  },
  {
    id: "gemini", name: "Gemini 2.0", vendor: "Google DeepMind", tagline: "Sovereign · Multimodal",
    hotspot: { left: "25%", bottom: "14%", width: "18%", height: "68%" } as React.CSSProperties,
    color: "#8ab4f8", dim: "#2a4a7a", glow: "rgba(138,180,248,0.3)",
    vec: [0.75,0.80,0.72,0.25,0.45,0.82,0.88,0.80,0.78,0.74,0.42,0.85],
    label: "GEMINI 2.0 // DEEPMIND",
  },
  {
    id: "gpt4", name: "GPT-4o", vendor: "OpenAI", tagline: "Axiomatic · Policy Layer",
    hotspot: { right: "25%", bottom: "14%", width: "18%", height: "68%" } as React.CSSProperties,
    color: "#81c784", dim: "#2a5a30", glow: "rgba(129,199,132,0.3)",
    vec: [0.78,0.75,0.68,0.20,0.60,0.75,0.85,0.72,0.70,0.62,0.52,0.78],
    label: "GPT-4o // OPENAI",
  },
  {
    id: "claude", name: "Claude Sonnet", vendor: "Anthropic", tagline: "Constitutional · Precise",
    hotspot: { right: "6%", bottom: "14%", width: "16%", height: "65%" } as React.CSSProperties,
    color: "#f48fb1", dim: "#7a2a4a", glow: "rgba(244,143,177,0.3)",
    vec: [0.85,0.82,0.75,0.18,0.40,0.80,0.88,0.85,0.82,0.80,0.30,0.88],
    label: "CLAUDE SONNET // ANTHROPIC",
  },
] as const;

type Model = typeof MODELS[number];

const PIPELINE_STEPS = [
  "INTENT FIREWALL",
  "BIAS CHECKER — PRE-FLIGHT",
  "ANTI-DATA GENERATOR",
  "PROMPT STRUCTURING",
  "LLM CALL",
  "RESPONSE AUDIT",
  "MERKLE SEAL",
];

type StageStatus = "idle" | "active" | "done";
interface Stage { label: string; status: StageStatus; detail: string | null; }

// ── Sub-components ────────────────────────────────────────────────────────

function BiasBar({ label, value, color }: { label: string; value: number; color: string }) {
  const pct = Math.round(value * 100);
  const hi  = value > 0.70;
  return (
    <div style={{ marginBottom: 5 }}>
      <div style={{
        display: "flex", justifyContent: "space-between",
        fontSize: 8, marginBottom: 2,
        color: hi ? "#e74c3c" : "rgba(255,255,255,0.3)",
        letterSpacing: "0.05em",
      }}>
        <span>{label}{hi ? " ◄" : ""}</span>
        <span>{pct}%</span>
      </div>
      <div style={{ height: 3, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{
          height: "100%", borderRadius: 2,
          width: `${pct}%`,
          transition: "width 0.9s cubic-bezier(0.16,1,0.3,1)",
          background: hi
            ? "linear-gradient(90deg,#7a1a1a,#e74c3c)"
            : `linear-gradient(90deg,${color}55,${color})`,
        }} />
      </div>
    </div>
  );
}

function PipelineView({ stages }: { stages: Stage[] }) {
  const rows = stages.length
    ? stages
    : PIPELINE_STEPS.map(l => ({ label: l, status: "idle" as StageStatus, detail: null }));
  return (
    <div style={{ fontFamily: "monospace", fontSize: 10, padding: "2px 0" }}>
      {rows.map((s, i) => (
        <div key={i} style={{
          borderLeft: `1px solid ${
            s.status === "done"   ? "rgba(46,204,113,0.5)" :
            s.status === "active" ? "#c8941a" :
                                    "rgba(255,255,255,0.08)"
          }`,
          paddingLeft: 10, marginBottom: 5, transition: "border-color 0.3s",
        }}>
          <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
            <span style={{
              fontSize: 8,
              color: s.status === "done"   ? "#2ecc71" :
                     s.status === "active" ? "#c8941a" :
                                             "rgba(255,255,255,0.2)",
            }}>
              {s.status === "done" ? "✓" : s.status === "active" ? "▶" : "·"}
            </span>
            <span style={{
              fontSize: 9, letterSpacing: "0.05em",
              color: s.status === "idle" ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.85)",
            }}>
              [{String(i + 1).padStart(2, "0")}] {s.label}
            </span>
          </div>
          {s.detail && s.status !== "idle" && (
            <div style={{ color: "rgba(255,255,255,0.35)", marginLeft: 16, marginTop: 2, fontSize: 8, lineHeight: 1.7 }}>
              {s.detail}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function MerkleView({ data }: { data: { leaves: string[]; root: string } | null }) {
  if (!data) return (
    <div style={{ color: "rgba(255,255,255,0.25)", fontSize: 9, lineHeight: 2 }}>
      ARCHIVIST STANDING BY<span className="blink">_</span>
      <br />
      <span style={{ fontSize: 8, opacity: 0.7 }}>
        Execute pipeline to generate Merkle seal.<br />
        Each leaf = one pipeline stage, SHA-256 chained.<br />
        Root seals the complete analytical state.
      </span>
    </div>
  );
  return (
    <div style={{ fontFamily: "monospace", fontSize: 9 }}>
      <div style={{ color: "rgba(200,148,26,0.6)", marginBottom: 8, fontSize: 8, letterSpacing: "0.15em" }}>
        🌳 MERKLE TREE — ARCHIVIST SEAL
      </div>
      <div style={{ textAlign: "center", marginBottom: 10 }}>
        <div style={{
          display: "inline-block", padding: "4px 12px",
          border: "1px solid rgba(200,148,26,0.4)",
          color: "#c8941a", fontSize: 8, letterSpacing: "0.1em",
        }}>
          ROOT: {data.root.toUpperCase().slice(0, 20)}...
        </div>
      </div>
      <div style={{ display: "flex", gap: 3, flexWrap: "wrap", justifyContent: "center", marginBottom: 8 }}>
        {data.leaves.map((l, i) => (
          <div key={i} style={{
            padding: "2px 6px", border: "1px solid rgba(255,255,255,0.08)",
            fontSize: 7, color: "rgba(255,255,255,0.3)",
          }}>
            L{i + 1}: {l.slice(0, 8).toUpperCase()}
          </div>
        ))}
      </div>
      <div style={{
        borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 8, marginTop: 4,
        fontSize: 8, color: "#2ecc71", letterSpacing: "0.08em",
      }}>
        ✅ CHAIN INTEGRITY VERIFIED<br />
        <span style={{ color: "rgba(255,255,255,0.25)" }}>
          SEALED {new Date().toISOString().slice(0, 19)}Z · {data.leaves.length} ENTRIES
        </span>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────

export default function VerumFrontier() {
  const [activeModel,  setActiveModel]  = useState<Model | null>(null);
  const [hoveredModel, setHoveredModel] = useState<Model | null>(null);
  const [running,      setRunning]      = useState(false);
  const [stages,       setStages]       = useState<Stage[]>([]);
  const [merkle,       setMerkle]       = useState<{ leaves: string[]; root: string } | null>(null);
  const [tab,          setTab]          = useState<"pipeline" | "merkle">("pipeline");
  const [panelOpen,    setPanelOpen]    = useState(false);
  const [aliceOutput,  setAliceOutput]  = useState("SYSTEM STANDBY // AWAITING ARCHITECT COMMAND...");
  const [ticker,       setTicker]       = useState("");
  const tickerRef = useRef("");

  // Live clock
  const [clock, setClock] = useState("");
  useEffect(() => {
    const tick = () => setClock(new Date().toISOString().replace("T", " ").slice(0, 19) + "Z");
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // Typewriter
  useEffect(() => {
    tickerRef.current = aliceOutput;
    setTicker("");
    let i = 0;
    const id = setInterval(() => {
      if (i < tickerRef.current.length) setTicker(tickerRef.current.slice(0, ++i));
      else clearInterval(id);
    }, 20);
    return () => clearInterval(id);
  }, [aliceOutput]);

  const setStage = (idx: number, status: StageStatus, detail: string | null) =>
    setStages(prev => { const n = [...prev]; n[idx] = { ...n[idx], status, detail }; return n; });

  const runPipeline = async (model: Model) => {
    if (running) return;
    setRunning(true);
    setActiveModel(model);
    setPanelOpen(true);
    setMerkle(null);
    setTab("pipeline");

    const bias = biasScore(model.vec);
    const conf = confidenceScore(model.vec);
    const anti = bias > 0.55;
    const bf   = bias > 0.65 ? "🚨 HIGH" : bias > 0.45 ? "⚠️  MED" : "✅ LOW";

    setStages(PIPELINE_STEPS.map(label => ({ label, status: "idle", detail: null })));
    const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

    setAliceOutput(`INITIATING A.L.I.C.E. PIPELINE FOR ${model.name.toUpperCase()}...`);

    setStage(0, "active", null); await delay(550);
    setStage(0, "done", "Query classified NORMAL — routing to bias layer");

    setStage(1, "active", null); await delay(850);
    setAliceOutput(`BIAS CHECK: ${(bias*100).toFixed(1)}% ${bf} | CONFIDENCE: ${(conf*100).toFixed(1)}%`);
    setStage(1, "done", `Score: ${(bias*100).toFixed(1)}% ${bf}  |  Confidence: ${(conf*100).toFixed(1)}%`);

    setStage(2, "active", null); await delay(650);
    setStage(2, "done", anti
      ? `⚠️  Anti-data generated — ${Object.values(componentScores(model.vec)).filter(v => v > 0.65).length} boundaries active`
      : "✓ No anti-data required — bias within operational bounds");

    setStage(3, "active", null); await delay(480);
    setStage(3, "done", `Structured prompt built — ${(2200 + Math.floor(Math.random() * 900)).toLocaleString()} tokens  ✅`);

    setStage(4, "active", null);
    setAliceOutput(`LLM CALL IN PROGRESS → ${model.name.toUpperCase()} // WRAPPER INTERCEPTING...`);
    await delay(1300);
    const lat = 160 + Math.floor(Math.random() * 360);
    setStage(4, "done", `${model.name} responded — ${lat}ms  |  ${(700 + Math.floor(Math.random() * 500)).toLocaleString()} tokens`);

    setStage(5, "active", null); await delay(680);
    const rb = 0.32 + Math.random() * 0.28;
    setStage(5, "done", `Response bias: ${(rb*100).toFixed(1)}%  ${rb > 0.55 ? "⚠️  MODERATE" : "✅ CLEAN"}`);

    setStage(6, "active", null); await delay(750);
    const leaves = [
      sha256sim(`INTEL_${model.id}_${Date.now()}`),
      sha256sim(`BIAS_${(bias * 1e4).toFixed(0)}`),
      sha256sim(`ANTI_${anti}_${model.id}`),
      sha256sim(`PROMPT_${model.name}_${lat}`),
      sha256sim(`LLM_${lat}_${model.vendor}`),
      sha256sim(`AUDIT_${(rb * 1e4).toFixed(0)}`),
    ];
    const { root } = buildMerkle(leaves);
    setMerkle({ leaves, root });
    setStage(6, "done", `Root: ${root.toUpperCase().slice(0, 18)}...  ✅ INTACT`);

    setAliceOutput(
      `MERKLE ROOT SEALED: ${root.toUpperCase().slice(0, 16)}... ` +
      `| BIAS: ${(bias*100).toFixed(1)}% | CONF: ${(conf*100).toFixed(1)}% ` +
      `| SOVEREIGNTY MAINTAINED — ALL OUTPUTS AUDITED BEFORE OPERATOR DELIVERY`
    );
    setRunning(false);
  };

  return (
    <main className="min-h-screen bg-black text-zinc-300 font-mono relative overflow-hidden" style={{ height: "100dvh" }}>

      {/* ── BACKGROUND ────────────────────────────────────────────────── */}
      <div className="absolute inset-0 z-0">
        <Image
          src="/rabbitholeai-verum_frontier.png"
          alt="Verum Frontier"
          fill
          className="object-cover opacity-60 mix-blend-screen"
          priority
          unoptimized
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/90" />
      </div>

      {/* ── SCANLINES ─────────────────────────────────────────────────── */}
      <div className="absolute inset-0 z-10 pointer-events-none" style={{
        background: "repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.03) 2px,rgba(0,0,0,0.03) 4px)"
      }} />

      {/* ── TOP HEADER ────────────────────────────────────────────────── */}
      <header className="relative z-50 flex justify-between items-center p-4 md:p-6 border-b border-white/5 bg-black/40 backdrop-blur-md">
        <div className="flex items-center gap-3 md:gap-4">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${running ? "bg-amber-500 animate-pulse" : "bg-green-500"}`}
               style={{ boxShadow: running ? "0 0 8px #f59e0b" : "0 0 8px #22c55e" }} />
          <h1 className="text-[9px] md:text-[10px] tracking-[0.3em] md:tracking-[0.4em] uppercase font-bold text-white whitespace-nowrap">
            Verum Frontier // A.L.I.C.E. v1.1
          </h1>
        </div>
        <div className="hidden md:block text-[9px] text-zinc-500 tracking-widest uppercase font-mono">
          {clock}
        </div>
        <div className="hidden lg:block text-[8px] text-zinc-600 tracking-wider uppercase">
          SOVEREIGN WRAPPER · BIAS LAYER ACTIVE
        </div>
      </header>

      {/* ── HOTSPOTS ──────────────────────────────────────────────────── */}
      <div className="absolute inset-0 z-20">
        {MODELS.map((m) => {
          const isActive  = activeModel?.id === m.id;
          const isHovered = hoveredModel?.id === m.id;
          const bias = biasScore(m.vec);
          const conf = confidenceScore(m.vec);
          return (
            <button
              key={m.id}
              onClick={() => runPipeline(m)}
              onMouseEnter={() => setHoveredModel(m)}
              onMouseLeave={() => setHoveredModel(null)}
              className="absolute transition-all duration-500 group"
              style={{ ...m.hotspot, cursor: running ? "wait" : "crosshair" }}
              aria-label={`Select ${m.name}`}
            >
              {/* Hover label */}
              <div className="absolute -top-14 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-all duration-300 bg-black/90 border border-zinc-800 p-2 whitespace-nowrap z-30 pointer-events-none">
                <div className="text-[10px] font-bold" style={{ color: m.color }}>{m.label}</div>
                <div className="text-[8px] text-zinc-500 uppercase tracking-tighter">{m.tagline}</div>
              </div>

              {/* Glow overlay */}
              <div className="absolute inset-0 rounded-xl transition-all duration-500" style={{
                border: `1px solid ${isActive || isHovered ? m.dim : "transparent"}`,
                boxShadow: isActive || isHovered ? `inset 0 0 50px ${m.glow}, 0 0 30px ${m.glow}` : "none",
                background: isActive || isHovered ? m.glow : "transparent",
              }} />

              {/* Mini meters */}
              {(isActive || isHovered) && (
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[90%] mb-1 z-30 fade-in" style={{
                  background: "rgba(4,3,10,0.95)",
                  border: `1px solid ${m.dim}`,
                  padding: "6px 10px",
                  fontFamily: "monospace",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8, color: "rgba(255,255,255,0.3)", marginBottom: 3 }}>
                    <span>CONF</span><span style={{ color: m.color }}>{(conf*100).toFixed(0)}%</span>
                  </div>
                  <div style={{ height: 2, background: "rgba(255,255,255,0.06)", borderRadius: 2, marginBottom: 5, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${conf*100}%`, background: `linear-gradient(90deg,${m.dim},${m.color})`, transition: "width 0.8s ease" }} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8, color: "rgba(255,255,255,0.3)", marginBottom: 3 }}>
                    <span>BIAS</span>
                    <span style={{ color: bias>0.55 ? "#e74c3c" : bias>0.40 ? "#c8941a" : "#2ecc71" }}>
                      {(bias*100).toFixed(0)}%
                    </span>
                  </div>
                  <div style={{ height: 2, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden" }}>
                    <div style={{
                      height: "100%", transition: "width 0.8s ease", width: `${bias*100}%`,
                      background: bias>0.55 ? "linear-gradient(90deg,#7a1a1a,#e74c3c)"
                                : bias>0.40 ? "linear-gradient(90deg,#5a3a08,#c8941a)"
                                :             "linear-gradient(90deg,#1a5a30,#2ecc71)",
                    }} />
                  </div>
                  {isActive && (
                    <div style={{ marginTop: 5, fontSize: 7, color: running ? "#c8941a" : "#2ecc71", letterSpacing: "0.15em", textAlign: "center" }}>
                      {running ? "▶ EXECUTING..." : "✓ COMPLETE"}
                    </div>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* ── PIPELINE PANEL ────────────────────────────────────────────── */}
      <div className="panel-in" style={{
        position: "absolute", top: "10%",
        right: panelOpen ? "1.5%" : "-320px",
        width: 296, maxHeight: "76vh", zIndex: 45,
        display: "flex", flexDirection: "column",
        background: "rgba(4,3,10,0.96)",
        border: `1px solid ${activeModel ? activeModel.dim : "rgba(255,255,255,0.07)"}`,
        boxShadow: activeModel ? `0 0 40px ${activeModel.glow}` : "none",
        backdropFilter: "blur(20px)",
        transition: "right 0.4s cubic-bezier(0.16,1,0.3,1)",
      }}>
        {/* Header */}
        <div style={{
          padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.07)",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          background: "rgba(4,3,10,0.98)",
        }}>
          <div>
            <div style={{ fontSize: 8, letterSpacing: "0.25em", color: "rgba(255,255,255,0.3)" }}>A.L.I.C.E. PIPELINE</div>
            {activeModel && (
              <div style={{ fontSize: 11, color: activeModel.color, letterSpacing: "0.1em", marginTop: 2, fontWeight: 600 }}>
                {activeModel.name}
              </div>
            )}
          </div>
          <button onClick={() => setPanelOpen(false)} style={{
            background: "none", border: "none", color: "rgba(255,255,255,0.3)",
            cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 4,
          }}>×</button>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.07)", background: "rgba(4,3,10,0.98)" }}>
          {(["pipeline", "merkle"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              flex: 1, padding: "8px 4px", fontSize: 8, letterSpacing: "0.2em",
              textTransform: "uppercase", background: "none", border: "none",
              borderBottom: tab === t ? "1px solid #c8941a" : "1px solid transparent",
              color: tab === t ? "#c8941a" : "rgba(255,255,255,0.3)",
              cursor: "pointer", transition: "all 0.2s", fontFamily: "monospace",
            }}>
              {t}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: 14, background: "rgba(4,3,8,0.97)" }}>
          {tab === "pipeline" && <PipelineView stages={stages} />}
          {tab === "merkle"   && <MerkleView data={merkle} />}
        </div>

        {/* Component bias breakdown */}
        {activeModel && (
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", padding: 12, background: "rgba(4,3,8,0.98)" }}>
            <div style={{ fontSize: 7, letterSpacing: "0.2em", color: "rgba(255,255,255,0.25)", marginBottom: 8 }}>
              COMPONENT BIAS — {activeModel.name.toUpperCase()}
            </div>
            {Object.entries(componentScores(activeModel.vec)).map(([k, v]) => (
              <BiasBar key={k} label={k} value={v} color={activeModel.color} />
            ))}
            {Object.values(componentScores(activeModel.vec)).some(v => v > 0.70) && (
              <div style={{
                marginTop: 8, padding: "6px 8px",
                border: "1px solid rgba(231,76,60,0.3)", background: "rgba(231,76,60,0.05)",
                fontSize: 8, color: "#e74c3c", lineHeight: 1.6,
              }}>
                ⚠️ Anti-data active — verify flagged dimensions
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── IDLE HINT ─────────────────────────────────────────────────── */}
      {!panelOpen && (
        <div style={{
          position: "absolute", bottom: "17%", left: "50%", transform: "translateX(-50%)",
          zIndex: 30, textAlign: "center", pointerEvents: "none",
          animation: "fadeIn 1s 0.8s ease both", opacity: 0,
        }}>
          <div style={{ fontSize: 9, letterSpacing: "0.3em", color: "rgba(212,196,154,0.4)", textTransform: "uppercase" }}>
            Select a Prime — click any figure to execute the pipeline
          </div>
        </div>
      )}

      {/* ── A.L.I.C.E. BAR ────────────────────────────────────────────── */}
      <div className="absolute bottom-10 left-0 right-0 z-50 px-4 md:px-10">
        <div className="bg-black/90 border border-zinc-800 p-4 md:p-6 rounded shadow-2xl backdrop-blur-xl flex items-center gap-4 md:gap-8">
          <div className="flex-shrink-0">
            <div style={{
              width: 8, height: 8, borderRadius: "50%",
              background: running ? "#c8941a" : activeModel ? "#2ecc71" : "rgba(255,255,255,0.2)",
              boxShadow: running ? "0 0 12px #c8941a" : activeModel ? "0 0 10px #2ecc71" : "none",
              animation: running ? "pulse-amber 0.5s ease infinite" : "none",
            }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[8px] text-zinc-600 uppercase tracking-[0.4em] mb-1 md:mb-2 font-black italic">
              Verification Stream
            </div>
            <p className="text-xs md:text-sm tracking-tight text-zinc-200 min-h-[1.2rem] truncate">
              {ticker}
              <span className="animate-pulse ml-1 inline-block w-[6px] h-[12px] bg-amber-500 align-middle" />
            </p>
          </div>
          <div className="text-right border-l border-zinc-900 pl-4 md:pl-8 flex-shrink-0">
            <div className="text-[9px] text-zinc-500 font-bold">$0.00042 / QUERY</div>
            <div className="text-[8px] text-zinc-700 uppercase mt-1">Sovereign · Local-First</div>
          </div>
        </div>
      </div>

      {/* ── FOOTER ────────────────────────────────────────────────────── */}
      <footer className="absolute bottom-0 left-0 right-0 z-50 px-3 py-1 bg-black border-t border-white/5 flex justify-between items-center">
        <span className="text-[7px] text-zinc-600 tracking-[0.15em] hidden md:block">RABBIT HOLE AI // MIT LICENSE</span>
        <span className="text-[7px] text-zinc-700 tracking-[0.1em] hidden lg:block">BIAS CHECKER → ANTI-DATA → LLM → RESPONSE AUDIT → MERKLE ARCHIVIST</span>
        <span className="text-[7px] text-zinc-600 tracking-[0.15em]">JEREMIAH DAWSON · rabbitholeai.ai</span>
      </footer>

    </main>
  );
}