"use client";

import { useId, useState, type FormEvent } from "react";
import type { Allocation, api } from "@/lib/api";
import { SheetFrame } from "@/components/SheetFrame";
import { editorField, editorQuiet, editorSecondary } from "@/components/upcoming/editorSupport";

export type AllocationPeriodReduceServices = Pick<typeof api, "setAllocationPeriodOverride">;

const gbp = (v: number) => `£${v.toLocaleString("en-GB", { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 })}`;

/**
 * G217: "Reduce set-aside" from the Home shortfall card. Saves a one-period
 * override (PUT /allocations/{id}/period-override): the recurring amount never
 * moves and the reduction lapses when the next pay period starts. Changing the
 * recurring amount stays available as a clearly separate secondary action.
 */
export function AllocationPeriodReduceSheet({ allocation, suggestedAmount, services, onClose, onSaved, onChangeEvery }: {
  allocation: Allocation;
  suggestedAmount: number;
  services: AllocationPeriodReduceServices;
  onClose(): void;
  onSaved(item: Allocation): void | Promise<void>;
  /** Close this sheet and open the full editor for the recurring amount. */
  onChangeEvery(): void;
}) {
  const formId = useId();
  const recurring = Number(allocation.amount_per_period);
  const [amount, setAmount] = useState(() => suggestedAmount.toFixed(2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > recurring) {
      setError(`Enter an amount from £0 to ${gbp(recurring)}.`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const saved = await services.setAllocationPeriodOverride(allocation.id, Math.round(parsed * 100) / 100);
      await onSaved(saved);
    } catch {
      setError("Couldn't save that. Try again.");
      setBusy(false);
    }
  }

  return (
    <SheetFrame
      variant="compact"
      title={`Reduce ${allocation.name}`}
      description={`This period only. It goes back to ${gbp(recurring)} every pay period afterwards.`}
      onClose={onClose}
      footer={(controls) => (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3">
          <button type="button" disabled={busy} onClick={controls.close} className={editorSecondary + " disabled:opacity-50"}>Cancel</button>
          <button type="submit" form={formId} disabled={busy} className="min-h-11 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-60">Reduce this period</button>
        </div>
      )}
    >
      {(controls) => (
        <form id={formId} onSubmit={submit} className="space-y-4">
          <label className="block text-sm font-medium">
            Set aside this period (£)
            <input type="number" min="0" max={recurring} step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required disabled={busy} className={editorField} />
          </label>
          <p className="text-xs leading-5 text-slate-600 dark:text-slate-400">Prefilled to cover the shortfall. Every pay period stays at {gbp(recurring)}.</p>
          {error && <p role="alert" className="rounded-xl border border-slate-300 p-3 text-sm leading-6 text-slate-700 dark:border-slate-600 dark:text-slate-200">{error}</p>}
          <div className="border-t border-slate-200 pt-3 dark:border-slate-700">
            <button type="button" disabled={busy} onClick={() => controls.closeThen(onChangeEvery)} className={editorQuiet + " -ml-3"}>Change every period</button>
            <p className="text-xs leading-5 text-slate-600 dark:text-slate-400">Edit the amount you set aside every pay period instead.</p>
          </div>
        </form>
      )}
    </SheetFrame>
  );
}
