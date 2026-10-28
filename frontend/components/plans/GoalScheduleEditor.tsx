"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { DateField } from "@/components/DatePicker";
import { api, type GoalSchedule, type GoalSchedulePreview } from "@/lib/api";
import { scheduleDate, scheduleMoney } from "@/components/plans/GoalScheduleDetails";
import MoneyText from "@/components/MoneyText";
import { useBalancesHidden } from "@/lib/balancesHidden";

type Props = {
  schedule: GoalSchedule;
  onCancel: () => void;
  onSave: (schedule: GoalSchedule) => Promise<void>;
  previewSchedule?: (schedule: GoalSchedule) => Promise<GoalSchedulePreview>;
  busy?: boolean;
  renderActions?: (actions: ReactNode) => ReactNode;
  submitLabel?: string;
  draftProposal?: boolean;
};
type Draft = { type: "arithmetic" | "fixed" | "percent_of_pay"; start: string; first: string; step: string; count: string; end: string; unit: "day" | "week" | "period"; amounts: string; percent: string; pay: string };

const field = "money mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100";
const money = scheduleMoney;
const pence = (value: string) => Math.round(Number(value) * 100);
const pounds = (value: number | null | undefined) => value == null ? "" : String(value / 100);
const iso = (value: string) => value.slice(0, 10);

function initial(schedule: GoalSchedule): Draft {
  if (schedule.type === "arithmetic") return { type: schedule.type, start: iso(schedule.start_date), first: pounds(schedule.start_pence), step: pounds(schedule.step_pence), count: schedule.count == null ? "" : String(schedule.count), end: schedule.end_date ? iso(schedule.end_date) : "", unit: schedule.step_unit, amounts: "", percent: "", pay: "" };
  if (schedule.type === "fixed") return { type: schedule.type, start: iso(schedule.start_date), first: "", step: "", count: "", end: "", unit: "period" as const, amounts: schedule.amounts_pence.map(v => pounds(v)).join(", "), percent: "", pay: "" };
  if (schedule.type === "percent_of_pay") return { type: schedule.type, start: iso(schedule.start_date), first: "", step: "", count: schedule.count == null ? "" : String(schedule.count), end: schedule.end_date ? iso(schedule.end_date) : "", unit: "period" as const, amounts: "", percent: String(schedule.percent), pay: pounds(schedule.expected_pay_pence) };
  return { type: "arithmetic" as const, start: new Date().toISOString().slice(0, 10), first: "", step: "", count: "", end: "", unit: "period" as const, amounts: "", percent: "", pay: "" };
}

export default function GoalScheduleEditor({ schedule, onCancel, onSave, previewSchedule = api.previewGoalSchedule, busy = false, renderActions, submitLabel = "Save changes", draftProposal = false }: Props) {
  const scheduleKey = JSON.stringify(schedule);
  const [draft, setDraft] = useState(() => initial(schedule));
  const [preview, setPreview] = useState<GoalSchedulePreview | null>(null);
  const [previewKey, setPreviewKey] = useState("");
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const generation = useRef(0);
  const startId = useId();
  const endId = useId();
  const hidden = useBalancesHidden();
  useEffect(() => { setDraft(initial(schedule)); }, [scheduleKey]); // a newly saved record owns the next draft

  const parsed = useMemo<GoalSchedule | null>(() => {
    if (!draft.start) return null;
    if (draft.type === "arithmetic") {
      if (!draft.first.trim() || !draft.step.trim()) return null;
      const start = pence(draft.first), step = pence(draft.step), count = draft.count ? Number(draft.count) : null;
      if (!Number.isFinite(start) || !Number.isFinite(step) || (count !== null && (!Number.isInteger(count) || count < 1)) || (!count && !draft.end)) return null;
      return { type: "arithmetic", start_date: draft.start, start_pence: start, step_pence: step, step_unit: draft.unit, count, end_date: draft.end || null };
    }
    if (draft.type === "fixed") {
      if (!draft.amounts.trim()) return null;
      const tokens = draft.amounts.split(",").map(s => s.trim());
      if (tokens.some(token => !token)) return null;
      const amounts = tokens.map(pence);
      if (!amounts.length || amounts.some(value => !Number.isFinite(value) || value < 0)) return null;
      return { type: "fixed", start_date: draft.start, amounts_pence: amounts, unit: "period" };
    }
    if (!draft.percent.trim()) return null;
    const percent = Number(draft.percent), pay = draft.pay ? pence(draft.pay) : null, count = draft.count ? Number(draft.count) : null;
    if (!Number.isFinite(percent) || percent <= 0 || (pay !== null && (!Number.isFinite(pay) || pay < 0)) || (count !== null && (!Number.isInteger(count) || count < 1)) || (!count && !draft.end)) return null;
    return { type: "percent_of_pay", start_date: draft.start, percent, expected_pay_pence: pay, count, end_date: draft.end || null };
  }, [draft]);
  useEffect(() => {
    const request = ++generation.current;
    setPreview(null); setPreviewKey(""); setPreviewError(null);
    if (!parsed) return;
    const key = JSON.stringify(parsed);
    const timer = window.setTimeout(() => {
      previewSchedule(parsed).then(value => { if (generation.current === request) { setPreview(value); setPreviewKey(key); } }).catch(() => { if (generation.current === request) setPreviewError("The schedule could not be checked. Your changes are still here. Try again."); });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [parsed, previewSchedule]);
  const set = (key: keyof typeof draft, value: string) => setDraft(current => ({ ...current, [key]: value }));
  const changeType = (type: typeof draft.type) => {
    if (type === draft.type) return;
    setDraft(current => ({ ...current, type, first: type === "arithmetic" ? current.first : "", step: type === "arithmetic" ? current.step : "", amounts: type === "fixed" ? current.amounts : "", percent: type === "percent_of_pay" ? current.percent : "", pay: type === "percent_of_pay" ? current.pay : "" }));
  };
  const parsedKey = parsed ? JSON.stringify(parsed) : "";
  const submit = async () => { if (!parsed || !preview || previewKey !== parsedKey || saving || busy || submitting.current) return; submitting.current = true; setSaveError(null); setSaving(true); try { await onSave(parsed); } catch { setSaveError("That did not save. Try again."); } finally { submitting.current = false; setSaving(false); } };
  const actions = <div className="flex gap-2"><button type="button" disabled={!preview || previewKey !== parsedKey || saving || busy} onClick={() => void submit()} className="min-h-11 flex-1 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">{saving || busy ? "Saving…" : submitLabel}</button><button type="button" disabled={saving || busy} onClick={onCancel} className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 min-h-11 rounded-xl px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">Cancel</button></div>;
  if (hidden) return <section aria-label="Edit schedule" className="space-y-3"><p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Figures are hidden</p><p className="text-sm leading-5 text-slate-600 dark:text-slate-300">Show figures to edit this schedule.</p><button type="button" disabled={busy} onClick={onCancel} className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 min-h-11 rounded-xl px-4 text-sm font-semibold text-slate-700 dark:text-slate-200">Back</button></section>;
  return <section aria-label="Edit schedule" className="space-y-4"><fieldset disabled={saving || busy} className="space-y-4 disabled:opacity-70">
    <div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Schedule type</p><div className="mt-2 grid grid-cols-2 gap-2">{([['arithmetic','Rising amount'], ['fixed','Fixed list'], ['percent_of_pay','% of pay']] as const).map(([type, label]) => <button key={type} type="button" aria-pressed={draft.type === type} onClick={() => changeType(type)} className={`min-h-11 rounded-xl border px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${draft.type === type ? "border-indigo-600 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-200" : "border-slate-200 text-slate-700 dark:border-slate-600 dark:text-slate-200"}`}>{label}</button>)}</div></div>
    <div><label htmlFor={startId} className="mb-1 block text-sm font-medium">Starts on</label><DateField id={startId} mode="day" label="Starts on" value={draft.start} onChange={value => set("start", value)} required /></div>
    {draft.type === "arithmetic" && <><div className="grid grid-cols-2 gap-3"><label className="text-sm font-medium">Starts at (£)<input className={field} inputMode="decimal" value={draft.first} onChange={e => set("first", e.target.value)} /></label><label className="text-sm font-medium">Changes by (£)<input className={field} inputMode="decimal" value={draft.step} onChange={e => set("step", e.target.value)} /></label></div><label className="block text-sm font-medium">Each contribution<div className="mt-1 grid grid-cols-3 gap-2">{(["day", "week", "period"] as const).map(unit => <button key={unit} type="button" onClick={() => set("unit", unit)} aria-pressed={draft.unit === unit} className={`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 min-h-11 rounded-xl border text-sm font-semibold ${draft.unit === unit ? "border-indigo-600 text-indigo-700 dark:text-indigo-300" : "border-slate-200 dark:border-slate-600"}`}>{unit}</button>)}</div></label></>}
    {draft.type === "fixed" && <label className="block text-sm font-medium">Amounts (£)<input className={field} inputMode="text" value={draft.amounts} onChange={e => set("amounts", e.target.value)} placeholder="100, 150, 200" /><span className="mt-1 block text-xs font-normal text-slate-500">One amount per pay period, separated by commas.</span></label>}
    {draft.type === "percent_of_pay" && <div className="grid grid-cols-2 gap-3"><label className="text-sm font-medium">Percentage<input className={field} inputMode="decimal" value={draft.percent} onChange={e => set("percent", e.target.value)} /></label><label className="text-sm font-medium">Expected pay (£)<input className={field} inputMode="decimal" value={draft.pay} onChange={e => set("pay", e.target.value)} /></label></div>}
    {draft.type !== "fixed" && <div className="grid grid-cols-2 gap-3"><label className="text-sm font-medium">Number of contributions<input className={field} inputMode="numeric" value={draft.count} onChange={e => set("count", e.target.value)} placeholder="or end date" /></label><div><label className="block text-sm font-medium">Optional end date</label><DateField id={endId} mode="day" label="Optional end date" value={draft.end} onChange={value => set("end", value)} /></div><p className="col-span-2 text-xs text-slate-500">Use either, or both. When both are set, the schedule ends at the earlier limit.</p></div>}
    {!parsed && <p role="alert" className="text-sm text-slate-700 dark:text-slate-200"><span className="mr-2 inline-block size-2 rounded-full bg-amber-500" />Enter valid amounts and either a count or end date.</p>}
    {previewError && <p role="alert" className="text-sm text-slate-700 dark:text-slate-200"><span className="mr-2 inline-block size-2 rounded-full bg-amber-500" />{previewError} <button type="button" onClick={() => { if (parsed) { const key = JSON.stringify(parsed); const next = ++generation.current; previewSchedule(parsed).then(value => { if (generation.current === next) { setPreview(value); setPreviewKey(key); setPreviewError(null); } }).catch(() => { if (generation.current === next) setPreviewError("The schedule could not be checked. Your changes are still here. Try again."); }); } }} className="font-semibold text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300">Retry</button></p>}
    {saveError && <p role="alert" className="text-sm text-slate-700 dark:text-slate-200">{saveError} <button type="button" onClick={() => void submit()} className="font-semibold text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300">Retry save</button></p>}
    {preview && previewKey === parsedKey && <div className="border-y border-slate-200 py-3 dark:border-slate-700"><div className="flex items-baseline justify-between gap-3"><span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{preview.estimated ? "Estimated total" : "Total"}</span><MoneyText text={money(preview.total)} className="text-lg font-bold text-slate-950 dark:text-white" /></div><div className="mt-2 flex justify-between gap-3 text-sm"><span className="text-slate-600 dark:text-slate-300">This pay period{preview.estimated ? " · estimated" : ""}</span><MoneyText text={money(preview.current_period.amount)} className="font-semibold" /></div><p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{preview.label}</p></div>}
    <p className="text-xs leading-5 text-slate-600 dark:text-slate-300">The first contribution starts on {draft.start ? scheduleDate(draft.start) : "the chosen start date"}.{(draft.type === "arithmetic" && draft.unit === "period") || draft.type === "fixed" || draft.type === "percent_of_pay" ? " Later contributions fall on the first day of each pay period." : ""}</p></fieldset>
    <p className="text-xs leading-5 text-slate-600 dark:text-slate-300">{draftProposal ? "Updating this proposal does not change your goal until you confirm it." : "Saving a different schedule resets any manual amount chosen for this pay period. Nothing moves until you move it."}</p>
    {renderActions ? renderActions(actions) : actions}
  </section>;
}
