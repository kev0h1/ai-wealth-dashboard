"use client";

// Penny's aim nudge (G242). Only for a trait the user marked "change"
// (BEHAVIOURS.md Layer 2), one at a time (Layer 3), and it names the trait.
// It is advice from Penny, so it wears Penny's gradient chip and nothing
// else does. Passing an aim is not a risk: never red, never amber.
import { DismissChip } from "@/components/HomeBrief";
import PennyMark from "@/components/PennyMark";
import MoneyText from "@/components/MoneyText";
import { fmtWhole } from "@/lib/aimFormat";

export interface AimNudgeCardProps {
  category: string;
  /** The trait's real title, as the Mirror shows it. */
  traitTitle: string;
  aimAmount: number;
  spentSoFar: number;
  /** Where an even pace would put the period if it carried on. */
  projected: number;
  daysLeft: number;
  sym?: string;
  onOpen: () => void;
  onDismiss?: () => void;
}

export default function AimNudgeCard({ category, traitTitle, aimAmount, spentSoFar, projected, daysLeft, sym = "£", onOpen, onDismiss }: AimNudgeCardProps) {
  return (
    <div className="glass-card relative rounded-2xl p-4">
      <span
        className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-white"
        style={{ background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)" }}
      >
        <PennyMark size={11} />
        Penny
      </span>
      <p className="mt-2 pr-8 text-[15px] font-semibold leading-snug text-slate-900 dark:text-slate-100">
        {category} looks likely to pass your aim.
      </p>
      <p className="mt-1 text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
        <MoneyText text={`${fmtWhole(spentSoFar, sym)} so far against a ${fmtWhole(aimAmount, sym)} aim, with ${daysLeft} days left. At this pace it would land near ${fmtWhole(projected, sym)}.`} />
      </p>
      <p className="mt-1 text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
        You marked &ldquo;{traitTitle}&rdquo; as something to change, so I am keeping an eye on it. Nothing to do unless you want to.
      </p>
      <button
        type="button"
        onClick={onOpen}
        className="mt-1 inline-flex min-h-[44px] items-center text-[13px] font-semibold text-indigo-700 transition-opacity hover:text-indigo-800 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300 dark:hover:text-indigo-200"
      >
        See {category}
      </button>
      {onDismiss && (
        <DismissChip label="Dismiss" onClick={onDismiss} className="absolute right-2 top-2 z-10" />
      )}
    </div>
  );
}
