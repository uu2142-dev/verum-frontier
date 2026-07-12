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
| `GROQ_API_KEY` | console.groq.com (serves Llama 3.3 70B, GPT-OSS 120B, Qwen3 32B) |
| `GEMINI_API_KEY` | aistudio.google.com (serves Gemini 2.5 Flash) |
| `QUOTA_SECRET` | any long random string — signs the free-tier quota cookie |

Without these, the site renders but live queries return errors.

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
