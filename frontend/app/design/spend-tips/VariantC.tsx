"use client";

// Variant C — both. A's subline signifier plus B's "Ways to save" card. See
// SpendTipsClient.tsx for the full brief and annotation copy.

import { MajoritySection, NotableShoppingCard, MoneyMovedBar, WaysToSaveCard } from "./shared";
import { OPEN_TIPS, tipsFor, type MajorityRowFixture } from "./fixtures";
import { tipSubline } from "@/lib/spendTips";
import type { SavingsInsight } from "@/lib/api";

// Same full-subline builder as VariantA.tsx — see that file's comment.
function sublineFor(row: MajorityRowFixture): string {
  const base = `${row.payments_count} payment${row.payments_count === 1 ? "" : "s"}`;
  const suffix = tipSubline(tipsFor(row.category));
  return suffix ? `${base} · ${suffix}` : base;
}

export default function VariantC({
  onOpenCategory,
  onOpenTip,
}: {
  onOpenCategory: (category: string) => void;
  onOpenTip: (tip: SavingsInsight) => void;
}) {
  return (
    <>
      <NotableShoppingCard />
      <MajoritySection sublineFor={sublineFor} onOpenCategory={onOpenCategory} />
      <WaysToSaveCard tips={OPEN_TIPS} onOpenTip={onOpenTip} />
      <MoneyMovedBar />
    </>
  );
}
