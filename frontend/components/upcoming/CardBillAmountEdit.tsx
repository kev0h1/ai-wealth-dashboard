"use client";

import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { api, type CardStatementBill } from "@/lib/api";
import { usePreferences } from "@/components/PreferencesContext";
import { BalancesHiddenContext } from "@/lib/balancesHidden";
import { invalidateVerdictCache } from "@/lib/verdictCache";
import { StatementAmountEntry, StatementWorking, canEnterStatementAmount, parseStatementAmount } from "@/components/card-settings/StatementAmountEntry";
import cardStyles from "@/components/card-settings/CardSettings.module.css";
import { EditorActions, EditorError, useEditorRequest } from "./editorSupport";

export type CardBillServices = Pick<typeof api, "getCardTerms" | "saveCardStatementAmount" | "clearCardStatementAmount">;
export type CardBillAmountEditProps = {
  cardId: string;
  onCancel(): void;
  /** Where to go after a successful change; defaults to onCancel (one step back). */
  onDone?: () => void;
  onSaved(): void | Promise<void>;
  services?: CardBillServices;
  renderActions?: (actions: ReactNode) => ReactNode;
  /** Design previews and tests render without the preferences provider. */
  hiddenOverride?: boolean;
  /** The bill when the caller already has it (tests and previews); otherwise it is loaded. */
  initialBill?: CardStatementBill | null;
};

/** G444: Edit on a defined card bill is the statement amount for this statement only, never the generic prediction editor. */
export function CardBillAmountEdit({ cardId, onCancel, onDone, onSaved, services = api, renderActions, hiddenOverride, initialBill }: CardBillAmountEditProps) {
  const formId = useId();
  const prefs = usePreferences();
  const hidden = hiddenOverride ?? (prefs.hideNetWorth || !prefs.preferencesReady);
  const request = useEditorRequest();
  const [bill, setBill] = useState<CardStatementBill | null | undefined>(initialBill);
  const [typed, setTyped] = useState<string | null>(null);
  useEffect(() => {
    if (initialBill !== undefined) return;
    let live = true;
    services.getCardTerms().then((r) => { if (live) setBill(r.cards.find((c) => c.account_id === cardId)?.statement_bill ?? null); }).catch(() => { if (live) setBill(null); });
    return () => { live = false; };
  }, [cardId, services, initialBill]);
  const finish = async () => { invalidateVerdictCache(); await onSaved(); };
  const canSave = !hidden && canEnterStatementAmount(bill) && Boolean(typed?.trim());
  function save(event: FormEvent) {
    event.preventDefault();
    if (request.needsRefresh) { void request.retryRefresh(); return; }
    // Only a figure the person typed is saved. The prefilled estimate is shown, never submitted, and nothing is saved while balances are hidden.
    if (!canSave || !bill) return;
    const value = parseStatementAmount(typed ?? "");
    if (value == null) { request.setError("Enter an amount above £0 and no more than £100,000."); return; }
    void request.run(() => services.saveCardStatementAmount(cardId, value), onDone ?? onCancel, "The amount could not be saved. It is still here. Try again.", finish);
  }
  const clear = () => void request.run(() => services.clearCardStatementAmount(cardId), onDone ?? onCancel, "The amount could not be cleared. Try again.", finish);
  const note = "text-xs leading-5 text-slate-600 dark:text-slate-400";
  return <BalancesHiddenContext.Provider value={hidden}><form id={formId} onSubmit={save} className="space-y-6">
    <div><h3 className="text-sm font-semibold">Card bill</h3><p className={`mt-1 ${note}`}>This is the card bill, not a second payment to add to it. It does not change a bank payment, and the payment still counts as paid when it leaves your account.</p></div>
    {bill === undefined && <p role="status" className={note}>Loading the card bill…</p>}
    {bill === null && <p role="alert" className="text-sm leading-6">We could not load this card bill. It has not been changed.</p>}
    {bill && !canEnterStatementAmount(bill) && <p className="text-sm leading-6">This card bill is not paid in full from a statement, so there is no statement amount to enter here.</p>}
    {bill && canEnterStatementAmount(bill) && <div className={`${cardStyles.surface} space-y-4`}>
      <fieldset disabled={request.busy || request.needsRefresh} className="min-w-0 space-y-4">
        <StatementAmountEntry bill={bill} hidden={hidden} disabled={request.busy} value={typed} onChange={setTyped} />
        {bill.user_entered && <button type="button" onClick={clear} className={cardStyles.link}>Clear my amount</button>}
      </fieldset>
      <StatementWorking bill={bill} hidden={hidden} />
    </div>}
    <EditorError message={request.error} />
    <EditorActions formId={formId} busy={request.busy} needsRefresh={request.needsRefresh} saveDisabled={!canSave && !request.needsRefresh} onCancel={onCancel} renderActions={renderActions} />
  </form></BalancesHiddenContext.Provider>;
}
