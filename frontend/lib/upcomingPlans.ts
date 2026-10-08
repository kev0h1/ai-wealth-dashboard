import type { Account, AccountPlanData, CashflowData } from "./api";
import type { UpcomingAccountSummary } from "./upcomingAccounts";

/** Account-only planning overlay. Never an input to the payday hero or bill walk. */
export type Plan = {
  id: string;
  recordId?: string;
  kind: "allocation" | "goal";
  name: string;
  destination: string;
  destinationIds?: string[];
  sourceId: string | null;
  evidence: "recent-transfers" | "chosen" | "unknown";
  periodPence: number;
  filledPence: number;
  /** Live server remainder takes precedence over the display target/fill pair. */
  remainingPence?: number;
  active: boolean;
  amountUnavailable?: boolean;
  /** No current API proves transfer-to-plan identity. Never infer an offset. */
  overlapUncertain?: boolean;
  overlapReason?: "forecast-transfer" | "shared-plan";
  scheduledPence?: number;
};

export function money(pence: number, positive = false) {
  if (!Number.isFinite(pence)) return "Unavailable";
  return `${pence < 0 ? "−" : positive && pence > 0 ? "+" : ""}£${(Math.abs(pence) / 100).toLocaleString("en-GB", { minimumFractionDigits: pence % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

export function dateLabel(iso: string) {
  const date = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(date) : "Date unavailable";
}

export function remaining(plan: Plan) {
  return plan.active ? Math.max(0, plan.remainingPence ?? (plan.periodPence - plan.filledPence)) : 0;
}

/** A user choice remains distinct from a read-only historical association. */
export function hasChosenPlanSource(plan: Plan) {
  return plan.evidence === "chosen" && Boolean(plan.sourceId);
}

/** The API validates derived sources (set-asides and goal plans); every resulting figure must
 * be labelled estimated. Unknown sources and intentional clears stay out. */
export function hasPlanSource(plan: Plan) {
  // G230: a goal plan's paying account may also be inferred from recent
  // transfers into its pot, so it counts here as an estimate, exactly like a
  // set-aside's inferred source.
  return hasChosenPlanSource(plan) || Boolean(plan.sourceId && plan.evidence === "recent-transfers");
}

export function isPlanSourceAccount(account: Account) {
  const kind = `${account.type} ${account.subtype ?? ""}`.toLowerCase();
  return account.currency.toUpperCase() === "GBP" && !kind.includes("credit")
    && (account.manual || /bank|current|transaction|saving|isa|cash/.test(kind));
}

export function plansFromApi(items: AccountPlanData[]): Plan[] {
  return items.map((item) => ({
    id: item.id, recordId: item.record_id, kind: item.kind, name: item.name,
    destination: item.destination, destinationIds: item.destination_account_ids,
    sourceId: item.source_account_id, evidence: item.source_basis,
    periodPence: Math.round(item.period_amount * 100),
    filledPence: Math.round((item.filled_amount ?? 0) * 100),
    remainingPence: Math.round(item.remaining * 100), active: item.active,
    amountUnavailable: ![item.period_amount, item.remaining, item.filled_amount ?? 0].every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0),
  }));
}

/**
 * Destination/source coincidence is NOT proof that two promises are one.
 * If a dated move might also fill a plan, leave the combined total unknown
 * instead of either deducting it twice or inventing a matching credit.
 * Shared receiving pots similarly do not prove allocation/goal identity.
 */
export const PLAN_OVERLAP_TOLERANCE = 0.15;

type OverlapAccount = Pick<Account, "id" | "type"> & { subtype?: string | null };

function isCardRepayment(bill: CashflowData["upcoming_bills"][number], accounts: OverlapAccount[]) {
  if ((bill.category ?? "").trim().toLowerCase() === "debt") return true;
  const dest = bill.dest_account_id ? accounts.find((account) => account.id === bill.dest_account_id) : undefined;
  return Boolean(dest && `${dest.type} ${dest.subtype ?? ""}`.toLowerCase().includes("credit"));
}

/** G235: only a move that could plausibly BE the plan's contribution counts. It must go to one
 * of the plan's destinations, or have an unknown destination while not being a card repayment and
 * sitting within PLAN_OVERLAP_TOLERANCE (15%) of the plan's remaining slice. Anything else
 * (card repayments, unrelated amounts) is unrelated and never blanks the figure. */
export function assessPlanOverlap(plans: Plan[], cashflow: Pick<CashflowData, "upcoming_bills">, endMs: number, accounts: OverlapAccount[] = []): Plan[] {
  return plans.map((plan) => {
    if (!plan.active || remaining(plan) === 0 || !hasPlanSource(plan)) return plan;
    const shared = plans.some((other) => other.id !== plan.id && other.active && remaining(other) > 0
      && other.sourceId === plan.sourceId && hasPlanSource(other)
      && other.destinationIds?.some((id) => plan.destinationIds?.includes(id)));
    const slice = remaining(plan) / 100;
    const move = cashflow.upcoming_bills.some((bill) => bill.kind === "movement"
      && bill.account_id === plan.sourceId && !bill.is_credit_card && !bill.observed_pending
      && Number.isFinite(Date.parse(bill.expected_date)) && Date.parse(bill.expected_date) <= endMs
      && (bill.dest_account_id
        ? Boolean(plan.destinationIds?.includes(bill.dest_account_id))
        : !isCardRepayment(bill, accounts) && Math.abs(Math.abs(bill.amount) - slice) <= slice * PLAN_OVERLAP_TOLERANCE));
    return { ...plan, overlapUncertain: shared || move, overlapReason: shared ? "shared-plan" : move ? "forecast-transfer" : undefined };
  });
}

export function accountPlan(account: UpcomingAccountSummary, plans: Plan[]) {
  const assigned = plans.filter((plan) => plan.active && plan.sourceId === account.id && hasPlanSource(plan));
  const unassigned = plans.filter((plan) => plan.active && (plan.amountUnavailable || remaining(plan) > 0) && !hasPlanSource(plan));
  const estimated = assigned.some((plan) => plan.evidence === "recent-transfers" && (plan.amountUnavailable || remaining(plan) > 0));
  const clientUncertain = assigned.some((plan) => plan.amountUnavailable || plan.overlapUncertain);
  const allocationPence = assigned.filter((plan) => plan.kind === "allocation" && !plan.amountUnavailable).reduce((sum, plan) => sum + remaining(plan), 0);
  const goalPence = assigned.filter((plan) => plan.kind === "goal" && !plan.amountUnavailable).reduce((sum, plan) => sum + remaining(plan), 0);
  // Reserved for an explicit future transfer-to-plan identity contract. No
  // production payload currently has that evidence, so no credit is invented.
  const scheduledPence = 0;
  const clientReservedPence = allocationPence + goalPence;
  // G238: the server's per-account position is the single source of truth, so
  // Upcoming and Home's Spend from can never disagree. The arithmetic below is
  // only the fallback for an old API that does not send it yet.
  // TODO(G238): delete the fallback arithmetic after the release that ships the server field.
  const server = account.position;
  const toPence = (pounds: number | null) => (pounds === null ? null : Math.round(pounds * 100));
  const afterPayments = server ? toPence(server.afterPayments) : account.closing === null ? null : Math.round(account.closing * 100);
  const uncertain = server ? server.uncertain : clientUncertain;
  const reservedPence = server ? Math.round(server.plansReserved * 100) : clientReservedPence;
  const afterPlans = server
    ? (uncertain ? null : toPence(server.afterPaymentsAndPlans))
    : afterPayments === null || uncertain ? null : afterPayments - reservedPence;
  const planGap = afterPlans === null || afterPayments === null ? null : Math.max(0, -afterPlans) - Math.max(0, -afterPayments);
  return { assigned, unassigned, estimated, uncertain, allocationPence, goalPence, scheduledPence, reservedPence, afterPayments, afterPlans, planGap };
}
