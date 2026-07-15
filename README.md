# Verum Frontier // A.L.I.C.E. v1.2 — LIVE GATE
### RHAI — Rabbit Hole AI | Sovereign Alignment & Audit Layer

Live at: **rabbitholeai.ai**

Two modes:
- **LIVE GATE (default)** — real multi-model chat. Four model families (Meta,
  OpenAI open-weights, Alibaba, Google) answer through the gate. Every response
  returns real token counts, a cost-plus receipt, and a SHA-256 Merkle seal
  that anyone can re-verify. Free tier: 5 queries/day, 1,024-token answers.
- **SIM DEMO** — the original cinematic pipeline concept demo, clearly labeled
  as simulated.

**Honesty contract:** nothing in LIVE GATE is simulated. The validated bias
gate is not wired yet and the UI says so — it is labeled, not faked.

---

## Environment variables (required for LIVE GATE)

Copy `.env.local.example` → `.env.local` for local dev. In production set the
same three in **Vercel → Project → Settings → Environment Variables**:

| Variable | Source |
|---|---|
| `GROQ_API_KEY` | console.groq.com (serves Llama 3.3 70B, GPT-OSS 120B, Qwen 3.6 27B) |
| `GEMINI_API_KEY` | aistudio.google.com (serves Gemini 2.5 Flash) |
| `QUOTA_SECRET` | any long random string — signs the free-tier quota cookie |
| `BIAS_ENDPOINT` | `https://rhai-financial.duckdns.org/bias` — validated BiasChecker v1 on RHAI infra |
| `BIAS_TOKEN` | on the droplet in `/opt/alice/app/.bias_env` — bearer token for `/score` |
| `SEAL_SIGNING_KEY` | Ed25519 private key (pkcs8 der, base64) — signs each Merkle root so exported sessions are origin-attestable. Fail-open: unset → seals ship unsigned and say so. Public key published via `GET /api/chat` |
| `STRIPE_SECRET_KEY` | dashboard.stripe.com — `sk_test_…` until the account is activated (UI labels TEST MODE) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | dashboard.stripe.com — `pk_test_…` counterpart |
| `CREDITS_ENDPOINT` | `https://rhai-financial.duckdns.org/credits` — RHAI Credits Ledger on .16 |
| `CREDITS_TOKEN` | on the droplet in `/opt/alice/app/.credits_env` — bearer token for wallet ops |

**Prepaid credits (cost-plus made concrete):** Buy $5/$10/$25 via Stripe
Checkout → the returned session id funds a wallet on the RHAI ledger
(idempotent: one session, one wallet, token issued exactly once, stored only
in the buyer's browser). Each paid answer debits its exact cost-plus total
(micro-USD integers, rounded up — we never undercharge) and the receipt shows
`CHARGED … — CREDITS` plus the live balance. Wallet credentials are verified
against the ledger *before* the model call, so fake wallets can't bypass the
free tier; ledger failures never bill the visitor (answer ships uncharged,
honestly labeled). Every claim and debit is appended to a hash-chained audit
log, publicly verifiable at `CREDITS_ENDPOINT/verify` (hashes only — no
balances, no identities).

**Memory architecture:** the context window is working memory; the visitor's
sealed archive is long-term memory. Every exchange joins a browser-local
memory store (`vf_memory_v1`, capped 300, user-erasable). On each query the
client recalls up to 3 relevant older exchanges by keyword overlap and sends
them with the request; the server verifies each one's Ed25519 seal signature
(verified/legacy-unsigned injected and labeled, failed signatures REJECTED),
injects them as cited context, and seals the recall as a MEMORY Merkle leaf.
Only the last 2 exchanges ride along as raw history — receipts shrink because
the archive does the remembering.

Without the first three, live queries return errors. Without the bias pair the
gate still works — the bias screen fails open and answers are labeled unscreened.

**Bias screen honesty:** dual-head triage (toxicity AUROC 0.924 ± 0.007 5-fold on
civil_comments; media/framing 0.842 on the BABE official split — held-out, this
build, metadata served at `BIAS_ENDPOINT/health`). It labels answers with
percentiles vs its training distribution; it never filters or blocks. It is not
a truth, accuracy, or hallucination detector, and the UI says so.

**Session archive:** conversations persist in the visitor's own browser
(localStorage) and can be resumed after refresh — still no server database.

---

## Cost-plus receipt (per VERUM_FRONTIER_BRAIN)

```
DIRECT API COST        real tokens × published provider rates
INFRASTRUCTURE (5%)
PROJECT SUPPORT (15%)  server 30% / development 40% / steward 20% / reserve 10%
──────────────────────
YOUR COST              (charged $0.00 on the free tier)
```

Provider rates pinned in `lib/pricing.ts` (`PRICE_SHEET_DATE`) — re-verify and
bump the date when providers change prices.

---

## Deploy to Vercel

1. Set the three env vars in Vercel first (above)
2. `git push` — Vercel builds and deploys automatically
3. Custom domain rabbitholeai.ai in Project Settings → Domains

## Local Development
```bash
npm install
npm run dev
# → http://localhost:3000
```

---

## Project Structure
```
verum-frontier/
├── app/
│   ├── api/chat/route.ts  # The real gate: Groq + Gemini calls, receipts,
│   │                      #   SHA-256 seals, free-tier quota (429 past 5/day)
│   ├── layout.tsx         # Root layout, fonts, metadata
│   ├── page.tsx           # Home route
│   └── globals.css        # Tailwind + keyframes
├── components/
│   ├── VerumFrontier.tsx  # Mode toggle + SIM DEMO (labeled simulated)
│   └── LiveGate.tsx       # LIVE GATE chat: thread, receipts, seals,
│                          #   session chain + sealed-session JSON download
├── lib/
│   ├── pricing.ts         # Model registry, price sheet, cost-plus receipt
│   └── quota.ts           # HMAC-signed cookie quota (5 free/day)
└── public/rabbitholeai-verum_frontier.png
```

## Verifying a sealed session

Download the session JSON from the LIVE GATE side panel. Leaves are SHA-256
digests computed server-side; the Merkle root pairs leaves left-to-right
(duplicating the last when odd) hashing hex-string concatenations; the session
chain is `SHA-256(prevChainHash + seal.root)` with genesis
`SHA-256('VERUM_FRONTIER_SESSION_GENESIS' + startedAt)`. Any SHA-256 tool
can re-verify — no trust required.

MIT License | github.com/uu2142-dev | Jeremiah Dawson
