"use client";

// TEMPORARY PREVIEW — shared entry-point mocks, rendered at the bottom of
// every variant so the owner can compare the two IA candidates against
// each identical list design. Static fragments only, no navigation wired,
// Planning and Settings themselves are untouched.

import { ChevronRight, Inbox } from "lucide-react";

export default function EntryPointMocks({ count }: { count: number }) {
  return (
    <div className="mt-10">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-3">
        Entry points, mock only
      </p>

      <div className="flex flex-col gap-4">
        {/* Candidate 1: quiet row at the bottom of Planning's upcoming list */}
        <div>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mb-1.5">On Planning, below the upcoming list</p>
          <div className="glass-card rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-50 dark:border-slate-700">
              <div>
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Council tax</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Due in 6 days</p>
              </div>
              <span className="money text-sm font-semibold text-slate-800 dark:text-slate-100">£142</span>
            </div>
            <button className="w-full min-h-[44px] flex items-center justify-between px-4 py-3 active:scale-[0.99] transition-transform">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {count === 0 ? "Nothing set aside" : `${count} set aside`}
              </span>
              <ChevronRight size={15} className="text-slate-300 dark:text-slate-600" />
            </button>
          </div>
        </div>

        {/* Candidate 2: a row inside the Account hub (/settings) */}
        <div>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mb-1.5">In the Account hub</p>
          <div className="glass-card rounded-2xl overflow-hidden">
            <button className="w-full min-h-[44px] flex items-center gap-2.5 px-4 py-3.5 active:scale-[0.99] transition-transform">
              <div className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center shrink-0">
                <Inbox size={14} className="text-slate-500 dark:text-slate-400" />
              </div>
              <span className="flex-1 text-left text-sm font-medium text-slate-800 dark:text-slate-100">Set aside</span>
              {count > 0 && (
                <span className="text-xs font-semibold text-slate-400 dark:text-slate-500">{count}</span>
              )}
              <ChevronRight size={15} className="text-slate-300 dark:text-slate-600" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
