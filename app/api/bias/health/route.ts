// GET /api/bias/health — passthrough to the RHAI BiasChecker's own health
// endpoint, so the public can read the deployed model's held-out validation
// metrics (AUROC, build date, honest scope) from our own domain. The numbers
// come from the model build's metadata — a report card, not a marketing page.
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 15;

export async function GET() {
  const endpoint = process.env.BIAS_ENDPOINT;
  if (!endpoint) {
    return NextResponse.json({ error: "Bias service not configured." }, { status: 503 });
  }
  try {
    const res = await fetch(`${endpoint}/health`, {
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "Bias service unreachable." }, { status: 502 });
  }
}
