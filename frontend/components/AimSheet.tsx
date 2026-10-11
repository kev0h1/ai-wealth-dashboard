"use client";

import { useState, useEffect } from "react";
import { api, Checkpoint } from "@/lib/api";
import PennyMark from "@/components/PennyMark";
import { SheetFrame } from "@/components/SheetFrame";

interface AimSheetProps {
  category: string;
  onClose: () => void;
  // Called once the checkpoint is created — parent can refresh its aims list.
  onSaved?: (checkpoint: Checkpoint) => void;
  // G242 (all optional; omit them and the sheet behaves exactly as before).
  // baseline — a ready usual figure, so the sheet does not fetch it (design
  //   previews and any caller that already holds the signal).
  baseline?: { usual: number | null; suggestedAim?: number | null };
  // existingAmount — editing a live aim: prefills it and says so.
  existingAmount?: number;
  // onSubmit — replaces the POST /checkpoints save (previews, edit flows).
  onSubmit?: (amount: number | undefined) => Promise<void> | void;
  // onRemove — shows "Remove this aim" when editing.
  onRemove?: () => Promise<void> | void;
}

function fmtWhole(n: number): string {
  return `£${Math.round(n).toLocaleString("en-GB")}`;
}

// Round to the nearest £5, never below £5.
function roundTo5(n: number): number {
  return Math.max(5, Math.round(n / 5) * 5);
}

// Aim-setting sheet for the Mirror's "This isn't me, change it" path.
// Fetches the category's usual-period baseline from /spend/category-signals,
// prefils the derived aim (backend suggested_aim when present, otherwise
// ~93% of usual rounded to £5), and saves via POST /checkpoints. Cancelling
// keeps the recorded choice — no checkpoint is created.
export default function AimSheet({ category, onClose, onSaved, baseline, existingAmount, onSubmit, onRemove }: AimSheetProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [loading, setLoading] = useState(true);
  const [usual, setUsual] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (baseline) {
      const u = baseline.usual ?? baseline.suggestedAim ?? null;
      setUsual(u);
      const prefill = existingAmount ?? baseline.suggestedAim ?? (u != null ? roundTo5(u * 0.93) : null);
      if (prefill != null) setAmount(String(Math.round(prefill)));
      setLoading(false);
      return;
    }
    let cancelled = false;
    api.categorySignals()
      .then(d => {
        if (cancelled) return;
        const sig = d.signals[category];
        const periodDays = d.period.days_elapsed + (d.period.days_left ?? 0);
        // "Usual" = the category's own per-period baseline
        const u = sig?.usual_rate_per_day != null && periodDays > 0
          ? sig.usual_rate_per_day * periodDays
          : sig?.suggested_aim ?? null;
        setUsual(u);
        // Prefill: the backend-derived aim where available, else ~93% of usual
        const prefill = existingAmount ?? sig?.suggested_aim ?? (u != null ? roundTo5(u * 0.93) : null);
        if (prefill != null) setAmount(String(Math.round(prefill)));
      })
      .catch(() => {
        // No baseline available — input stays empty; backend derives on save
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // baseline and existingAmount are fixtures or one-shot seeds, not re-fetch triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  const parsed = parseFloat(amount.replace(/[^0-9.]/g, ""));
  const amountValid = !isNaN(parsed) && parsed > 0;
  // Empty input is allowed — the backend derives the aim from the baseline.
  const canSave = !saving && (amountValid || amount.trim() === "");

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setSaveError(false);
    try {
      if (onSubmit) {
        await onSubmit(amountValid ? parsed : undefined);
        setSaved(true);
      } else {
        const cp = await api.createCheckpoint(category, amountValid ? parsed : undefined);
        setSaved(true);
        onSaved?.(cp);
      }
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  if (!mounted) return null;

  return (
    <SheetFrame
      title={existingAmount != null ? `Your ${category} aim` : `Set an aim for ${category}`}
      onClose={onClose}
      footer={({ close }) => saved ? (
        <button onClick={close} className="w-full rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-[transform,background-color] hover:bg-indigo-700 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
          Done
        </button>
      ) : (
        <button disabled={saving} onClick={close} className="w-full rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 active:scale-95 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
          Cancel
        </button>
      )}
    >
          {saved ? (
            <div className="glass-card rounded-2xl p-4">
              <p className="text-[15px] text-slate-700 dark:text-slate-200 leading-relaxed">
                Aim set, Penny will track it with you.
              </p>
            </div>
          ) : (
            <div className="glass-card rounded-2xl p-4">
              {/* Penny gradient chip — this is an AI advice surface */}
              <div className="flex items-center gap-2 mb-3">
                <span
                  className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-white rounded-full px-2.5 py-1"
                  style={{ background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)" }}
                >
                  <PennyMark size={11} />
                  Penny
                </span>
              </div>

              {loading ? (
                <div className="space-y-2 animate-pulse" aria-hidden="true">
                  <div className="h-4 w-3/4 bg-slate-100 dark:bg-slate-700/60 rounded" />
                  <div className="h-10 w-32 bg-slate-100 dark:bg-slate-700/60 rounded-xl" />
                </div>
              ) : (
                <>
                  <p className="text-[15px] text-slate-700 dark:text-slate-200 leading-relaxed mb-3">
                    {usual != null
                      ? <>Your usual is about <strong className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">{fmtWhole(usual)}/period</strong>. {existingAmount != null ? "Adjust the aim you check against:" : "Set an aim to track against:"}</>
                      : existingAmount != null
                        ? <>Adjust the aim you check against for {category}:</>
                        : <>Set an aim for {category} to track against, leave it blank and I&apos;ll work one out from your own baseline:</>}
                  </p>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-1 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 bg-slate-50 dark:bg-slate-700 focus-within:ring-2 focus-within:ring-indigo-500">
                      <span className="text-[15px] text-slate-500 dark:text-slate-400">£</span>
                      <input
                        inputMode="decimal"
                        aria-label="Aim amount"
                        placeholder="Amount"
                        value={amount}
                        onChange={e => { setAmount(e.target.value); setSaveError(false); }}
                        className="text-[15px] text-slate-900 dark:text-slate-100 bg-transparent outline-none w-24 [@media(pointer:coarse)]:w-28"
                      />
                    </div>
                    <button
                      disabled={!canSave}
                      onClick={handleSave}
                      className="text-sm font-semibold text-white rounded-xl px-4 py-2 min-h-[44px] active:scale-95 transition-transform disabled:opacity-60 bg-indigo-600 hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    >
                      {saving ? "Saving…" : "Save aim"}
                    </button>
                  </div>
                  {(onSubmit || baseline) && (
                    <p className="mt-2 text-[13px] text-slate-500 dark:text-slate-400">
                      A pace check, not a limit. Spending past it is fine, you will just see where you are.
                    </p>
                  )}
                  {onRemove && existingAmount != null && (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={async () => { setSaving(true); try { await onRemove(); } finally { setSaving(false); } }}
                      className="mt-2 inline-flex min-h-[44px] items-center text-sm font-medium text-slate-600 transition-opacity hover:text-slate-900 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-300 dark:hover:text-slate-100"
                    >
                      Remove this aim
                    </button>
                  )}

                  {saveError && (
                    <p className="mt-2 text-[13px] text-slate-500 dark:text-slate-400">
                      That didn&apos;t save. Try again.
                    </p>
                  )}
                </>
              )}
            </div>
          )}
    </SheetFrame>
  );
}
