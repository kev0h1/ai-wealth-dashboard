"use client";

// G228 PROPOSAL. Hand-authored deferral sheet on the production SheetFrame.
// Not a production component; nothing is saved.

import { useId, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { SheetFrame } from "@/components/SheetFrame";
import { COPY } from "./copy";
import { GOAL, deferMath, gbp } from "./fixtures";

const BTN_GHOST = "min-h-11 rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800";
const BTN_PRIMARY = "min-h-11 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";
const BTN_STEP = "flex size-11 min-h-11 shrink-0 touch-manipulation items-center justify-center rounded-xl border border-slate-300 text-slate-700 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-40 dark:border-slate-600 dark:text-slate-200";
const BTN_CHIP = "min-h-11 rounded-full border border-slate-300 px-4 text-xs font-semibold text-slate-700 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-600 dark:text-slate-200";

export default function DeferSheet({ covered, eased, onClose, onSaved }: { covered: boolean; eased: number; onClose(): void; onSaved(reduce: number, keep: "date" | "amount"): void }) {
  const formId = useId();
  const [reduce, setReduce] = useState(GOAL.gap);
  const [keep, setKeep] = useState<"date" | "amount">("date");
  const x = deferMath(reduce);
  const set = (v: number) => setReduce(Math.min(GOAL.usual, Math.max(0, v)));

  return (
    <SheetFrame
      variant="compact"
      title={COPY.sheetTitle}
      description={COPY.sheetDescription}
      onClose={onClose}
      footer={(c) => (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3">
          <button type="button" onClick={c.close} className={BTN_GHOST}>{COPY.cancel}</button>
          <button type="submit" form={formId} disabled={reduce === 0} className={`${BTN_PRIMARY} disabled:opacity-50`}>{COPY.save}</button>
        </div>
      )}
    >
      {(c) => (
        <form id={formId} onSubmit={(e) => { e.preventDefault(); c.closeThen(() => onSaved(reduce, keep)); }} className="space-y-5">
          {covered && <p className="text-sm leading-6 text-slate-700 dark:text-slate-200">{COPY.coveredNote}</p>}

          <div>
            <p id="step-label" className="text-sm font-medium text-slate-900 dark:text-slate-100">{COPY.stepLabel}</p>
            <div className="mt-2 flex items-center gap-3" role="group" aria-labelledby="step-label">
              <button type="button" aria-label="Take £5 less off" disabled={reduce <= 0} onClick={() => set(reduce - GOAL.stepPounds)} className={BTN_STEP}><Minus size={16} aria-hidden="true" /></button>
              <p className="money min-w-0 flex-1 text-center text-2xl font-semibold text-slate-900 dark:text-white" aria-live="polite">{gbp(reduce)}</p>
              <button type="button" aria-label="Take £5 more off" disabled={reduce >= GOAL.usual} onClick={() => set(reduce + GOAL.stepPounds)} className={BTN_STEP}><Plus size={16} aria-hidden="true" /></button>
            </div>
            <input type="range" min={0} max={GOAL.usual} step={GOAL.stepPounds} value={reduce} onChange={(e) => set(Number(e.target.value))} aria-label={COPY.stepLabel} aria-valuetext={`${gbp(reduce)} off, ${gbp(x.thisPeriod)} planned this period`} className="mt-3 min-h-11 w-full accent-indigo-600" />
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => set(GOAL.gap)} className={BTN_CHIP}>{COPY.coverGap}</button>
              <button type="button" onClick={() => set(GOAL.usual)} className={BTN_CHIP}>{COPY.skip}</button>
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-400">{COPY.stepHint}</p>
            <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">{COPY.planned}: <span className="money font-semibold">{gbp(x.thisPeriod)}</span></p>
          </div>

          <fieldset>
            <legend className="text-sm font-medium text-slate-900 dark:text-slate-100">{COPY.choiceLegend}</legend>
            <div className="mt-2 divide-y divide-slate-200 rounded-xl border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
              {([
                ["date", COPY.keepDateTitle, `About ${gbp(x.keepDatePer)} each period after this, with ${gbp(x.keepDateFinal)} in the last.`],
                ["amount", COPY.keepAmountTitle, x.periodsLater === 0 ? "Should still land on time." : `Should land ${x.periodsLater} ${x.periodsLater === 1 ? "period" : "periods"} later, in ${x.landsLabel}.`],
              ] as const).map(([id, title, detail]) => (
                <label key={id} className="flex min-h-11 cursor-pointer items-start gap-3 p-3 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-indigo-500">
                  <input type="radio" name="keep" checked={keep === id} onChange={() => setKeep(id)} className="mt-1 size-4 accent-indigo-600" />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</span>
                    <span className="mt-0.5 block text-xs leading-5 text-slate-600 dark:text-slate-400">{detail}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <section aria-label={COPY.workingTitle}>
            <h3 className="text-sm font-medium text-slate-900 dark:text-slate-100">{COPY.workingTitle}</h3>
            <dl className="mt-2 text-xs text-slate-700 dark:text-slate-300">
              <div className="flex justify-between gap-3 py-1"><dt>Remaining before this period</dt><dd className="money">{gbp(GOAL.remaining)}</dd></div>
              <div className="flex justify-between gap-3 py-1"><dt>Planned this period</dt><dd className="money">{gbp(x.thisPeriod)}</dd></div>
              <div className="flex justify-between gap-3 border-t border-slate-300 py-1.5 font-semibold dark:border-slate-600"><dt>Remaining afterwards</dt><dd className="money">{gbp(x.after)}</dd></div>
              {keep === "date" ? (
                <>
                  <div className="flex justify-between gap-3 py-1"><dt>{gbp(x.after)} over {x.later} later periods</dt><dd className="money">{gbp(Math.round(x.exactPer * 100) / 100)}</dd></div>
                  <div className="flex justify-between gap-3 py-1"><dt>Rounded up to the pound</dt><dd className="money">{gbp(x.keepDatePer)}</dd></div>
                </>
              ) : (
                <>
                  <div className="flex justify-between gap-3 py-1"><dt>{gbp(x.after)} at {gbp(GOAL.usual)} a period</dt><dd className="money">{x.keepAmountPeriods} periods</dd></div>
                  <div className="flex justify-between gap-3 py-1"><dt>Last one takes the rest</dt><dd className="money">{gbp(x.keepAmountFinal)}</dd></div>
                </>
              )}
            </dl>
          </section>

          <p className="text-xs leading-5 text-slate-600 dark:text-slate-400">{COPY.limits(eased)} {COPY.noBank} {COPY.roundingCaveat}</p>
          <div className="border-t border-slate-200 pt-3 dark:border-slate-700">
            <p className="text-xs font-medium text-slate-900 dark:text-slate-100">{COPY.auditHeading}</p>
            <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-400">{COPY.audit(reduce, keep)}</p>
          </div>
        </form>
      )}
    </SheetFrame>
  );
}
