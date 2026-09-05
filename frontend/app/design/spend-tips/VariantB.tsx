"use client";

// Variant B — summary card door. Rows stay plain ("{n} payments" only);
// every open tip lives in one "Ways to save" card under the list, with a
// reconciled total and a link on to Patterns. See SpendTipsClient.tsx for
// the full brief and annotation copy.

import { MajoritySection, NotableShoppingCard, MoneyMovedBar, WaysToSaveCard } from "./shared";
import { OPEN_TIPS, type MajorityRowFixture } from "./fixtures";
import type { SavingsInsight } from "@/lib/api";

export default function VariantB({
  onOpenCategory,
  onOpenTip,
}: {
  onOpenCategory: (category: string) => void;
  onOpenTip: (tip: SavingsInsight) => void;
}) {
  return (
    <>
      <NotableShoppingCard />
      <MajoritySection
        sublineFor={(row: MajorityRowFixture) => `${row.payments_count} payment${row.payments_count === 1 ? "" : "s"}`}
        onOpenCategory={onOpenCategory}
      />
      <WaysToSaveCard tips={OPEN_TIPS} onOpenTip={onOpenTip} />
      <MoneyMovedBar />
    </>
  );
}
