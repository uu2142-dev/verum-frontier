// POST /api/wow/feedback — server-side passthrough for tester suggestions.
// The service screens each one (prompt-injection + validated toxicity model when
// configured) and seals it to a tamper-evident feedback chain; the council
// reviews the batch on demand. Nothing here is a model call the visitor pays for.
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 20;

const WOW_ENDPOINT = process.env.WOW_ENDPOINT || "https://rhai-financial.duckdns.org";

export async function POST(req: Request) {
  let body: { text?: string; handle?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send JSON: { text: \"...\" }" }, { status: 400 });
  }
  const text = (body.text || "").trim();
  if (text.length < 6) {
    return NextResponse.json({ error: "Say a little more so it's useful." }, { status: 400 });
  }
  if (text.length > 4000) {
    return NextResponse.json({ error: "That's longer than the box allows (4000 characters)." }, { status: 413 });
  }
  try {
    const res = await fetch(`${WOW_ENDPOINT}/wow/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, handle: (body.handle || "").trim().slice(0, 40) || undefined }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({ error: "The service returned an unreadable response." }));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "Couldn't reach the feedback service — try again shortly." }, { status: 502 });
  }
}
