"use client";

import { useId, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import MoneyText from "@/components/MoneyText";
import { PlanIcon } from "@/components/upcoming/detailPrimitives";
import type { Account, Allocation } from "@/lib/api";
import { displayAccountName } from "@/lib/accountName";
import { tidyAccountText } from "@/lib/accountDisplay";
import { titleFor } from "@/lib/setAsideDisplay";
import { fulfilmentRow, money, remaining, type Plan } from "@/lib/upcomingPlans";
import styles from "./UpcomingPlansCard.module.css";

export interface UpcomingPlansCardProps {
  /** `null` is still loading; an empty array is a successful empty result. */
  allocations: Allocation[] | null;
  allocationsError: boolean;
  plans: Plan[];
  plansStatus: "loading" | "error" | "ready";
  accounts: Account[];
  onAdd(): void;
  onEditAllocation(allocation: Allocation): void;
  onPlan(id: string): void;
  onRetryAllocations(): void;
  onRetryPlans(): void;
}

type GroupKind = "allocation" | "goal";

type AllocationRow = {
  kind: "allocation";
  allocation: Allocation;
};

type GoalRow = {
  kind: "goal";
  plan: Plan;
};

type Row = AllocationRow | GoalRow;

function accountIdentity(account: Account | undefined) {
  if (!account) return null;
  const provider = tidyAccountText(account.provider);
  const name = displayAccountName(account.name);
  return [provider, name].filter(Boolean).join(" · ") || null;
}

type SourcePresentation = { text: string; needsPayer: boolean };

function allocationSource(allocation: Allocation, accounts: Account[], overlay: Plan | undefined, overlayReady: boolean): SourcePresentation {
  if (overlayReady && overlay) return planSource(overlay, accounts);
  if (allocation.source_account_id) {
    const identity = accountIdentity(accounts.find((account) => account.id === allocation.source_account_id));
    return identity ? { text: `From ${identity}`, needsPayer: false } : { text: "Paying account needs checking", needsPayer: true };
  }
  // Until the plan overlay has arrived we cannot know whether a legacy
  // allocation has verified source evidence. Do not call it unassigned.
  return { text: "Checking paying account", needsPayer: false };
}

function planSource(plan: Plan, accounts: Account[]): SourcePresentation {
  if (!plan.sourceId) return { text: "Choose paying account", needsPayer: true };
  const identity = accountIdentity(accounts.find((account) => account.id === plan.sourceId));
  if (!identity || plan.evidence === "unknown") return { text: "Paying account needs checking", needsPayer: true };
  return plan.evidence === "recent-transfers"
    ? { text: `From ${identity} · estimated from recent transfers`, needsPayer: false }
    : { text: `From ${identity}`, needsPayer: false };
}

function allocationOverlay(allocation: Allocation, plans: Plan[]) {
  return plans.find((plan) => plan.kind === "allocation" && (
    plan.recordId === allocation.id || plan.id === `allocation:${allocation.id}`
  ));
}

function formatPounds(value: number) {
  return money(Math.round(value * 100));
}

function allocationFigure(allocation: Allocation) {
  const target = allocation.period_amount ?? allocation.amount_per_period;
  const filled = Math.max(0, allocation.filled_this_period);
  const due = Math.max(0, allocation.remaining);
  const starts = new Date(`${allocation.period_start.slice(0, 10)}T12:00:00Z`);
  const startsLabel = Number.isFinite(starts.getTime())
    ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(starts)
    : null;

  // Pending reserves are deliberately not portrayed as funded, even though
  // their server remainder is zero while the period has not begun.
  if (allocation.pending) {
    return {
      amount: null,
      label: startsLabel ? `Starts ${startsLabel}` : "Starts later",
      status: "Not reserved",
      supporting: null,
    };
  }
  // A completed once-only record only proves that its fixed period ended.
  // Its actual fill remains the only basis for a "set aside" claim.
  if (allocation.completed) {
    return filled > 0
      ? { amount: formatPounds(filled), label: "was set aside", status: null, supporting: null }
      : { amount: null, label: "Period ended", status: null, supporting: null };
  }
  if (due === 0 && filled > 0) {
    return { amount: formatPounds(filled), label: "set aside", status: null, supporting: `${formatPounds(filled)} of ${formatPounds(target)} set aside` };
  }
  return {
    amount: formatPounds(due),
    label: "still to reserve",
    status: null,
    supporting: filled > 0 ? `${formatPounds(filled)} of ${formatPounds(target)} set aside` : null,
  };
}

function planFigure(plan: Plan) {
  if (plan.amountUnavailable) return { amount: null, label: plan.planKind ? "to repay" : "to contribute", status: "Unavailable", supporting: null };
  const fulfilment = fulfilmentRow(plan);
  if (fulfilment) {
    return { amount: fulfilment.amount, label: fulfilment.status, status: null, supporting: fulfilment.detail };
  }
  return {
    amount: money(remaining(plan)),
    label: plan.planKind ? "to repay" : plan.sourceId ? "to contribute" : "this period",
    status: null,
    supporting: null,
  };
}

function RowItem({ row, accounts, plans, plansReady, onEditAllocation, onPlan }: {
  row: Row;
  accounts: Account[];
  plans: Plan[];
  plansReady: boolean;
  onEditAllocation: (allocation: Allocation) => void;
  onPlan: (id: string) => void;
}) {
  const isAllocation = row.kind === "allocation";
  const allocation = isAllocation ? row.allocation : null;
  const plan = !isAllocation ? row.plan : null;
  const figure = allocation ? allocationFigure(allocation) : planFigure(plan!);
  const source = allocation ? allocationSource(allocation, accounts, allocationOverlay(allocation, plans), plansReady) : planSource(plan!, accounts);
  const title = allocation ? titleFor({
    name: allocation.name,
    // This is only the legacy display-hygiene context for a bare numeric
    // title. It is never used to infer where the allocation is paid from.
    feedLabel: allocation.fill_display_name || accounts.find((account) => account.id === allocation.fill_account_id)?.name || null,
  }) : { primary: plan!.name, tag: null };
  const payerPrompt = source.needsPayer;
  const description = plan?.planKind === "card_repayment" ? `Repayment plan · ${source.text}` : source.text;

  return <li className={styles.rowItem}>
    <button
      type="button"
      className={styles.row}
      data-balanced-row={`plan-${allocation?.id ?? plan!.id}`}
      aria-haspopup="dialog"
      onClick={() => allocation ? onEditAllocation(allocation) : onPlan(plan!.id)}
    >
      <span data-row-content className={styles.rowContent}>
        <span className={styles.icon} aria-hidden="true"><PlanIcon kind={isAllocation ? "allocation" : "goal"} cardPlan={Boolean(plan?.planKind)} /></span>
        <span className={styles.copy}>
          <span className={styles.name}><MoneyText text={title.primary} />{title.tag && <span className={styles.tag}> {title.tag}</span>}</span>
          <MoneyText text={description} className={`${styles.source} ${payerPrompt ? styles.payerPrompt : ""}`} />
          {figure.supporting && <MoneyText text={figure.supporting} className={styles.supporting} />}
        </span>
        <span className={styles.figure}>
          {figure.status ? <MoneyText text={figure.status} className={styles.status} /> : figure.amount ? <MoneyText text={figure.amount} className={styles.amount} /> : null}
          <span className={styles.caption}>{figure.label}</span>
        </span>
        <ChevronRight aria-hidden="true" size={16} className={styles.chevron} />
      </span>
    </button>
  </li>;
}

function groupPresentation(kind: GroupKind, rows: Row[]) {
  if (kind === "allocation") return { heading: "Set-asides", noun: "set-aside" };
  const goals = rows.flatMap((row) => row.kind === "goal" ? [row.plan] : []);
  if (goals.length > 0 && goals.every((plan) => plan.planKind === "card_repayment")) return { heading: "Repayment plans", noun: "repayment plan" };
  if (goals.some((plan) => plan.planKind === "card_repayment")) return { heading: "Goals and repayment plans", noun: "plan" };
  return { heading: "Goals", noun: "goal" };
}

function rowsMeta(noun: string, count: number, needsPayer: number) {
  const counted = `${count} ${noun}${count === 1 ? "" : "s"}`;
  return needsPayer ? `${counted} · ${needsPayer} ${needsPayer === 1 ? "needs" : "need"} a paying account` : counted;
}

function ReadyGroup({ kind, rows, accounts, plans, plansReady, onEditAllocation, onPlan, headingId, contentId, recovery }: {
  kind: GroupKind;
  rows: Row[];
  accounts: Account[];
  plans: Plan[];
  plansReady: boolean;
  onEditAllocation: (allocation: Allocation) => void;
  onPlan: (id: string) => void;
  headingId: string;
  contentId: string;
  recovery?: { onRetry: () => void };
}) {
  const [expanded, setExpanded] = useState(false);
  const { heading, noun } = groupPresentation(kind, rows);
  const needsPayer = rows.filter((row) => {
    if (row.kind === "allocation") {
      // Pending, completed and zero-due allocation rows have no current payer
      // action, even if their historic source is absent.
      if (row.allocation.pending || row.allocation.completed || row.allocation.remaining <= 0) return false;
      return allocationSource(row.allocation, accounts, allocationOverlay(row.allocation, plans), plansReady).needsPayer;
    }
    return planSource(row.plan, accounts).needsPayer;
  }).length;

  if (rows.length === 0) {
    return <section className={styles.group} aria-labelledby={headingId} data-tutorial-id={kind === "allocation" ? "tutorial-planning-allocations" : undefined}>
      <div className={styles.emptySection} data-balanced-row={`empty-${kind}`}>
        <div data-row-content className={styles.emptySectionContent}><h3 id={headingId}>{heading}</h3><p>None yet</p></div>
      </div>
      {recovery && <div className={styles.inlineError} role="alert"><span>Couldn’t refresh. Showing the last known plans.</span><button type="button" onClick={recovery.onRetry}>Try again</button></div>}
    </section>;
  }

  return <section className={styles.group} aria-labelledby={headingId} data-tutorial-id={kind === "allocation" ? "tutorial-planning-allocations" : undefined}>
    <h3 id={headingId} className={styles.groupHeading}>
      <button
        type="button"
        className={styles.groupButton}
        data-balanced-row={`plans-${kind}-disclosure`}
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded((open) => !open)}
      >
        <span data-row-content className={styles.groupCopy}>
          <span className={styles.groupTitle}>{heading}</span>
          <span className={styles.groupMeta}>{rowsMeta(noun, rows.length, needsPayer)}</span>
        </span>
        <ChevronDown aria-hidden="true" size={18} className={`${styles.groupChevron} ${expanded ? styles.groupChevronOpen : ""}`} />
      </button>
    </h3>
    {recovery && <div className={styles.inlineError} role="alert"><span>Couldn’t refresh. Showing the last known plans.</span><button type="button" onClick={recovery.onRetry}>Try again</button></div>}
    <div id={contentId} className={styles.groupContent} hidden={!expanded}>
      <ul className={styles.list}>{rows.map((row) => <RowItem key={row.kind === "allocation" ? row.allocation.id : row.plan.id} row={row} accounts={accounts} plans={plans} plansReady={plansReady} onEditAllocation={onEditAllocation} onPlan={onPlan} />)}</ul>
    </div>
  </section>;
}

function LoadingGroup({ heading, id }: { heading: string; id: string }) {
  return <section className={styles.group} aria-labelledby={id}>
    <h3 id={id} className={styles.groupHeading}><span className={styles.groupStatus}><span>{heading}</span><span>Checking…</span></span></h3>
  </section>;
}

function ErrorGroup({ heading, id, onRetry }: { heading: string; id: string; onRetry: () => void }) {
  return <section className={styles.group} aria-labelledby={id}>
    <div className={styles.errorGroup} role="alert">
      <span><strong id={id}>{heading}</strong><span>Couldn’t check these plans.</span></span>
      <button type="button" onClick={onRetry}>Try again</button>
    </div>
  </section>;
}

export default function UpcomingPlansCard({
  allocations,
  allocationsError,
  plans,
  plansStatus,
  accounts,
  onAdd,
  onEditAllocation,
  onPlan,
  onRetryAllocations,
  onRetryPlans,
}: UpcomingPlansCardProps) {
  const id = useId();
  const allocationRows: AllocationRow[] = (allocations ?? []).filter((allocation) => allocation.active).map((allocation) => ({ kind: "allocation", allocation }));
  // The account-plan projection is already scoped to the current period.
  // Keep every active goal record, including fulfilled and zero-remainder rows.
  const goalRows: GoalRow[] = plans.filter((plan) => plan.kind === "goal" && plan.active).map((plan) => ({ kind: "goal", plan }));
  const allocationsReady = allocations !== null;
  const plansReady = plansStatus === "ready" || (plansStatus === "error" && goalRows.length > 0);
  const bothEmpty = allocationsReady && !allocationsError && plansStatus === "ready" && allocationRows.length === 0 && goalRows.length === 0;
  const onlyRepayments = goalRows.length > 0 && goalRows.every(({ plan }) => plan.planKind === "card_repayment");

  return <section id="pay-period-plans" className={styles.panel} data-tutorial-id="tutorial-planning-plans" aria-labelledby={`${id}-title`}>
    <header className={styles.header}>
      <h2 id={`${id}-title`}>{onlyRepayments ? "Set-asides and repayment plans" : "Set-asides and goals"}</h2>
      <button type="button" onClick={onAdd} data-tutorial-id="tutorial-planning-add" aria-haspopup="dialog" className={styles.add}>Add</button>
    </header>
    {bothEmpty ? <div className={styles.emptyAll}>
      <p>No set-asides or goal contributions this period.</p>
      <button type="button" onClick={onAdd}>Add a plan</button>
    </div> : <div className={styles.card}>
      {!allocationsReady ? (allocationsError ? <ErrorGroup heading="Set-asides" id={`${id}-set-asides`} onRetry={onRetryAllocations} /> : <LoadingGroup heading="Set-asides" id={`${id}-set-asides`} />)
        : <ReadyGroup kind="allocation" rows={allocationRows} accounts={accounts} plans={plans} plansReady={plansStatus === "ready"} onEditAllocation={onEditAllocation} onPlan={onPlan} headingId={`${id}-set-asides`} contentId={`${id}-set-asides-content`} recovery={allocationsError ? { onRetry: onRetryAllocations } : undefined} />}
      {!plansReady ? (plansStatus === "error" ? <ErrorGroup heading="Goals" id={`${id}-goals`} onRetry={onRetryPlans} /> : <LoadingGroup heading="Goals" id={`${id}-goals`} />)
        : <ReadyGroup kind="goal" rows={goalRows} accounts={accounts} plans={plans} plansReady={plansStatus === "ready"} onEditAllocation={onEditAllocation} onPlan={onPlan} headingId={`${id}-goals`} contentId={`${id}-goals-content`} recovery={plansStatus === "error" ? { onRetry: onRetryPlans } : undefined} />}
    </div>}
  </section>;
}
