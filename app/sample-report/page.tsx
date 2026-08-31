import type { Metadata } from "next";
import SampleReportClient from "./SampleReportClient";

export const metadata: Metadata = {
  title: "Sample Findings Memo — Rabbit Hole AI",
  description:
    "A complete sample of the written findings memo delivered after the 90-minute reconstructability review — built from a fully synthetic incident so you can see exactly what you get before you book.",
};

export default function SampleReportPage() {
  return <SampleReportClient />;
}
