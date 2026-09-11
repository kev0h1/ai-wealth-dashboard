"use client";

// BASELINE — the CURRENT shipped period view, rendered from the real,
// unmodified production components (components/SpendHeader.tsx,
// components/SpendVerdictView.tsx, components/SpendShapeCard.tsx) driven by
// this route's own fixture. Reusing the live components (rather than a
// redrawn copy) is the only way this baseline can be trusted as "what Kevin
// actually has today" — same convention /design/spend-live already
// established for the header. This file makes ZERO edits to those
// components; it only imports and calls them.
//
// This is also where the ticket's named inconsistency is directly visible:
// NotableCardView (the "Needs a look" hero, ~SpendVerdictView.tsx:555-558)
// places the spend figure and the pace badge in a `flex-col items-end`
// two-row grid, stacked. NotableMiniRow (an "Also running warm" row,
// ~SpendVerdictView.tsx:643-646) places the exact same pair inline in one
// flex row. Scroll to "Needs a look" vs "Also running warm" below to see it
// side by side against real density.

import { useState } from "react";
import { useColours } from "@/components/ColourProvider";
import SpendHeader from "@/components/SpendHeader";
import SpendVerdictView from "@/components/SpendVerdictView";
import SpendShapeCard from "@/components/SpendShapeCard";
import { formatPeriodLocal } from "@/components/PayPeriodSettingsSheet";
import {
  SPEND_VERDICT_FIXTURE,
  PREVIEW_ACCOUNTS,
  PREVIEW_INCOME_TXNS,
  PREVIEW_INSIGHTS,
  PREVIEW_MISCATEGORISED_COUNT,
  PREVIEW_PAIR_COUNT,
  PREVIEW_REVIEW_TOTAL,
  PREVIEW_MONEY_SHAPE,
  PREVIEW_SIGNALS,
} from "./fixtures";

export default function Baseline() {
  const { colours } = useColours();
  const [resolved, setResolved] = useState<Record<string, "one_off" | "new_normal">>({});
  const verdict = SPEND_VERDICT_FIXTURE;
  const periodStart = new Date(verdict.period.start);
  const periodEnd = new Date(verdict.period.end);

  return (
    <div className="mx-auto min-h-dvh max-w-xl pb-24">
      <SpendHeader
        verdict={verdict}
        periodLabel={formatPeriodLocal(periodStart, periodEnd)}
        isCurrentPeriod
        canGoPrev={false}
        onPrev={() => {}}
        onNext={() => {}}
        onOpenSettings={() => {}}
        onOpenRules={() => {}}
        incomeTxns={PREVIEW_INCOME_TXNS}
        onTransactionClick={() => {}}
        recentPeriods={[{ offset: 0, label: formatPeriodLocal(periodStart, periodEnd) }]}
        onSelectOffset={() => {}}
      />

      <div className="px-4 pt-4">
        <SpendVerdictView
          verdict={verdict}
          colours={colours}
          hideReading
          categoryInsights={PREVIEW_INSIGHTS}
          miscategorisedCount={PREVIEW_MISCATEGORISED_COUNT}
          pairCount={PREVIEW_PAIR_COUNT}
          reviewTotal={PREVIEW_REVIEW_TOTAL}
          onMiscategorisedTap={() => {}}
          onOpenCategory={() => {}}
          unresolvedAccountName={PREVIEW_ACCOUNTS[0]?.name}
          signals={PREVIEW_SIGNALS}
          sym="£"
          onAimChanged={() => {}}
          onIntent={(category, answer) => {
            setResolved((r) => ({ ...r, [category]: answer }));
            return Promise.resolve();
          }}
          resolved={resolved}
          onResolved={(category, answer) => setResolved((r) => ({ ...r, [category]: answer }))}
          onNewNormalRequest={(category) => setResolved((r) => ({ ...r, [category]: "new_normal" }))}
          onAskCorrect={() => {}}
        />
        <div className="mt-4">
          <SpendShapeCard shape={PREVIEW_MONEY_SHAPE} hideValues={false} onOpen={() => {}} />
        </div>
      </div>
    </div>
  );
}
