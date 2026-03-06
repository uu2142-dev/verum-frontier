# Verum Frontier // A.L.I.C.E. v1.1
### RHAI — Rabbit Hole AI | Sovereign Alignment & Audit Layer

Live at: **rabbitholeai.ai**

---

## Deploy to Vercel in 5 minutes

### Option A — GitHub (recommended)
1. Push this folder to a GitHub repo
2. Go to vercel.com → New Project → Import your repo
3. Vercel auto-detects Next.js — click Deploy
4. Add custom domain: rabbitholeai.ai in Project Settings → Domains

### Option B — Vercel CLI
```bash
npm install -g vercel
cd verum-frontier
vercel --prod
```

---

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
│   ├── layout.tsx        # Root layout, fonts, metadata
│   ├── page.tsx          # Home route
│   └── globals.css       # Tailwind + keyframes
├── components/
│   └── VerumFrontier.tsx # Main component — all logic here
├── public/
│   └── rabbitholeai-verum_frontier.png  # Background image
├── next.config.js
├── tailwind.config.ts
└── vercel.json
```

---

## Architecture
RHAI / A.L.I.C.E. — Alignment Layer for Inference-time Cryptographic Evaluation

Pipeline: Intent Firewall → Bias Checker → Anti-Data Generator →
          Prompt Structuring → LLM Call → Response Audit → Merkle Seal

MIT License | github.com/uu2142-dev | Jeremiah Dawson
