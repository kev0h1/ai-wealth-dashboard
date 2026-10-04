"use client";

import { useId, useState, type FormEvent } from "react";
import type { Account } from "@/lib/api";
import { AccountRadioPicker } from "@/components/AccountRadioPicker";
import { UpcomingFlowFooter } from "@/components/UpcomingFlowSheet";
import { isPlanSourceAccount, money, type Plan } from "@/lib/upcomingPlans";
import { EditorActions, EditorError, useEditorRequest } from "./editorSupport";

export default function GoalSourceForm({ plan, accounts, onSave, onSaved, onCancel }: {
  plan: Plan; accounts: Account[];
  onSave(source: string | null): Promise<void>; onSaved(): Promise<void>; onCancel(): void;
}) {
  const id = useId();
  const [source, setSource] = useState(plan.sourceId ?? "");
  const request = useEditorRequest();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (request.needsRefresh) { void request.retryRefresh(); return; }
    await request.run(() => onSave(source || null), onCancel, undefined, onSaved);
  }
  return <form id={id} onSubmit={submit} className="space-y-5">
    <div><p className="text-xs text-slate-600 dark:text-slate-400">This period’s goal contribution</p><p className="mt-1 font-mono text-2xl font-semibold tabular-nums">{money(plan.periodPence)}</p><p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-400">Set by your goal plan. Here you are only changing which account will fund it.</p></div>
    <fieldset disabled={request.busy || request.needsRefresh} className="min-w-0 space-y-5 [&_input]:text-base">
      <AccountRadioPicker accounts={accounts.filter((account) => isPlanSourceAccount(account) && !plan.destinationIds?.includes(account.id))} value={source} onChange={setSource} label="Pay from" allowUnset unsetLabel="Not linked yet" />
      <p className="text-xs leading-5 text-slate-600 dark:text-slate-400">The remaining amount is included in this account’s working. Choosing an account does not move money.</p>
      <div><p className="text-xs text-slate-600 dark:text-slate-400">Receiving pot</p><p className="mt-1 break-words text-sm font-semibold">{plan.destination}</p></div>
    </fieldset>
    <EditorError message={request.error} />
    <EditorActions formId={id} busy={request.busy} needsRefresh={request.needsRefresh} onCancel={onCancel} renderActions={(actions) => <UpcomingFlowFooter>{actions}</UpcomingFlowFooter>} />
  </form>;
}
