import type { Metadata } from "next";
import { ComingSoon } from "@/components/ComingSoon";

export const metadata: Metadata = { title: "Ledger" };

export default function LedgerPage() {
  return <ComingSoon title="Ledger" />;
}
