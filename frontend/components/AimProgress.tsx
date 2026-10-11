"use client";

// Aim progress for a Spend category row (G242). Three presentations of the
// same quiet fact. Neutral by construction: an aim is a pace check, so no
// state is ever red or amber, and passing one is not a risk. The fill is
// neutral ink: a category colour (orange Eating Out, say) would read as a
// warning.
import type { Checkpoint } from "@/lib/api";
import { aimPace } from "@/lib/aimPace";
import { fmtWhole } from "@/lib/aimFormat";
import MoneyText from "@/components/MoneyText";

export type AimRowStyle = "line" | "rule" | "ring";

/** The sentence all three presentations share: "£82 of a £100 aim, on pace". */
export function aimSentence(aim: Checkpoint, periodDays: number, sym = "£"): string {
  const p = aimPace(aim, periodDays);
  return `${fmtWhole(aim.spent_so_far, sym)} of a ${fmtWhole(aim.aim_amount, sym)} aim · ${p.phrase}`;
}

export function AimLine({ aim, periodDays, sym = "£" }: { aim: Checkpoint; periodDays: number; sym?: string }) {
  return (
    <p className="mt-0.5 text-[11px] text-slate-600 dark:text-slate-400">
      <MoneyText text={aimSentence(aim, periodDays, sym)} />
    </p>
  );
}

/** Thin neutral rule: the fill is what is spent, the tick is where an even pace would be today. */
export function AimRule({ aim, periodDays, sym = "£" }: { aim: Checkpoint; periodDays: number; sym?: string }) {
  const p = aimPace(aim, periodDays);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-[11px] text-slate-600 dark:text-slate-400">
        <span><MoneyText text={`${fmtWhole(aim.spent_so_far, sym)} of a ${fmtWhole(aim.aim_amount, sym)} aim`} /></span>
        <span className="flex-shrink-0">{p.phrase}</span>
      </div>
      <div
        className="relative mt-1.5 h-1 rounded-full bg-slate-200 dark:bg-slate-700"
        role="img"
        aria-label={`${aimSentence(aim, periodDays, sym)}. The tick marks an even pace for today, ${fmtWhole(p.paceToday, sym)}.`}
      >
        <div className="absolute inset-y-0 left-0 rounded-full bg-slate-500 dark:bg-slate-400" style={{ width: `${Math.round(p.spentFraction * 100)}%` }} />
        <div className="absolute -top-0.5 h-2 w-0.5 rounded-full bg-slate-500 dark:bg-slate-300" style={{ left: `calc(${Math.round(Math.min(1, p.paceToday / Math.max(1, aim.aim_amount)) * 100)}% - 1px)` }} />
      </div>
    </div>
  );
}

/** Compact ring beside the amount. Fill is spent against the aim; the dot sits at even pace. */
export function AimRing({ aim, periodDays, sym = "£" }: { aim: Checkpoint; periodDays: number; sym?: string }) {
  const p = aimPace(aim, periodDays);
  const r = 8;
  const c = 2 * Math.PI * r;
  const paceAngle = 2 * Math.PI * Math.min(1, p.paceToday / Math.max(1, aim.aim_amount)) - Math.PI / 2;
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" role="img" aria-label={aimSentence(aim, periodDays, sym)} className="flex-shrink-0">
      <circle cx="11" cy="11" r={r} fill="none" strokeWidth="2.5" className="stroke-slate-200 dark:stroke-slate-700" />
      <circle
        cx="11" cy="11" r={r} fill="none" strokeWidth="2.5" strokeLinecap="round"
        className="stroke-slate-500 dark:stroke-slate-400"
        strokeDasharray={`${c * p.spentFraction} ${c}`}
        transform="rotate(-90 11 11)"
      />
      <circle cx={11 + r * Math.cos(paceAngle)} cy={11 + r * Math.sin(paceAngle)} r="1.6" className="fill-slate-600 dark:fill-slate-200" />
    </svg>
  );
}
