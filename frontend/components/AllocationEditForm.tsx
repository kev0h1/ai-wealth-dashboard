"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";
import { api, type Account, type Allocation } from "@/lib/api";
import { isPlanSourceAccount } from "@/lib/upcomingPlans";
import { AccountRadioPicker } from "./AccountRadioPicker";
import { EffectiveDateField, FillRulePicker, RhythmToggle, type AllocationRhythm, type FillRuleValue } from "./AllocationFields";
import { EditorActions, EditorError, editorField, editorQuiet, useEditorRequest, validDate } from "./upcoming/editorSupport";

export type AllocationEditServices = Pick<typeof api, "updateAllocation" | "deleteAllocation" | "allocationFillCandidates">;
export interface AllocationEditFormProps {
  allocation: Allocation; accounts: Account[]; sourceChoices?: Account[]; suggestedSourceId?: string | null;
  periodStart: Date; /** G217: prefill the amount (e.g. the per-period figure that clears a shortfall). Nothing is saved until the form is submitted. */ suggestedAmount?: number; onCancel(): void; onSaved(item: Allocation): void | Promise<void>; onDeleted(): void | Promise<void>;
  services?: AllocationEditServices; renderActions?: (actions: ReactNode) => ReactNode;
}
function todayIso() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }

export function AllocationEditForm({ allocation, accounts, sourceChoices, suggestedSourceId, suggestedAmount, periodStart, onCancel, onSaved, onDeleted, services = api, renderActions }: AllocationEditFormProps) {
  const formId = useId();
  const [name, setName] = useState(allocation.name);
  const [amount, setAmount] = useState(() => Number(suggestedAmount ?? allocation.amount_per_period).toFixed(2));
  const [recurrence, setRecurrence] = useState<AllocationRhythm>(allocation.recurrence);
  const [destination, setDestination] = useState(allocation.fill_account_id);
  // Show the derived payer without silently persisting it as a user choice.
  // Only changing this field adds source_account_id to the PATCH below.
  const [source, setSource] = useState(allocation.source_account_id ?? suggestedSourceId ?? "");
  const [sourceDirty, setSourceDirty] = useState(false);
  const [rule, setRule] = useState<FillRuleValue>({ match_type: allocation.match_type, match_value: allocation.match_value, fill_display_name: allocation.fill_display_name });
  const initialEffective = allocation.effective_from === allocation.period_start ? null : allocation.effective_from;
  const [effectiveFrom, setEffectiveFrom] = useState<string | null>(initialEffective);
  const [confirm, setConfirm] = useState<"pause" | "delete" | null>(null);
  const request = useEditorRequest();
  const suggestion = accounts.find((account) => account.id === suggestedSourceId && account.id !== destination);
  const choices = (sourceChoices ?? accounts).filter((account) => isPlanSourceAccount(account) && account.id !== destination);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (request.needsRefresh) { void request.retryRefresh(); return; }
    const parsed = Number(amount);
    if (!name.trim() || !Number.isFinite(parsed) || parsed < 0.01 || parsed > 1000000 || !destination || !rule.match_value.trim() || (effectiveFrom !== null && !validDate(effectiveFrom))) {
      request.setError("Enter a name and an amount between £0.01 and £1,000,000, and choose a receiving account and fill rule."); return;
    }
    const body: Parameters<typeof api.updateAllocation>[1] = {
      name: name.trim(), amount_per_period: parsed, fill_account_id: destination,
      match_type: rule.match_type, match_value: rule.match_value, fill_display_name: rule.fill_display_name || undefined,
      recurrence,
      ...(sourceDirty ? { source_account_id: source || null } : {}),
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
      <label className="block text-sm font-medium">Name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} required autoComplete="off" className={editorField} /></label>
      <label className="block text-sm font-medium">Amount each pay period (£)<input type="number" min="0.01" max="1000000" step="0.01" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} required className={editorField} /></label>
      {suggestedAmount !== undefined && <p className="-mt-3 text-xs leading-5 text-slate-600 dark:text-slate-400">Prefilled to cover this period. Nothing changes until you save.</p>}
      <div className="border-t border-slate-200 pt-5 dark:border-slate-700">
        {suggestion && !sourceDirty && !allocation.source_account_id && <p className="mb-3 text-xs leading-5 text-slate-600 dark:text-slate-400">Using {suggestion.provider} · {suggestion.name} based on recent transfers. This is included in the account estimate. Change it below if the money will come from elsewhere.</p>}
        <AccountRadioPicker accounts={choices} value={source} onChange={(id) => { setSourceDirty(true); setSource(id); }} label="Pay from" allowUnset unsetLabel="Not linked yet" />
        <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-400">Choosing an account does not move money. Clearing it leaves this allocation out of named-account calculations.</p>
      </div>
      <div><p className="text-xs text-slate-600 dark:text-slate-400">Receiving pot</p><p className="mt-1 text-sm font-semibold">{accounts.find((account) => account.id === destination)?.name ?? allocation.fill_display_name}</p></div>
      <details className="border-t border-slate-200 pt-2 dark:border-slate-700"><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">How this allocation works</summary><div className="space-y-5 pt-2">
        <RhythmToggle value={recurrence} onChange={setRecurrence} />
        <AccountRadioPicker accounts={accounts} value={destination} onChange={(id) => {
          if (id === destination) return;
          setDestination(id); setRule({ match_type: "description_contains", match_value: "", fill_display_name: "" });
          if (source === id) { setSource(""); setSourceDirty(true); }
        }} label="Which account will it fill?" />
        {destination && <FillRulePicker accountId={destination} value={rule} onChange={setRule} loadCandidates={services.allocationFillCandidates} />}
        <EffectiveDateField value={effectiveFrom} periodStartLabel={periodStart.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} todayIso={todayIso()} onChange={setEffectiveFrom} />
      </div></details>
      <details className="border-t border-slate-200 pt-2 dark:border-slate-700"><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">More options</summary>
        {!confirm ? <div className="flex flex-col"><button type="button" onClick={() => setConfirm("pause")} className={editorQuiet}>{allocation.active ? "Pause this allocation" : "Resume this allocation"}</button><button type="button" onClick={() => setConfirm("delete")} className={editorQuiet}>Delete this allocation</button></div> : <div className="space-y-2">
          <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">{confirm === "delete" ? "Delete for good? Money already set aside stays where it is. This just stops tracking it." : allocation.active ? "Pause it? Nothing more will be expected until you turn it back on." : "Resume setting money aside for this allocation?"}</p>
          <div className="grid grid-cols-2 gap-3"><button type="button" onClick={() => void changeStatus()} className={editorQuiet}>{confirm === "delete" ? "Yes, delete it" : allocation.active ? "Yes, pause it" : "Yes, resume it"}</button><button type="button" onClick={() => setConfirm(null)} className={editorQuiet}>Keep it</button></div>
        </div>}
      </details>
    </fieldset>
    <EditorError message={request.error} />
    <EditorActions formId={formId} busy={request.busy} needsRefresh={request.needsRefresh} onCancel={onCancel} renderActions={renderActions} />
  </form>;
}
