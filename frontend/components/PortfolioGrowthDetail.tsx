"use client";

import GrowthChart from "./portfolio-growth/GrowthChart";
import GrowthSplit, { type GrowthVariant } from "./portfolio-growth/GrowthSplit";
import HoldingRows from "./portfolio-growth/HoldingRows";
import { growthSummary, ink, label, Money, RangeChips, RiskLines, whisper } from "./portfolio-growth/Parts";
import { CHART_MODE, cardSurface } from "./PortfolioGrowthCard";
import { METHOD_NOTE, money, shortDate, type GrowthRange, type InvestmentGrowth } from "@/lib/investmentGrowth";

/** Drill-in for one investment account (G271): a taller chart, the paid-in and
 *  growth split, each holding's change since the last statement, how growth is
 *  worked out, and the risk lines. Data arrives through props. */
export default function PortfolioGrowthDetail({
  title, growth, range, onRangeChange, variant = "ledger", hidden,
}: {
  title: string;
  growth: InvestmentGrowth;
  range: GrowthRange;
  onRangeChange?: (r: GrowthRange) => void;
  variant?: GrowthVariant;
  hidden?: boolean;
}) {
  const roomy = variant === "breathing";
  return (
    <article className={`${cardSurface} ${roomy ? "space-y-7" : "space-y-5"}`} aria-label={`${title} detail`}>
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

      <div>
        <RangeChips range={range} onChange={onRangeChange} />
        <div className="mt-1">
          <GrowthChart points={growth.points} mode={CHART_MODE[variant]} height={180} hidden={hidden} summary={growthSummary(growth, hidden)} />
        </div>
      </div>

      <GrowthSplit g={growth} variant={variant} hidden={hidden} />

      <HoldingRows holdings={growth.holdings} variant={variant} hidden={hidden} statementDate={growth.statement_date} />

      <section aria-labelledby="pg-how">
        <h3 id="pg-how" className={label}>How this is worked out</h3>
        <p className={`mt-1 text-[13px] leading-snug ${whisper}`}>{METHOD_NOTE} This is not advice.</p>
      </section>

      <RiskLines />
    </article>
  );
}
