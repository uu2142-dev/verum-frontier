import type { Metadata } from "next";
import VerumFrontier from "@/components/VerumFrontier";

export const metadata: Metadata = {
  title: "Live Gate — Rabbit Hole AI",
  description:
    "The running instrument behind the Agent Record Audit: a metered multi-model gate where every answer ships with a cost-plus receipt, a bias screen, and an Ed25519-signed Merkle seal you can recompute yourself.",
};

export default function GatePage() {
  return <VerumFrontier />;
}
