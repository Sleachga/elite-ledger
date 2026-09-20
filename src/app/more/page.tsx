import type { Metadata } from "next";
import { ComingSoon } from "@/components/ComingSoon";

export const metadata: Metadata = { title: "More" };

export default function MorePage() {
  return <ComingSoon title="More" />;
}
