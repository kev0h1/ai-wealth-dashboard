"use client";

import { BarChart3, WalletCards } from "@/lib/phosphorIcons";
import { SpendPeriodBar } from "@/components/SpendHeader";
import SpendJourneyNav, { type SpendJourneyDestination } from "@/components/SpendJourneyNav";
import SpendPaceHero from "@/components/SpendPaceHero";
import SpendTrends from "@/components/SpendTrends";
import SpendVerdictView from "@/components/SpendVerdictView";
import { CATEGORY_COLOURS } from "@/lib/categories";
import { useMaskedFormatter } from "@/lib/balancesHidden";
import { dateToUTCDay, type PayPeriodConfig } from "@/lib/payPeriod";
import { payArrivedText } from "@/lib/spendPeriod";
import type { Transaction } from "@/lib/api";
import { C22_SPEND } from "./fixtures";

const noOp = () => {};

const incomeTransactions: Transaction[] = [{
  id: "c22-income-30-oct",
  account_id: "c22-everyday",
  date: "2026-10-30",
  amount: 1800,
  currency: "GBP",
  description: "Salary",
  merchant_name: "Salary",
  category: "Income",
  transaction_type: "credit",
}];

const payPeriodConfig: PayPeriodConfig = { type: "monthly_pay_date", day: 30 };
const periodStart = new Date(dateToUTCDay(C22_SPEND.period.start));
const periodEnd = new Date(dateToUTCDay(C22_SPEND.period.end));

function jumpTo(id: string) {
  const target = document.getElementById(id);
  if (!target) return;
  target.focus({ preventScroll: true });
  target.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

/**
 * Fixture-backed version of Spend's real period journey. Its parent owns the
 * phone chrome and scroll container; this component owns the faithful route
 * content beneath it.
 */
export default function SpendScreen() {
  const money = useMaskedFormatter((amount: number) => `${amount < 0 ? "−" : ""}£${Math.abs(Math.round(amount)).toLocaleString("en-GB")}`);
  const latestPace = [...(C22_SPEND.pace_series ?? [])].reverse().find((point) => point.usual != null);
  const paceDifference = latestPace?.usual != null ? C22_SPEND.pills.spent - latestPace.usual : null;
  const journeyDestinations: SpendJourneyDestination[] = [
    ...(C22_SPEND.notables.length > 0 ? [{
      id: "spend-journey-changes",
      label: "Changes",
      value: paceDifference == null
        ? `${C22_SPEND.notables.length} to review`
        : <span className="font-mono tabular-nums">{money(Math.abs(paceDifference))}</span>,
      needsLook: paceDifference != null && paceDifference > 0,
    }] : []),
    ...(C22_SPEND.majority.some((row) => row.spent > 0) ? [{
      id: "spend-majority-section",
      label: "Spending",
      value: <span className="font-mono tabular-nums">{money(C22_SPEND.pills.spent)}</span>,
    }] : []),
    {
      id: "spend-journey-charts",
      label: "Charts",
      value: "1 shown",
    },
  ];

  return (
    <div className="min-w-0 pt-4" data-c22-spend-journey>
      <SpendPeriodBar
        verdict={C22_SPEND}
        periodLabel="30 Oct to 29 Nov"
        isCurrentPeriod
        canGoPrev
        onPrev={noOp}
        onNext={noOp}
        onOpenSettings={noOp}
        onOpenRules={noOp}
        incomeTxns={incomeTransactions}
        onTransactionClick={noOp}
        onOutTap={() => jumpTo("spend-majority-section")}
        onMovedTap={() => jumpTo("spend-money-moved")}
      />

      <div className="mt-3 grid min-w-0 gap-5">
        <div data-c22-spend-summary data-c22-spend-hero>
          <SpendPaceHero
            verdict={C22_SPEND}
            incomeTxns={incomeTransactions}
            onTransactionClick={noOp}
            onOutTap={() => jumpTo("spend-majority-section")}
            onMovedTap={() => jumpTo("spend-money-moved")}
          />
        </div>

        <div data-c22-spend-nav>
          <SpendJourneyNav destinations={journeyDestinations} />
        </div>

        <main data-c22-spend-rail className="relative min-w-0 pl-8 before:absolute before:bottom-3 before:left-[11px] before:top-3 before:w-px before:bg-slate-300 dark:before:bg-slate-600">
          <section data-c22-pay-arrived className="relative pb-10">
            <span className="absolute -left-8 top-1 flex size-6 items-center justify-center rounded-full bg-indigo-600 text-white ring-4 ring-[#f0f2f7] dark:ring-[#0f172a]" aria-hidden="true">
              <WalletCards size={12} />
            </span>
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-600 dark:text-slate-400">
              {payArrivedText(C22_SPEND, "30 Oct")}
            </p>
            <h2 className="mt-2 text-xl font-bold text-slate-950 dark:text-white"><span className="font-mono tabular-nums">{money(C22_SPEND.pills.income)}</span> recorded coming in</h2>
          </section>

          <SpendVerdictView
            verdict={C22_SPEND}
            colours={CATEGORY_COLOURS}
            hideReading
            journey
            onOpenCategory={noOp}
            onOpenMoved={noOp}
            onIntent={async () => {}}
          />

          <section id="spend-journey-charts" tabIndex={-1} className="relative scroll-mt-24 pb-10 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
            <span className="absolute -left-8 top-1 flex size-6 items-center justify-center rounded-full border border-indigo-300 bg-indigo-50 text-indigo-700 ring-4 ring-[#f0f2f7] dark:border-indigo-400/30 dark:bg-indigo-400/10 dark:text-indigo-300 dark:ring-[#0f172a]" aria-hidden="true">
              <BarChart3 size={12} />
            </span>
            <h2 className="text-xl font-bold text-slate-950 dark:text-white">Your charts</h2>
            <p className="mt-1 max-w-2xl text-pretty text-[13px] leading-5 text-slate-600 dark:text-slate-400">Your spending pace tracks this period&apos;s running total against your usual. Add more charts, drag the handle to reorder, or pin one chart to Home.</p>
            <SpendTrends
              embedded
              preview={{ widgets: ["pace_curve"] }}
              periodTxns={[]}
              allTxns={[]}
              periodStart={periodStart}
              periodEnd={periodEnd}
              payPeriodConfig={payPeriodConfig}
              colours={CATEGORY_COLOURS}
              paceSeries={C22_SPEND.pace_series}
            />
          </section>
        </main>
      </div>
    </div>
  );
}
