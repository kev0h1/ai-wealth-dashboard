"use client";

import { useRouter } from "next/navigation";
import PaydayPlanCard from "@/components/PaydayPlanCard";
import type { CompanionItem } from "@/lib/api";
import { PreviewHeading } from "./shared";

/**
 * "Today", the real production PaydayPlanCard.tsx, fed Kevin's real
 * 2026-09-18 payload through its actual props. This is what makes the
 * round honest: it is literally what Kevin is looking at on his phone, not
 * a description of it. No markup is reimplemented here.
 */
export default function Baseline({ item }: { item: CompanionItem }) {
  const router = useRouter();
  return (
    <section aria-label="Today, the production card">
      <PreviewHeading
        title="Today"
        copy="The real PaydayPlanCard.tsx component, unmodified, fed Kevin's real payload. The hero total and the payday split line below come from two disjoint datasets but both say &ldquo;moves&rdquo;, which is the root of the confusion this round fixes."
      />
      <PaydayPlanCard item={item} router={router} hideNetWorth={false} maskAmounts={(text) => text} />
    </section>
  );
}
