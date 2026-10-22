"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Pencil } from "lucide-react";
import { type Account, type Allocation, type Commitment } from "@/lib/api";
import { displayAccountName } from "@/lib/accountName";
import type { Plan } from "@/lib/upcomingPlans";
import type { UpcomingAccountSummary } from "@/lib/upcomingAccounts";
import { BANK_META, BankBadge, bankKey, bankLogoSrc } from "@/components/AccountMiniCard";
import UpcomingFlowSheet, { UpcomingFlowFooter, type UpcomingFlowNavigation } from "@/components/UpcomingFlowSheet";
import { UpcomingEditForm, type UpcomingEditItem, type UpcomingEditServices } from "@/components/UpcomingEditForm";
import { PlannedEditForm, type PlannedEditItem, type PlannedEditServices } from "@/components/PlannedEditForm";
import { AllocationPlanEditor, type AllocationEditServices } from "@/components/AllocationPlanEditor";
import UpcomingAccountDetails from "./UpcomingAccountDetails";
import UpcomingRowDetails from "./UpcomingRowDetails";
import type { UpcomingRowModel } from "./UpcomingRow";
import { CategoryIcon, PlanIcon, detailFocus } from "./detailPrimitives";
import { useEditorRequest } from "./editorSupport";
import UpcomingGoalPlan, { type UpcomingGoalServices } from "./UpcomingGoalPlan";

export type PaymentDetail = { id: string; model: UpcomingRowModel; editor: UpcomingEditItem; planned?: PlannedEditItem; skip?: () => Promise<void>;
  /** The cashflow item this payment was built from, so an account event (UpcomingAccountEvent.source) can open it. */
  source?: object };
export type UpcomingDetailView = { kind: "account"; id: string } | { kind: "plan" | "edit-plan" | "goal-contribution" | "allocation-contribution"; id: string; step?: "details" } | { kind: "payment" | "edit-payment"; id: string };
export type UpcomingDetailServices = {
  upcoming?: UpcomingEditServices;
  planned?: PlannedEditServices;
  allocation?: AllocationEditServices;
  /** Complete records only. Upcoming plan rows are read-only forecast projections. */
  goal?: UpcomingGoalServices;
};
export type UpcomingDetailFlowProps = {
  initialView: UpcomingDetailView; onClose(): void;
  accounts: Account[]; summaries: UpcomingAccountSummary[]; periodLabel: string; periodStart: Date;
  plans: Plan[]; plansStatus: "loading" | "error" | "ready";
  allocations: Allocation[]; payments: PaymentDetail[];
  onRefresh(): Promise<void>;
  onDismiss(payment: PaymentDetail): void;
  onDeletePlanned(id: string): void;
  services?: UpcomingDetailServices;
};
export const flowPrimary = `flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700 ${detailFocus}`;
export const flowSecondary = `flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800 ${detailFocus}`;
/** A payment detail opened from an account sheet returns there after a change; opened from the list it keeps its own exit. */
const isAccountView = (view: UpcomingDetailView) => view.kind === "account";
const leavePayment = (navigation: UpcomingFlowNavigation<UpcomingDetailView>, fallback: () => void) => () => { if (!navigation.returnTo(isAccountView)) fallback(); };
/** A dismissed payment unmounts its own detail before any "after" callback can run, so the absent state itself steps back to the account sheet it came from. */
function ReturnToAccount({ navigation }: { navigation: UpcomingFlowNavigation<UpcomingDetailView> }) {
  const { returnTo } = navigation;
  const leaving = navigation.canReturnTo(isAccountView);
  useEffect(() => { returnTo(isAccountView); }, [returnTo]);
  // An account is beneath: the popstate is about to land, so show nothing rather than flash the copy.
  if (leaving) return <div aria-busy="true" className="min-h-24" />;
  return <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">This item is no longer expected in this period.</p>;
}
const actionsInFooter = (actions: ReactNode) => <UpcomingFlowFooter>{actions}</UpcomingFlowFooter>;

function PaymentActions({ payment, navigation }: { payment: PaymentDetail; navigation: UpcomingFlowNavigation<UpcomingDetailView> }) {
  const request = useEditorRequest();
  const { busy, error } = request;
  async function skip() {
    if (payment.skip) await request.run(payment.skip, leavePayment(navigation, navigation.close), "We could not dismiss this occurrence. Please try again.");
  }
  return <div>
    {error && <p role="alert" className="mb-3 text-sm">{error}</p>}
    <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-3"><button type="button" data-flow-focus="edit-payment" disabled={busy} className={flowSecondary} onClick={() => navigation.goTo({ kind: "edit-payment", id: payment.id })}><Pencil size={16} aria-hidden="true" />{payment.planned ? "Edit payment" : "Edit prediction"}</button><button type="button" disabled={busy} className={flowPrimary} onClick={navigation.close}>Done</button></div>
    {payment.skip && <button type="button" disabled={busy} onClick={skip} className={`mt-2 min-h-11 w-full rounded-lg text-sm text-slate-600 dark:text-slate-300 ${detailFocus}`}>{busy ? "Dismissing…" : "Dismiss for this month"}</button>}
  </div>;
}

/** A forecast row can outlive the refreshed allocation record briefly. Do not
 * substitute a plan projection for a record that is no longer available. */
function MissingAllocation({ onRetry }: { onRetry(): Promise<void> }) {
  const request = useEditorRequest();
  return <div className="space-y-4">
    <p role="alert" className="text-sm leading-6 text-slate-700 dark:text-slate-200">We could not load this set-aside. It has not been changed.</p>
    {request.error && <p role="alert" className="text-sm leading-6 text-slate-700 dark:text-slate-200">{request.error}</p>}
    <button type="button" disabled={request.busy} onClick={() => void request.run(onRetry, undefined, "We could not refresh this set-aside. Please try again.")} className={flowSecondary}>{request.busy ? "Refreshing…" : "Try again"}</button>
  </div>;
}

/** The preview and Upcoming mount this exact flow, including the real editors. */
export default function UpcomingDetailFlow(props: UpcomingDetailFlowProps) {
  const { accounts, summaries, plans, allocations, payments, services } = props;
  const [goals, setGoals] = useState<Record<string, Commitment>>({});
  const [savedAllocations, setSavedAllocations] = useState<Record<string, Allocation>>({});
  function renderView(view: UpcomingDetailView, navigation: UpcomingFlowNavigation<UpcomingDetailView>) {
    const done = <button type="button" className={flowPrimary} onClick={navigation.close}>Done</button>;
    const absent = { title: "Details updated", body: <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">This item is no longer expected in this period.</p>, footer: done };
    async function saved() { await props.onRefresh(); }
    if (view.kind === "account") {
      const account = summaries.find((item) => item.id === view.id);
      if (!account) return absent;
      const meta = BANK_META[bankKey({ provider: account.bank })];
      const editable = new Map<string, string>();
      for (const event of account.events) { const match = event.source ? payments.find((item) => item.source === event.source) : undefined; if (match) editable.set(event.id, match.id); }
      return {
        title: account.bank, subtitle: `${displayAccountName(account.name)} · ${props.periodLabel}`,
        leading: <BankBadge logoSrc={bankLogoSrc(meta)} initials={meta?.initials ?? account.bank.slice(0, 2)} altText="" size={36} />,
        body: <UpcomingAccountDetails account={account} periodLabel={props.periodLabel} plans={plans} plansStatus={props.plansStatus} onPlan={(id) => navigation.goTo({ kind: "plan", id })} editableEventIds={new Set(editable.keys())} onEvent={(eventId) => { const id = editable.get(eventId); if (id) navigation.goTo({ kind: "payment", id }); }} />, footer: done,
      };
    }
    if (view.kind === "payment" || view.kind === "edit-payment") {
      const payment = payments.find((item) => item.id === view.id);
      if (!payment) return { ...absent, body: <ReturnToAccount navigation={navigation} /> };
      if (view.kind === "payment") return {
        title: payment.model.name, subtitle: `${payment.model.accountLabel ?? "Account not confirmed"} · ${payment.model.isCreditCard ? "Card charge" : payment.model.type === "income" ? "Income" : "Payment"}`,
        leading: <CategoryIcon Icon={payment.model.CategoryIcon} colour={payment.model.categoryColour} />,
        body: <UpcomingRowDetails model={payment.model} ruleLabel={payment.editor.rule_label} />,
        footer: <PaymentActions payment={payment} navigation={navigation} />,
      };
      return { title: payment.planned ? "Edit planned payment" : "Edit prediction", subtitle: payment.model.name,
        body: payment.planned
          ? <PlannedEditForm key={payment.id} item={payment.planned} accounts={accounts} services={services?.planned} onCancel={navigation.back} onDone={leavePayment(navigation, navigation.back)} onSaved={saved} onDelete={() => { props.onDeletePlanned(payment.planned!.id); leavePayment(navigation, navigation.close)(); }} renderActions={actionsInFooter} />
          : <UpcomingEditForm key={payment.id} item={payment.editor} services={services?.upcoming} onCancel={navigation.back} onDone={leavePayment(navigation, navigation.back)} onSaved={saved} onDismiss={() => { props.onDismiss(payment); leavePayment(navigation, navigation.close)(); }} renderActions={actionsInFooter} />,
      };
    }
    const plan = plans.find((item) => item.id === view.id);
    if (!plan) return absent;
    const allocation = (plan.recordId ? savedAllocations[plan.recordId] : undefined) ?? allocations.find((item) => item.id === plan.recordId);
    async function allocationSaved(item: Allocation) { setSavedAllocations(previous => ({ ...previous, [item.id]: item })); await props.onRefresh(); }
    const backToPlan = () => { if (!navigation.returnTo(item => item.kind === "plan" && item.id === plan.id)) navigation.back(); };
    if (plan.kind === "goal") {
      const goal = plan.recordId ? goals[plan.recordId] : undefined;
      return {
        title: view.kind === "edit-plan" ? "Edit plan" : view.kind === "goal-contribution" ? "Change this period" : goal?.name ?? "Goal",
        subtitle: view.kind === "plan" ? goal ? "Your goal" : "Loading goal" : undefined,
        leading: <PlanIcon kind="goal" />,
        body: <UpcomingGoalPlan
          key={`${view.kind}-${plan.recordId ?? plan.id}`}
          id={plan.recordId}
          planId={plan.id}
          mode={view.kind === "edit-plan" ? "edit" : view.kind === "goal-contribution" ? "contribution" : "view"}
          editStep={view.kind === "edit-plan" ? view.step : undefined}
          accounts={accounts}
          commitment={goal}
          services={services?.goal}
          navigation={navigation}
          onLoaded={(commitment) => setGoals(previous => ({ ...previous, [commitment.id]: commitment }))}
          onRefresh={props.onRefresh}
        />,
      };
    }
    if (view.kind === "plan") {
      if (plan.kind === "allocation" && allocation) return {
        title: plan.name, subtitle: "Your set-aside", leading: <PlanIcon kind={plan.kind} />,
        body: <AllocationPlanEditor key={`view-${plan.id}`} initialMode="view" onEdit={() => navigation.goTo({ kind: "edit-plan", id: plan.id })} onChangeContribution={() => navigation.goTo({ kind: "allocation-contribution", id: plan.id })} allocation={allocation} accounts={accounts} suggestedSourceId={plan.evidence === "recent-transfers" ? plan.sourceId : null} periodStart={props.periodStart} services={services?.allocation} onCancel={navigation.close} onSaved={allocationSaved} onDeleted={saved} renderActions={actionsInFooter} />,
      };
      return { title: plan.name, subtitle: "Your set-aside", leading: <PlanIcon kind="allocation" />, body: <MissingAllocation onRetry={props.onRefresh} /> };
    }
    return {
      title: allocation ? view.kind === "allocation-contribution" ? "Change this period" : "Edit plan" : "Set-aside unavailable", subtitle: plan.name,
      body: allocation ? <AllocationPlanEditor key={`${view.kind}-${plan.id}`} initialMode={view.kind === "allocation-contribution" ? "contribution" : "edit"} onChangeContribution={() => navigation.goTo({ kind: "allocation-contribution", id: plan.id })} allocation={allocation} accounts={accounts} suggestedSourceId={plan.evidence === "recent-transfers" ? plan.sourceId : null} periodStart={props.periodStart} services={services?.allocation} onCancel={backToPlan} onSaved={allocationSaved} onDeleted={saved} renderActions={actionsInFooter} />
        : <MissingAllocation onRetry={props.onRefresh} />,
    };
  }
  return <UpcomingFlowSheet initialView={props.initialView} onClose={props.onClose} renderView={renderView} />;
}
