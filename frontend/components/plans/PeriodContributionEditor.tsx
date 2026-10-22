"use client";

import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import MoneyText from "@/components/MoneyText";
import { useFlowSubmission } from "@/components/UpcomingFlowSheet";
import { EditorError, editorField, editorQuiet, editorSecondary, useEditorRequest } from "@/components/upcoming/editorSupport";

export type PeriodContributionPreview = { period_end: string; contribution: number; reserved: number; matched_this_period: number; preview_token: string; unchanged?: boolean; blocked_reason?: string | null };
export type PeriodContributionAdapter<T, P extends PeriodContributionPreview> = {
  initial: number;
  preview(pence: number): Promise<P>;
  save(input: { contribution_pence: number; period_end: string; preview_token: string }): Promise<T>;
  renderReview(preview: P): ReactNode;
};

export function toContributionPence(value: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const pounds = Number(match[1]);
  if (!Number.isSafeInteger(pounds) || pounds > 1_000_000) return null;
  const pence = pounds * 100 + Number((match[2] ?? "").padEnd(2, "0") || "0");
  return pence <= 100_000_000 ? pence : null;
}

export function periodMoney(value: number) {
  return `${value < 0 ? "−" : ""}£${Math.abs(value).toLocaleString("en-GB", { minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

export function PeriodContributionEditor<T, P extends PeriodContributionPreview>({ adapter, onCancel, onSaved, onComplete, renderActions, onBusyChange }: { adapter: PeriodContributionAdapter<T, P>; onCancel(): void; onSaved(item: T): void | Promise<void>; onComplete(): void; renderActions?: (actions: ReactNode) => ReactNode; onBusyChange?: (busy: boolean) => void }) {
  const formId = useId();
  const [step, setStep] = useState<"amount" | "review">("amount");
  const [amount, setAmount] = useState(adapter.initial.toFixed(2));
  const [retry, setRetry] = useState(0);
  const [preview, setPreview] = useState<P | null>(null);
  const [previewFor, setPreviewFor] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const request = useEditorRequest();
  const setFlowSubmission = useFlowSubmission();
  const pence = toContributionPence(amount);
  const ready = pence !== null && previewFor === pence ? preview : null;
  const unchanged = Boolean(ready?.unchanged);
  const locked = request.busy || request.needsRefresh;
  useEffect(() => {
    setFlowSubmission(locked);
    onBusyChange?.(locked);
    return () => { setFlowSubmission(false); onBusyChange?.(false); };
  }, [locked, onBusyChange, request.busy, setFlowSubmission]);
  useEffect(() => {
    if (locked) return;
    let stale = false;
    queueMicrotask(() => {
      if (stale) return;
      setLoading(pence !== null); setPreviewError("");
      if (pence === null) { setPreview(null); setPreviewFor(null); }
    });
    if (pence === null) return () => { stale = true; };
    const timer = window.setTimeout(() => adapter.preview(pence).then(value => { if (!stale) { setPreview(value); setPreviewFor(pence); } }).catch(() => { if (!stale) { setPreview(null); setPreviewFor(null); setPreviewError("We could not check this contribution. Try again."); } }).finally(() => { if (!stale) setLoading(false); }), 300);
    return () => { stale = true; window.clearTimeout(timer); };
  }, [adapter, locked, pence, retry]);
  const canReview = Boolean(ready) && !loading && !previewError && !unchanged;
  const canSave = Boolean(ready) && !ready?.blocked_reason && !loading && !request.busy && !request.needsRefresh && !unchanged;
  function submit(event: FormEvent) {
    event.preventDefault();
    if (request.needsRefresh) { void request.retryRefresh(); return; }
    if (step === "amount") { if (canReview) setStep("review"); return; }
    if (!ready || !canSave || pence === null) return;
    let saved: T;
    void request.run(() => adapter.save({ contribution_pence: pence, period_end: ready.period_end, preview_token: ready.preview_token }).then(item => { saved = item; }), onComplete, undefined, () => onSaved(saved));
  }
  const primary = "min-h-11 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-60";
  const actions = <div className="grid grid-cols-2 gap-3"><button type="button" onClick={onCancel} disabled={request.busy || request.needsRefresh} className={editorSecondary}>Back to plan</button>{step === "review" ? <button type={request.needsRefresh ? "button" : "submit"} form={request.needsRefresh ? undefined : formId} onClick={request.needsRefresh ? event => { event.preventDefault(); void request.retryRefresh(); } : undefined} disabled={request.busy || (!canSave && !request.needsRefresh)} className={primary}>{request.needsRefresh ? "Retry refresh" : request.busy ? "Saving…" : "Save changes"}</button> : <button type="button" disabled={!canReview} onClick={event => { event.preventDefault(); setStep("review"); }} className={primary}>Review changes</button>}</div>;
  return <form id={formId} aria-busy={request.busy || undefined} onSubmit={submit} className="space-y-5 [&_input]:text-base"><fieldset disabled={request.busy || request.needsRefresh} className="min-w-0 space-y-5"><p role="status" className="text-xs font-semibold text-slate-600 dark:text-slate-300">{step === "amount" ? "Amount · 1 of 2" : "Review · 2 of 2"}</p>{step === "amount" ? <><label className="block text-sm font-medium text-slate-900 dark:text-slate-100">Total for this pay period (£)<input id="goal-contribution-amount" name="goal-period-contribution" aria-describedby="goal-contribution-help" autoComplete="off" inputMode="decimal" value={amount} onChange={event => { setAmount(event.target.value); setStep("amount"); }} className={`${editorField} font-mono tabular-nums`} /></label><p id="goal-contribution-help" className="text-xs leading-5 text-slate-600 dark:text-slate-300">Choose more, less or £0. This total includes any payment already matched this pay period.</p>{pence === null && <p role="alert" className="text-sm text-slate-700 dark:text-slate-200">Enter an amount from £0 to £1,000,000 with no more than two decimal places.</p>}{loading && <p role="status" className="text-sm text-slate-600 dark:text-slate-300">Checking this contribution…</p>}{!loading && ready?.unchanged && <p role="status" className="text-sm text-slate-600 dark:text-slate-300">This is already your amount for this pay period.</p>}{previewError && <div><p role="alert" className="text-sm text-slate-700 dark:text-slate-200">{previewError}</p><button type="button" onClick={() => setRetry(v => v + 1)} className={editorQuiet}>Retry check</button></div>}</> : ready && <><div className="border-y border-slate-200 py-3 dark:border-slate-700"><div className="flex items-center justify-between gap-3"><span><span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">This pay period</span><strong className="mt-1 block font-mono text-lg text-slate-900 dark:text-slate-100"><MoneyText text={periodMoney(ready.contribution)} /></strong></span><button type="button" onClick={() => setStep("amount")} className={editorQuiet}>Change amount</button></div></div>{ready.matched_this_period > 0 && <p className="text-sm leading-6 text-slate-600 dark:text-slate-300"><MoneyText text={`${periodMoney(ready.matched_this_period)} is already matched. ${periodMoney(ready.reserved)} is still to set aside.`} /></p>}{adapter.renderReview(ready)}<p className="text-xs leading-5 text-slate-600 dark:text-slate-300">This changes your plan for this pay period only. It does not move money or change any standing order.</p></>}</fieldset><EditorError message={request.error} />{request.error && !request.needsRefresh && <button type="button" onClick={() => { request.setError(""); setStep("amount"); setRetry(v => v + 1); }} className={editorQuiet}>Recheck contribution</button>}{renderActions ? renderActions(actions) : actions}</form>;
}
