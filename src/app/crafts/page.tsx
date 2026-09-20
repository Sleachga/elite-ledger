import type { Metadata } from "next";
import { ComingSoon } from "@/components/ComingSoon";

export const metadata: Metadata = { title: "Crafts" };

export default function CraftsPage() {
  return <ComingSoon title="Crafts" />;
}
