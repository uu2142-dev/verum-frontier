// ── Stripe via plain fetch (no SDK dependency, like the rest of the gate) ──
// Test mode until the RHAI Stripe account is activated; the UI labels it.

const STRIPE_API = "https://api.stripe.com/v1";

function stripeKey(): string | null {
  return process.env.STRIPE_SECRET_KEY ?? null;
}

export function stripeConfigured(): boolean {
  return !!stripeKey();
}

export function stripeTestMode(): boolean {
  return (stripeKey() ?? "").startsWith("sk_test_");
}

async function stripeFetch(
  path: string,
  init?: { method?: string; form?: Record<string, string> },
) {
  const key = stripeKey();
  if (!key) throw new Error("Stripe is not configured.");
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      ...(init?.form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: init?.form ? new URLSearchParams(init.form).toString() : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Stripe ${res.status}: ${data?.error?.message ?? "error"}`);
  return data;
}

export const CREDIT_PACKS_USD = [5, 10, 25] as const;

export async function createCreditsCheckout(amountUsd: number, origin: string) {
  return stripeFetch("/checkout/sessions", {
    method: "POST",
    form: {
      mode: "payment",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][product_data][name]":
        `Verum Frontier prepaid credits — $${amountUsd} (cost-plus per query)`,
      "line_items[0][price_data][unit_amount]": String(amountUsd * 100),
      "line_items[0][quantity]": "1",
      success_url: `${origin}/?credit_session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/`,
    },
  });
}

export async function retrieveCheckoutSession(id: string) {
  return stripeFetch(`/checkout/sessions/${encodeURIComponent(id)}`);
}
