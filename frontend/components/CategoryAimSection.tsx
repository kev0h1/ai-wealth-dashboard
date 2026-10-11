"use client";

// The aim section of a Spend category sheet (G242). Set, see, edit and
// remove an aim in the one place the category already lives. An aim is a
// pace check, not a budget: nothing here blocks, warns or compares across
// categories, and no state is red or amber.
import { Target } from "lucide-react";
import type { Checkpoint } from "@/lib/api";
import { aimPace } from "@/lib/aimPace";
import { fmtWhole } from "@/lib/aimFormat";
import MoneyText from "@/components/MoneyText";

export interface CategoryAimSectionProps {
  category: string;
  aim: Checkpoint | null;
  /** The pre-filled amount offered when there is no aim yet (suggested aim or ~93% of usual). */
  suggestedAim: number | null;
  periodDays: number;
  sym?: string;
  /** Opens the aim sheet (set when there is no aim, edit when there is). */
  onOpenEditor: () => void;
}

export default function CategoryAimSection({ category, aim, suggestedAim, periodDays, sym = "£", onOpenEditor }: CategoryAimSectionProps) {
  if (aim) {
    const p = aimPace(aim, periodDays);
    return (
      <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-700">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Your aim</p>
        <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
          <MoneyText text={`${fmtWhole(aim.spent_so_far, sym)} of a ${fmtWhole(aim.aim_amount, sym)} aim`} />
          <span className="font-normal text-slate-600 dark:text-slate-400"> · {p.phrase}</span>
        </p>
        <p className="mt-0.5 text-[13px] text-slate-600 dark:text-slate-400">
          <MoneyText text={`An even pace would be about ${fmtWhole(p.paceToday, sym)} by today.`} /> It is a pace check, not a limit.
        </p>
        <button
          type="button"
          onClick={onOpenEditor}
          className="mt-1 inline-flex min-h-[44px] items-center text-[13px] font-semibold text-indigo-700 transition-opacity hover:text-indigo-800 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300 dark:hover:text-indigo-200"
        >
          Edit or remove this aim
        </button>
      </div>
    );
  }
  return (
    <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-700">
      <p className="text-[13px] text-slate-600 dark:text-slate-400">
        {suggestedAim != null
          ? <MoneyText text={`A pace to check ${category} against? Your usual would put it near ${fmtWhole(suggestedAim, sym)} a period.`} />
          : `A pace to check ${category} against?`}
      </p>
      <button
        type="button"
        onClick={onOpenEditor}
        className="mt-1 inline-flex min-h-[44px] items-center gap-1.5 text-[13px] font-semibold text-indigo-700 transition-opacity hover:text-indigo-800 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300 dark:hover:text-indigo-200"
      >
        <Target size={14} className="flex-shrink-0" aria-hidden="true" />
        Set an aim
      </button>
    </div>
  );
}
