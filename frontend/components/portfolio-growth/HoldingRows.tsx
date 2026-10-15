"use client";

import { COST_UNKNOWN, money, NO_PRICE_YET, shortDate, type GrowthHolding } from "@/lib/investmentGrowth";
import { ink, whisper, holdingGain, Marker, Money, label } from "./Parts";

function Row({ h, hidden }: { h: GrowthHolding; hidden?: boolean }) {
  const body = (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <p className={`min-w-0 truncate text-[14px] font-semibold ${ink}`}>{h.name ?? "Holding"}</p>
        <Money text={money(h.value, { hidden })} className={`shrink-0 text-[14px] font-semibold ${ink}`} />
      </div>
      {h.type.toLowerCase() === "cash" ? null : (
        <p className={`mt-0.5 text-[12px] ${whisper}`}>
          {h.units !== null ? `${h.units.toLocaleString("en-GB", { maximumFractionDigits: 4 })} units` : "Units not known"}
          {", "}
          {h.price !== null ? <>price <Money text={money(h.price, { hidden })} className={ink} />{h.price_date ? ` on ${shortDate(h.price_date)}` : ""}</> : NO_PRICE_YET}
        </p>
      )}
      <p className={`mt-0.5 text-[12px] ${whisper}`}>
        {h.cost === null ? COST_UNKNOWN : <>Cost <Money text={money(h.cost, { hidden })} className={ink} /></>}
      </p>
      <p className={`mt-0.5 flex items-center gap-1.5 text-[12px] ${whisper}`}>
        {h.gain_abs === null ? null : <Marker n={h.gain_abs} />}
        <span className="min-w-0 truncate">{h.gain_abs === null ? "No gain shown" : "Gain"} {h.gain_abs === null ? null : <Money text={holdingGain(h, hidden)} className={ink} />}</span>
      </p>
    </>
  );
  return <li className="py-3">{body}</li>;
}

/** One row per holding (G277, G278): units, price (or No price yet), value,
 *  cost (or Cost not known) and gain, which is value minus cost. A holding with
 *  no known cost shows no gain. */
export default function HoldingRows({ holdings, hidden }: {
  holdings: GrowthHolding[]; hidden?: boolean;
}) {
  if (!holdings.length) return null;
  return (
    <section aria-labelledby="pg-holdings">
      <h3 id="pg-holdings" className={label}>Holdings</h3>
      <ul className="mt-1 divide-y divide-slate-100 dark:divide-slate-700">
        {holdings.map((h) => <Row key={h.id} h={h} hidden={hidden} />)}
      </ul>
    </section>
  );
}
