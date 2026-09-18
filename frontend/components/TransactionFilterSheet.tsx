"use client";

// The transactions hub's filter sheet — folded in from the G119 design
// round (app/design/g119-transactions-live/FilterSheet.tsx). Every
// dimension here is one GET /transactions/search actually accepts (see
// lib/transactionFilters.ts's own SearchFilters docstring): category
// (multi-select), merchant name (free text, same substring-OR the
// backend's `merchants` param does), a date window (quick presets + custom
// from/to), and direction (money in/out, `txn_type`). There is no
// account-scope control: the endpoint this sheet's results feed has no
// account parameter (it deliberately spans every account), so a control
// for it would be fake.

import { useState } from "react";
import { X } from "lucide-react";
import { useCategories } from "@/components/CategoriesContext";
import type { SearchFilters } from "@/lib/transactionFilters";

const MONEY_DIRECTIONS: { value: "debit" | "credit" | null; label: string }[] = [
  { value: null, label: "All" },
  { value: "debit", label: "Money out" },
  { value: "credit", label: "Money in" },
];

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

const DATE_PRESETS: { label: string; from: string | null; to: string | null }[] = [
  { label: "All time", from: null, to: null },
  { label: "Last 7 days", from: isoDaysAgo(7), to: null },
  { label: "Last 30 days", from: isoDaysAgo(30), to: null },
  { label: "Last 90 days", from: isoDaysAgo(90), to: null },
];

export interface FilterDraft {
  categories: string[];
  merchant: string;
  from: string | null;
  to: string | null;
  txnType: "debit" | "credit" | null;
}

export function draftFromFilters(f: SearchFilters): FilterDraft {
  return {
    categories: f.categories && f.categories.length > 0 ? f.categories : (f.category ? [f.category] : []),
    merchant: f.merchants && f.merchants.length > 0 ? f.merchants.join(", ") : "",
    from: f.from,
    to: f.to,
    txnType: f.txnType,
  };
}

export default function FilterSheet({
  initial,
  onApply,
  onClearAll,
  onClose,
}: {
  initial: FilterDraft;
  onApply: (draft: FilterDraft) => void;
  onClearAll: () => void;
  onClose: () => void;
}) {
  const { allCategories } = useCategories();
  const [categories, setCategories] = useState<string[]>(initial.categories);
  const [merchant, setMerchant] = useState(initial.merchant);
  const [from, setFrom] = useState<string | null>(initial.from);
  const [to, setTo] = useState<string | null>(initial.to);
  const [txnType, setTxnType] = useState<"debit" | "credit" | null>(initial.txnType);

  function toggleCategory(c: string) {
    setCategories((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  function apply() {
    onApply({ categories, merchant, from, to, txnType });
  }

  function clearAll() {
    setCategories([]);
    setMerchant("");
    setFrom(null);
    setTo(null);
    setTxnType(null);
    onClearAll();
  }

  const activePreset = DATE_PRESETS.find((p) => p.from === from && p.to === to) ?? null;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-[65] fade-in" onClick={onClose} />
      <div
        className="fixed left-1/2 -translate-x-1/2 w-full max-w-[500px] glass-sheet z-[70] overflow-y-auto bottom-0 rounded-t-3xl slide-up max-h-[88dvh] lg:bottom-auto lg:top-1/2 lg:-translate-y-1/2 lg:rounded-3xl lg:max-h-[85dvh] lg:shadow-2xl"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="flex justify-center pt-3 pb-1 lg:hidden">
          <div className="w-10 h-1 bg-slate-200 dark:bg-slate-600 rounded-full" />
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close filters"
          className="absolute top-3 right-3 w-11 h-11 flex items-center justify-center rounded-full text-slate-400 dark:text-slate-500 active:scale-95 transition-transform"
        >
          <X size={18} />
        </button>

        <div className="px-5 pb-6 pt-1">
          <h2 className="text-lg font-bold text-slate-950 dark:text-slate-50">Filter payments</h2>
          <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400">
            Narrow the list. Applies to every group below, not just this page.
          </p>

          {/* Direction */}
          <p className="mt-5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
            Direction
          </p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {MONEY_DIRECTIONS.map((d) => (
              <button
                key={d.label}
                type="button"
                onClick={() => setTxnType(d.value)}
                className={`min-h-[44px] rounded-xl border text-[13px] font-semibold transition-colors ${
                  txnType === d.value
                    ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300"
                    : "border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400"
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>

          {/* Date window */}
          <p className="mt-5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
            When
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {DATE_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => { setFrom(p.from); setTo(p.to); }}
                className={`min-h-[44px] px-3 flex items-center rounded-full text-[13px] font-semibold active:scale-95 transition-transform ${
                  activePreset?.label === p.label
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <label className="flex-1">
              <span className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">From</span>
              <input
                type="date"
                value={from ?? ""}
                onChange={(e) => setFrom(e.target.value || null)}
                className="w-full h-11 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 px-3 text-[13px] text-slate-900 dark:text-slate-100 outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </label>
            <label className="flex-1">
              <span className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">To</span>
              <input
                type="date"
                value={to ?? ""}
                onChange={(e) => setTo(e.target.value || null)}
                className="w-full h-11 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 px-3 text-[13px] text-slate-900 dark:text-slate-100 outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </label>
          </div>

          {/* Merchant */}
          <p className="mt-5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
            Merchant
          </p>
          <input
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
            placeholder="e.g. Tesco, Netflix"
            maxLength={120}
            className="mt-2 w-full h-11 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 px-3 text-[13px] text-slate-900 dark:text-slate-100 outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Comma-separate a few names to match any of them.
          </p>

          {/* Category */}
          <p className="mt-5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
            Category
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {allCategories.map((c) => {
              const active = categories.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleCategory(c)}
                  className={`min-h-[44px] px-3 flex items-center rounded-full text-[13px] font-semibold active:scale-95 transition-transform ${
                    active
                      ? "bg-indigo-600 text-white ring-2 ring-indigo-300 dark:ring-indigo-400/40"
                      : "bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200"
                  }`}
                >
                  {c}
                </button>
              );
            })}
          </div>

          <div className="mt-6 flex items-center gap-3">
            <button
              type="button"
              onClick={clearAll}
              className="min-h-[44px] px-4 text-[13px] font-semibold text-slate-500 dark:text-slate-400 active:opacity-70 transition-opacity"
            >
              Clear all
            </button>
            <button
              type="button"
              onClick={apply}
              className="flex-1 min-h-[44px] rounded-xl bg-indigo-600 text-white text-[14px] font-semibold active:scale-95 transition-transform"
            >
              Show results
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
