"use client";

import { X } from "lucide-react";
import { Transaction } from "@/lib/api";
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
}

export default function CategorySheet({ name, total, count, transactions, onClose, onTransactionClick, sym = "£" }: Props) {
  useLockBodyScroll();
  const { colours } = useColours();
  const { icons: iconOverrides } = useCategoryIcons();
  const colour = colours[name] ?? CATEGORY_COLOURS[name as keyof typeof CATEGORY_COLOURS] ?? CATEGORY_COLOURS.Other;
  const panelRef = useSheetA11y<HTMLDivElement>(onClose);

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
