import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Note — Verum Frontier",
};

const S = {
  h2: { color: "#c8941a", letterSpacing: "0.15em", fontSize: 12, textTransform: "uppercase" as const, margin: "28px 0 10px" },
  p:  { color: "rgba(255,255,255,0.7)", fontSize: 13, lineHeight: 1.9, marginBottom: 12 },
};

export default function Privacy() {
  return (
    <main className="min-h-screen bg-black font-mono" style={{ padding: "48px 24px" }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <Link href="/" style={{ fontSize: 9, letterSpacing: "0.25em", color: "rgba(255,255,255,0.4)" }}>
          ← VERUM FRONTIER
        </Link>
        <h1 style={{ color: "#fff", fontSize: 18, letterSpacing: "0.2em", margin: "18px 0 4px", textTransform: "uppercase" }}>
          Privacy Note
        </h1>
        <p style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", letterSpacing: "0.1em" }}>
          PLAIN-LANGUAGE POLICY · EFFECTIVE JULY 2026 · WILL BE FORMALIZED BEFORE ANY PAID LAUNCH
        </p>

        <h2 style={S.h2}>What we don&apos;t do</h2>
        <p style={S.p}>
          No accounts. No ad trackers. No analytics scripts. We do not store your
          conversations on our servers — there is no database behind this site. We do
          not sell data.
        </p>

        <h2 style={S.h2}>What actually happens to a query</h2>
        <p style={S.p}>
          When you send a live query, it goes from your browser to our serverless
          function, which forwards it to the model provider you selected — Groq, Inc.,
          Google, Anthropic, OpenAI, or xAI. Providers process it under their own
          policies. If you attach text or a document, it travels the same path — to
          the provider, for that one answer only — and is sealed by hash into the
          exchange record; we store neither the query nor the attachment. Sealed
          memories the gate recalls for a turn are sent along with it, because that
          is how the model reads them. With GROUND IT on, your query is also used to
          run web searches, either by that provider or through Google Search.
        </p>
        <p style={S.p}>
          One more hop worth naming: the answer text (not your query) is sent to our
          own bias-screening service, running on RHAI infrastructure, to produce the
          toxicity and framing percentiles shown under each answer. It is not sent to
          any third party, and nothing is stored there. If that service is
          unreachable the answer still ships, labeled as unscreened. The receipt
          and SHA-256 seal are computed in the moment and returned to you; we keep no
          copy. The sealed-session JSON download is generated in your browser and
          never uploaded anywhere.
        </p>

        <h2 style={S.h2}>The one cookie</h2>
        <p style={S.p}>
          A single signed cookie counts your free-tier queries for the day (a number
          and a date — nothing else). It expires within 48 hours. That&apos;s the only
          cookie we set.
        </p>

        <h2 style={S.h2}>Payments</h2>
        <p style={S.p}>
          Credit purchases are processed by Stripe on their own pages — we never see
          your card number. Stripe handles your payment details under its own privacy
          policy. On our side, the credits ledger stores an anonymous wallet id, a
          balance, and a hash-chained audit log of amounts — no names, no emails, no
          card data. Your wallet token exists only in your browser.
        </p>

        <h2 style={S.h2}>Hosting logs</h2>
        <p style={S.p}>
          The site runs on Vercel, whose infrastructure keeps standard operational logs
          (such as IP addresses and request timing) for a limited period, as with
          virtually every website. We don&apos;t use these to identify you.
        </p>

        <h2 style={S.h2}>Practical advice</h2>
        <p style={S.p}>
          Don&apos;t paste passwords, keys, or sensitive personal information into any AI
          chat — this one included. The gate shows you what a query costs and seals
          what was said; it cannot un-send what you type.
        </p>

        <h2 style={S.h2}>Contact</h2>
        <p style={S.p}>
          Rabbit Hole AI — Jeremiah Dawson ·{" "}
          <a href="mailto:jtdawson015@gmail.com" style={{ color: "#c8941a" }}>jtdawson015@gmail.com</a>.
          See also the <Link href="/terms" style={{ color: "#c8941a" }}>Terms of Use</Link>.
        </p>
      </div>
    </main>
  );
}
