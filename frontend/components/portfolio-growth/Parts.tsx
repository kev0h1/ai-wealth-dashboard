"use client";

import MoneyText from "@/components/MoneyText";
import {
  direction, GROWTH_RANGES, money, percent, RISK_LINES, shortDate,
  type GrowthHolding, type GrowthRange, type InvestmentGrowth,
} from "@/lib/investmentGrowth";

export const label = "text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400";
export const ink = "text-slate-900 dark:text-slate-100";
export const whisper = "text-slate-600 dark:text-slate-400";

export function RangeChips({ range, onChange }: { range: GrowthRange; onChange?: (r: GrowthRange) => void }) {
  return (
    <div role="radiogroup" aria-label="Time range" className="flex items-center justify-between">
      {GROWTH_RANGES.map((r) => {
        const on = r.value === range;
        return (
          <button
            key={r.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange?.(r.value)}
            className="touch-manipulation flex min-h-[44px] min-w-[44px] flex-1 items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-800 rounded-lg"
          >
            <span
              className={`rounded-full px-3 py-1 text-[12px] font-semibold ${
                on ? "bg-indigo-600 text-white dark:bg-indigo-500" : "text-slate-600 dark:text-slate-400"
              }`}
            >
              {r.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Small direction marker: emerald dot for a rise, neutral slate for level or a
 *  fall. Colour is information; a fall is not a warning, so it never goes red.
 *  The sign and the sr-only word carry the meaning without colour. */
export function Marker({ n }: { n: number | null }) {
  const d = direction(n);
  return (
    <>
      <span aria-hidden="true" className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${d === "up" ? "bg-emerald-500" : "bg-slate-400 dark:bg-slate-500"}`} />
      <span className="sr-only">{d === "up" ? "Up" : d === "down" ? "Down" : "Unchanged"}</span>
    </>
  );
}

export function RiskLines({ className = "" }: { className?: string }) {
  return (
    <ul className={`space-y-0.5 text-[12px] leading-snug ${whisper} ${className}`}>
      {RISK_LINES.map((l) => <li key={l}>{l}</li>)}
    </ul>
  );
}

export function growthSummary(g: InvestmentGrowth, hidden?: boolean): string {
  if (g.value === null || g.growth_abs === null) return "Not enough daily values to chart yet.";
  const since = g.since ? ` since ${shortDate(g.since, true)}` : "";
  return `Value ${money(g.value, { hidden })}, money paid in ${money(g.paid_in ?? 0, { hidden })}, growth ${money(g.growth_abs, { sign: true, hidden })}${since}.`;
}

export function holdingChange(h: GrowthHolding, hidden?: boolean): string {
  if (h.change_abs === null) return "Price not yet available";
  const pct = h.change_pct === null ? "" : ` (${percent(h.change_pct, { hidden })})`;
  return `${money(h.change_abs, { sign: true, hidden })}${pct}`;
}

export function Money({ text, className }: { text: string; className?: string }) {
  return <MoneyText text={text} className={className} />;
}
