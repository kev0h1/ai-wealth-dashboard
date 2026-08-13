"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, ArrowLeftRight } from "lucide-react";
import { Transaction, api } from "@/lib/api";
import { useLockBodyScroll } from "@/lib/useLockBodyScroll";
import { useSheetOpen } from "@/lib/useSheetOpen";
import { getCategoryColour } from "@/lib/categories";
import { useColours } from "@/components/ColourProvider";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { useCategoryIcons } from "@/components/IconProvider";
import { formatDate } from "@/lib/payPeriod";
import { formatCurrency, currencySymbol } from "@/lib/currency";
import Spinner from "@/components/Spinner";

type MiscategorisedItem = {
  id: string;
  ids: string[];
  count: number;
  series_key: string;
  merchant_name: string | null;
  description: string | null;
  amount: number;
  amount_min: number | null;
  amount_max: number | null;
  date: string;
  first_date: string | null;
  currency: string;
  category: string | null;
  transaction_type: string;
};

interface MiscategorisedReviewSheetProps {
  onClose: () => void;
  onRecategorise: (tx: Transaction) => void;
  onChanged?: () => void;
}

// Turns a miscategorised-list item into a Transaction shape good enough for
// TransactionSheet — account_id is unknown here (the list endpoint doesn't
// carry it), which just means the bank badge in TransactionSheet won't
// render; everything else (category picker, save, similar-txn scope) works
// off the id/description/merchant fields alone.
function toTransaction(item: MiscategorisedItem): Transaction {
  return {
    id: item.id,
    account_id: "",
    date: item.date,
    amount: item.amount,
    currency: item.currency,
    description: item.description ?? "",
    merchant_name: item.merchant_name ?? undefined,
    category: item.category ?? undefined,
    transaction_type: item.transaction_type === "credit" ? "credit" : "debit",
  };
}

export default function MiscategorisedReviewSheet({
  onClose,
  onRecategorise,
  onChanged,
}: MiscategorisedReviewSheetProps) {
  useLockBodyScroll();
  useSheetOpen();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<MiscategorisedItem[]>([]);
  const [dismissingIds, setDismissingIds] = useState<Set<string>>(new Set());

  const { colours } = useColours();
  const { icons: iconOverrides } = useCategoryIcons();

  useEffect(() => {
    let cancelled = false;
    api
      .getMiscategorised()
      .then((res) => {
        if (!cancelled) setItems(res.items);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleDismiss(item: MiscategorisedItem) {
    if (dismissingIds.has(item.series_key)) return;
    setDismissingIds((prev) => new Set(prev).add(item.series_key));
    // Optimistic — the whole series leaves immediately; a failed call just
    // leaves it out of this list until the next open (it'll re-surface from
    // the count).
    setItems((prev) => prev.filter((t) => t.series_key !== item.series_key));
    api
      .dismissMiscategorisedSeries(item.series_key)
      .catch(() => {})
      .finally(() => onChanged?.());
  }

  if (!mounted) return null;

  return createPortal(
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-[65] fade-in" onClick={onClose} />

      {/* Sheet — bottom sheet on mobile, centered modal on desktop */}
      <div
        className="fixed left-1/2 -translate-x-1/2 w-full max-w-[500px] glass-sheet z-[70] overflow-y-auto
                    bottom-0 rounded-t-3xl slide-up max-h-[88dvh]
                    lg:bottom-auto lg:top-1/2 lg:-translate-y-1/2 lg:rounded-3xl lg:max-h-[85dvh] lg:shadow-2xl"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        {/* Handle — mobile only */}
        <div className="flex justify-center pt-3 pb-1 lg:hidden">
          <div className="w-10 h-1 bg-slate-200 dark:bg-slate-600 rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-2 pb-4 lg:pt-5">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 truncate flex-1 mr-4">
            Review these transfers
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors flex-shrink-0"
          >
            <X size={16} color="#64748b" />
          </button>
        </div>

        {/* Penny explainer */}
        <div className="mx-5 mb-4 glass-card rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <span
              className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-white rounded-full px-2.5 py-1"
              style={{ background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)" }}
            >
              ✦ Penny
            </span>
          </div>
          <p className="text-[14px] text-slate-700 dark:text-slate-200 leading-relaxed">
            Money moving between your own accounts isn&apos;t spending — it should be a{" "}
            <strong className="font-semibold text-slate-900 dark:text-slate-100">Transfer</strong>{" "}
            (or <strong className="font-semibold text-slate-900 dark:text-slate-100">Savings</strong>{" "}
            if it&apos;s going to a savings account, <strong className="font-semibold text-slate-900 dark:text-slate-100">Debt</strong>{" "}
            if it&apos;s a card payment). These look like your own transfers but landed in a spending
            category, which overstates your spending. Recategorise them, or dismiss if they&apos;re
            genuinely spending.
          </p>
        </div>

        {/* List */}
        <div className="px-5 pb-20 lg:pb-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Spinner size={28} />
            </div>
          ) : items.length === 0 ? (
            <div className="glass-card rounded-2xl p-8 text-center">
              <p className="text-2xl mb-2">🎉</p>
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">All reviewed</p>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                Nothing left to check for now.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((item) => {
                const category = item.category || "Other";
                const colour = getCategoryColour(category, colours);
                const CategoryIcon = getCategoryIcon(category, iconOverrides);
                const name = item.merchant_name || item.description || "(no description)";
                const isCredit = item.transaction_type === "credit";
                const dismissing = dismissingIds.has(item.series_key);
                const hasRange =
                  item.amount_min != null && item.amount_max != null && item.amount_min !== item.amount_max;
                return (
                  <div key={item.series_key} className="glass-card rounded-xl p-3">
                    <div className="flex items-center gap-3">
                      <span
                        className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: `${colour}26` }}
                      >
                        <ArrowLeftRight size={15} style={{ color: colour }} />
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate flex items-center gap-1.5">
                          <span className="truncate">{name}</span>
                          {item.count > 1 && (
                            <span className="flex-shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400">
                              {item.count}×
                            </span>
                          )}
                        </p>
                        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                          {item.count > 1
                            ? `${item.count} payments since ${formatDate(item.first_date ?? item.date)}`
                            : formatDate(item.date)}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <span className={`text-sm font-semibold ${isCredit ? "text-emerald-500" : "text-slate-900 dark:text-slate-100"}`}>
                          {isCredit ? "+" : "-"}
                          {hasRange ? (
                            <>
                              {formatCurrency(item.amount_min as number, item.currency).replace(
                                currencySymbol(item.currency),
                                ""
                              )}
                              –{formatCurrency(item.amount_max as number, item.currency)}
                            </>
                          ) : (
                            formatCurrency(item.amount, item.currency)
                          )}
                        </span>
                        <span
                          className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full text-white"
                          style={{ backgroundColor: colour }}
                        >
                          <CategoryIcon size={10} className="text-white flex-shrink-0" />
                          {category}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-3">
                      <button
                        onClick={() => onRecategorise(toTransaction(item))}
                        disabled={dismissing}
                        className="flex-1 py-2 rounded-xl text-sm font-semibold text-white active:scale-95 transition-transform disabled:opacity-50"
                        style={{ background: "linear-gradient(135deg, #4f46e5, #7c3aed)" }}
                      >
                        Recategorise
                      </button>
                      <button
                        onClick={() => handleDismiss(item)}
                        disabled={dismissing}
                        className="flex-1 py-2 rounded-xl text-sm font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 active:scale-95 transition-transform disabled:opacity-50"
                      >
                        {dismissing ? "Dismissing…" : "Dismiss"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>,
    document.body
  );
}
