"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { api } from "@/lib/api";
import { DateField } from "./DatePicker";
import { dateLabel } from "@/lib/upcomingPlans";
import { EditorActions, EditorError, editorField, editorQuiet, useEditorRequest, validDate } from "./upcoming/editorSupport";

export type UpcomingEditItem = { name: string; amount: number; expected_date: string; original_date?: string | null; type: "bill" | "income"; edited?: boolean; rule_label?: string | null };
export type UpcomingEditServices = Pick<typeof api, "editUpcoming" | "clearUpcomingOverride" | "skipUpcomingOccurrence" | "previewUpcomingRule" | "applyUpcomingRule" | "clearUpcomingRule">;
export interface UpcomingEditFormProps {
  item: UpcomingEditItem; onCancel(): void; onDismiss(): void;
  /** Where to go after a successful change; defaults to onCancel (one step back). */
  onDone?: () => void;
  onSaved(): void | Promise<void>; services?: UpcomingEditServices;
  renderActions?: (actions: ReactNode) => ReactNode;
}

export function UpcomingEditForm({ item, onCancel, onDone, onDismiss, onSaved, services = api, renderActions }: UpcomingEditFormProps) {
  const formId = useId();
  const [date, setDate] = useState(item.expected_date);
  const [amount, setAmount] = useState(item.amount.toFixed(2));
  const [scope, setScope] = useState<"one" | "future">("one");
  const [removing, setRemoving] = useState(false);
  const [ruleText, setRuleText] = useState("");
  const [rulePreview, setRulePreview] = useState<{ schedule: Record<string, unknown>; label: string; next_dates: string[] } | null>(null);
  const request = useEditorRequest();
  const previewGeneration = useRef(0);
  useEffect(() => () => { previewGeneration.current += 1; }, []);
  const originalDate = item.original_date ?? item.expected_date;
  async function mutate(operation: () => Promise<unknown>) { await request.run(operation, onDone ?? onCancel, undefined, onSaved); }
  function save(event: FormEvent) {
    event.preventDefault();
    if (request.needsRefresh) { void request.retryRefresh(); return; }
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1000000 || !validDate(date)) { request.setError("Enter a valid date and an amount between £0.01 and £1,000,000."); return; }
    if (date === item.expected_date && parsed === item.amount) { onCancel(); return; }
    void mutate(() => services.editUpcoming({ key: item.name, date: originalDate, scope, ...(date !== item.expected_date ? { new_date: date } : {}), ...(parsed !== item.amount ? { new_amount: parsed } : {}) }));
  }
  async function previewRule() {
    const generation = ++previewGeneration.current;
    await request.run(async () => {
      const result = await services.previewUpcomingRule({ key: item.name, text: ruleText, anchor_date: item.expected_date });
      if (generation !== previewGeneration.current) return;
      if (!result.ok || !result.schedule || !result.label || !result.next_dates) { request.setError(result.error || "Try a schedule such as every Sunday or the last Friday of the month."); return; }
      setRulePreview({ schedule: result.schedule, label: result.label, next_dates: result.next_dates });
    }, undefined, "The schedule could not be checked. Your text is still here. Try again.");
  }
  return <form id={formId} onSubmit={save} className="space-y-6">
    <div><h3 className="text-sm font-semibold">Payment details</h3><p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-400">Adjust the prediction. This does not change a bank payment.</p></div>
    <fieldset disabled={request.busy || request.needsRefresh} className="min-w-0 space-y-6">
      <div className="grid gap-4 min-[380px]:grid-cols-2">
        <label className="min-w-0 text-sm font-medium">Expected date<DateField mode="day" label="Expected date" value={date} onChange={setDate} required className="mt-1" /></label>
        <label className="min-w-0 text-sm font-medium">Amount (£)<input type="number" min="0.01" max="1000000" step="0.01" inputMode="decimal" autoComplete="off" value={amount} onChange={(event) => setAmount(event.target.value)} required className={editorField} /></label>
      </div>
      <fieldset className="border-t border-slate-200 pt-4 dark:border-slate-700"><legend className="pr-3 text-sm font-semibold">Apply changes to</legend><div className="mt-1 space-y-1">
        {([["one", "Just this payment", "Keep the usual prediction."], ["future", "This and future payments", "Use the new date and amount going forward."]] as const).map(([value, label, hint]) => <label key={value} className="flex min-h-14 cursor-pointer items-center gap-3 rounded-lg py-2"><input type="radio" name={formId + "-scope"} value={value} checked={scope === value} onChange={() => setScope(value)} className="size-4 shrink-0 accent-indigo-600 focus-visible:ring-2 focus-visible:ring-indigo-500" /><span><span className="block text-sm font-medium">{label}</span><span className="block text-xs leading-5 text-slate-600 dark:text-slate-400">{hint}</span></span></label>)}
      </div></fieldset>
      <details className="border-t border-slate-200 pt-2 dark:border-slate-700"><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">Repeats{item.rule_label ? " · " + item.rule_label : " · Set a schedule"}</summary><div className="space-y-3 pb-2">
        {item.rule_label ? <button type="button" onClick={() => void mutate(() => services.clearUpcomingRule({ key: item.name }))} className={editorQuiet}>Remove schedule</button> : <>
          <label className="block text-sm font-medium">Schedule<input value={ruleText} onChange={(event) => { previewGeneration.current += 1; setRuleText(event.target.value); setRulePreview(null); }} placeholder="For example, every Sunday" className={editorField} /></label>
          {rulePreview ? <div><p className="text-sm font-semibold">{rulePreview.label}</p><p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-400">{rulePreview.next_dates.map(dateLabel).join(" · ")}</p><button type="button" onClick={() => void mutate(() => services.applyUpcomingRule({ key: item.name, schedule: rulePreview.schedule }))} className={editorQuiet}>Apply schedule</button></div> : <button type="button" disabled={!ruleText.trim()} onClick={() => void previewRule()} className={editorQuiet}>Preview schedule</button>}
        </>}
      </div></details>
      <div className="flex flex-col items-stretch gap-1 border-t border-slate-200 pt-2 dark:border-slate-700" aria-label="Prediction actions">
        {item.edited && <button type="button" onClick={() => void mutate(() => services.clearUpcomingOverride({ key: item.name, date: originalDate }))} className={editorQuiet}>Reset to prediction</button>}
        {item.type !== "income" && <button type="button" onClick={() => void mutate(() => services.skipUpcomingOccurrence(item.name, originalDate))} className={editorQuiet}>Skip this month</button>}
        {!removing ? <button type="button" onClick={() => setRemoving(true)} className={editorQuiet}>{item.type === "income" ? "Not income" : "Not a bill"}</button> : <div><p className="text-sm leading-6 text-slate-600 dark:text-slate-300">Stop predicting this? You can undo this on Upcoming.</p><div className="grid grid-cols-2 gap-3"><button type="button" onClick={onDismiss} className={editorQuiet}>Remove prediction</button><button type="button" onClick={() => setRemoving(false)} className={editorQuiet}>Keep it</button></div></div>}
      </div>
    </fieldset>
    <EditorError message={request.error} />
    <EditorActions formId={formId} busy={request.busy} needsRefresh={request.needsRefresh} onCancel={onCancel} renderActions={renderActions} />
  </form>;
}
