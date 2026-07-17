// GET /api/credits/verify — passthrough to the RHAI Credits Ledger's public
// chain verification (hashes only — no balances, no identities). Anyone can
// confirm the payment audit chain is intact from our own domain.
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 15;

export async function GET() {
  const endpoint = process.env.CREDITS_ENDPOINT;
  if (!endpoint) {
    return NextResponse.json({ error: "Credits ledger not configured." }, { status: 503 });
  }
  try {
    const res = await fetch(`${endpoint}/verify`, {
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "Credits ledger unreachable." }, { status: 502 });
  }
}
