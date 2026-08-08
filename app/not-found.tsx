import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Not found — Verum Frontier",
};

// An unknown route used to fall through to Next's default black-on-white 404,
// which drops the visitor out of the site's visual language entirely and offers
// no way back. Links point only at routes that actually exist — a 404 that
// links to more 404s is worse than the default one.
const link = {
  color: "#c8941a",
  fontSize: 12,
  letterSpacing: "0.12em",
  textDecoration: "underline",
} as const;

export default function NotFound() {
  return (
    <main className="min-h-screen bg-black font-mono" style={{ padding: "48px 24px" }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <Link href="/" style={{ fontSize: 10, letterSpacing: "0.25em", color: "rgba(255,255,255,0.45)" }}>
          ← VERUM FRONTIER
        </Link>

        <h1 style={{ color: "#fff", fontSize: 18, letterSpacing: "0.2em", margin: "18px 0 4px", textTransform: "uppercase" }}>
          404 · No such route
        </h1>
        <p style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em" }}>
          THE GATE IS STILL RUNNING — THIS ADDRESS JUST ISN&apos;T ONE OF ITS DOORS
        </p>

        <p style={{ color: "rgba(255,255,255,0.7)", fontSize: 13, lineHeight: 1.9, margin: "28px 0 12px" }}>
          Nothing is served at this path. If you followed a link expecting a
          verification page, note that sealed sessions are verified from the JSON
          you download. You can check one on the verify page below, or with any
          SHA-256 tool — every exchange ships with its own hashes, Ed25519
          signature, and the exact steps to recompute them, so verification does
          not depend on this site staying up.
        </p>

        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 24 }}>
          <Link href="/" style={link}>THE GATE</Link>
          <Link href="/verify" style={link}>VERIFY A SESSION</Link>
          <Link href="/terms" style={link}>TERMS</Link>
          <Link href="/privacy" style={link}>PRIVACY</Link>
          <a href="https://github.com/uu2142-dev/alice-evidence" style={link} target="_blank" rel="noopener noreferrer">
            REFERENCE VERIFIER ↗
          </a>
        </div>
      </div>
    </main>
  );
}
