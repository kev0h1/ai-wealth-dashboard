"use client";
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X, CircleDashed } from "lucide-react";
import { accountBrand, BankBadge } from "@/components/AccountMiniCard";
import { api, Account, PlannedImpact } from "@/lib/api";
import { useLockBodyScroll } from "@/lib/useLockBodyScroll";
import { useSheetA11y } from "@/lib/useSheetA11y";
import { useSheetOpen } from "@/lib/useSheetOpen";

interface PlanOneOffSheetProps {
  accounts: Account[];
  onClose: () => void;
  onSaved: () => void;
}

export function RadioDot({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`flex-shrink-0 w-[18px] h-[18px] rounded-full border-2 flex items-center justify-center transition-colors ${
        selected ? "border-indigo-600" : "border-slate-300 dark:border-slate-600"
      }`}
    >
      {selected && <span className="w-2 h-2 rounded-full bg-indigo-600" />}
    </span>
  );
}

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function PlanOneOffSheet({ accounts, onClose, onSaved }: PlanOneOffSheetProps) {
  useLockBodyScroll();
  useSheetOpen();
  const panelRef = useSheetA11y<HTMLDivElement>(onClose);

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const reduceMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const today = todayIso();

  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [accountId, setAccountId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [impact, setImpact] = useState<PlannedImpact | null | "none">(null);
  const savedRef = useRef(false);

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

  function handleBackdropClose() {
    if (savedRef.current) onSaved();
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsedAmount = parseFloat(amount);
    if (!name.trim()) { setError("Enter a name for this expense"); return; }
    if (isNaN(parsedAmount) || parsedAmount <= 0) { setError("Enter a valid amount greater than 0"); return; }
    if (!date || date < today) { setError("Date must be today or in the future"); return; }
    setSaving(true);
    setError(null);
    try {
      const params: { name: string; amount: number; date: string; account_id?: string } = {
        name: name.trim(),
        amount: parsedAmount,
        date,
      };
      if (accountId) params.account_id = accountId;
      const result = await api.addPlanned(params);
      savedRef.current = true;
      setImpact(result.impact ?? "none");
      onSaved();
    } catch {
      setError("Couldn't save, please try again");
    } finally {
      setSaving(false);
    }
  }

  function handleDone() {
    onSaved();
    onClose();
  }

  if (!mounted) return null;

  const saved = impact !== null;

  let confirmMessage: string | null = null;
  if (saved && impact !== "none" && impact !== null) {
    const sts = impact.safe_to_spend_after;
    if (sts !== null) {
      if (sts > 0) {
        confirmMessage = `Planned. You're still okay, £${sts.toLocaleString("en-GB", { maximumFractionDigits: 0 })} in hand after this.`;
      } else {
        confirmMessage = `Planned. This tips your window £${Math.abs(sts).toLocaleString("en-GB", { maximumFractionDigits: 0 })} short, a cover plan will appear on Home.`;
      }
    } else {
      confirmMessage = "Planned. It's now in your upcoming bills.";
    }
  } else if (saved) {
    confirmMessage = "Planned. It's now in your upcoming bills.";
  }

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-[65] fade-in"
        onClick={handleBackdropClose}
        aria-hidden="true"
      />

      {/* Sheet */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Plan a one-off expense"
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
            <div className="flex-1 min-w-0">
              <p className="text-base font-semibold text-slate-900 dark:text-slate-100">Plan a one-off</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">A payment you know is coming.</p>
            </div>
            <button
              onClick={handleBackdropClose}
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
            {saved ? (
              /* Confirmation state */
              <div className="space-y-4 py-2">
                <div className="rounded-2xl bg-indigo-50 dark:bg-indigo-900/20 px-4 py-5">
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 leading-snug">
                    {confirmMessage}
                  </p>
                </div>
                <button
                  onClick={handleDone}
                  className="w-full min-h-[48px] rounded-xl bg-indigo-600 text-white text-sm font-semibold active:scale-95 transition-transform focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                >
                  Done
                </button>
              </div>
            ) : (
              /* Form */
              <form onSubmit={handleSubmit} className="space-y-3">

                {/* Name */}
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
                    Name
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Car service"
                    required
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
                      value={amount}
                      onChange={e => setAmount(e.target.value)}
                      placeholder="0.00"
                      required
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
                    value={date}
                    min={today}
                    onChange={e => setDate(e.target.value)}
                    required
                    className="w-full min-h-[48px] px-3 rounded-xl bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-slate-100 border border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 text-sm appearance-none text-left [&::-webkit-date-and-time-value]:text-left"
                  />
                </div>

                {/* Account (optional) */}
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
                    Which account will it leave from?
                  </label>
                  <div
                    role="radiogroup"
                    aria-label="Which account will it leave from?"
                    className="rounded-xl border border-slate-200/70 dark:border-white/[0.08] divide-y divide-slate-100 dark:divide-white/[0.06] overflow-hidden"
                  >
                    {/* "Not sure yet" — first row */}
                    <button
                      type="button"
                      role="radio"
                      aria-checked={accountId === ""}
                      onClick={() => setAccountId("")}
                      className="w-full min-h-[44px] flex items-center gap-3 px-3 py-2.5 text-left active:opacity-70 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-inset"
                    >
                      <span className="w-9 h-9 rounded-xl flex items-center justify-center bg-slate-100 dark:bg-white/[0.06] ring-1 ring-black/[0.06] dark:ring-white/[0.12] flex-shrink-0">
                        <CircleDashed size={16} className="text-slate-400 dark:text-slate-500" />
                      </span>
                      <span className="flex-1 min-w-0 text-sm font-medium text-slate-700 dark:text-slate-200">Not sure yet</span>
                      <RadioDot selected={accountId === ""} />
                    </button>

                    {spendableAccounts.map(acc => {
                      const brand = accountBrand(acc);
                      return (
                        <button
                          key={acc.id}
                          type="button"
                          role="radio"
                          aria-checked={accountId === acc.id}
                          onClick={() => setAccountId(acc.id)}
                          className="w-full min-h-[44px] flex items-center gap-3 px-3 py-2.5 text-left active:opacity-70 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-inset"
                        >
                          <BankBadge
                            logoSrc={brand.logoSrc}
                            initials={brand.initials}
                            altText={brand.label}
                            brandBg={brand.background}
                          />
                          <span className="flex-1 min-w-0">
                            <span className="block text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{acc.name}</span>
                            {acc.provider && (
                              <span className="block text-xs text-slate-400 dark:text-slate-500 truncate">{acc.provider}</span>
                            )}
                          </span>
                          <RadioDot selected={accountId === acc.id} />
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
                    Pick one so I can plan the cover if it&apos;s short.
                  </p>
                </div>

                {/* Error */}
                {error && (
                  <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>
                )}

                {/* Save button */}
                <button
                  type="submit"
                  disabled={saving}
                  className="w-full min-h-[48px] rounded-xl bg-indigo-600 text-white text-sm font-semibold active:scale-95 transition-transform disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                >
                  {saving ? "Planning…" : "Plan it"}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
