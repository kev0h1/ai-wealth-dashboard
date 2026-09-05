"use client";

// Variant A — signifier in the subline. Rows only: no extra card, no
// summary anywhere. A category carrying an open tip says so in its own
// subline (count + estimate); the tip itself waits behind a one-line row
// under the filter chips on the transactions page, above the payments. See
// SpendTipsClient.tsx for the full brief and annotation copy.

import { MajoritySection, NotableShoppingCard, MoneyMovedBar } from "./shared";
import { tipsFor, type MajorityRowFixture } from "./fixtures";
import { tipSubline } from "@/lib/spendTips";

// The live suffix-only tipSubline (lib/spendTips.ts) returns just the tip
// signifier ("2 tips · ~£52/mo from 1"); this builds the row's FULL subline
// the same way the shipped SpendVerdictView.tsx does — base payment count
// first, the suffix appended with its own " · " only when there's a tip to
// report.
function sublineFor(row: MajorityRowFixture): string {
  const base = `${row.payments_count} payment${row.payments_count === 1 ? "" : "s"}`;
  const suffix = tipSubline(tipsFor(row.category));
  return suffix ? `${base} · ${suffix}` : base;
}

export default function VariantA({ onOpenCategory }: { onOpenCategory: (category: string) => void }) {
  return (
    <>
      <NotableShoppingCard />
      <MajoritySection sublineFor={sublineFor} onOpenCategory={onOpenCategory} />
      <MoneyMovedBar />
    </>
  );
}
