// ── Display-only reading aid for /verify ────────────────────────────────────
//
// Given a model's sealed RESPONSE text, this flags spans that look like agentic
// tool-loop "working notes" — the model narrating between web searches ("let me
// retry with simpler terms", "the tool returns a JSON string") — so a reader can
// tell them apart from the actual answer.
//
// THIS IS A HEURISTIC FOR DISPLAY ONLY. It hashes nothing, changes no seal, and
// removes no text. On /verify the full response is always shown verbatim and the
// leaf hash still covers every character; these spans are merely de-emphasized.
//
// It is deliberately CONSERVATIVE: it would rather miss narration than dim a
// sentence of the real answer, because calling the model's reasoning "plumbing"
// would be its own mis-attribution — the same failure, one level up, that this
// product exists to expose. When unsure, a sentence stays bright.

export type Segment = { text: string; note: boolean };

// Sentence-level markers of agentic tool-loop scaffolding. Each must be specific
// to *operating the tools*, never generic reasoning or answer content.
const PROCESS_MARKERS: RegExp[] = [
  /\blet me (retry|re-?run|try again|search|re-?search|pull|fetch|grab|look up|query|parse|cross-?check|dig|compile|nail down)\b/i,
  /\bthe (search(es)?|tool|query|request)s? (returned|came back|gave|yields?|returns?)\b/i,
  /\bno results (this round|this time|again|yet)\b/i,
  /\b(parsing works|parse it correctly|let me parse)\b/i,
  /\b(now |then )?compil(e|ing)\b[^.?!]{0,40}\b(timeline|results?|answer|report|findings?)\b/i,
  /\bi'?ll (now )?(retry|re-?run|search|pull|parse|compile|cross-?check|look up)\b/i,
];

// Split into sentence-ish fragments. A model in a tool loop often runs sentences
// together with no space after the period ("...dates.The searches..."), so we
// split *after* any . ! ? and keep the delimiter attached. The digit guard keeps
// decimals and dated numbers ("$1.5B", "80.5") from splitting mid-token.
function splitSentences(text: string): string[] {
  const out: string[] = [];
  let buf = "";
  for (let i = 0; i < text.length; i++) {
    buf += text[i];
    if (/[.!?]/.test(text[i])) {
      const next = text[i + 1];
      if (!next || !/\d/.test(next)) { out.push(buf); buf = ""; }
    }
  }
  if (buf) out.push(buf);
  return out;
}

// Break the response into ordered segments, each flagged as narration (`note`)
// or not. Consecutive same-kind sentences are coalesced so rendering stays cheap
// and the original spacing is preserved exactly (nothing is added or dropped).
export function segmentResponse(text: string): Segment[] {
  if (!text) return [];
  const segs: Segment[] = [];
  for (const s of splitSentences(text)) {
    const note = PROCESS_MARKERS.some(re => re.test(s));
    const last = segs[segs.length - 1];
    if (last && last.note === note) last.text += s;
    else segs.push({ text: s, note });
  }
  return segs;
}

// True when the response appears to contain any tool-loop working-notes.
export function hasProcessNarration(text: string): boolean {
  return !!text && PROCESS_MARKERS.some(re => re.test(text));
}
