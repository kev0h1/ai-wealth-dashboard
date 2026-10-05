import type { CashflowData, UpcomingBill } from "./api";
import type { UpcomingAccountEvent, UpcomingAccountSummary } from "./upcomingAccounts";
import type { UpcomingRowModel } from "../components/upcoming/UpcomingRow";
import { upcomingDisplayName } from "./upcomingDisplayName";

export type AccountCoverage = { before: number; after: number; shortfall: number };
type Movement = { name: string; amount: number; expected_date: string };
type RiskBill = UpcomingBill & { movementCulprit?: Movement };
export type UpcomingAccountWalk = {
  endMs: number;
  accounts: UpcomingAccountSummary[];
  atRisk: RiskBill[];
  // Key by the original occurrence, not display fields: two identical debits
  // still have distinct before/after balances. Adapters retain this reference.
  coverage: Map<UpcomingBill, AccountCoverage>;
  riskByBill: Map<UpcomingBill, RiskBill>;
};

/** Same-day credits first; otherwise preserve the payload's order within a day. */
export function compareUpcomingEvents(
  a: { expected_date: string; type: "income" | "inflow" | "bill" },
  b: { expected_date: string; type: "income" | "inflow" | "bill" },
) {
  return Date.parse(a.expected_date) - Date.parse(b.expected_date)
    || Number(a.type === "bill") - Number(b.type === "bill");
}

/**
 * One source-account walk for both the account card and payment rows. It never
 * feeds the pooled hero. Card charges and settling debits do not debit cash;
 * credits fund only their named destination. Negative balances are cash, not
 * proof of a credit card. All arithmetic is in pence, with credits first.
 */
export function walkUpcomingAccounts(
  cashflow: Pick<CashflowData, "upcoming_bills" | "upcoming_income" | "internal_inflows">,
  endMs: number,
  planSources: { id: string; bank: string; name: string; balance: number | null }[] = [],
): UpcomingAccountWalk {
  const inWindow = (date: string) => Number.isFinite(Date.parse(date)) && Date.parse(date) <= endMs;
  const bills = cashflow.upcoming_bills.filter((bill) => inWindow(bill.expected_date) && !bill.is_credit_card && !bill.observed_pending);
  const income = cashflow.upcoming_income.filter((item) => inWindow(item.expected_date));
  const inflows = (cashflow.internal_inflows ?? []).filter((item) => inWindow(item.expected_date));
  const unknownIncome = income.some((item) => !item.account_id);
  const ids = [...new Set([...bills.map((bill) => bill.account_id || "__unknown__"), ...planSources.map((account) => account.id)])];
  const pennies = (amount: number) => Math.round(amount * 100);
  const atRisk: RiskBill[] = [];
  const coverage = new Map<UpcomingBill, AccountCoverage>();
  const riskByBill = new Map<UpcomingBill, RiskBill>();

  const accounts = ids.map((id): UpcomingAccountSummary => {
    const payments = bills.filter((bill) => (bill.account_id || "__unknown__") === id);
    const first = payments[0];
    // A plan-only source still needs the SAME dated cash walk, including its
    // income and transfers. Never override contradictory/unknown bill data
    // with a newer account-list balance, or change bill-row coverage.
    const planSource = planSources.find((account) => account.id === id);
    const opening = first ? first.account_balance : planSource?.balance;
    const balanceKnown = id !== "__unknown__" && typeof opening === "number" && Number.isFinite(opening)
      && payments.every((bill) => typeof bill.account_balance === "number" && Number.isFinite(bill.account_balance) && pennies(bill.account_balance) === pennies(opening));
    const credits = income.filter((item) => item.account_id === id);
    const transfers = inflows.filter((item) => item.account_id === id);
    const rawEvents = [
      ...credits.map((item, index) => ({ id: `income-${index}`, name: upcomingDisplayName(item), expected_date: item.expected_date, type: "income" as const, kind: "income" as const, amount: pennies(item.amount), bill: undefined, ref: item as object })),
      ...transfers.map((item, index) => ({ id: `inflow-${index}`, name: item.source_account_name ? `From ${item.source_account_name}` : "Transfer in", expected_date: item.expected_date, type: "inflow" as const, kind: "inflow" as const, amount: pennies(item.amount), bill: undefined, ref: item as object })),
      ...payments.map((item, index) => ({ id: `payment-${index}`, name: upcomingDisplayName(item), expected_date: item.expected_date, type: "bill" as const, kind: item.kind === "movement" ? "movement" as const : "payment" as const, amount: -pennies(item.amount), bill: item, ref: item as object })),
    ].sort(compareUpcomingEvents);
    const knownWorking = balanceKnown && rawEvents.every((item) => Number.isFinite(item.amount));
    let running = knownWorking ? pennies(opening!) : null;
    let gap = 0;
    let billGap = 0;
    let firstShortDate: string | null = null;
    let firstBillShortDate: string | null = null;
    let movementsSince: Movement[] = [];
    const events = rawEvents.map((event): UpcomingAccountEvent => {
      const before = running;
      if (running !== null) running += event.amount;
      if (running !== null && event.bill) {
        const shortfall = Math.max(0, -running);
        gap = Math.max(gap, shortfall);
        if (shortfall > 0) firstShortDate ??= event.expected_date;
        if (event.kind === "payment" && shortfall > 0) {
          billGap = Math.max(billGap, shortfall);
          firstBillShortDate ??= event.expected_date;
        }
        // Unknown income never funds an account. A possible deficit remains
        // unverified in BOTH views; cash sufficient without it still proves
        // coverage. The pooled forecast cannot override this evidence.
        if (!unknownIncome || shortfall === 0) {
          coverage.set(event.bill, { before: before! / 100, after: running / 100, shortfall: shortfall / 100 });
          if (event.kind === "payment" && shortfall > 0) {
            const culprit = [...movementsSince].sort((a, b) => b.amount - a.amount)[0];
            const risk = culprit ? { ...event.bill, movementCulprit: culprit } : event.bill;
            atRisk.push(risk);
            riskByBill.set(event.bill, risk);
          }
        }
        if (event.kind === "movement") movementsSince.push({ name: event.bill.name, amount: event.bill.amount, expected_date: event.expected_date });
      } else if (!event.bill) {
        movementsSince = [];
      }
      return { id: event.id, name: event.name, date: event.expected_date, kind: event.kind, amount: event.amount / 100, after: running === null ? null : running / 100, source: event.ref };
    });
    const verifiable = knownWorking && !(unknownIncome && gap > 0);
    const sum = (values: { amount: number }[]) => values.reduce((total, item) => total + pennies(item.amount), 0) / 100;
    return {
      id,
      bank: first?.account_bank || first?.account_name || planSource?.bank || "Account not identified",
      name: first?.account_name || planSource?.name || (id === "__unknown__" ? "Payment account unavailable" : "Payment account"),
      opening: balanceKnown ? opening! : null,
      income: sum(credits), transfersIn: sum(transfers), outgoing: sum(payments),
      closing: verifiable && running !== null ? running / 100 : null,
      shortfall: verifiable ? (billGap || gap) / 100 : null,
      status: !verifiable ? "unknown" : billGap > 0 ? "short" : gap > 0 ? "unfunded" : "covered",
      firstShortDate: verifiable ? (billGap > 0 ? firstBillShortDate : firstShortDate) : null,
      hasUnassignedIncome: unknownIncome,
      events,
    };
  });
  return { endMs, accounts, atRisk, coverage, riskByBill };
}

/** The production row adapter. Never infer coverage from pooled cash or a sign. */
export function upcomingAccountAssessment(
  item: UpcomingBill & { type?: "bill" | "income" },
  walk: UpcomingAccountWalk,
): Pick<UpcomingRowModel, "assessment" | "coverage" | "isCreditCard" | "isSettling" | "flagged" | "timingRisk" | "accountShort" | "accountTiming" | "atRisk" | "movementCalm" | "unfundedMovement"> {
  const future = Date.parse(item.expected_date) > walk.endMs;
  const isSettling = Boolean(item.observed_pending);
  const isCreditCard = Boolean(item.is_credit_card);
  const coverage = item.type !== "income" && !future && !isSettling && !isCreditCard ? walk.coverage.get(item) : undefined;
  const short = (coverage?.shortfall ?? 0) > 0;
  const optionalMove = item.kind === "movement";
  return {
    assessment: future ? "future" : coverage ? undefined : "unverified",
    coverage: coverage ? { ...coverage, optionalMove } : undefined,
    isSettling, isCreditCard,
    flagged: short && !optionalMove, accountShort: short && !optionalMove, atRisk: short && !optionalMove,
    timingRisk: false, accountTiming: false,
    movementCalm: short && optionalMove, unfundedMovement: short && optionalMove,
  };
}
