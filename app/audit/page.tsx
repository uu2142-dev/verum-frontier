import type { Metadata } from "next";
import AuditClient from "./AuditClient";

export const metadata: Metadata = {
  title: "Agent Record Audit — Verum Frontier",
  description:
    "Forensic record and provenance verification for autonomous systems. Run the free Eight-Questions self-check to see where your evidentiary chain breaks, then request a scoping conversation.",
};

export default function AuditPage() {
  return <AuditClient />;
}
