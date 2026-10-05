"use client";

import { useEffect, type ReactNode } from "react";
import { Pencil } from "lucide-react";
import { api, type Account, type Allocation } from "@/lib/api";
import type { Plan } from "@/lib/upcomingPlans";
import type { UpcomingAccountSummary } from "@/lib/upcomingAccounts";
import { BANK_META, BankBadge, bankKey, bankLogoSrc } from "@/components/AccountMiniCard";
import UpcomingFlowSheet, { UpcomingFlowFooter, type UpcomingFlowNavigation } from "@/components/UpcomingFlowSheet";
import { UpcomingEditForm, type UpcomingEditItem, type UpcomingEditServices } from "@/components/UpcomingEditForm";
import { PlannedEditForm, type PlannedEditItem, type PlannedEditServices } from "@/components/PlannedEditForm";
import { AllocationEditForm, type AllocationEditServices } from "@/components/AllocationEditForm";
import UpcomingAccountDetails from "./UpcomingAccountDetails";
import UpcomingPlanDetails from "./UpcomingPlanDetails";
import UpcomingRowDetails from "./UpcomingRowDetails";
import type { UpcomingRowModel } from "./UpcomingRow";
import GoalSourceForm from "./GoalSourceForm";
import { CategoryIcon, PlanIcon, detailFocus } from "./detailPrimitives";
import { useEditorRequest } from "./editorSupport";

export type PaymentDetail = { id: string; model: UpcomingRowModel; editor: UpcomingEditItem; planned?: PlannedEditItem; skip?: () => Promise<void>;
  /** The cashflow item this payment was built from, so an account event (UpcomingAccountEvent.source) can open it. */
  source?: object };
export type UpcomingDetailView = { kind: "account"; id: string } | { kind: "plan" | "edit-plan"; id: string } | { kind: "payment" | "edit-payment"; id: string };
export type UpcomingDetailServices = {
  upcoming?: UpcomingEditServices;
  planned?: PlannedEditServices;
  allocation?: AllocationEditServices;
  changeGoalSource?: (id: string, source: string | null) => Promise<unknown>;
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
  useEffect(() => { returnTo(isAccountView); }, [returnTo]);
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

/** The preview and Upcoming mount this exact flow, including the real editors. */
export default function UpcomingDetailFlow(props: UpcomingDetailFlowProps) {
  const { accounts, summaries, plans, allocations, payments, services } = props;
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
        title: account.bank, subtitle: `${account.name} · ${props.periodLabel}`,
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
    if (view.kind === "plan") {
      const source = accounts.find((account) => account.id === plan.sourceId);
      return {
        title: plan.name, subtitle: `${plan.kind === "allocation" ? "Allocation" : "Goal"} · This pay period`, leading: <PlanIcon kind={plan.kind} />,
        body: <UpcomingPlanDetails plan={plan} accountName={source && plan.evidence !== "unknown" ? `${source.provider} · ${source.name}` : null} />,
        footer: <button type="button" data-flow-focus={`edit-${plan.id}`} className={flowSecondary} onClick={() => navigation.goTo({ kind: "edit-plan", id: plan.id })}><Pencil size={16} aria-hidden="true" />{plan.kind === "allocation" ? "Edit allocation" : "Change paying account"}</button>,
      };
    }
    const allocation = allocations.find((item) => item.id === plan.recordId);
    return {
      title: plan.kind === "allocation" ? "Edit allocation" : "Link goal to an account", subtitle: plan.name,
      body: plan.kind === "goal"
        ? <GoalSourceForm key={plan.id} plan={plan} accounts={accounts} onCancel={navigation.back} onSaved={saved} onSave={async (source) => { await (services?.changeGoalSource ?? ((id, sourceId) => api.updateCommitment(id, { source_account_id: sourceId })))(plan.recordId!, source); }} />
          : allocation ? <AllocationEditForm key={plan.id} allocation={allocation} accounts={accounts} suggestedSourceId={plan.evidence === "recent-transfers" ? plan.sourceId : null} periodStart={props.periodStart} services={services?.allocation} onCancel={navigation.back} onSaved={saved} onDeleted={saved} renderActions={actionsInFooter} />
          : <p role="status" className="text-sm">The allocation could not be loaded. Close these details and try again.</p>,
    };
  }
  return <UpcomingFlowSheet initialView={props.initialView} onClose={props.onClose} renderView={renderView} />;
}
