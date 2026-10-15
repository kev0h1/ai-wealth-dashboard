"use client";

import { money, percent, type InvestmentGrowth } from "@/lib/investmentGrowth";
import { label, ink, whisper, Marker, Money } from "./Parts";

function growthText(g: InvestmentGrowth, hidden?: boolean) {
  return money(g.growth_abs ?? 0, { sign: true, hidden });
}

function pctText(g: InvestmentGrowth, hidden?: boolean) {
  return g.growth_pct === null ? null : percent(g.growth_pct, { hidden });
}

/** Paid in versus growth. Never a proportional bar: a bar would imply the two
 *  add to a whole, and a fall would need a negative segment. Figures only. */
export default function GrowthSplit({ g, hidden }: { g: InvestmentGrowth; hidden?: boolean }) {
  if (g.growth_abs === null || g.paid_in === null) return null;
  const pct = pctText(g, hidden);

  return (
    <dl className="grid grid-cols-2 gap-x-4 text-[14px]">
      <div className="min-w-0">
        <dt className={`flex items-center gap-1.5 ${label}`}>
          <svg width="16" height="6" viewBox="0 0 16 6" aria-hidden="true"><line x1="0" y1="3" x2="16" y2="3" className="stroke-slate-400 dark:stroke-slate-500" strokeWidth="1.5" strokeDasharray="4 3" /></svg>
          Paid in
        </dt>
        <dd className="mt-1"><Money text={money(g.paid_in, { hidden })} className={`block truncate text-[16px] font-semibold ${ink}`} /></dd>
      </div>
      <div className="min-w-0">
        <dt className={`flex items-center gap-1.5 ${label}`}><Marker n={g.growth_abs} />Growth</dt>
        <dd className="mt-1">
          <Money text={growthText(g, hidden)} className={`block truncate text-[16px] font-semibold ${ink}`} />
          {pct ? <span className={`text-[12px] ${whisper}`}>{pct} of paid in</span> : null}
        </dd>
      </div>
      {g.cost_coverage ? <p className={`col-span-2 mt-1 text-[12px] ${whisper}`}>Gain is {g.cost_coverage}. The rest read Cost not known.</p> : null}
    </dl>
  );
}
