"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Tag, Check, Users, User, CalendarArrowUp, CheckSquare, Square } from "lucide-react";
import { Transaction, api } from "@/lib/api";
import { useLockBodyScroll } from "@/lib/useLockBodyScroll";
import { useSheetOpen } from "@/lib/useSheetOpen";
import { BankBadge, BANK_META } from "@/components/AccountMiniCard";
import { getCategoryColour } from "@/lib/categories";
import { useColours } from "@/components/ColourProvider";
import { useCategories } from "@/components/CategoriesContext";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { useCategoryIcons } from "@/components/IconProvider";
import { formatDate } from "@/lib/payPeriod";
import { formatCurrency } from "@/lib/currency";
import CustomSelect from "@/components/CustomSelect";

type Scope = "single" | "all" | "future";

interface TransactionSheetProps {
  transaction: Transaction;
  onClose: () => void;
  onUpdated: (tx: Transaction, additionalIds?: string[]) => void;
  account?: { name: string; provider: string };
}

export default function TransactionSheet({
  transaction,
  onClose,
  onUpdated,
  account,
}: TransactionSheetProps) {
  useLockBodyScroll();
  useSheetOpen();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [category, setCategory] = useState(transaction.category ?? "Other");
  const [scope, setScope] = useState<Scope>("single");
  const [similar, setSimilar] = useState<Transaction[] | null>(null);
  const [loadingSimilar, setLoadingSimilar] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState<number | null>(null);

  const { colours } = useColours();
  const { icons: iconOverrides } = useCategoryIcons();
  const { allCategories } = useCategories();
  const isCredit = transaction.transaction_type === "credit";
  const colour = getCategoryColour(category, colours);
  const CategoryIcon = getCategoryIcon(category, iconOverrides);
  const name = transaction.merchant_name || transaction.description || "(no description)";

  // A transaction with no matchable identity can't sensibly drive "all/future
  // from" — the backend would have nothing real to match on
  const hasMatchKey = Boolean(
    (transaction.merchant_name ?? "").trim() || (transaction.description ?? "").trim().length >= 3
  );

  const matchLabel = transaction.merchant_name
    ? `"${transaction.merchant_name}"`
    : `"${transaction.description.slice(0, 28)}${transaction.description.length > 28 ? "…" : ""}"`;

  // Fetch similar transactions when scope changes to non-single
  useEffect(() => {
    if (scope === "single") {
      setSimilar(null);
      setSelected(new Set());
      return;
    }
    setLoadingSimilar(true);
    setSimilar(null);
    api
      .similarTransactions(transaction.id, scope)
      .then((txns) => {
        setSimilar(txns);
        setSelected(new Set(txns.map((t) => t.id)));
      })
      .catch(() => {
        setSimilar([]);
        setSelected(new Set());
      })
      .finally(() => setLoadingSimilar(false));
  }, [scope, transaction.id]);

  function toggleAll() {
    if (similar === null) return;
    if (selected.size === similar.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(similar.map((t) => t.id)));
    }
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSave() {
    if (saving || savedCount !== null) return;
    setSaving(true);
    try {
      const additionalIds = scope !== "single" && similar ? Array.from(selected) : [];
      const res = await api.patchTransaction(transaction.id, {
        category,
        additional_ids: additionalIds,
      });
      setSavedCount(res.bulk_count ?? 0);
      onUpdated({ ...transaction, category }, additionalIds.length > 0 ? additionalIds : undefined);
      setTimeout(onClose, 900);
    } catch {
      setSavedCount(0);
      onUpdated({ ...transaction, category });
      setTimeout(onClose, 900);
    } finally {
      setSaving(false);
    }
  }

  const saved = savedCount !== null;

  const SCOPES: { value: Scope; label: string; Icon: React.ElementType }[] = hasMatchKey
    ? [
        { value: "single", label: "Just this one", Icon: User },
        { value: "all", label: `All from ${matchLabel}`, Icon: Users },
        { value: "future", label: `Future from ${matchLabel}`, Icon: CalendarArrowUp },
      ]
    : [{ value: "single", label: "Just this one", Icon: User }];

  const allChecked = similar !== null && similar.length > 0 && selected.size === similar.length;

  if (!mounted) return null;

  return createPortal(
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-[65] fade-in" onClick={onClose} />

      {/* Sheet — bottom sheet on mobile, centered modal on desktop */}
      <div className="fixed left-1/2 -translate-x-1/2 w-full max-w-[500px] glass-sheet z-[70] overflow-y-auto
                      bottom-0 rounded-t-3xl slide-up max-h-[88dvh]
                      lg:bottom-auto lg:top-1/2 lg:-translate-y-1/2 lg:rounded-3xl lg:max-h-[85dvh] lg:shadow-2xl"
           style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        {/* Handle — mobile only */}
        <div className="flex justify-center pt-3 pb-1 lg:hidden">
          <div className="w-10 h-1 bg-slate-200 dark:bg-slate-600 rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-2 pb-4 lg:pt-5">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 truncate flex-1 mr-4">{name}</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors flex-shrink-0"
          >
            <X size={16} color="#64748b" />
          </button>
        </div>

        {/* Amount + date + bank */}
        <div className="flex items-center gap-4 px-5 pb-5 border-b border-slate-100 dark:border-slate-700">
          <div
            className="rounded-2xl px-4 py-3 text-center"
            style={{ background: isCredit ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.08)" }}
          >
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-0.5">Amount</p>
            <p className={`text-xl font-bold ${isCredit ? "text-emerald-500" : "text-red-500"}`}>
              {isCredit ? "+" : "-"}
              {formatCurrency(transaction.amount, transaction.currency)}
            </p>
          </div>
          <div className="flex-1">
            <p className="text-xs text-slate-400 dark:text-slate-500 mb-1">Date</p>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{formatDate(transaction.date)}</p>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 capitalize">{transaction.transaction_type}</p>
          </div>
          {account && (() => {
            const key = (account.provider ?? "").toUpperCase().replace(/[\s-]+/g, "_");
            const meta = BANK_META[key];
            const logoSrc = meta?.logoFile
              ? `/banks/${meta.logoFile}`
              : meta?.domain
                ? `https://www.google.com/s2/favicons?domain=${meta.domain}&sz=64`
                : null;
            const initials = meta?.initials ?? (account.provider ?? "?").slice(0, 2).toUpperCase();
            const label = meta?.label ?? (account.provider || "Bank");
            return (
              <div className="flex flex-col items-center gap-1 flex-shrink-0">
                <BankBadge
                  logoSrc={logoSrc}
                  initials={initials}
                  altText={label}
                />
                <span className="text-[10px] text-slate-400 dark:text-slate-500 max-w-[64px] truncate text-center leading-tight">{label}</span>
              </div>
            );
          })()}
        </div>

        {/* Category picker */}
        <div className="px-5 pt-5 pb-4">
          <div className="flex items-center gap-2 mb-3">
            <Tag size={14} color="#64748b" />
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Category</p>
          </div>

          <div className="flex items-center gap-2 mb-3">
            <span
              className="flex items-center gap-1.5 text-sm font-semibold pl-2.5 pr-3 py-1 rounded-full"
              style={{ backgroundColor: `${colour}26`, color: colour }}
            >
              <CategoryIcon size={14} className="flex-shrink-0" style={{ color: colour }} />
              {category}
            </span>
          </div>

          <CustomSelect
            value={category}
            onChange={setCategory}
            options={allCategories.map(cat => ({ value: cat, label: cat }))}
          />
        </div>

        {/* Scope picker */}
        <div className="px-5 pb-4">
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">Apply to</p>
          <div className="space-y-2">
            {SCOPES.map(({ value, label, Icon }) => (
              <button
                key={value}
                onClick={() => setScope(value)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all text-left ${
                  scope === value
                    ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20"
                    : "border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/40 hover:border-slate-200 dark:hover:border-slate-600"
                }`}
              >
                <Icon size={16} color={scope === value ? "#4f46e5" : "#94a3b8"} className="flex-shrink-0" />
                <span className={`text-sm font-medium truncate ${scope === value ? "text-indigo-700 dark:text-indigo-300" : "text-slate-600 dark:text-slate-300"}`}>
                  {label}
                </span>
                {scope === value && (
                  <span className="ml-auto flex-shrink-0 w-4 h-4 rounded-full bg-indigo-500 flex items-center justify-center">
                    <Check size={10} color="#fff" strokeWidth={3} />
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Similar transactions checklist */}
        {scope !== "single" && (
          <div className="px-5 pb-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                {loadingSimilar ? "Loading…" : similar === null ? "" : `${similar.length} similar transaction${similar.length !== 1 ? "s" : ""}`}
              </p>
              {similar !== null && similar.length > 0 && (
                <button
                  onClick={toggleAll}
                  className="flex items-center gap-1 text-xs font-medium text-indigo-600 active:opacity-70"
                >
                  {allChecked ? <CheckSquare size={14} /> : <Square size={14} />}
                  {allChecked ? "Deselect all" : "Select all"}
                </button>
              )}
            </div>

            {loadingSimilar && (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-12 rounded-xl bg-slate-100 dark:bg-slate-700 animate-pulse" />
                ))}
              </div>
            )}

            {!loadingSimilar && similar !== null && similar.length === 0 && (
              <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-3">No similar transactions found</p>
            )}

            {!loadingSimilar && similar !== null && similar.length > 0 && (
              <div className="space-y-1 max-h-52 overflow-y-auto rounded-xl border border-slate-100 dark:border-slate-700">
                {similar.map((tx) => {
                  const checked = selected.has(tx.id);
                  return (
                    <button
                      key={tx.id}
                      onClick={() => toggleOne(tx.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                        checked ? "bg-indigo-50 dark:bg-indigo-900/20" : "bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/40"
                      }`}
                    >
                      <span className={`flex-shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                        checked ? "bg-indigo-500 border-indigo-500" : "border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700"
                      }`}>
                        {checked && <Check size={9} color="#fff" strokeWidth={3} />}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-xs font-medium text-slate-700 dark:text-slate-200 truncate">
                          {tx.merchant_name || tx.description}
                        </span>
                        <span className="block text-[10px] text-slate-400 dark:text-slate-500">{formatDate(tx.date)}</span>
                      </span>
                      <span className={`text-xs font-semibold flex-shrink-0 ${tx.transaction_type === "credit" ? "text-emerald-500" : "text-red-500"}`}>
                        {tx.transaction_type === "credit" ? "+" : "-"}{formatCurrency(tx.amount, tx.currency)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Save button */}
        <div className="px-5 pb-20 lg:pb-6">
          <button
            onClick={handleSave}
            disabled={saving || saved}
            className="w-full py-4 rounded-2xl font-semibold text-white text-base transition-all active:scale-95 flex items-center justify-center gap-2"
            style={{
              background: saved
                ? "linear-gradient(135deg, #10b981, #059669)"
                : "linear-gradient(135deg, #4f46e5, #7c3aed)",
            }}
          >
            {saved ? (
              <>
                <Check size={18} />
                {savedCount && savedCount > 0 ? `Saved · ${savedCount + 1} updated` : "Saved"}
              </>
            ) : saving ? (
              "Saving…"
            ) : scope === "single" ? (
              "Save Category"
            ) : selected.size === 0 ? (
              "Save (this transaction only)"
            ) : (
              `Save for ${selected.size + 1} transaction${selected.size > 0 ? "s" : ""}`
            )}
          </button>
        </div>
      </div>
    </>,
    document.body
  );
}
