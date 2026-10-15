"use client";

import GrowthChart from "./portfolio-growth/GrowthChart";
import GrowthSplit from "./portfolio-growth/GrowthSplit";
import HoldingRows from "./portfolio-growth/HoldingRows";
import LifetimeBlock from "./portfolio-growth/LifetimeBlock";
import { PurchaseRows, SinceStatementLine, StatementPeriods } from "./portfolio-growth/SecondaryGrowth";
import { growthSummary, ink, label, Money, RangeChips, RiskLines, whisper } from "./portfolio-growth/Parts";
import { cardSurface } from "./PortfolioGrowthCard";
import { chartReady, CHART_WAITING, LIFETIME_NOTE, METHOD_NOTE, money, shortDate, type GrowthRange, type InvestmentGrowth } from "@/lib/investmentGrowth";

/** Drill-in for one investment account (G271): a taller chart, the paid-in and
 *  growth split, each holding's change since the last statement, how growth is
 *  worked out, and the risk lines. Data arrives through props. */
export default function PortfolioGrowthDetail({
  title, growth, range, onRangeChange, hidden, bare, onAnchor, onOverride,
}: {
  title: string;
  growth: InvestmentGrowth;
  range: GrowthRange;
  onRangeChange?: (r: GrowthRange) => void;
  hidden?: boolean;
  /** Drop the card surface when the host (a sheet) already provides one. */
  bare?: boolean;
  onAnchor?: () => void;
  onOverride?: (on: boolean) => void;
}) {
  return (
    <article className={`${bare ? "" : cardSurface} space-y-5`} aria-label={`${title} detail`}>
      <header>
        <div className="flex items-baseline justify-between gap-2">
          <h2 className={label}>{title}</h2>
          {growth.as_of ? <span className={`shrink-0 text-[11px] ${whisper}`}>As of {shortDate(growth.as_of, true)}</span> : null}
        </div>
        {growth.value !== null ? (
          <p className="mt-1">
            <Money text={money(growth.value, { hidden })} className={`text-[30px] font-bold leading-tight tracking-tight ${ink}`} />
          </p>
        ) : null}
      </header>

      {chartReady(growth.points) ? (
        <div>
          <RangeChips range={range} onChange={onRangeChange} />
          <div className="mt-1">
            <GrowthChart points={growth.points} height={180} hidden={hidden} summary={growthSummary(growth, hidden)} />
          </div>
        </div>
      ) : (
        <p className={`text-[13px] ${whisper}`}>{CHART_WAITING}</p>
      )}

      {growth.value_note ? <p className={`text-[12px] leading-snug ${whisper}`}>{growth.value_note}</p> : null}

      <LifetimeBlock g={growth} hidden={hidden} onAnchor={onAnchor} onOverride={onOverride} detail />
      <SinceStatementLine g={growth} hidden={hidden} />
      {!growth.lifetime && !growth.cost_coverage ? <GrowthSplit g={growth} hidden={hidden} /> : null}

      <HoldingRows holdings={growth.holdings} hidden={hidden} />

      <PurchaseRows g={growth} hidden={hidden} />

      <StatementPeriods g={growth} hidden={hidden} />

      <section aria-labelledby="pg-how">
        <h3 id="pg-how" className={label}>How this is worked out</h3>
        <p className={`mt-1 text-[13px] leading-snug ${whisper}`}>{METHOD_NOTE}{growth.lifetime ? ` ${LIFETIME_NOTE}` : ""} Simple gain, not a time-weighted return. This is not advice.</p>
      </section>

      <RiskLines />
    </article>
  );
}
