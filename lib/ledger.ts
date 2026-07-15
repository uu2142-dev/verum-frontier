// ── Client for the RHAI Credits Ledger on .16 ───────────────────────────
// The wallet ledger is RHAI-owned infrastructure: SQLite balances in
// micro-USD plus an append-only hash-chained audit log (publicly verifiable
// at CREDITS_ENDPOINT/verify — hashes only, no balances or identities).

interface LedgerResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
}

async function ledgerFetch<T>(path: string, body: unknown): Promise<LedgerResult<T>> {
  const endpoint = process.env.CREDITS_ENDPOINT;
  const token = process.env.CREDITS_TOKEN;
  if (!endpoint || !token) return { ok: false, status: 0, error: "ledger not configured", data: null };
  try {
    const res = await fetch(`${endpoint}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data, error: res.ok ? undefined : (data?.detail ?? `ledger ${res.status}`) };
  } catch {
    return { ok: false, status: 0, error: "ledger unreachable", data: null };
  }
}

export function claimWallet(checkoutSessionId: string, amountUsd: number) {
  return ledgerFetch<{ wallet_id: string; wallet_token?: string; balance_usd: number; already_claimed: boolean }>(
    "/wallet/claim", { checkout_session_id: checkoutSessionId, amount_usd: amountUsd });
}

export function debitWallet(walletId: string, walletToken: string, amountUsd: number, memo: string) {
  return ledgerFetch<{ wallet_id: string; debited_usd: number; balance_usd: number }>(
    "/wallet/debit", { wallet_id: walletId, wallet_token: walletToken, amount_usd: amountUsd, memo });
}

export function walletBalance(walletId: string, walletToken: string) {
  return ledgerFetch<{ wallet_id: string; balance_usd: number }>(
    "/wallet/balance", { wallet_id: walletId, wallet_token: walletToken });
}
