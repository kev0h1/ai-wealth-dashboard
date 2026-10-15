"use client";

import { ChevronRight } from "lucide-react";
import GrowthChart from "./portfolio-growth/GrowthChart";
import GrowthSplit from "./portfolio-growth/GrowthSplit";
import LifetimeBlock from "./portfolio-growth/LifetimeBlock";
import { SinceStatementLine } from "./portfolio-growth/SecondaryGrowth";
import { growthSummary, ink, label, Money, RangeChips, RiskLines, whisper } from "./portfolio-growth/Parts";
import { chartReady, valueNoteText, CHART_WAITING, money, NO_COST_LINE, shortDate, SIMPLE_GAIN_NOTE, type GrowthRange, type InvestmentGrowth } from "@/lib/investmentGrowth";

export interface PortfolioGrowthCardProps {
  title: string;
  growth: InvestmentGrowth | null;
  range: GrowthRange;
  onRangeChange?: (r: GrowthRange) => void;
  status?: "ready" | "loading" | "error";
  onRetry?: () => void;
  /** Opens the drill-in (holdings). Omit to hide the link. */
  onOpen?: () => void;
  /** G278: opens the Anchor from your provider sheet (entry point and Edit anchor). */
  onAnchor?: () => void;
  /** G278: use (or stop using) the provider's value for the anchor date, display only. */
  onOverride?: (on: boolean) => void;
  hidden?: boolean;
}

export const cardSurface = "rounded-2xl border border-slate-100 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:shadow-none";

/** Portfolio growth card (G271, variant C "Contribution and Difference" approved 2026-10-15). Takes its data through props; the page that
 *  hosts it owns the fetch (api.getInvestmentGrowth). Prices are end of day,
 *  so the figure is stamped "as of" the last daily value, never "live". */
export default function PortfolioGrowthCard({
  title, growth, range, onRangeChange, status = "ready", onRetry, onOpen, onAnchor, onOverride, hidden,
}: PortfolioGrowthCardProps) {
  if (status === "loading") {
    return <div className={`${cardSurface} h-[420px] animate-pulse`} aria-busy="true" aria-label="Loading portfolio growth" />;
  }
  if (status === "error" || !growth) {
    return (
      <section className={cardSurface}>
        <h2 className={label}>{title}</h2>
        <p className={`mt-2 text-[14px] ${ink}`}>We could not load this portfolio&apos;s growth.</p>
        <button type="button" onClick={onRetry} className="touch-manipulation mt-2 min-h-[44px] rounded-xl px-1 text-[14px] font-semibold text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300">
          Try again
        </button>
      </section>
    );
  }

  return (
    <section className={cardSurface} aria-label={`${title} growth`}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className={label}>{title}</h2>
        {growth.as_of ? <span className={`shrink-0 text-[11px] ${whisper}`}>As of {shortDate(growth.as_of)}</span> : null}
      </div>
      {growth.value !== null ? (
        <p className="mt-1">
          <Money text={money(growth.value, { hidden })} className={`text-[30px] font-bold leading-tight tracking-tight ${ink}`} />
        </p>
      ) : (
        <p className={`mt-2 text-[14px] ${ink}`}>Growth starts once we have a daily value for this account.</p>
      )}

      {growth.value !== null && valueNoteText(growth, hidden) ? (
        <p className={`mt-1 text-[12px] leading-snug ${whisper}`}>{valueNoteText(growth, hidden)}</p>
      ) : null}

      {growth.value !== null ? (
        <div className="mt-3 space-y-3">
          <LifetimeBlock g={growth} hidden={hidden} onAnchor={onAnchor} onOverride={onOverride} />
          <SinceStatementLine g={growth} hidden={hidden} />
          {!growth.lifetime && growth.growth_abs !== null && !growth.cost_coverage ? <GrowthSplit g={growth} hidden={hidden} /> : null}
          {!growth.lifetime && growth.growth_abs === null ? <p className={`text-[12px] ${whisper}`}>{NO_COST_LINE}</p> : null}
          {!growth.lifetime && growth.growth_abs !== null && growth.cost_coverage ? (
            <p className={`text-[12px] ${whisper}`}>Cost is known for {growth.holdings_with_cost} of {growth.holdings_total} holdings, so no whole-account gain is shown. The holdings list shows each one.</p>
          ) : null}
        </div>
      ) : null}

      {chartReady(growth.points) ? (
        <>
          <div className="mt-2">
            <RangeChips range={range} onChange={onRangeChange} />
          </div>
          <div className="mt-1">
            <GrowthChart points={growth.points} hidden={hidden} summary={growthSummary(growth, hidden)} />
          </div>
        </>
      ) : (
        <p className={`mt-3 text-[13px] ${whisper}`}>{CHART_WAITING}</p>
      )}

      {growth.value !== null ? <p className={`mt-2 text-[12px] ${whisper}`}>{SIMPLE_GAIN_NOTE}</p> : null}

      <RiskLines className="mt-3" />

      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className="touch-manipulation mt-2 -mb-1 flex min-h-[44px] w-full items-center justify-between rounded-xl text-[14px] font-semibold text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300"
        >
          See holdings and how it is worked out
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : null}
    </section>
  );
}
