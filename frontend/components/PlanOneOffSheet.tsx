"use client";
import { useState, useEffect, useRef } from "react";
import { AccountRadioPicker } from "@/components/AccountRadioPicker";
import { api, Account, PlannedImpact } from "@/lib/api";
import MoneyText from "@/components/MoneyText";
import { SheetFrame } from "@/components/SheetFrame";

interface PlanOneOffSheetProps {
  accounts: Account[];
  onClose: () => void;
  onSaved: () => void;
}

// RadioDot's canonical home is now AccountMiniCard.tsx; re-exported here so
// every existing `from "@/components/PlanOneOffSheet"` import keeps working
// unchanged (PlannedEditSheet.tsx, CardTermsSheet.tsx, AllocationFields.tsx,
// AccountsPage.tsx, the /design/account-picker variants).
export { RadioDot } from "@/components/AccountMiniCard";

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function PlanOneOffSheet({ accounts, onClose, onSaved }: PlanOneOffSheetProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

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

  return (
    <SheetFrame
      title="Plan a one-off"
      description="A payment you know is coming."
      onClose={handleBackdropClose}
      dismissDisabled={saving}
      footer={({ close }) => saved ? (
        <button onClick={close} className="w-full rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white active:scale-95">Done</button>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={close} disabled={saving} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 active:scale-95 dark:border-slate-600 dark:text-slate-200">Cancel</button>
          <button type="submit" form="plan-one-off-form" disabled={saving} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white active:scale-95 disabled:opacity-60">{saving ? "Planning…" : "Plan it"}</button>
        </div>
      )}
    >
            {saved ? (
              /* Confirmation state */
              <div className="space-y-4 py-2">
                <div className="rounded-2xl bg-indigo-50 dark:bg-indigo-900/20 px-4 py-5">
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 leading-snug">
                    {confirmMessage && <MoneyText text={confirmMessage} />}
                  </p>
                </div>
              </div>
            ) : (
              /* Form */
              <form id="plan-one-off-form" onSubmit={handleSubmit} className="space-y-3">

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
                <AccountRadioPicker
                  accounts={spendableAccounts}
                  value={accountId}
                  onChange={setAccountId}
                  label="Which account will it leave from?"
                  allowUnset
                  unsetLabel="Not sure yet"
                  helperText="Pick one so I can plan the cover if it's short."
                />

                {/* Error */}
                {error && (
                  <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>
                )}

              </form>
            )}
    </SheetFrame>
  );
}
