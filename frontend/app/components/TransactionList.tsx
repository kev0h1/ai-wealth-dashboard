"use client";

import { ArrowDownLeft, ArrowUpRight, X } from "lucide-react";
import { Transaction } from "@/lib/api";

const CATEGORY_COLORS: Record<string, string> = {
  SHOPPING: "bg-pink-500/20 text-pink-300",
  EATING_OUT: "bg-orange-500/20 text-orange-300",
  TRANSPORT: "bg-blue-500/20 text-blue-300",
  BILLS: "bg-red-500/20 text-red-300",
  ENTERTAINMENT: "bg-purple-500/20 text-purple-300",
  GROCERIES: "bg-green-500/20 text-green-300",
  INCOME: "bg-emerald-500/20 text-emerald-300",
};

function categoryClass(cat?: string) {
  if (!cat) return "bg-slate-700/50 text-slate-400";
  return CATEGORY_COLORS[cat.toUpperCase()] || "bg-slate-700/50 text-slate-400";
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export default function TransactionList({
  transactions,
  loading,
  selectedAccount,
  onClearFilter,
}: {
  transactions: Transaction[];
  loading: boolean;
  selectedAccount: string | null;
  onClearFilter: () => void;
}) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl">
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200">
          Transactions
          {selectedAccount && (
            <span className="ml-2 text-xs text-indigo-400">(filtered)</span>
          )}
        </h2>
        <div className="flex items-center gap-2">
          {selectedAccount && (
            <button
              onClick={onClearFilter}
              className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200"
            >
              <X className="w-3 h-3" /> Clear filter
            </button>
          )}
          <span className="text-xs text-slate-500">{transactions.length} transactions</span>
        </div>
      </div>

      {loading ? (
        <div className="p-4 space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-12 bg-slate-800 animate-pulse rounded-lg" />
          ))}
        </div>
      ) : transactions.length === 0 ? (
        <div className="px-4 py-12 text-center text-slate-500 text-sm">
          No transactions to show
        </div>
      ) : (
        <div className="divide-y divide-slate-800/50 max-h-[600px] overflow-y-auto">
          {transactions.slice(0, 100).map((txn) => (
            <div key={txn.id} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-800/40 transition-colors">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                  txn.transaction_type === "credit"
                    ? "bg-emerald-500/20"
                    : "bg-red-500/20"
                }`}
              >
                {txn.transaction_type === "credit" ? (
                  <ArrowUpRight className="w-4 h-4 text-emerald-400" />
                ) : (
                  <ArrowDownLeft className="w-4 h-4 text-red-400" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-200 truncate">
                  {txn.merchant_name || txn.description}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-slate-500">{formatDate(txn.date)}</span>
                  {txn.category && (
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${categoryClass(txn.category)}`}>
                      {txn.category.toLowerCase().replace("_", " ")}
                    </span>
                  )}
                </div>
              </div>
              <span
                className={`text-sm font-medium shrink-0 ${
                  txn.transaction_type === "credit" ? "text-emerald-400" : "text-slate-200"
                }`}
              >
                {txn.transaction_type === "credit" ? "+" : "-"}£
                {txn.amount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          ))}
          {transactions.length > 100 && (
            <div className="px-4 py-3 text-center text-xs text-slate-500">
              Showing 100 of {transactions.length} transactions
            </div>
          )}
        </div>
      )}
    </div>
  );
}
