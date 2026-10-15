"use client";

import { useRef, type KeyboardEvent } from "react";
import MoneyText from "@/components/MoneyText";
import {
  COST_UNKNOWN, direction, GROWTH_RANGES, money, percent, RISK_LINES, shortDate,
  type GrowthHolding, type GrowthRange, type InvestmentGrowth,
} from "@/lib/investmentGrowth";

export const label = "text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400";
export const ink = "text-slate-900 dark:text-slate-100";
export const whisper = "text-slate-600 dark:text-slate-400";

export function RangeChips({ range, onChange }: { range: GrowthRange; onChange?: (r: GrowthRange) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const i = GROWTH_RANGES.findIndex((r) => r.value === range);
    const next = GROWTH_RANGES[(i + step + GROWTH_RANGES.length) % GROWTH_RANGES.length];
    onChange?.(next.value);
    ref.current?.querySelectorAll<HTMLButtonElement>("button")[GROWTH_RANGES.indexOf(next)]?.focus();
  };
  return (
    <div ref={ref} onKeyDown={onKey} role="radiogroup" aria-label="Time range" className="flex items-center justify-between">
      {GROWTH_RANGES.map((r) => {
        const on = r.value === range;
        return (
          <button
            key={r.value}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
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
  if (g.value === null || g.growth_abs === null) return "Not enough information to chart yet.";
  const since = g.since ? ` since ${shortDate(g.since, true)}` : "";
  const cover = g.cost_coverage ? `, ${g.cost_coverage}` : "";
  return `Value ${money(g.value, { hidden })}, money paid in ${money(g.paid_in ?? 0, { hidden })}, growth ${money(g.growth_abs, { sign: true, hidden })}${cover}${since}.`;
}

/** Per-holding gain: value minus cost, with its percent. No known cost reads
 *  "Cost not known" and carries no gain. */
export function holdingGain(h: GrowthHolding, hidden?: boolean): string {
  if (h.gain_abs === null) return COST_UNKNOWN;
  const pct = h.gain_pct === null ? "" : ` (${percent(h.gain_pct, { hidden })})`;
  return `${money(h.gain_abs, { sign: true, hidden })}${pct}`;
}

export function Money({ text, className }: { text: string; className?: string }) {
  return <MoneyText text={text} className={className} />;
}
