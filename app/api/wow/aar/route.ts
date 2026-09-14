// POST /api/wow/aar — server-side passthrough to the ALICE Verum WoW service's
// After Action Report. The browser posts a WoWCombatLog.txt segment; we relay it
// and return the sealed "truth" (facts from the log) + cited "what could help".
// Server-side so the backend URL stays off the client, matching the other /wow
// proxies. Post-hoc only — nothing here is a live/in-combat read.
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60; // an opt-in council debrief can take a little longer

const WOW_ENDPOINT = process.env.WOW_ENDPOINT || "https://rhai-financial.duckdns.org";
const MAX_AAR_CHARS = 3_000_000;

export async function POST(req: Request) {
  let body: { log?: string; council?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send JSON: { log: \"...combat log...\" }" }, { status: 400 });
  }
  const log = (body.log || "").trim();
  if (log.length < 32) {
    return NextResponse.json(
      { error: "Paste a combat-log segment that includes a boss pull (an ENCOUNTER_START / ENCOUNTER_END)." },
      { status: 400 },
    );
  }
  if (log.length > MAX_AAR_CHARS) {
    return NextResponse.json(
      { error: "That log is too large — paste just the pull, or a trimmed segment (last ~3 MB)." },
      { status: 413 },
    );
  }
  try {
    const res = await fetch(`${WOW_ENDPOINT}/wow/aar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ log, council: !!body.council }),
      signal: AbortSignal.timeout(55_000),
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({ error: "The service returned an unreadable response." }));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "The After Action Report service is unreachable right now — try again shortly." }, { status: 502 });
  }
}
