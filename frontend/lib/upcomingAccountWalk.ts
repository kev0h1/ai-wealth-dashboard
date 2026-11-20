import type { CashflowData, UpcomingBill } from "./api";
import { displayAccountName } from "./accountName";
import type { UpcomingAccountEvent, UpcomingAccountSummary } from "./upcomingAccounts";
import type { UpcomingRowModel } from "../components/upcoming/UpcomingRow";
import { upcomingDisplayName } from "./upcomingDisplayName";
import { isCardRepayment, isOwnAccountMove, repaymentLabel } from "./cardRepayment";

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
  // G231: accounts the user does not count towards Safe to Spend. The server
  // already drops their items; this keeps a stale cached payload honest too.
  excludedAccountIds: ReadonlySet<string> = new Set(),
): UpcomingAccountWalk {
  const inWindow = (date: string) => Number.isFinite(Date.parse(date)) && Date.parse(date) <= endMs;
  const counted = (accountId: string | null | undefined) => !accountId || !excludedAccountIds.has(accountId);
  const bills = cashflow.upcoming_bills.filter((bill) => inWindow(bill.expected_date) && !bill.is_credit_card && !bill.observed_pending && counted(bill.account_id));
  const income = cashflow.upcoming_income.filter((item) => inWindow(item.expected_date) && counted(item.account_id));
  // G372 / G481: the ONE money-in rule, mirroring backend `predicted_money_in` (Kevin 2026-11-20). A predicted
  // income offsets its account's payments when the server stamped a credit_basis (confirmed, reliable or
  // steady) or it has been seen two or more times, attributed to the account; a single sighting is shown by the
  // pooled forecast but never underwrites a per-account verdict.
  // Income dated today counts on no walk until it has posted (backend `income_counts_in_walk`): it may already be in
  // the balance. It still lists on the sheet, as an uncredited event that moves no balance.
  const isMoneyIn = (item: (typeof income)[number]) => item.days_away > 0 && (Boolean(item.credit_basis) || (item.occurrences ?? 0) >= 2);
  const credited = income.filter(isMoneyIn);
  const pennies = (amount: number) => Math.round(amount * 100);
  const allInflows = (cashflow.internal_inflows ?? []).filter((item) => inWindow(item.expected_date) && counted(item.account_id));
  // G479 (Kevin 2026-11-19, option 1): a predicted own transfer counts on BOTH legs, whether or not its source can
  // fund it. The source shows the shortfall; the destination is credited and never flagged short for money due to
  // arrive. (The G360 funded-inflow gate is gone, mirrored by the backend.)
  const inflows = allInflows;
  const unknownIncome = income.some((item) => !item.account_id);
  const ids = [...new Set([...bills.map((bill) => bill.account_id || "__unknown__"), ...planSources.filter((account) => counted(account.id)).map((account) => account.id)])];
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
    const credits = credited.filter((item) => item.account_id === id);
    // G372: an uncredited prediction stays visible as a zero-delta event (credited: false).
    const uncredited = income.filter((item) => item.account_id === id && !isMoneyIn(item));
    const transfers = inflows.filter((item) => item.account_id === id);
    const rawEvents = [
      ...credits.map((item, index) => ({ id: `income-${index}`, name: upcomingDisplayName(item), category: item.category, expected_date: item.expected_date, type: "income" as const, kind: "income" as const, amount: pennies(item.amount), credited: true as boolean, bill: undefined, ref: item as object })),
      ...uncredited.map((item, index) => ({ id: `uncredited-${index}`, name: upcomingDisplayName(item), category: item.category, expected_date: item.expected_date, type: "income" as const, kind: "income" as const, amount: pennies(item.amount), credited: false as boolean, bill: undefined, ref: item as object })),
      ...transfers.map((item, index) => ({ id: `inflow-${index}`, name: item.source_account_name ? `From ${item.source_account_name}` : "Transfer in", category: "Transfer", expected_date: item.expected_date, type: "inflow" as const, kind: "inflow" as const, amount: pennies(item.amount), credited: true as boolean, bill: undefined, ref: item as object })),
      ...payments.map((item, index) => ({ id: `payment-${index}`, name: upcomingDisplayName(item), category: item.category, expected_date: item.expected_date, type: "bill" as const, kind: isOwnAccountMove(item) ? "movement" as const : "payment" as const, amount: -pennies(item.amount), credited: true as boolean, bill: item, ref: item as object })),
    ].sort(compareUpcomingEvents);
    const knownWorking = balanceKnown && rawEvents.every((item) => Number.isFinite(item.amount));
    let running = knownWorking ? pennies(opening!) : null;
    // G481 (Kevin 2026-11-20): money in only offsets payments and no timing is involved, so whether a payment
    // is short is judged on the two totals: the opening balance plus EVERY credit, less the payments so far.
    // `running` stays the dated balance the rows display; only the verdict (shortfall) reads the totals,
    // exactly as the server's walks do (credits before debits whatever the date).
    const creditTotal = rawEvents.reduce((total, item) => (item.credited !== false && item.amount > 0 ? total + item.amount : total), 0);
    let verdictRunning = knownWorking ? pennies(opening!) + creditTotal : null;
    let gap = 0;
    let billGap = 0;
    let firstShortDate: string | null = null;
    let firstBillShortDate: string | null = null;
    let shortFor: { label: string; date: string; cardRepayment: boolean } | null = null;
    let movementsSince: Movement[] = [];
    const events = rawEvents.map((event): UpcomingAccountEvent => {
      const before = running;
      if (running !== null && event.credited !== false) running += event.amount;
      if (verdictRunning !== null && event.bill && event.credited !== false) verdictRunning += event.amount;
      if (running !== null && verdictRunning !== null && event.bill) {
        const shortfall = Math.max(0, -verdictRunning);
        gap = Math.max(gap, shortfall);
        if (shortfall > 0) firstShortDate ??= event.expected_date;
        if (shortfall > 0) {
          if (shortfall > billGap) {
            const cardRepayment = isCardRepayment(event.bill);
            shortFor = { label: cardRepayment ? repaymentLabel(event.bill) : upcomingDisplayName(event.bill), date: event.expected_date, cardRepayment };
          }
          billGap = Math.max(billGap, shortfall);
          firstBillShortDate ??= event.expected_date;
        }
        // Unknown income never funds an account. A possible deficit remains
        // unverified in BOTH views; cash sufficient without it still proves
        // coverage. The pooled forecast cannot override this evidence.
        if (!unknownIncome || shortfall === 0) {
          coverage.set(event.bill, { before: before! / 100, after: running / 100, shortfall: shortfall / 100 });
          if (shortfall > 0) {
            const culprit = [...movementsSince].sort((a, b) => b.amount - a.amount)[0];
            const risk = culprit ? { ...event.bill, movementCulprit: culprit } : event.bill;
            atRisk.push(risk);
            riskByBill.set(event.bill, risk);
          }
        }
        if (event.kind === "movement") movementsSince.push({ name: upcomingDisplayName(event.bill), amount: event.bill.amount, expected_date: event.expected_date });
      } else if (!event.bill && event.credited !== false) {
        movementsSince = [];
      }
      return { id: event.id, name: event.name, date: event.expected_date, kind: event.kind, ...(event.category ? { category: event.category } : {}), amount: event.amount / 100, after: running === null ? null : running / 100, source: event.ref, ...(event.credited === false ? { credited: false } : {}) };
    });
    const verifiable = knownWorking && !(unknownIncome && gap > 0);
    const sum = (values: { amount: number }[]) => values.reduce((total, item) => total + pennies(item.amount), 0) / 100;
    return {
      id,
      bank: first?.account_bank || first?.account_name || planSource?.bank || "Account not identified",
      name: displayAccountName(first?.account_name || planSource?.name || "") || (id === "__unknown__" ? "Payment account unavailable" : "Payment account"),
      opening: balanceKnown ? opening! : null,
      income: sum(credits), transfersIn: sum(transfers), outgoing: sum(payments),
      closing: verifiable && running !== null ? running / 100 : null,
      shortfall: verifiable ? (billGap || gap) / 100 : null,
      status: !verifiable ? "unknown" : billGap > 0 ? "short" : "covered",
      firstShortDate: verifiable ? (billGap > 0 ? firstBillShortDate : firstShortDate) : null,
      shortFor: verifiable && billGap > 0 ? shortFor : null,
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
): Pick<UpcomingRowModel, "assessment" | "coverage" | "isCreditCard" | "isSettling" | "flagged" | "timingRisk" | "accountShort" | "accountTiming" | "atRisk"> {
  const future = Date.parse(item.expected_date) > walk.endMs;
  const isSettling = Boolean(item.observed_pending);
  const isCreditCard = Boolean(item.is_credit_card);
  const coverage = item.type !== "income" && !future && !isSettling && !isCreditCard ? walk.coverage.get(item) : undefined;
  const short = (coverage?.shortfall ?? 0) > 0;
  return {
    assessment: future ? "future" : coverage ? undefined : "unverified",
    coverage,
    isSettling, isCreditCard,
    flagged: short, accountShort: short, atRisk: short,
    timingRisk: false, accountTiming: false,
  };
}
