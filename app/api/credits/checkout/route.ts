// POST /api/credits/checkout — create a Stripe Checkout Session for a
// credit pack. Returns the hosted checkout URL; the visitor pays there and
// returns with ?credit_session={CHECKOUT_SESSION_ID} for /api/credits/claim.
import { NextResponse } from "next/server";
import { CREDIT_PACKS_USD, createCreditsCheckout, stripeConfigured, stripeTestMode } from "@/lib/stripe";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  if (!stripeConfigured()) {
    return NextResponse.json({ error: "Payments are not configured yet." }, { status: 503 });
  }
  let body: { amountUsd?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const amount = Number(body.amountUsd);
  if (!CREDIT_PACKS_USD.includes(amount as (typeof CREDIT_PACKS_USD)[number])) {
    return NextResponse.json({ error: `Amount must be one of: ${CREDIT_PACKS_USD.join(", ")} USD.` }, { status: 400 });
  }
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "www.rabbitholeai.ai";
  const proto = req.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  try {
    const session = await createCreditsCheckout(amount, `${proto}://${host}`);
    return NextResponse.json({ url: session.url, testMode: stripeTestMode() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Checkout creation failed.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
