"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { X, ChevronDown } from "lucide-react";
import FuelSavingsCard from "@/components/FuelSavingsCard";
import GroceryBasketCard from "@/components/GroceryBasketCard";
import { Transaction, api } from "@/lib/api";
import { useColours } from "@/components/ColourProvider";
import { CATEGORY_COLOURS } from "@/lib/categories";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { useCategoryIcons } from "@/components/IconProvider";
import TransactionRow from "@/components/TransactionRow";
import { useLockBodyScroll } from "@/lib/useLockBodyScroll";
import { useSheetA11y } from "@/lib/useSheetA11y";

interface Props {
  name: string;
  total: number;
  count: number;
  transactions: Transaction[];
  onClose: () => void;
  onTransactionClick: (tx: Transaction) => void;
  sym?: string;
  isPro?: boolean;
}

export default function CategorySheet({ name, total, count, transactions, onClose, onTransactionClick, sym = "£", isPro }: Props) {
  useLockBodyScroll();
  const { colours } = useColours();
  const { icons: iconOverrides } = useCategoryIcons();
  const colour = colours[name] ?? CATEGORY_COLOURS[name as keyof typeof CATEGORY_COLOURS] ?? CATEGORY_COLOURS.Other;
  const panelRef = useSheetA11y<HTMLDivElement>(onClose);
  const [toolOpen, setToolOpen] = useState(false);
  const router = useRouter();
  const [debtVerdict, setDebtVerdict] = useState<{ totalDebt: number; debtFreeLabel: string } | null>(null);

  useEffect(() => {
    if (name !== "Debt") return;
    api.debtInsights().then(d => {
      const months = d.months_at_current_rate;
      let debtFreeLabel = "";
      if (months && isFinite(months) && months > 0 && months < 600) {
        const target = new Date();
        target.setMonth(target.getMonth() + Math.round(months));
        debtFreeLabel = target.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
      }
      setDebtVerdict({ totalDebt: d.total_debt, debtFreeLabel });
    }).catch(() => {});
  }, [name]);

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-[65] fade-in" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${name} category`}
        className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[500px] bg-white dark:bg-slate-800 rounded-t-3xl z-[70] max-h-[80vh] flex flex-col"
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 bg-slate-200 dark:bg-slate-600 rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-center gap-3 px-5 pt-2 pb-4 flex-shrink-0">
          {(() => {
            const Icon = getCategoryIcon(name, iconOverrides);
            return (
              <span
                className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: `${colour}26` }}
              >
                <Icon size={16} style={{ color: colour }} />
              </span>
            );
          })()}
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">{name}</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">{count} transaction{count !== 1 ? "s" : ""}</p>
          </div>
          <p className="text-xl font-bold text-slate-800 dark:text-slate-100 flex-shrink-0">
            {sym}{total.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 flex-shrink-0 ml-1"
          >
            <X size={15} color="#64748b" />
          </button>
        </div>

        {/* Transaction list */}
        <div className="overflow-y-auto flex-1 border-t border-slate-100 dark:border-slate-700">
          {/* Compact tool launchers — collapsed by default so transactions lead */}
          {name === "Debt" && (
            <div className="border-b border-slate-100 dark:border-slate-700 px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                {debtVerdict ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                    <span className="font-semibold text-slate-700 dark:text-slate-200">
                      £{debtVerdict.totalDebt.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} left
                    </span>
                    {debtVerdict.debtFreeLabel && (
                      <> · debt-free {debtVerdict.debtFreeLabel}</>
                    )}
                  </p>
                ) : (
                  <p className="text-xs text-slate-500 dark:text-slate-400">Payoff planner</p>
                )}
              </div>
              <button
                onClick={() => router.push("/debt")}
                className="flex-shrink-0 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors whitespace-nowrap"
              >
                See your payoff plan ›
              </button>
            </div>
          )}
          {name.toLowerCase() === "transport" && (
            <div className="border-b border-slate-100 dark:border-slate-700">
              <button
                onClick={() => setToolOpen(o => !o)}
                aria-expanded={toolOpen}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
              >
                <span className="text-base leading-none">⛽</span>
                <span className="flex-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                  Cheaper fuel nearby
                </span>
                <ChevronDown
                  size={14}
                  className="text-slate-400 dark:text-slate-500 flex-shrink-0 transition-transform motion-reduce:transition-none"
                  style={{ transform: toolOpen ? "rotate(180deg)" : "rotate(0deg)" }}
                />
              </button>
              {toolOpen && (
                <div className="px-4 pb-3">
                  <FuelSavingsCard />
                </div>
              )}
            </div>
          )}
          {name.toLowerCase() === "groceries" && isPro && (
            <div className="border-b border-slate-100 dark:border-slate-700">
              <button
                onClick={() => setToolOpen(o => !o)}
                aria-expanded={toolOpen}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
              >
                <span className="text-base leading-none">🧾</span>
                <span className="flex-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                  Scan &amp; compare receipts
                </span>
                <ChevronDown
                  size={14}
                  className="text-slate-400 dark:text-slate-500 flex-shrink-0 transition-transform motion-reduce:transition-none"
                  style={{ transform: toolOpen ? "rotate(180deg)" : "rotate(0deg)" }}
                />
              </button>
              {toolOpen && (
                <div className="px-4 pb-3">
                  <GroceryBasketCard />
                </div>
              )}
            </div>
          )}
          {transactions.map(tx => (
            <TransactionRow
              key={tx.id}
              transaction={tx}
              onClick={() => { onClose(); setTimeout(() => onTransactionClick(tx), 50); }}
            />
          ))}
        </div>
      </div>
    </>
  );
}
