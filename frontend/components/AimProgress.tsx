"use client";

// Aim progress for a Spend category row (G242, approved C "pocket ring"
// 2026-10-11). A compact ring beside the amount, kept at all times, also when
// the row carries a tip. Neutral by construction: an aim is a pace check, so
// no state is ever red or amber, and passing one is not a risk. The fill is
// neutral slate ink: a category colour (orange Eating Out, say) would read as
// a warning. The sentence for screen readers is the same one the hub shows.
import type { Checkpoint } from "@/lib/api";
import { aimPace } from "@/lib/aimPace";
import { fmtWhole } from "@/lib/aimFormat";

/** "£82 of a £100 aim, on pace". The pace phrase comes from the server reading. */
export function aimSentence(aim: Checkpoint, periodDays: number, sym = "£"): string {
  const p = aimPace(aim, periodDays);
  return `${fmtWhole(aim.spent_so_far, sym)} of a ${fmtWhole(aim.aim_amount, sym)} aim, ${p.phrase}`;
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
      <circle cx={11 + r * Math.cos(paceAngle)} cy={11 + r * Math.sin(paceAngle)} r="3" strokeWidth="1.25" className="fill-slate-700 stroke-white dark:fill-slate-100 dark:stroke-slate-900" />
    </svg>
  );
}
