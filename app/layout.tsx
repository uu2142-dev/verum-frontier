import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.rabbitholeai.ai"),
  icons: { icon: "/rhai-logo.png", apple: "/rhai-logo.png" },
  title: "Rabbit Hole AI — Agent Record Audit",
  description:
    "If one of your AI agents harmed a third party tomorrow, could you prove what it did? " +
    "Fixed-fee reconstructability reviews for autonomous systems, a free 8-question self-check, " +
    "and a live gate where every answer ships with a receipt and a signed, recomputable seal.",
  openGraph: {
    title: "Rabbit Hole AI — Agent Record Audit",
    description:
      "Could you prove what your AI agent did — and that the record wasn't altered afterward? Fixed-fee reconstructability reviews, free self-check, verify-it-yourself seals.",
    url: "https://www.rabbitholeai.ai",
    siteName: "Rabbit Hole AI",
    images: [{ url: "/og.jpg", width: 1200, height: 630 }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Rabbit Hole AI — Agent Record Audit",
    description:
      "Could you prove what your AI agent did — and that the record wasn't altered afterward? Fixed-fee reconstructability reviews, free self-check, verify-it-yourself seals.",
    images: ["/og.jpg"],
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

