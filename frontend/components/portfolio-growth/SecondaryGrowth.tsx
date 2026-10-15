"use client";

import { money, percent, shortDate, type InvestmentGrowth } from "@/lib/investmentGrowth";
import { ink, label, Marker, Money, whisper } from "./Parts";

/** One quiet line under the lifetime figure: growth since the last statement. */
export function SinceStatementLine({ g, hidden }: { g: InvestmentGrowth; hidden?: boolean }) {
  const s = g.since_statement;
  if (!s) return null;
  return (
    <p className={`flex flex-wrap items-center gap-x-1.5 text-[13px] ${ink}`}>
      <Marker n={s.growth_abs} />
      <span>Growth since your {shortDate(s.date)} statement</span>
      <Money text={money(s.growth_abs, { sign: true, hidden })} className="font-semibold" />
      <span className={`text-[12px] ${whisper}`}>after <Money text={money(s.paid_in, { hidden })} className={ink} /> paid in since</span>
    </p>
  );
}

/** Statement-period growth, SECONDARY (G278): closing minus opening minus
 *  payments in, with fees and interest as their own lines. */
export function StatementPeriods({ g, hidden }: { g: InvestmentGrowth; hidden?: boolean }) {
  const periods = g.statement_periods ?? [];
  if (!periods.length) return null;
  const chain = g.periods_chain;
  return (
    <section aria-labelledby="pg-periods">
      <h3 id="pg-periods" className={label}>Statement periods</h3>
      <ul className="mt-1 divide-y divide-slate-100 dark:divide-slate-700">
        {periods.map((p) => (
          <li key={p.to} className="py-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className={`text-[14px] font-semibold ${ink}`}>{p.from ? `${shortDate(p.from)} to ${shortDate(p.to, true)}` : `To ${shortDate(p.to, true)}`}</p>
              <Money text={money(p.growth_abs, { sign: true, hidden })} className={`shrink-0 text-[14px] font-semibold ${ink}`} />
            </div>
            <p className={`mt-0.5 text-[12px] ${whisper}`}>
              <Money text={money(p.closing_value, { hidden })} className={ink} /> closing, <Money text={money(p.opening_value, { hidden })} className={ink} /> opening, <Money text={money(p.payments_in, { hidden })} className={ink} /> paid in
              {p.growth_pct === null ? "" : `, ${percent(p.growth_pct, { hidden })}`}
            </p>
            <p className={`mt-0.5 text-[12px] ${whisper}`}>
              Fees <Money text={money(p.fees, { hidden })} className={ink} />, interest <Money text={money(p.interest, { hidden })} className={ink} />, both already in the growth.
            </p>
          </li>
        ))}
      </ul>
      {chain && chain.periods > 1 && chain.from ? (
        <p className={`text-[13px] ${ink}`}>
          Since {shortDate(chain.from, true)} <Money text={money(chain.growth_abs, { sign: true, hidden })} className="font-semibold" />
          <span className={`text-[12px] ${whisper}`}> across {chain.periods} statements</span>
        </p>
      ) : null}
    </section>
  );
}

/** Per-purchase gain, SECONDARY (G278): units x today's price minus the amount. */
export function PurchaseRows({ g, hidden }: { g: InvestmentGrowth; hidden?: boolean }) {
  const buys = g.purchases ?? [];
  if (!buys.length) return null;
  return (
    <section aria-labelledby="pg-purchases">
      <h3 id="pg-purchases" className={label}>Purchases</h3>
      <ul className="mt-1 divide-y divide-slate-100 dark:divide-slate-700">
        {buys.map((b, i) => (
          <li key={`${b.date}-${b.amount}-${i}`} className="py-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className={`min-w-0 truncate text-[14px] font-semibold ${ink}`}>{b.fund_name}</p>
              <Money text={money(b.amount, { hidden })} className={`shrink-0 text-[14px] font-semibold ${ink}`} />
            </div>
            <p className={`mt-0.5 flex items-center gap-1.5 text-[12px] ${whisper}`}>
              {b.gain_abs === null ? null : <Marker n={b.gain_abs} />}
              <span className="min-w-0 truncate">
                {b.date ? shortDate(b.date, true) : "Undated"}
                {b.units ? `, ${b.units.toLocaleString("en-GB", { maximumFractionDigits: 4 })} units` : ""}
                {b.gain_abs === null ? ", no gain shown" : <>, gain <Money text={money(b.gain_abs, { sign: true, hidden })} className={ink} /></>}
              </span>
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
