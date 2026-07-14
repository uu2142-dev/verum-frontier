import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://rabbitholeai.ai"),
  title: "Verum Frontier // A.L.I.C.E. v1.2 — LIVE GATE",
  description:
    "RHAI / A.L.I.C.E. — Sovereign alignment and audit layer for frontier AI. " +
    "Bias-checked inference, anti-data generation, Merkle-sealed audit trail.",
  openGraph: {
    title: "Verum Frontier // A.L.I.C.E. v1.2 — LIVE GATE",
    description: "Sovereign AI wrapper — bias checking, Merkle audit trail, model-agnostic.",
    url: "https://rabbitholeai.ai",
    siteName: "Rabbit Hole AI",
    images: [{ url: "/og.png", width: 1200, height: 630 }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Verum Frontier // A.L.I.C.E. v1.2 — LIVE GATE",
    description: "Sovereign AI wrapper — bias checking, Merkle audit trail, model-agnostic.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Rajdhani:wght@300;500;700&family=Cormorant+Garamond:ital,wght@1,300;1,500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}

