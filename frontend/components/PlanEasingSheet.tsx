"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Minus, Plus } from "lucide-react";
import type { PlanEasePreview, api } from "@/lib/api";
import { SheetFrame } from "@/components/SheetFrame";

export type PlanEasingServices = Pick<typeof api, "previewPlanEase" | "easePlan">;

const STEP = 5;
const MAX_PER_12_MONTHS = 2;

const BTN_GHOST = "min-h-11 rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800";
const BTN_PRIMARY = "min-h-11 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50";
const BTN_STEP = "flex size-11 min-h-11 shrink-0 touch-manipulation items-center justify-center rounded-xl border border-slate-300 text-slate-700 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-40 dark:border-slate-600 dark:text-slate-200";
const BTN_CHIP = "min-h-11 rounded-full border border-slate-300 px-4 text-xs font-semibold text-slate-700 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-600 dark:text-slate-200";

const gbp = (v: number) => `£${v.toLocaleString("en-GB", { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 })}`;
const monthYear = (iso: string) => new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
const periods = (n: number) => `${n} ${n === 1 ? "period" : "periods"}`;

type Mode = "keep_date" | "keep_amount";

/**
 * G228 (Kevin picked A, 2026-10-07): ease a goal plan for THIS pay period.
 * A £5 stepper and slider take some or all of this period's contribution off,
 * then the user chooses how it is made up: keep the date (later periods rise)
 * or keep the amount (the date moves). Every figure comes from the server's
 * ease-preview (the engine's own rounding, caps included), never recomputed
 * here. Saving writes the one-period easing; there is no undo, because editing
 * the plan on Planning is the way back. Nothing here moves money.
 */
export function PlanEasingSheet({ planId, planName, usualSlice, targetDate, easedCount12m, suggestedReduce, services, onClose, onSaved }: {
  planId: string;
  planName: string;
  /** The usual contribution this period, in pounds (a multiple of £5). */
  usualSlice: number;
  /** Current target date, ISO. */
  targetDate: string;
  /** Periods this plan has been eased in the last 12 months. */
  easedCount12m: number;
  /** Reduction to start on, in pounds; clamped to £5 steps. */
  suggestedReduce: number;
  services: PlanEasingServices;
  onClose(): void;
  onSaved(): void | Promise<void>;
}) {
  const formId = useId();
  const labelId = useId();
  const clamp = (v: number) => Math.min(usualSlice, Math.max(0, v));
  const [reduce, setReduce] = useState(() => clamp(Math.ceil(suggestedReduce / STEP) * STEP || STEP));
  const [mode, setMode] = useState<Mode>("keep_date");
  const [preview, setPreview] = useState<PlanEasePreview | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const latest = useRef(0);
  const thisPeriod = usualSlice - reduce;

  useEffect(() => {
    if (reduce <= 0) return;
    const ticket = ++latest.current;
    const timer = setTimeout(() => {
      services.previewPlanEase(planId, usualSlice - reduce).then(
        (p) => { if (latest.current === ticket) { setPreview(p); setPreviewError(false); } },
        () => { if (latest.current === ticket) setPreviewError(true); },
      );
    }, 120);
    return () => clearTimeout(timer);
  }, [reduce, planId, usualSlice, services]);

  const fresh = preview !== null && preview.contribution === thisPeriod;
  const blocked = preview?.blocked_reason ?? null;
  const options = fresh ? { keep_date: preview.keep_date, keep_amount: preview.keep_amount } : null;
  const chosen = options?.[mode] ?? null;
  const canSave = reduce > 0 && !!chosen && chosen.refused === null && !blocked && !busy;

  // If the chosen way is refused for this amount but the other is fine, move to it.
  useEffect(() => {
    if (!options) return;
    if (options[mode].refused && !options[mode === "keep_date" ? "keep_amount" : "keep_date"].refused) {
      setMode(mode === "keep_date" ? "keep_amount" : "keep_date");
    }
  }, [options, mode]);

  const set = (v: number) => setReduce(clamp(v));
  const keptDate = monthYear(targetDate);
  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const laterFigure = chosen?.later_slice != null ? gbp(chosen.later_slice) : null;
  const auditLine = chosen
    ? mode === "keep_date"
      ? `${today}. This period's contribution reduced from ${gbp(usualSlice)} to ${gbp(thisPeriod)}. Kept ${keptDate}${laterFigure ? `: about ${laterFigure} a period after this` : ""}. No money moved.`
      : `${today}. This period's contribution reduced from ${gbp(usualSlice)} to ${gbp(thisPeriod)}. Kept ${gbp(usualSlice)} a period: ${chosen.date_moves_periods === 0 ? `should still land in ${keptDate}` : `date moves from ${keptDate} to ${monthYear(chosen.target_date)}`}. No money moved.`
    : null;

  async function submit(event: FormEvent, close: () => void) {
    event.preventDefault();
    if (!canSave) return;
    setBusy(true);
    setError("");
    try {
      await services.easePlan(planId, thisPeriod, mode);
      close();
      await onSaved();
    } catch {
      setError("Couldn't save that. Try again, or edit the plan on Planning.");
      setBusy(false);
    }
  }

  const choice = (id: Mode, title: string, detail: string, refused: string | null) => (
    <label key={id} className={`flex min-h-11 items-start gap-3 p-3 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-indigo-500 ${refused ? "opacity-60" : "cursor-pointer"}`}>
      <input type="radio" name="easing-mode" checked={mode === id} disabled={!!refused || busy} onChange={() => setMode(id)} className="mt-1 size-4 accent-indigo-600" />
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</span>
        <span className="mt-0.5 block text-xs leading-5 text-slate-600 dark:text-slate-400">{refused ?? detail}</span>
      </span>
    </label>
  );

  return (
    <SheetFrame
      variant="compact"
      title={`Ease ${planName} this period`}
      description="This period only. Later periods catch up."
      onClose={onClose}
      footer={(c) => (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3">
          <button type="button" onClick={c.close} disabled={busy} className={BTN_GHOST}>Cancel</button>
          <button type="submit" form={formId} disabled={!canSave} className={BTN_PRIMARY}>Save plan change</button>
        </div>
      )}
    >
      {(c) => (
        <form id={formId} onSubmit={(e) => submit(e, c.close)} className="space-y-5">
          <div>
            <p id={labelId} className="text-sm font-medium text-slate-900 dark:text-slate-100">Reduce this period by</p>
            <div className="mt-2 flex items-center gap-3" role="group" aria-labelledby={labelId}>
              <button type="button" aria-label="Take £5 less off" disabled={reduce <= 0} onClick={() => set(reduce - STEP)} className={BTN_STEP}><Minus size={16} aria-hidden="true" /></button>
              <p className="money min-w-0 flex-1 text-center text-2xl font-semibold text-slate-900 dark:text-white" aria-live="polite">{gbp(reduce)}</p>
              <button type="button" aria-label="Take £5 more off" disabled={reduce >= usualSlice} onClick={() => set(reduce + STEP)} className={BTN_STEP}><Plus size={16} aria-hidden="true" /></button>
            </div>
            <input type="range" min={0} max={usualSlice} step={STEP} value={reduce} onChange={(e) => set(Number(e.target.value))} aria-label="Reduce this period by" aria-valuetext={`${gbp(reduce)} off, ${gbp(thisPeriod)} planned this period`} className="mt-3 min-h-11 w-full accent-indigo-600" />
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => set(usualSlice)} className={BTN_CHIP}>Skip this period</button>
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-400">In £{STEP} steps, from £0 up to the whole {gbp(usualSlice)}.</p>
            <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">Planned this period: <span className="money font-semibold">{gbp(thisPeriod)}</span></p>
          </div>

          {blocked && <p role="status" className="text-sm leading-6 text-slate-700 dark:text-slate-200">{blocked}</p>}
          {previewError && <p role="status" className="text-sm leading-6 text-slate-700 dark:text-slate-200">Couldn&apos;t work that out just now. Try another amount, or try again in a moment.</p>}

          <fieldset aria-busy={!fresh && !previewError} disabled={busy}>
            <legend className="text-sm font-medium text-slate-900 dark:text-slate-100">Then catch up by</legend>
            <div className="mt-2 divide-y divide-slate-200 rounded-xl border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
              {choice(
                "keep_date",
                `Keep ${keptDate}`,
                options ? (options.keep_date.later_slice != null ? `About ${gbp(options.keep_date.later_slice)} each period after this.` : "Later periods carry the rest.") : "Working it out.",
                options?.keep_date.refused ?? null,
              )}
              {choice(
                "keep_amount",
                `Keep ${gbp(usualSlice)} each period`,
                options ? (options.keep_amount.date_moves_periods === 0 ? "Should still land on time." : `Should land ${periods(options.keep_amount.date_moves_periods)} later, in ${monthYear(options.keep_amount.target_date)}.`) : "Working it out.",
                options?.keep_amount.refused ?? null,
              )}
            </div>
          </fieldset>

          {fresh && chosen && (
            <section aria-label="How we worked it out">
              <h3 className="text-sm font-medium text-slate-900 dark:text-slate-100">How we worked it out</h3>
              <dl className="mt-2 text-xs text-slate-700 dark:text-slate-300">
                <div className="flex justify-between gap-3 py-1"><dt>Usual this period</dt><dd className="money">{gbp(usualSlice)}</dd></div>
                <div className="flex justify-between gap-3 py-1"><dt>Taken off</dt><dd className="money">−{gbp(reduce)}</dd></div>
                <div className="flex justify-between gap-3 border-t border-slate-300 py-1.5 font-semibold dark:border-slate-600"><dt>This period</dt><dd className="money">{gbp(thisPeriod)}</dd></div>
                <div className="flex justify-between gap-3 py-1"><dt>Left to save afterwards</dt><dd className="money">{gbp(Math.max(0, preview.remaining - thisPeriod))}</dd></div>
                {chosen.later_slice != null && (
                  <div className="flex justify-between gap-3 py-1"><dt>Later periods, rounded up to £{STEP}</dt><dd className="money">{gbp(chosen.later_slice)}</dd></div>
                )}
              </dl>
            </section>
          )}

          <p className="text-xs leading-5 text-slate-600 dark:text-slate-400">
            Eased {easedCount12m} of {MAX_PER_12_MONTHS} times in the last 12 months. Later periods stay within a quarter of the usual {gbp(usualSlice)}, and the date moves by at most two periods. This changes your plan, not a bank payment.
          </p>
          {error && <p role="alert" className="rounded-xl border border-slate-300 p-3 text-sm leading-6 text-slate-700 dark:border-slate-600 dark:text-slate-200">{error}</p>}
          {auditLine && (
            <div className="border-t border-slate-200 pt-3 dark:border-slate-700">
              <p className="text-xs font-medium text-slate-900 dark:text-slate-100">Note we will add to the plan</p>
              <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-400">{auditLine}</p>
            </div>
          )}
        </form>
      )}
    </SheetFrame>
  );
}
