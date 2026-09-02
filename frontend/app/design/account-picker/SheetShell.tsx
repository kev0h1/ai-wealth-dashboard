"use client";

// Static 390px replica of SetAsideSheet.tsx's "An envelope" step (see
// components/SetAsideSheet.tsx step === "envelope"), faithful down to the
// chrome (drag handle, header row, glass-sheet surface, rounded-t-3xl) so
// the account picker is judged at its real density: Name and Amount above
// it (static, not the focus of this review), the real RhythmToggle
// immediately above it, and the real FillRulePicker immediately below it
// once an account is chosen — exactly the neighbours it has in production.

import { ChevronLeft, X } from "lucide-react";
import {
  RhythmToggle,
  FillRulePicker,
  type AllocationRhythm,
  type FillRuleValue,
} from "@/components/AllocationFields";

export default function SheetShell({
  rhythm,
  onRhythmChange,
  accountId,
  fillRule,
  onFillRuleChange,
  children,
}: {
  rhythm: AllocationRhythm;
  onRhythmChange: (v: AllocationRhythm) => void;
  accountId: string;
  fillRule: FillRuleValue;
  onFillRuleChange: (v: FillRuleValue) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-[390px] glass-sheet rounded-3xl flex flex-col shadow-xl">
      {/* Drag handle */}
      <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
        <div className="w-10 h-1 bg-slate-200 dark:bg-slate-600 rounded-full" />
      </div>

      {/* Header */}
      <div className="flex items-center gap-3 px-5 pt-2 pb-3 flex-shrink-0">
        <button
          type="button"
          aria-label="Back"
          tabIndex={-1}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 flex-shrink-0"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-base font-semibold text-slate-900 dark:text-slate-100">An envelope</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">Set aside an amount</p>
        </div>
        <button
          type="button"
          aria-label="Close"
          tabIndex={-1}
          className="w-10 h-10 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 flex-shrink-0 ml-2"
        >
          <X size={15} />
        </button>
      </div>

      {/* Body */}
      <div className="px-5 pb-6 space-y-3">
        {/* Name — static, not the surface under review */}
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
            Name
          </label>
          <div className="w-full min-h-[48px] flex items-center px-3 rounded-xl bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-slate-100 text-sm">
            Emergency top-up
          </div>
        </div>

        {/* Amount per period — static, not the surface under review */}
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
            Amount per period
          </label>
          <div className="w-full min-h-[48px] flex items-center px-3 rounded-xl bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-slate-100 text-sm money">
            £150.00
          </div>
        </div>

        <RhythmToggle value={rhythm} onChange={onRhythmChange} />

        {/* ── The account picker under review ── */}
        {children}

        {accountId !== "" && (
          <FillRulePicker accountId={accountId} value={fillRule} onChange={onFillRuleChange} />
        )}

        <button
          type="button"
          tabIndex={-1}
          className="w-full min-h-[48px] rounded-xl bg-indigo-600 text-white text-sm font-semibold opacity-90"
        >
          Save envelope
        </button>
      </div>
    </div>
  );
}
