"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { api, Checkpoint } from "@/lib/api";
import { useLockBodyScroll } from "@/lib/useLockBodyScroll";
import { useSheetOpen } from "@/lib/useSheetOpen";
import { useSheetA11y } from "@/lib/useSheetA11y";
import PennyMark from "@/components/PennyMark";

interface AimSheetProps {
  category: string;
  onClose: () => void;
  // Called once the checkpoint is created — parent can refresh its aims list.
  onSaved?: (checkpoint: Checkpoint) => void;
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
export default function AimSheet({ category, onClose, onSaved }: AimSheetProps) {
  useLockBodyScroll();
  useSheetOpen();
  const panelRef = useSheetA11y<HTMLDivElement>(onClose);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [loading, setLoading] = useState(true);
  const [usual, setUsual] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
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
        const prefill = sig?.suggested_aim ?? (u != null ? roundTo5(u * 0.93) : null);
        if (prefill != null) setAmount(String(Math.round(prefill)));
      })
      .catch(() => {
        // No baseline available — input stays empty; backend derives on save
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
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
      const cp = await api.createCheckpoint(category, amountValid ? parsed : undefined);
      setSaved(true);
      onSaved?.(cp);
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  if (!mounted) return null;

  return createPortal(
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-[65] fade-in" onClick={onClose} />

      {/* Sheet — bottom sheet on mobile, centered modal on desktop */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Set an aim for ${category}`}
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
            Set an aim for {category}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors flex-shrink-0"
          >
            <X size={16} color="#64748b" />
          </button>
        </div>

        <div className="px-5 pb-8 lg:pb-6">
          {saved ? (
            <div className="glass-card rounded-2xl p-4">
              <p className="text-[15px] text-slate-700 dark:text-slate-200 leading-relaxed">
                Aim set, Penny will track it with you.
              </p>
              <button
                onClick={onClose}
                className="mt-3 inline-flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 active:scale-95 transition-[transform,background-color] text-white text-sm font-semibold px-4 py-2 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 min-h-[44px]"
              >
                Done
              </button>
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
                      ? <>Your usual is about <strong className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">{fmtWhole(usual)}/period</strong>. Set an aim to track against:</>
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
                        className="text-[15px] text-slate-900 dark:text-slate-100 bg-transparent outline-none w-24"
                      />
                    </div>
                    <button
                      disabled={!canSave}
                      onClick={handleSave}
                      className="text-sm font-semibold text-white rounded-xl px-4 py-2 min-h-[44px] active:scale-95 transition-transform disabled:opacity-60 bg-indigo-600 hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    >
                      {saving ? "Saving…" : "Save aim"}
                    </button>
                    <button
                      disabled={saving}
                      onClick={onClose}
                      className="text-sm font-semibold text-slate-500 dark:text-slate-400 rounded-xl px-4 py-2 min-h-[44px] hover:opacity-80 active:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    >
                      Cancel
                    </button>
                  </div>

                  {saveError && (
                    <p className="mt-2 text-[13px] text-slate-500 dark:text-slate-400">
                      That didn&apos;t save. Try again.
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </>,
    document.body
  );
}
