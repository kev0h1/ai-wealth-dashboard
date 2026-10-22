"use client";

import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { api, type Commitment, type GoalContributionPreview } from "@/lib/api";
import MoneyText from "@/components/MoneyText";
import { PlanEditorSummaryRow } from "@/components/plans/PlanEditorSummary";
import { EditorError, editorField, editorQuiet, editorSecondary, useEditorRequest } from "@/components/upcoming/editorSupport";

type GoalContributionServices = Pick<typeof api, "previewGoalContribution" | "setGoalContribution">;

export interface GoalContributionEditorProps {
  commitment: Commitment;
  services?: GoalContributionServices;
  onCancel(): void;
  onChangeDate(): void;
  onSaved(item: Commitment): void | Promise<void>;
  onComplete(): void;
  renderActions?: (actions: ReactNode) => ReactNode;
  onBusyChange?: (busy: boolean) => void;
}

function poundsToPence(value: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const whole = Number(match[1]);
  if (!Number.isSafeInteger(whole) || whole > 1_000_000) return null;
  const pence = Number((match[2] ?? "").padEnd(2, "0") || "0");
  const total = whole * 100 + pence;
  return total <= 100_000_000 ? total : null;
}

function amountInput(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

function money(value: number): string {
  const absolute = Math.abs(value).toLocaleString("en-GB", { minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 });
  return `${value < 0 ? "−" : ""}£${absolute}`;
}

/** One current-pay-period contribution draft. The server owns all projection maths. */
export function GoalContributionEditor({ commitment, services = api, onCancel, onChangeDate, onSaved, onComplete, renderActions, onBusyChange }: GoalContributionEditorProps) {
  const formId = useId();
  const initial = commitment.current_period_contribution?.contribution ?? commitment.planned_per_period_slice ?? commitment.usual_slice ?? commitment.per_period_slice;
  const [step, setStep] = useState<"amount" | "review">("amount");
  const [amount, setAmount] = useState(() => amountInput(initial));
  const [retry, setRetry] = useState(0);
  const [preview, setPreview] = useState<GoalContributionPreview | null>(null);
  const [previewFor, setPreviewFor] = useState<number | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const request = useEditorRequest();
  const pence = poundsToPence(amount);
  const validAmount = pence !== null;
  const readyPreview = validAmount && previewFor === pence ? preview : null;

  useEffect(() => {
    onBusyChange?.(request.busy);
    return () => { onBusyChange?.(false); };
  }, [onBusyChange, request.busy]);

  useEffect(() => {
    let stale = false;
    queueMicrotask(() => {
      if (stale) return;
      setPreviewBusy(pence !== null);
      setPreviewError("");
      if (pence === null) { setPreview(null); setPreviewFor(null); }
    });
    if (pence === null) return () => { stale = true; };
    const timer = window.setTimeout(() => {
      services.previewGoalContribution(commitment.id, pence)
        .then(result => {
          if (stale) return;
          setPreview(result);
          setPreviewFor(pence);
        })
        .catch(() => { if (!stale) { setPreview(null); setPreviewFor(null); setPreviewError("We could not check this contribution. Try again."); } })
        .finally(() => { if (!stale) setPreviewBusy(false); });
    }, 300);
    return () => { stale = true; window.clearTimeout(timer); };
  }, [commitment.id, pence, retry, services]);

  const canReview = validAmount && !previewBusy && Boolean(readyPreview) && !previewError;
  const canSave = Boolean(readyPreview && !readyPreview.blocked_reason && !previewBusy && !request.busy);

  function continueToReview() {
    if (canReview) setStep("review");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (request.needsRefresh) {
      void request.retryRefresh();
      return;
    }
    if (step === "amount") { continueToReview(); return; }
    if (step !== "review" || !readyPreview || !canSave || pence === null) return;
    let saved: Commitment;
    void request.run(
      async () => { saved = await services.setGoalContribution(commitment.id, { contribution_pence: pence, period_end: readyPreview.period_end, preview_token: readyPreview.preview_token }); },
      onComplete,
      undefined,
      async () => { await onSaved(saved); },
    );
  }

  const actions = step === "amount"
    ? <div className="grid grid-cols-2 gap-3"><button type="button" onClick={onCancel} disabled={request.busy} className={editorSecondary}>Back to plan</button><button type="button" onClick={event => { event.preventDefault(); continueToReview(); }} disabled={!canReview || request.busy} className="min-h-11 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-60">Review changes</button></div>
    : <div className="grid grid-cols-2 gap-3"><button type="button" onClick={onCancel} disabled={request.busy || request.needsRefresh} className={editorSecondary}>Back to plan</button><button type={request.needsRefresh ? "button" : "submit"} form={request.needsRefresh ? undefined : formId} onClick={request.needsRefresh ? event => { event.preventDefault(); void request.retryRefresh(); } : undefined} disabled={!canSave} className="min-h-11 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-60">{request.needsRefresh ? "Retry refresh" : request.busy ? "Saving…" : "Save changes"}</button></div>;

  return <form id={formId} onSubmit={submit} className="space-y-5 [&_input]:text-base" aria-busy={request.busy || undefined}>
    <fieldset disabled={request.busy || request.needsRefresh} className="min-w-0 space-y-5">
      <p tabIndex={-1} className="text-xs font-semibold text-slate-600 outline-none dark:text-slate-300">{step === "amount" ? "Amount · 1 of 2" : "Review · 2 of 2"}</p>
      {step === "amount" ? <>
        <div>
          <label htmlFor="goal-contribution-amount" className="block text-sm font-medium text-slate-900 dark:text-slate-100">Total for this pay period (£)</label>
          <input id="goal-contribution-amount" name="goal-period-contribution" autoComplete="off" inputMode="decimal" value={amount} onChange={event => { setAmount(event.target.value); setStep("amount"); }} className={`${editorField} font-mono tabular-nums`} aria-describedby="goal-contribution-help" />
          <p id="goal-contribution-help" className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-300">Choose more, less or £0. This total includes any payment already matched this pay period.</p>
        </div>
        {!validAmount && <p role="alert" className="text-sm text-slate-700 dark:text-slate-200">Enter an amount from £0 to £1,000,000 with no more than two decimal places.</p>}
        {previewBusy && <p className="text-sm text-slate-600 dark:text-slate-300" role="status">Checking this contribution…</p>}
        {previewError && <div className="space-y-2"><p role="alert" className="text-sm text-slate-700 dark:text-slate-200">{previewError}</p><button type="button" onClick={() => setRetry(value => value + 1)} className={editorQuiet}>Retry check</button></div>}
      </> : readyPreview ? <>
        <PlanEditorSummaryRow label="This pay period" value={<MoneyText text={money(readyPreview.contribution)} />} detail={readyPreview.capped ? "Capped at the amount still needed for this target." : undefined} onEdit={() => setStep("amount")} />
        <button type="button" onClick={() => setStep("amount")} className={editorQuiet}>Change amount</button>
        <p className="text-xs leading-5 text-slate-600 dark:text-slate-300">Target: {new Date(`${readyPreview.target_date.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}.</p>
        {readyPreview.matched_this_period > 0 && <p className="text-sm leading-6 text-slate-600 dark:text-slate-300"><MoneyText text={`${money(readyPreview.matched_this_period)} is already matched this pay period.`} /> Your total includes it.</p>}
        {readyPreview.capped && readyPreview.requested_contribution !== readyPreview.contribution && <p className="text-sm leading-6 text-slate-600 dark:text-slate-300"><MoneyText text={`${money(readyPreview.requested_contribution)} was requested; ${money(readyPreview.contribution)} is the effective total for this pay period.`} /></p>}
        {readyPreview.blocked_reason ? <div className="space-y-2"><p role="alert" className="text-sm leading-6 text-slate-700 dark:text-slate-200">{readyPreview.blocked_reason}</p><button type="button" onClick={onChangeDate} className={editorQuiet}>Change target date</button></div> : <>
          {readyPreview.covers_remaining ? <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">This would cover the remaining target. <MoneyText text="Later periods would be £0." /> It is planned, not cash already saved.</p> : readyPreview.later_contribution !== null && <p className="text-sm leading-6 text-slate-600 dark:text-slate-300"><MoneyText text={`If you set aside ${money(readyPreview.reserved)} now, later periods would be about ${money(readyPreview.later_contribution)} each to aim for your target.`} /></p>}
          {readyPreview.large_increase && <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">Later periods would need a higher contribution to aim for this target date. You can choose a different target date.</p>}
          {readyPreview.replaces_easing && <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">This replaces the eased contribution for this pay period.</p>}
          {readyPreview.large_increase && <button type="button" onClick={onChangeDate} className={editorQuiet}>Change target date</button>}
        </>}
      </> : <p className="text-sm text-slate-600 dark:text-slate-300">Checking this contribution…</p>}
    </fieldset>
    <EditorError message={request.error} />
    {request.error && !request.needsRefresh && <button type="button" onClick={() => { request.setError(""); setStep("amount"); setRetry(value => value + 1); }} className={editorQuiet}>Check the contribution again</button>}
    {renderActions ? renderActions(actions) : actions}
  </form>;
}

export default GoalContributionEditor;
