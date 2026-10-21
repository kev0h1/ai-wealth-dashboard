"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";
import { api, type Account, type Allocation } from "@/lib/api";
import { isPlanSourceAccount } from "@/lib/upcomingPlans";
import { AccountRadioPicker } from "./AccountRadioPicker";
import { EffectiveDateField, FillRulePicker, RhythmToggle, type AllocationRhythm, type FillRuleValue } from "./AllocationFields";
import { EditorError, editorField, editorQuiet, editorSecondary, useEditorRequest, validDate } from "./upcoming/editorSupport";
import { PlanContribution, PlanEditorSummaryRow } from "./plans/PlanEditorSummary";
import { PlanTrackingMethod } from "./plans/PlanTrackingMethod";
import { PlanCategoryTracking, type PlanCategoryTrackingValue } from "./plans/PlanCategoryTracking";
import { PlanRecordView } from "./plans/PlanRecordView";
import PlanEditorFlow, { PLAN_EDITOR_STEPS as steps, type PlanEditorStep as Step } from "./plans/PlanEditorFlow";
import { tidyAccountName } from "@/lib/accountName";
import MoneyText from "@/components/MoneyText";

export type AllocationEditServices = Pick<typeof api, "updateAllocation" | "deleteAllocation" | "allocationFillCandidates">;

export interface AllocationPlanEditorProps {
  allocation: Allocation;
  accounts: Account[];
  sourceChoices?: Account[];
  suggestedSourceId?: string | null;
  periodStart: Date;
  onCancel(): void;
  onSaved(item: Allocation): void | Promise<void>;
  onDeleted(): void | Promise<void>;
  services?: AllocationEditServices;
  renderActions?: (actions: ReactNode) => ReactNode;
  initialMode?: "view" | "edit";
  onModeChange?: (mode: "view" | "edit") => void;
  onEdit?: () => void;
}

const todayIso = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
const dateLabel = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** The set-aside edit flow. It only writes from its final review step. */
export function AllocationPlanEditor({ allocation, accounts, sourceChoices, suggestedSourceId, periodStart, onCancel, onSaved, onDeleted, services = api, renderActions, initialMode = "edit", onModeChange, onEdit }: AllocationPlanEditorProps) {
  const formId = useId();
  const initialEffective = allocation.effective_from && allocation.effective_from > allocation.period_start ? allocation.effective_from : null;
  const initialDestination = allocation.destination_account_id ?? allocation.category_tracking?.destination_account_ids?.[0] ?? allocation.fill_account_id ?? "";
  const [mode, setMode] = useState<"view" | "edit">(initialMode);
  const [step, setStep] = useState<Step>("purpose");
  const [reviewing, setReviewing] = useState(false);
  const [confirm, setConfirm] = useState<"delete" | null>(null);
  const [name, setName] = useState(allocation.name);
  const [amount, setAmount] = useState(Number(allocation.amount_per_period).toFixed(2));
  const [recurrence, setRecurrence] = useState<AllocationRhythm>(allocation.recurrence);
  const [effectiveFrom, setEffectiveFrom] = useState<string | null>(initialEffective);
  const [effectiveTouched, setEffectiveTouched] = useState(false);
  const [source, setSource] = useState(allocation.source_account_id ?? suggestedSourceId ?? "");
  const [destination, setDestination] = useState(initialDestination);
  const [trackingMode, setTrackingMode] = useState<"existing_payment" | "manual">(allocation.tracking_mode === "manual" ? "manual" : "existing_payment");
  const [rule, setRule] = useState<FillRuleValue>({ match_type: allocation.match_type, match_value: allocation.match_value, fill_display_name: allocation.fill_display_name });
  const [categoryTracking, setCategoryTracking] = useState<PlanCategoryTrackingValue>(allocation.category_tracking ?? null);
  const request = useEditorRequest();
  const suggested = !allocation.source_account_id && source === suggestedSourceId && accounts.find(a => a.id === suggestedSourceId);
  const sourceAccounts = (sourceChoices ?? accounts).filter(account => isPlanSourceAccount(account) && (trackingMode === "manual" || account.id !== destination));
  const eligibleSources = sourceAccounts.filter(account => account.include_in_safe_to_spend !== false && !/saving|isa|credit/.test(`${account.type} ${account.subtype ?? ""}`.toLowerCase()));
  const destinations = accounts.filter(account => account.id !== source && account.currency === "GBP" && !/credit|card/i.test(`${account.type} ${account.subtype ?? ""}`));
  const parsedAmount = Number(amount);
  const savedSourceAccount = accounts.find(account => account.id === allocation.source_account_id);
  const inferredSourceAccount = !allocation.source_account_id ? accounts.find(account => account.id === suggestedSourceId) : undefined;
  const sourceAccount = accounts.find(account => account.id === source);
  const destinationAccount = accounts.find(account => account.id === destination);
  const validAmount = Number.isFinite(parsedAmount) && /^\d+(?:\.\d{1,2})?$/.test(amount.trim()) && parsedAmount >= .01 && parsedAmount <= 1000000;
  const canContinue = (current: Step) => {
    if (current === "purpose") return Boolean(name.trim());
    if (current === "details") return validAmount && (effectiveFrom === null || validDate(effectiveFrom));
    if (current === "source") return eligibleSources.some(account => account.id === source);
    if (current === "destination") return !destination || (destination !== source && destinations.some(account => account.id === destination));
    if (current === "tracking") return categoryTracking !== null || trackingMode === "manual" || Boolean(destination && rule.match_value.trim());
    return true;
  };
  const advance = () => {
    if (!canContinue(step)) { request.setError(step === "details" ? "Enter an amount between £0.01 and £1,000,000 and a valid start date." : "Complete this step before continuing."); return; }
    request.setError("");
    if (reviewing) { setReviewing(false); setStep("review"); }
    else setStep(steps[Math.min(steps.indexOf(step) + 1, steps.length - 1)]);
  };
  const changeRoute = (change: () => void) => { change(); setRule({ match_type: "description_contains", match_value: "", fill_display_name: "" }); setCategoryTracking(null); setTrackingMode("manual"); };
  const changeMode = (next: "view" | "edit") => { setMode(next); onModeChange?.(next); };
  async function save(event: FormEvent) {
    event.preventDefault();
    if (step !== "review") return;
    if (request.needsRefresh) { void request.retryRefresh(); return; }
    if (!steps.slice(0, -1).every(canContinue) || source === destination) { request.setError("Check each step before saving. Paying and receiving accounts must be different."); return; }
    const body: Parameters<typeof api.updateAllocation>[1] = {
      name: name.trim(), amount_per_period: parsedAmount, source_account_id: source,
      fill_account_id: trackingMode === "manual" ? "" : destination,
      match_type: trackingMode === "manual" ? "description_contains" : rule.match_type,
      match_value: trackingMode === "manual" ? "" : rule.match_value,
      fill_display_name: trackingMode === "manual" ? "" : rule.fill_display_name || undefined,
      tracking_mode: trackingMode, recurrence,
      // Historic dates are presented as "This pay period". Do not rewrite
      // one merely because the user saved another part of the plan.
      ...(effectiveTouched ? { effective_from: effectiveFrom ?? allocation.period_start } : {}),
      category_tracking: categoryTracking,
      destination_account_id: trackingMode === "manual" ? destination || null : null,
    };
    let saved: Allocation;
    await request.run(async () => { saved = await services.updateAllocation(allocation.id, body); }, onCancel, undefined, () => onSaved(saved));
  }
  async function changeStatus(action: "pause" | "delete") {
    let saved: Allocation;
    await request.run(async () => {
      if (action === "delete") await services.deleteAllocation(allocation.id);
      else saved = await services.updateAllocation(allocation.id, { active: !allocation.active });
    }, onCancel, undefined, () => action === "delete" ? onDeleted() : onSaved(saved));
  }
  const busy = request.busy || request.needsRefresh;
  const compact = <PlanContribution amount={Number.isFinite(parsedAmount) ? parsedAmount : null} cadence={recurrence === "once" ? "this pay period" : "each pay period"} />;
  if (mode === "view") {
    const savedDestinationId = allocation.destination_account_id ?? allocation.category_tracking?.destination_account_ids?.[0] ?? allocation.fill_account_id;
    const savedDestination = accounts.find(account => account.id === savedDestinationId);
    const actions = <fieldset disabled={busy} className="min-w-0 space-y-2"><button type="button" onClick={() => onEdit ? onEdit() : changeMode("edit")} className="min-h-11 w-full rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">Edit plan</button>{confirm === "delete" ? <div className="space-y-2"><p className="text-sm leading-5 text-slate-700 dark:text-slate-200">Delete this set-aside? Money already set aside stays where it is.</p><div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => setConfirm(null)} className={editorSecondary}>Keep plan</button><button type="button" onClick={() => void changeStatus("delete")} className="min-h-11 rounded-xl bg-red-600 px-3 text-sm font-semibold text-white hover:bg-red-700 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500">Delete plan</button></div></div> : <div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => void changeStatus("pause")} className={editorSecondary}>{allocation.active ? "Pause plan" : "Resume plan"}</button><button type="button" onClick={() => setConfirm("delete")} className="min-h-11 rounded-xl border border-red-300 px-3 text-sm font-semibold text-red-700 hover:bg-red-50 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:border-red-900 dark:text-red-300">Delete plan</button></div>}</fieldset>;
    return <div className="space-y-5"><PlanRecordView kind="set-aside" contribution={savedSourceAccount && !allocation.pending ? allocation.remaining : allocation.amount_per_period} cadence={savedSourceAccount && !allocation.pending ? "held back" : "planned"} frequency={allocation.recurrence === "once" ? "this pay period" : "each pay period"} sourceAccount={savedSourceAccount ?? inferredSourceAccount} sourceSuggested={Boolean(!savedSourceAccount && inferredSourceAccount)} sourceUnavailable={Boolean(allocation.source_account_id) && !savedSourceAccount} destinationUnavailable={Boolean(savedDestinationId) && !savedDestination} destinationAccounts={savedDestination ? [savedDestination] : []} trackingLabel={allocation.category_tracking ? `${allocation.category_tracking.category} category` : allocation.tracking_mode === "manual" ? "Not linked yet" : "Payment confirmed"} paused={!allocation.active}>{allocation.category_tracking && <PlanCategoryTracking readOnly kind="set-aside" sourceAccountId={allocation.source_account_id ?? ""} destinationAccountIds={allocation.category_tracking.destination_account_ids} value={allocation.category_tracking} allocationId={allocation.id} onChange={() => {}} />}</PlanRecordView><EditorError message={request.error} />{request.needsRefresh && <button type="button" onClick={() => void request.retryRefresh()} className={editorQuiet}>Retry refresh</button>}{renderActions ? renderActions(actions) : actions}</div>;
  }
  return <PlanEditorFlow
    formId={formId} step={step} reviewing={reviewing}
    busy={request.busy} locked={busy} needsRefresh={request.needsRefresh}
    onBack={onCancel} onContinue={advance} onSubmit={save}
    onPrevious={() => setStep(steps[Math.max(0, steps.indexOf(step) - 1)])}
    error={<EditorError message={request.error} />} renderActions={renderActions}
  >
      {step !== "purpose" && step !== "review" && compact}
      {step === "purpose" && <label className="block text-sm font-medium">What are you setting aside for?<input name="plan-name" value={name} onChange={event => setName(event.target.value)} maxLength={40} required autoComplete="off" className={editorField} /></label>}
      {step === "details" && <><label className="block text-sm font-medium">Amount each pay period (£)<input name="plan-amount" autoComplete="off" type="text" inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} required className={`${editorField} font-mono tabular-nums`} /></label><RhythmToggle value={recurrence} onChange={setRecurrence} /><EffectiveDateField value={effectiveFrom} periodStartLabel={(validDate(allocation.period_start) ? new Date(`${allocation.period_start}T12:00:00Z`) : periodStart).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })} todayIso={todayIso()} onChange={value => { setEffectiveTouched(true); setEffectiveFrom(value); }} /></>}
      {step === "source" && <><AccountRadioPicker accounts={eligibleSources} value={source} onChange={id => { if (id !== source) { if (destination === id) setDestination(""); changeRoute(() => setSource(id)); } }} label="Pay from" />{suggested && <p className="text-xs leading-5 text-slate-600 dark:text-slate-300"><strong>Suggested</strong> from recent transfers: {suggested.provider} · {tidyAccountName(suggested.name)}. Saving confirms this choice; it does not move money.</p>}</>}
      {step === "destination" && <><AccountRadioPicker accounts={destinations} value={destination} onChange={id => { if (id !== destination) changeRoute(() => setDestination(id)); }} label="Set aside in" /><button type="button" aria-pressed={!destination} onClick={() => { if (destination) changeRoute(() => setDestination("")); }} className={editorQuiet}>Keep it in the paying account</button></>}
      {step === "tracking" && <><PlanTrackingMethod value={categoryTracking ? "category" : trackingMode === "existing_payment" ? "payment" : "none"} onChange={method => { if (method === (categoryTracking ? "category" : trackingMode === "existing_payment" ? "payment" : "none")) return; setRule({ match_type: "description_contains", match_value: "", fill_display_name: "" }); if (method === "category") { setTrackingMode("manual"); setCategoryTracking({ category: destination ? "Savings" : "Groceries", ...(destination ? { destination_account_ids: [destination] } : {}) }); } else { setCategoryTracking(null); setTrackingMode(method === "payment" ? "existing_payment" : "manual"); } }} />{categoryTracking ? <PlanCategoryTracking kind="set-aside" sourceAccountId={source} destinationAccountIds={destination ? [destination] : undefined} value={categoryTracking} allocationId={allocation.id} effectiveFrom={effectiveFrom ?? undefined} onChange={value => { setCategoryTracking(value); setTrackingMode(value ? "manual" : "existing_payment"); }} /> : trackingMode === "existing_payment" && destination ? <div><FillRulePicker accountId={destination} value={rule} onChange={setRule} loadCandidates={services.allocationFillCandidates} helperText="" /><p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-300">Only matching payments into this account count. You move the money in your bank.</p></div> : trackingMode === "existing_payment" ? <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">Choose a receiving account in the previous step, or choose Not now.</p> : null}</>}
      {step === "review" && <><PlanContribution amount={Number.isFinite(parsedAmount) ? parsedAmount : null} cadence={recurrence === "once" ? "this pay period" : "each pay period"} /><div className="border-y border-slate-200 dark:border-slate-700"><PlanEditorSummaryRow label="Purpose" value={`${name || "Untitled"} · ${recurrence === "once" ? "This pay period" : "Every pay period"}`} onEdit={() => { setReviewing(true); setStep("purpose"); }} /><button type="button" onClick={() => { setReviewing(true); setStep("details"); }} className="min-h-11 w-full border-t border-slate-200 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:border-slate-700"><span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Details</span><strong className="mt-1 block text-sm text-slate-900 dark:text-slate-100"><MoneyText text={`£${validAmount ? parsedAmount.toLocaleString("en-GB", { minimumFractionDigits: 2 }) : amount}`} /> · {recurrence === "once" ? "This pay period" : "Every pay period"}</strong><span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">{effectiveFrom ? `Starts ${dateLabel(effectiveFrom)}` : "This pay period"}</span></button><PlanEditorSummaryRow label="Pay from" value={sourceAccount ? `${sourceAccount.provider} · ${tidyAccountName(sourceAccount.name)}` : "Choose an account"} detail={suggested ? "Suggested from recent transfers" : undefined} onEdit={() => { setReviewing(true); setStep("source"); }} /><PlanEditorSummaryRow label="Set aside in" value={destinationAccount ? `${destinationAccount.provider} · ${tidyAccountName(destinationAccount.name)}` : "Stays in the paying account"} onEdit={() => { setReviewing(true); setStep("destination"); }} /><PlanEditorSummaryRow label="Tracking" value={categoryTracking ? `${categoryTracking.category} category` : trackingMode === "manual" ? "Not now" : rule.fill_display_name || rule.match_value || "Choose a payment"} onEdit={() => { setReviewing(true); setStep("tracking"); }} /></div><p className="text-xs leading-5 text-slate-600 dark:text-slate-300">Saving changes this plan only. It does not move money.</p></>}
  </PlanEditorFlow>;
}
