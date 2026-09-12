// POST /api/wow/gearplan — server-side passthrough to the ALICE Verum WoW
// service (deterministic gear planner). The browser posts a /alice export
// string; we relay it to the service and return its plan. Server-side so the
// backend URL and any headers stay off the client, matching /api/bias and
// /api/chat. Everything returned is real and deterministic — no model in the
// loop, no payment, no council. Read-only on the service (no chain write).
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const WOW_ENDPOINT = process.env.WOW_ENDPOINT || "https://rhai-financial.duckdns.org";
const MAX_EXPORT_CHARS = 120_000;

export async function POST(req: Request) {
  let body: { export?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send JSON: { export: \"ALICEVERUM1...\" }" }, { status: 400 });
  }
  const exp = (body.export || "").trim();
  if (!exp) {
    return NextResponse.json({ error: "Paste your /alice export string first." }, { status: 400 });
  }
  if (exp.length > MAX_EXPORT_CHARS) {
    return NextResponse.json({ error: "That export string is too large." }, { status: 413 });
  }
  if (!exp.startsWith("ALICEVERUM1")) {
    return NextResponse.json(
      { error: "That doesn't look like an ALICE Verum export. In game: /alice export, then copy the whole string." },
      { status: 400 },
    );
  }
  try {
    const res = await fetch(`${WOW_ENDPOINT}/wow/gearplan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ export: exp }),
      signal: AbortSignal.timeout(25_000),
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({ error: "The service returned an unreadable response." }));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "The gear service is unreachable right now — try again shortly." }, { status: 502 });
  }
}
