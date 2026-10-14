"use client";

import { money, shortDate, type GrowthHolding } from "@/lib/investmentGrowth";
import { ink, whisper, holdingChange, Marker, Money, label } from "./Parts";
import type { GrowthVariant } from "./GrowthSplit";

function Row({ h, hidden, variant }: { h: GrowthHolding; hidden?: boolean; variant: GrowthVariant }) {
  const body = (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <p className={`min-w-0 truncate text-[14px] font-semibold ${ink}`}>{h.name ?? "Holding"}</p>
        <Money text={money(h.value, { hidden })} className={`shrink-0 text-[14px] font-semibold ${ink}`} />
      </div>
      <p className={`mt-0.5 flex items-center gap-1.5 text-[12px] ${whisper}`}>
        <Marker n={h.change_abs} />
        <span className="min-w-0 truncate">Since last statement <Money text={holdingChange(h, hidden)} className={ink} /></span>
      </p>
    </>
  );
  if (variant === "breathing") {
    return <li className="rounded-xl bg-slate-50 px-3.5 py-3 dark:bg-slate-900/60">{body}</li>;
  }
  return <li className="py-3">{body}</li>;
}

/** One row per holding: value, then its change since the last statement
 *  (current value minus statement value). A holding with no price yet says so. */
export default function HoldingRows({ holdings, variant, hidden, statementDate }: {
  holdings: GrowthHolding[]; variant: GrowthVariant; hidden?: boolean; statementDate: string | null;
}) {
  if (!holdings.length) return null;
  return (
    <section aria-labelledby="pg-holdings">
      <h3 id="pg-holdings" className={label}>
        Holdings{statementDate ? ` · change since ${shortDate(statementDate, true)}` : ""}
      </h3>
      <ul className={variant === "breathing" ? "mt-3 space-y-2" : "mt-1 divide-y divide-slate-100 dark:divide-slate-700"}>
        {holdings.map((h) => <Row key={h.id} h={h} hidden={hidden} variant={variant} />)}
      </ul>
    </section>
  );
}
