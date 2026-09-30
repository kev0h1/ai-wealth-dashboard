"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";
import { api, type Account } from "@/lib/api";
import { AccountRadioPicker } from "./AccountRadioPicker";
import { EditorActions, EditorError, editorField, editorQuiet, useEditorRequest, validDate } from "./upcoming/editorSupport";

export type PlannedEditItem = { id: string; name: string; amount: number; date: string; account_id: string | null };
export type PlannedEditServices = Pick<typeof api, "updatePlanned">;
export interface PlannedEditFormProps { item: PlannedEditItem; accounts: Account[]; onCancel(): void; onDelete(): void; onSaved(): void | Promise<void>; services?: PlannedEditServices; renderActions?: (actions: ReactNode) => ReactNode; }
function todayIso() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }

export function PlannedEditForm({ item, accounts, onCancel, onDelete, onSaved, services = api, renderActions }: PlannedEditFormProps) {
  const formId = useId();
  const [name, setName] = useState(item.name);
  const [amount, setAmount] = useState(item.amount.toFixed(2));
  const [date, setDate] = useState(item.date);
  const [accountId, setAccountId] = useState(item.account_id ?? "");
  const request = useEditorRequest();
  // Preserve the existing planned-payment editor's eligible account universe.
  const spendable = accounts.filter((a) => !a.manual && !(a.subtype || "").toLowerCase().includes("saving") && !(a.type || "").toLowerCase().includes("credit") && !(a.subtype || "").toLowerCase().includes("credit") && (a.balance ?? 0) >= 0);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (request.needsRefresh) { void request.retryRefresh(); return; }
    const trimmed = name.trim(); const parsed = Number(amount);
    if (!trimmed || !Number.isFinite(parsed) || parsed <= 0 || parsed > 1000000 || !validDate(date)) { request.setError("Enter a name, a valid date and an amount between £0.01 and £1,000,000."); return; }
    if (date !== item.date && date < todayIso()) { request.setError("Choose today or a future date."); return; }
    const patch: Parameters<typeof api.updatePlanned>[1] = {};
    if (trimmed !== item.name) patch.name = trimmed;
    if (parsed !== item.amount) patch.amount = parsed;
    if (date !== item.date) patch.date = date;
    if ((accountId || null) !== item.account_id) patch.account_id = accountId || null;
    if (!Object.keys(patch).length) { onCancel(); return; }
    await request.run(() => services.updatePlanned(item.id, patch), onCancel, undefined, onSaved);
  }
  return <form id={formId} onSubmit={submit} className="space-y-5">
    <fieldset disabled={request.busy || request.needsRefresh} className="space-y-5 [&_input]:text-base">
      <label className="block text-sm font-medium">Name<input value={name} onChange={(e) => setName(e.target.value)} required className={editorField} /></label>
      <div className="grid gap-4 min-[380px]:grid-cols-2"><label className="min-w-0 text-sm font-medium">Expected date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} required className={editorField} /></label><label className="min-w-0 text-sm font-medium">Amount (£)<input type="number" min="0.01" max="1000000" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required className={editorField} /></label></div>
      <AccountRadioPicker accounts={spendable} value={accountId} onChange={setAccountId} label="Which account will it leave from?" allowUnset unsetLabel="Not sure yet" />
      <button type="button" onClick={onDelete} className={editorQuiet}>Delete planned payment</button>
    </fieldset>
    <EditorError message={request.error} />
    <EditorActions formId={formId} busy={request.busy} needsRefresh={request.needsRefresh} onCancel={onCancel} renderActions={renderActions} />
  </form>;
}
