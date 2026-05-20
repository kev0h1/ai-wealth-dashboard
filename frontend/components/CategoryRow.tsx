"use client";

import { Transaction } from "@/lib/api";
import { useColours } from "@/components/ColourProvider";
import { CATEGORY_COLOURS } from "@/lib/categories";
import { formatDate } from "@/lib/payPeriod";
import { ChevronDown, ChevronUp } from "lucide-react";

interface CategoryData {
  name: string;
  total: number;
  count: number;
  transactions: Transaction[];
  pct: number;
}

interface CategoryRowProps {
  data: CategoryData;
  expanded: boolean;
  onToggle: () => void;
  onTransactionClick: (tx: Transaction) => void;
}

export default function CategoryRow({
  data,
  expanded,
  onToggle,
  onTransactionClick,
}: CategoryRowProps) {
  const { colours } = useColours();
  const colour = colours[data.name] ?? CATEGORY_COLOURS.Other;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm overflow-hidden">
      {/* Category header row */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-slate-50 dark:active:bg-slate-700 transition-colors"
      >
        <span
          className="flex-shrink-0 w-1 h-10 rounded-full"
          style={{ backgroundColor: colour }}
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              {data.name}
            </span>
            <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
              £
              {data.total.toLocaleString("en-GB", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${Math.min(data.pct, 100)}%`, backgroundColor: colour }}
              />
            </div>
            <span className="text-xs text-slate-400 dark:text-slate-500 flex-shrink-0">
              {data.count} txn{data.count !== 1 ? "s" : ""}
            </span>
          </div>
        </div>

        {expanded ? (
          <ChevronUp size={16} color="#94a3b8" className="flex-shrink-0" />
        ) : (
          <ChevronDown size={16} color="#94a3b8" className="flex-shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-slate-100 dark:border-slate-700">
          {data.transactions.map((tx) => (
            <button
              key={tx.id}
              onClick={() => onTransactionClick(tx)}
              className="w-full flex items-center justify-between px-5 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700/50 active:bg-slate-100 dark:active:bg-slate-700 transition-colors text-left"
            >
              <div>
                <p className="text-sm text-slate-700 dark:text-slate-200">
                  {tx.merchant_name || tx.description}
                </p>
                <p className="text-xs text-slate-400 dark:text-slate-500">{formatDate(tx.date)}</p>
              </div>
              <span
                className={`text-sm font-semibold ${
                  tx.transaction_type === "credit"
                    ? "text-emerald-500"
                    : "text-slate-700 dark:text-slate-200"
                }`}
              >
                {tx.transaction_type === "credit" ? "+" : "-"}£
                {Math.abs(tx.amount).toLocaleString("en-GB", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export type { CategoryData };
