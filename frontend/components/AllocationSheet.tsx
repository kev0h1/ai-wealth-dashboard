"use client";
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { api, Account, Allocation } from "@/lib/api";
import { useLockBodyScroll } from "@/lib/useLockBodyScroll";
import { useSheetA11y } from "@/lib/useSheetA11y";
import { useSheetOpen } from "@/lib/useSheetOpen";
import {
  AccountRadioPicker,
  EffectiveDateField,
  FillRulePicker,
  RhythmToggle,
  type AllocationRhythm,
  type FillRuleValue,
} from "@/components/AllocationFields";

// Edit sheet for an existing allocation (envelope) — creation now lives in
// SetAsideSheet.tsx, the single "+ Set money aside" door (owner
// consolidation, 2026-08-29). This sheet keeps its edit core: name, amount,
// rhythm, plus the fields that used to be locked at creation and are now
// editable too (owner: "updated to the new rule fields" — account and the
// match rule can both change from here). Fields are the SAME shared
// components SetAsideSheet's envelope step uses (AllocationFields.tsx), so
// the two never carry divergent copies of the same fields.

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

interface AllocationSheetProps {
  accounts: Account[];
  allocation: Allocation;
  /** Start of the current pay period — labels the effective-date default chip. */
  periodStart: Date;
  onClose: () => void;
  onSaved: (item: Allocation) => void;
  onDeleted?: () => void;
}

export default function AllocationSheet({
  accounts,
  allocation,
  periodStart,
  onClose,
  onSaved,
  onDeleted,
}: AllocationSheetProps) {
  useLockBodyScroll();
  useSheetOpen();
  const panelRef = useSheetA11y<HTMLDivElement>(onClose);

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const reduceMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const [name, setName] = useState(allocation.name);
  const [amount, setAmount] = useState(() => String(Math.round(allocation.amount_per_period * 100) / 100));
  const [recurrence, setRecurrence] = useState<AllocationRhythm>(allocation.recurrence);
  const [accountId, setAccountId] = useState(allocation.fill_account_id);
  const [rule, setRule] = useState<FillRuleValue>({
    match_type: allocation.match_type,
    match_value: allocation.match_value,
    fill_display_name: allocation.fill_display_name,
  });
  // A stored effective_from equal to this allocation's own period_start is
  // the ordinary "started on schedule" case — shown as the default chip
  // rather than a stale-looking custom date. Anything else is a genuine
  // override, shown pre-filled in the date picker.
  const initialEffectiveFrom = allocation.effective_from === allocation.period_start ? null : allocation.effective_from;
  const [effectiveFrom, setEffectiveFrom] = useState<string | null>(initialEffectiveFrom);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingPause, setConfirmingPause] = useState(false);

  const periodStartLabel = periodStart.toLocaleDateString("en-GB", { day: "numeric", month: "short" });

  function pickAccount(id: string) {
    if (id === accountId) return;
    setAccountId(id);
    // A rule picked for one account is never silently submitted against
    // another — clear it, same guard SetAsideSheet's create flow uses.
    setRule({ match_type: "description_contains", match_value: "", fill_display_name: "" });
    setError(null);
  }

  const parsedAmount = parseFloat(amount.replace(/[^0-9.]/g, ""));
  const amountValid = !isNaN(parsedAmount) && parsedAmount > 0;
  const canSave =
    !saving &&
    name.trim().length > 0 &&
    amountValid &&
    accountId !== "" &&
    rule.match_value.trim().length > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const item = await api.updateAllocation(allocation.id, {
        name: name.trim(),
        amount_per_period: parsedAmount,
        fill_account_id: accountId,
        match_type: rule.match_type,
        match_value: rule.match_value,
        fill_display_name: rule.fill_display_name || undefined,
        recurrence,
        // Only sent when it actually changed — an unmodified default (or an
        // unmodified existing override) should never be re-stated on a save
        // that isn't about the date at all.
        ...(effectiveFrom !== initialEffectiveFrom && effectiveFrom ? { effective_from: effectiveFrom } : {}),
      });
      onSaved(item);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save, please try again");
    } finally {
      setSaving(false);
    }
  }

  async function handleTogglePause() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const item = await api.updateAllocation(allocation.id, { active: !allocation.active });
      onSaved(item);
      setConfirmingPause(false);
      onClose();
    } catch {
      setError("Couldn't save, please try again");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await api.deleteAllocation(allocation.id);
      onDeleted?.();
      onClose();
    } catch {
      setError("Couldn't delete, please try again");
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
        aria-label="Edit allocation"
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
              <p className="text-base font-semibold text-slate-900 dark:text-slate-100">Edit allocation</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Sets money aside each pay period. The rule below decides what counts toward it.
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
            <form onSubmit={handleSubmit} className="space-y-3">
              {/* Name */}
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
                  Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => { setName(e.target.value); setError(null); }}
                  placeholder="House deposit"
                  maxLength={40}
                  required
                  className="w-full min-h-[48px] px-3 rounded-xl bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-slate-100 border border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 text-sm"
                />
              </div>

              {/* Amount per period */}
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
                  Amount per period
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 text-sm pointer-events-none select-none">£</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => { setAmount(e.target.value); setError(null); }}
                    placeholder="0.00"
                    required
                    className="w-full min-h-[48px] pl-7 pr-3 rounded-xl bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-slate-100 border border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 text-sm text-left tabular-nums"
                  />
                </div>
              </div>

              <RhythmToggle value={recurrence} onChange={(v) => { setRecurrence(v); setError(null); }} />

              <AccountRadioPicker accounts={accounts} value={accountId} onChange={pickAccount} />

              {accountId !== "" && (
                <FillRulePicker accountId={accountId} value={rule} onChange={setRule} />
              )}

              <EffectiveDateField
                value={effectiveFrom}
                periodStartLabel={periodStartLabel}
                todayIso={todayIso()}
                onChange={setEffectiveFrom}
              />

              {/* Error */}
              {error && (
                <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>
              )}

              {/* Save / Cancel */}
              <button
                type="submit"
                disabled={!canSave}
                className="w-full min-h-[48px] rounded-xl bg-indigo-600 text-white text-sm font-semibold active:scale-95 transition-transform disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={onClose}
                className="w-full min-h-[44px] text-sm font-semibold text-slate-500 dark:text-slate-400 rounded-xl hover:opacity-80 active:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                Cancel
              </button>

              {/* Pause/resume — single tap (reversible, not destructive) */}
              {!confirmingDelete && !confirmingPause && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setConfirmingPause(true)}
                  className="w-full min-h-[44px] text-[13px] font-medium text-slate-400 dark:text-slate-500 hover:opacity-80 active:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-xl"
                >
                  {allocation.active ? "Pause this allocation" : "Resume this allocation"}
                </button>
              )}
              {confirmingPause && (
                <div className="rounded-xl bg-slate-50 dark:bg-slate-700/50 px-4 py-3 space-y-2">
                  <p className="text-[13px] text-slate-600 dark:text-slate-300 leading-snug">
                    {allocation.active
                      ? "Pause it? Nothing more will be expected from this account until you turn it back on."
                      : "Resume setting money aside each period from this account?"}
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={handleTogglePause}
                      className="flex-1 min-h-[44px] rounded-xl text-sm font-semibold text-slate-700 dark:text-slate-200 bg-slate-200/70 dark:bg-slate-600 active:scale-95 transition-transform disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    >
                      {saving ? "Saving…" : allocation.active ? "Yes, pause it" : "Yes, resume it"}
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => setConfirmingPause(false)}
                      className="flex-1 min-h-[44px] rounded-xl text-sm font-semibold text-indigo-600 dark:text-indigo-400 bg-transparent hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    >
                      Keep it
                    </button>
                  </div>
                </div>
              )}

              {/* Delete — two-step confirm (destructive/permanent) */}
              {!confirmingPause && !confirmingDelete && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setConfirmingDelete(true)}
                  className="w-full min-h-[44px] text-[13px] font-medium text-slate-400 dark:text-slate-500 hover:opacity-80 active:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-xl"
                >
                  Delete this allocation
                </button>
              )}
              {confirmingDelete && (
                <div className="rounded-xl bg-slate-50 dark:bg-slate-700/50 px-4 py-3 space-y-2">
                  <p className="text-[13px] text-slate-600 dark:text-slate-300 leading-snug">
                    Delete for good? Money already set aside stays where it is, this just stops tracking it.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={handleDelete}
                      className="flex-1 min-h-[44px] rounded-xl text-sm font-semibold text-slate-700 dark:text-slate-200 bg-slate-200/70 dark:bg-slate-600 active:scale-95 transition-transform disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    >
                      {saving ? "Deleting…" : "Yes, delete it"}
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => setConfirmingDelete(false)}
                      className="flex-1 min-h-[44px] rounded-xl text-sm font-semibold text-indigo-600 dark:text-indigo-400 bg-transparent hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    >
                      Keep it
                    </button>
                  </div>
                </div>
              )}
            </form>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
