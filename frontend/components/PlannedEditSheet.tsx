"use client";
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { AccountRadioPicker } from "@/components/AccountRadioPicker";
import { api, Account, PlannedExpense } from "@/lib/api";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { getCategoryColour } from "@/lib/categories";
import { useColours } from "@/components/ColourProvider";
import { useLockBodyScroll } from "@/lib/useLockBodyScroll";
import { useSheetOpen } from "@/lib/useSheetOpen";
import { useSheetA11y } from "@/lib/useSheetA11y";

interface PlannedEditSheetProps {
  item: { id: string; name: string; amount: number; date: string; account_id: string | null };
  accounts: Account[];
  onClose: () => void;
  onDelete: () => void;
  onSaved: () => void;
}

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function PlannedEditSheet({ item, accounts, onClose, onDelete, onSaved }: PlannedEditSheetProps) {
  useLockBodyScroll();
  useSheetOpen();
  const panelRef = useSheetA11y<HTMLDivElement>(onClose);
  const { colours } = useColours();

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const reduceMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const today = todayIso();

  const [nameVal, setNameVal] = useState(item.name);
  const [amountVal, setAmountVal] = useState(item.amount.toFixed(2));
  const [dateVal, setDateVal] = useState(item.date);
  const [accountId, setAccountId] = useState(item.account_id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const catName = "Other";
  const colour = getCategoryColour(catName, colours);
  const Icon = getCategoryIcon(catName, {});

  const formattedDate = new Date(item.date).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  // Spendable accounts: exclude savings, credit accounts, negative balances
  const spendableAccounts = accounts.filter(acc => {
    if (acc.manual) return false;
    const sub = (acc.subtype || "").toLowerCase();
    const type = (acc.type || "").toLowerCase();
    if (sub.includes("saving")) return false;
    if (type.includes("credit") || sub.includes("credit")) return false;
    if ((acc.balance ?? 0) < 0) return false;
    return true;
  });

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = nameVal.trim();
    if (!trimmedName) { setError("Enter a name for this payment"); return; }
    const parsedAmount = parseFloat(amountVal);
    if (isNaN(parsedAmount) || parsedAmount <= 0) { setError("Enter a valid amount"); return; }
    // Date validation: only reject past dates if the user CHANGED the date
    if (dateVal !== item.date && dateVal < today) { setError("Date must be today or in the future"); return; }

    // Build patch with only changed fields
    const patch: { name?: string; amount?: number; date?: string; account_id?: string | null } = {};
    if (trimmedName !== item.name) patch.name = trimmedName;
    if (parsedAmount !== item.amount) patch.amount = parsedAmount;
    if (dateVal !== item.date) patch.date = dateVal;
    const newAccountId = accountId === "" ? null : accountId;
    if (newAccountId !== item.account_id) patch.account_id = newAccountId;

    if (Object.keys(patch).length === 0) { onClose(); return; }

    setSaving(true);
    setError(null);
    try {
      await api.updatePlanned(item.id, patch);
      onSaved();
      onClose();
    } catch {
      setError("Couldn't save, please try again");
    } finally {
      setSaving(false);
    }
  }

  if (!mounted) return null;

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-[65] fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Edit planned payment: ${item.name}`}
        className="fixed inset-x-0 bottom-0 z-[70]"
        style={reduceMotion ? undefined : { animation: "slideUpSheet 280ms cubic-bezier(0.32, 0.72, 0, 1) both" }}
      >
        <div
          className="mx-auto w-full max-w-[500px] glass-sheet rounded-t-3xl flex flex-col"
          style={{ maxHeight: "85dvh" }}
        >
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
            <div className="w-10 h-1 bg-slate-200 dark:bg-slate-600 rounded-full" />
          </div>

          {/* Header */}
          <div className="flex items-center gap-3 px-5 pt-2 pb-3 flex-shrink-0">
            <span
              className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: `${colour}26` }}
              aria-hidden="true"
            >
              <Icon size={16} style={{ color: colour }} />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-base font-semibold text-slate-900 dark:text-slate-100 truncate">{item.name}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Planned {formattedDate} · <span className="font-mono tabular-nums">−£{item.amount.toFixed(2)}</span>
              </p>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="w-10 h-10 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 flex-shrink-0 ml-2 active:bg-slate-200 dark:active:bg-slate-600 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
            >
              <X size={15} />
            </button>
          </div>

          {/* Scrollable content */}
          <div
            className="overflow-y-auto flex-1 px-5 space-y-3"
            style={{ paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom, 0px))" }}
          >
            <form onSubmit={handleSave} className="space-y-3">

              {/* Name */}
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
                  Name
                </label>
                <input
                  type="text"
                  value={nameVal}
                  onChange={e => setNameVal(e.target.value)}
                  className="w-full min-h-[48px] px-3 rounded-xl bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-slate-100 border border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 text-sm"
                />
              </div>

              {/* Amount */}
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
                  Amount
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 text-sm pointer-events-none select-none">£</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={amountVal}
                    onChange={e => setAmountVal(e.target.value)}
                    className="w-full min-h-[48px] pl-7 pr-3 rounded-xl bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-slate-100 border border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 text-sm text-left tabular-nums"
                  />
                </div>
              </div>

              {/* Date */}
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
                  Date
                </label>
                <input
                  type="date"
                  value={dateVal}
                  min={today}
                  onChange={e => setDateVal(e.target.value)}
                  className="w-full min-h-[48px] px-3 rounded-xl bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-slate-100 border border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 text-sm appearance-none text-left [&::-webkit-date-and-time-value]:text-left"
                />
              </div>

              {/* Account selector */}
              <AccountRadioPicker
                accounts={spendableAccounts}
                value={accountId}
                onChange={setAccountId}
                label="Which account will it leave from?"
                allowUnset
                unsetLabel="Not sure yet"
              />

              {/* Error */}
              {error && (
                <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>
              )}

              {/* Footer buttons */}
              <div className="flex flex-col gap-2 pt-1">
                {/* Save */}
                <button
                  type="submit"
                  disabled={saving}
                  className="w-full min-h-[48px] rounded-xl bg-indigo-600 text-white text-sm font-semibold active:scale-95 transition-transform disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                >
                  {saving ? "Saving…" : "Save"}
                </button>

                {/* Delete — no two-step confirm, deletion is undoable via snackbar */}
                <button
                  type="button"
                  onClick={() => { onDelete(); onClose(); }}
                  className="w-full min-h-[44px] rounded-xl text-rose-600 dark:text-rose-400 text-sm font-semibold bg-transparent hover:bg-rose-50 dark:hover:bg-rose-900/20 active:scale-95 transition-transform focus:outline-none focus:ring-2 focus:ring-rose-500 focus:ring-offset-2"
                >
                  Delete
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
