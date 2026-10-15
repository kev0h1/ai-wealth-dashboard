"use client";

import { money, percent, shortDate, type InvestmentGrowth } from "@/lib/investmentGrowth";
import { label, ink, whisper, Marker, Money } from "./Parts";

export type GrowthVariant = "ledger" | "breathing" | "pair";

function growthText(g: InvestmentGrowth, hidden?: boolean) {
  return money(g.growth_abs ?? 0, { sign: true, hidden });
}

function pctText(g: InvestmentGrowth, hidden?: boolean) {
  return g.growth_pct === null ? null : percent(g.growth_pct, { hidden });
}

/** Paid in versus growth. Never a proportional bar: a bar would imply the two
 *  add to a whole, and a fall would need a negative segment. Figures only. */
export default function GrowthSplit({ g, variant, hidden }: { g: InvestmentGrowth; variant: GrowthVariant; hidden?: boolean }) {
  if (g.growth_abs === null || g.paid_in === null) return null;
  const since = g.since ? `since ${shortDate(g.since, true)}` : "";
  const pct = pctText(g, hidden);

  if (variant === "ledger") {
    return (
      <dl className="divide-y divide-slate-100 border-y border-slate-100 text-[14px] dark:divide-slate-700 dark:border-slate-700">
        <div className="flex items-baseline justify-between gap-3 py-2.5">
          <dt className={whisper}>Money paid in</dt>
          <dd><Money text={money(g.paid_in, { hidden })} className={`font-semibold ${ink}`} /></dd>
        </div>
        <div className="flex items-baseline justify-between gap-3 py-2.5">
          <dt className={`flex min-w-0 items-center gap-1.5 ${whisper}`}><Marker n={g.growth_abs} /><span className="truncate">Growth{since ? <span className="text-[12px]"> {since}</span> : null}</span></dt>
          <dd className="shrink-0 whitespace-nowrap text-right">
            <Money text={growthText(g, hidden)} className={`font-semibold ${ink}`} />
            {pct ? <span className={`ml-2 text-[13px] ${whisper}`}>{pct}</span> : null}
          </dd>
        </div>
      </dl>
    );
  }

  if (variant === "breathing") {
    return (
      <dl className="space-y-5">
        <div>
          <dt className={label}>Money paid in</dt>
          <dd className="mt-1"><Money text={money(g.paid_in, { hidden })} className={`text-[22px] font-bold ${ink}`} /></dd>
        </div>
        <div>
          <dt className={`flex items-center gap-1.5 ${label}`}><Marker n={g.growth_abs} />Growth {since}</dt>
          <dd className="mt-1 flex items-baseline gap-2">
            <Money text={growthText(g, hidden)} className={`text-[22px] font-bold ${ink}`} />
            {pct ? <span className={`text-[14px] ${whisper}`}>{pct} of money paid in</span> : null}
          </dd>
        </div>
      </dl>
    );
  }

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
    </dl>
  );
}
