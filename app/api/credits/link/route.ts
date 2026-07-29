// POST /api/credits/link — adopt an existing wallet on a second device.
//
// Credits were never trapped on one machine: the balance lives in the ledger,
// server-side. What is device-local is only the CREDENTIAL — the {id, token}
// pair in localStorage — and the token is issued exactly once at claim time,
// so a second device had no way to reach a wallet the user already owned.
//
// This route mints nothing and moves no money. It confirms an {id, token} pair
// is real and returns that wallet's balance, so the second device can store the
// credential it was handed. Anyone holding the pair can already spend the
// balance by calling the gate directly; this adds no authority beyond that.
import { NextResponse } from "next/server";
import { walletBalance } from "@/lib/ledger";

export const runtime = "nodejs";
export const maxDuration = 20;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const b = body as { id?: unknown; token?: unknown } | null;
  const id = typeof b?.id === "string" ? b.id.trim() : "";
  const token = typeof b?.token === "string" ? b.token.trim() : "";
  if (!id || !token) {
    return NextResponse.json({ error: "Link code is incomplete." }, { status: 400 });
  }

  const r = await walletBalance(id, token);
  if (r.status === 0) {
    // Distinguish "we couldn't ask" from "the answer was no" — telling a user
    // their code is bad when the ledger is simply down would be a lie.
    return NextResponse.json({ error: "Credits ledger unreachable — try again shortly." }, { status: 502 });
  }
  if (!r.ok || !r.data) {
    // One response for both "no such wallet" and "wrong token": a link endpoint
    // must not confirm which wallet ids exist.
    return NextResponse.json({ error: "That link code was not accepted." }, { status: 401 });
  }
  return NextResponse.json({ walletId: r.data.wallet_id, balanceUsd: r.data.balance_usd });
}
