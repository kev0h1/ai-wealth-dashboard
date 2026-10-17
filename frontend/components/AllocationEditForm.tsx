"use client";

import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { api, type Account, type Allocation } from "@/lib/api";
import { isPlanSourceAccount } from "@/lib/upcomingPlans";
import { AccountRadioPicker } from "./AccountRadioPicker";
import { EffectiveDateField, FillRulePicker, RhythmToggle, type AllocationRhythm, type FillRuleValue } from "./AllocationFields";
import { EditorActions, EditorError, editorField, editorQuiet, useEditorRequest, validDate } from "./upcoming/editorSupport";
import { PlanAffordability, PlanContribution, PlanRouteSummary, PlanTrackingSummary } from "./plans/PlanEditorSummary";
import { Pencil } from "lucide-react";
import { DisclosureSummary } from "./Disclosure";
import { tidyAccountName } from "@/lib/accountName";
import MoneyText from "@/components/MoneyText";

export type AllocationEditServices = Pick<typeof api, "updateAllocation" | "deleteAllocation" | "allocationFillCandidates">;
export interface AllocationEditFormProps {
  allocation: Allocation; accounts: Account[]; sourceChoices?: Account[]; suggestedSourceId?: string | null;
  periodStart: Date; onCancel(): void; onSaved(item: Allocation): void | Promise<void>; onDeleted(): void | Promise<void>;
  services?: AllocationEditServices; renderActions?: (actions: ReactNode) => ReactNode;
}
function todayIso() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }

export function AllocationEditForm({ allocation, accounts, sourceChoices, suggestedSourceId, periodStart, onCancel, onSaved, onDeleted, services = api, renderActions }: AllocationEditFormProps) {
  const formId = useId();
  const [name, setName] = useState(allocation.name);
  const [amount, setAmount] = useState(() => Number(allocation.amount_per_period).toFixed(2));
  const [recurrence, setRecurrence] = useState<AllocationRhythm>(allocation.recurrence);
  const [destination, setDestination] = useState(allocation.fill_account_id);
  // Final confirmation persists the displayed paying account, including a
  // suggestion. Opening or editing a field never writes anything.
  const [source, setSource] = useState(allocation.source_account_id ?? suggestedSourceId ?? "");
  const [sourceDirty, setSourceDirty] = useState(false);
  const [trackingMode, setTrackingMode] = useState<"existing_payment" | "manual">(allocation.tracking_mode === "manual" ? "manual" : "existing_payment");
  const [rule, setRule] = useState<FillRuleValue>({ match_type: allocation.match_type, match_value: allocation.match_value, fill_display_name: allocation.fill_display_name });
  const initialEffective = allocation.effective_from === allocation.period_start ? null : allocation.effective_from;
  const [effectiveFrom, setEffectiveFrom] = useState<string | null>(initialEffective);
  const [confirm, setConfirm] = useState<"pause" | "delete" | null>(null);
  const [view, setView] = useState<"main" | "details" | "route" | "destination" | "tracking">("main");
  const summaryFocus = useRef<HTMLButtonElement>(null);
  const routeFocus = useRef<HTMLButtonElement>(null);
  const destinationFocus = useRef<HTMLButtonElement>(null);
  const trackingFocus = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<"details" | "route" | "destination" | "tracking">("details");
  const backToMain = () => { setView("main"); requestAnimationFrame(() => { const targets = { details: summaryFocus, route: routeFocus, destination: destinationFocus, tracking: trackingFocus }; targets[returnFocus.current].current?.focus(); }); };
  const request = useEditorRequest();
  const suggestion = accounts.find((account) => account.id === suggestedSourceId && account.id !== destination);
  const choices = (sourceChoices ?? accounts).filter((account) => isPlanSourceAccount(account) && (trackingMode === "manual" || account.id !== destination));
  const eligibleSources = choices.filter((account) => account.include_in_safe_to_spend !== false && !/saving|isa|credit/.test(`${account.type} ${account.subtype ?? ""}`.toLowerCase()));
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (request.needsRefresh) { void request.retryRefresh(); return; }
    const parsed = Number(amount);
    if (!name.trim() || !Number.isFinite(parsed) || parsed < 0.01 || parsed > 1000000 || !eligibleSources.some(account => account.id === source) || (trackingMode === "existing_payment" && (!destination || !rule.match_value.trim())) || (effectiveFrom !== null && !validDate(effectiveFrom))) {
      request.setError("Enter a name and an amount between £0.01 and £1,000,000, and choose a paying account. Transfer tracking also needs a receiving account and rule."); return;
    }
    const body: Parameters<typeof api.updateAllocation>[1] = {
      name: name.trim(), amount_per_period: parsed, source_account_id: source,
      fill_account_id: trackingMode === "manual" ? "" : destination,
      match_type: trackingMode === "manual" ? "description_contains" : rule.match_type,
      match_value: trackingMode === "manual" ? "" : rule.match_value,
      fill_display_name: trackingMode === "manual" ? "" : rule.fill_display_name || undefined,
      tracking_mode: trackingMode,
      recurrence,
      ...(effectiveFrom !== initialEffective ? { effective_from: effectiveFrom ?? allocation.period_start } : {}),
    };
    let saved: Allocation;
    await request.run(async () => { saved = await services.updateAllocation(allocation.id, body); }, onCancel, undefined, () => onSaved(saved));
  }
  async function changeStatus() {
    let saved: Allocation;
    await request.run(async () => {
      if (confirm === "delete") await services.deleteAllocation(allocation.id);
      else saved = await services.updateAllocation(allocation.id, { active: !allocation.active });
    }, onCancel, undefined, () => confirm === "delete" ? onDeleted() : onSaved(saved));
  }
  return <form id={formId} onSubmit={submit} className="space-y-5">
    <fieldset disabled={request.busy || request.needsRefresh} className="min-w-0 space-y-5 [&_input]:text-base">
      {view === "main" ? <>
        <PlanContribution amount={Number.isFinite(Number(amount)) ? Number(amount) : null} cadence={recurrence === "once" ? "this pay period" : "each pay period"} />
        {trackingMode === "existing_payment" && Number(amount) === allocation.amount_per_period && source === allocation.source_account_id && destination === allocation.fill_account_id && rule.match_value === allocation.match_value && rule.match_type === allocation.match_type && recurrence === allocation.recurrence && effectiveFrom === initialEffective && allocation.active && !allocation.pending && !allocation.completed && <p className="text-xs leading-5 text-slate-600 dark:text-slate-300"><MoneyText text={`£${allocation.filled_this_period.toLocaleString("en-GB")} of £${(allocation.period_amount ?? allocation.amount_per_period).toLocaleString("en-GB")} set aside this period · £${allocation.remaining.toLocaleString("en-GB")} still to set aside`} /></p>}
        <PlanAffordability>This is a planned set-aside, not a bank payment. Check Upcoming for its effect on available cash.</PlanAffordability>
        <button ref={summaryFocus} type="button" onClick={() => { returnFocus.current = "details"; setView("details"); }} className="flex min-h-12 w-full items-center justify-between border-y border-slate-200 py-3 text-left dark:border-slate-700"><span><strong className="block text-sm">{name}</strong><small className="mt-1 block text-xs text-slate-500">{recurrence === "once" ? "Just this period" : "Every pay period"}</small></span><Pencil size={16} className="text-slate-400" /></button>
        <PlanRouteSummary sourceAccount={accounts.find((account) => account.id === source)} destinationAccount={trackingMode === "existing_payment" ? accounts.find((account) => account.id === destination) : undefined} buttonRef={routeFocus} destinationButtonRef={destinationFocus} source={accounts.find((account) => account.id === source) ? tidyAccountName(accounts.find((account) => account.id === source)!.name) : "Choose a paying account"} destination={trackingMode === "manual" ? "Reserve in this account" : accounts.find((account) => account.id === destination) ? tidyAccountName(accounts.find((account) => account.id === destination)!.name) : "Choose a receiving account"} onEdit={() => { returnFocus.current = "route"; setView("route"); }} onDestinationEdit={() => { returnFocus.current = "destination"; setView("destination"); }} />
        <PlanTrackingSummary buttonRef={trackingFocus} label={trackingMode === "manual" ? "Check it yourself" : rule.fill_display_name || "Choose a matching transfer"} detail={trackingMode === "manual" ? "The full amount stays reserved. No payment is matched automatically." : "Only a matching incoming transfer at the receiving account counts towards this set-aside."} onEdit={() => { returnFocus.current = "tracking"; setView("tracking"); }} />
        {!allocation.source_account_id && source && <p className="text-xs leading-5 text-slate-600 dark:text-slate-300">Paying account suggested from recent transfers. Saving confirms this choice.</p>}
        <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">Confirming saves every choice. It does not move money.</p>
      </> : <>
      <PlanContribution amount={Number.isFinite(Number(amount)) ? Number(amount) : null} cadence={recurrence === "once" ? "this pay period" : "each pay period"} />
      {view === "details" && <>
      <label className="block text-sm font-medium">Name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} required autoComplete="off" className={editorField} /></label>
      <label className="block text-sm font-medium">Amount each pay period (£)<input type="number" min="0.01" max="1000000" step="0.01" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} required className={editorField} /></label>
      </>}
      <button type="button" onClick={backToMain} className="min-h-11 text-sm font-semibold text-indigo-600 dark:text-indigo-400">Back to summary</button>
      {view === "route" && <div className="border-t border-slate-200 pt-5 dark:border-slate-700">
        {suggestion && !sourceDirty && !allocation.source_account_id && <p className="mb-3 text-xs leading-5 text-slate-600 dark:text-slate-400">Using {suggestion.provider} · {suggestion.name} based on recent transfers. This is included in the account estimate. Change it below if the money will come from elsewhere.</p>}
        <div id={`${formId}-route`} className="mt-4"><AccountRadioPicker accounts={eligibleSources} value={source} onChange={(id) => { setSourceDirty(true); setSource(id); setRule({ match_type: "description_contains", match_value: "", fill_display_name: "" }); }} label="Pay from" /><p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-400">Choosing an account does not move money.</p></div>
      </div>}
      {view === "destination" && (trackingMode === "existing_payment" ? <AccountRadioPicker accounts={accounts.filter((account) => account.id !== source)} value={destination} onChange={(id) => { setDestination(id); setRule({ match_type: "description_contains", match_value: "", fill_display_name: "" }); }} label="Receiving account" /> : <><p className="text-sm leading-6 text-slate-600 dark:text-slate-300">This set-aside stays in the paying account. It has no receiving account.</p><button type="button" onClick={() => setView("tracking")} className="min-h-11 text-sm font-semibold text-indigo-600 dark:text-indigo-400">Change tracking</button></>)}
      {view === "tracking" && <fieldset><legend className="text-sm font-medium">Tracking</legend><div className="mt-2 grid grid-cols-2 gap-2"><button type="button" aria-pressed={trackingMode === "existing_payment"} onClick={() => setTrackingMode("existing_payment")} className="min-h-11 rounded-xl border border-slate-200 px-3 text-left text-sm font-semibold aria-pressed:border-indigo-600 aria-pressed:bg-indigo-50 dark:border-slate-700 dark:aria-pressed:bg-indigo-950/30">Match a transfer</button><button type="button" aria-pressed={trackingMode === "manual"} onClick={() => setTrackingMode("manual")} className="min-h-11 rounded-xl border border-slate-200 px-3 text-left text-sm font-semibold aria-pressed:border-indigo-600 aria-pressed:bg-indigo-50 dark:border-slate-700 dark:aria-pressed:bg-indigo-950/30">Reserve in account</button></div><p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-400">{trackingMode === "manual" ? "The full amount remains reserved until you change this. It is not automatically fulfilled." : "A matching incoming transfer confirms money has reached the receiving account."}</p></fieldset>}
      {(view === "details" || view === "tracking") && <details open className="border-t border-slate-200 pt-2 dark:border-slate-700"><DisclosureSummary className="min-h-11 cursor-pointer items-center justify-between gap-3 py-3 text-sm font-medium">{view === "details" ? "Details" : "Payment tracking"}</DisclosureSummary><div className="space-y-5 pt-2">
        {view === "details" && <RhythmToggle value={recurrence} onChange={setRecurrence} />}
        {view === "tracking" && trackingMode === "existing_payment" && destination && <FillRulePicker accountId={destination} value={rule} onChange={setRule} loadCandidates={services.allocationFillCandidates} />}
        {view === "details" && <EffectiveDateField value={effectiveFrom} periodStartLabel={periodStart.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} todayIso={todayIso()} onChange={setEffectiveFrom} />}
      </div></details>}
      {view === "details" && <details className="border-t border-slate-200 pt-2 dark:border-slate-700"><DisclosureSummary className="min-h-11 cursor-pointer items-center justify-between gap-3 py-3 text-sm font-medium">More options</DisclosureSummary>
        {!confirm ? <div className="flex flex-col"><button type="button" onClick={() => setConfirm("pause")} className={editorQuiet}>{allocation.active ? "Pause this allocation" : "Resume this allocation"}</button><button type="button" onClick={() => setConfirm("delete")} className={editorQuiet}>Delete this allocation</button></div> : <div className="space-y-2">
          <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">{confirm === "delete" ? "Delete for good? Money already set aside stays where it is. This just stops tracking it." : allocation.active ? "Pause it? Nothing more will be expected until you turn it back on." : "Resume setting money aside for this allocation?"}</p>
          <div className="grid grid-cols-2 gap-3"><button type="button" onClick={() => void changeStatus()} className={editorQuiet}>{confirm === "delete" ? "Yes, delete it" : allocation.active ? "Yes, pause it" : "Yes, resume it"}</button><button type="button" onClick={() => setConfirm(null)} className={editorQuiet}>Keep it</button></div>
        </div>}
      </details>}
      </>}
    </fieldset>
    <EditorError message={request.error} />
    {view === "main" ? <EditorActions formId={formId} busy={request.busy} needsRefresh={request.needsRefresh} onCancel={onCancel} renderActions={renderActions} /> : (renderActions ? renderActions(<button type="button" onClick={backToMain} className="min-h-11 w-full rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white">Keep these changes</button>) : <button type="button" onClick={backToMain} className="min-h-11 w-full rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white">Keep these changes</button>)}
  </form>;
}
