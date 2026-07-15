// POST /api/credits/claim — after Stripe checkout, the visitor returns with
// a session id. We retrieve the session from Stripe with the SECRET key
// (unforgeable), require payment_status "paid", then fund a wallet on the
// RHAI ledger. Claims are idempotent: one checkout session = one wallet,
// and the wallet token is only issued on the FIRST claim.
import { NextResponse } from "next/server";
import { retrieveCheckoutSession, stripeConfigured, stripeTestMode } from "@/lib/stripe";
import { claimWallet } from "@/lib/ledger";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  if (!stripeConfigured()) {
    return NextResponse.json({ error: "Payments are not configured yet." }, { status: 503 });
  }
  let body: { sessionId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const sessionId = (body.sessionId ?? "").trim();
  if (!/^cs_[a-zA-Z0-9_]{8,}$/.test(sessionId)) {
    return NextResponse.json({ error: "Invalid session id." }, { status: 400 });
  }
  let session: { payment_status?: string; amount_total?: number; currency?: string };
  try {
    session = await retrieveCheckoutSession(sessionId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not retrieve checkout session.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
  if (session.payment_status !== "paid") {
    return NextResponse.json({ error: "Checkout session is not paid." }, { status: 402 });
  }
  if (session.currency !== "usd" || !session.amount_total || session.amount_total < 100) {
    return NextResponse.json({ error: "Unexpected session amount." }, { status: 400 });
  }
  const amountUsd = session.amount_total / 100;
  const r = await claimWallet(sessionId, amountUsd);
  if (!r.ok || !r.data) {
    return NextResponse.json({ error: r.error ?? "Ledger unavailable — your payment is safe; retry claiming shortly." }, { status: 503 });
  }
  return NextResponse.json({
    walletId: r.data.wallet_id,
    walletToken: r.data.wallet_token ?? null, // null on re-claims — token is issued exactly once
    balanceUsd: r.data.balance_usd,
    alreadyClaimed: r.data.already_claimed,
    testMode: stripeTestMode(),
  });
}
