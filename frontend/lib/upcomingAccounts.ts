import type { Account, AccountEligibility, CashflowData } from "./api";
import { sourceClass } from "./coverPlanSourceClass";
import { walkUpcomingAccounts } from "./upcomingAccountWalk";
import { hasPlanSource, remaining, type Plan } from "./upcomingPlans";

export type UpcomingAccountEvent = {
  id: string;
  name: string;
  date: string;
  kind: "income" | "inflow" | "payment" | "movement";
  /** Signed pounds: incoming positive, outgoing negative. */
  amount: number;
  after: number | null;
  /** G372: false for a predicted income the server does not credit (no credit_basis). It shows on the sheet but moves no balance. */
  credited?: false;
  /** The originating cashflow item (same reference as the list row), so a row can be matched to its editor. Never serialised. */
  source?: object;
};

/** G238: the server's per-account position (backend `compute_account_positions`),
 * pounds. When present the sheet shows these figures instead of recomputing. */
export type UpcomingAccountPosition = {
  afterPayments: number | null;
  /** G360: the lowest running balance this period, before plans (server `low_point`). */
  lowPoint: number | null;
  plansReserved: number;
  afterPaymentsAndPlans: number | null;
  /** Mid-period minimum running balance minus plans (null when uncertain). */
  lowPointAndPlans: number | null;
  /** The Spend from figure Home shows: min(after payments and plans, low point and plans), live-move reserve and pool cap applied. Null when uncertain or not shown. */
  spendFrom: number | null;
  /** This allocation becomes spendable only if the shown cover recommendation is completed. */
  spendFromRequiresMove?: boolean;
  uncertain: boolean;
  /** G410: what a live suggested move would cover here, and what would still be short after it. Absent when no move is live. */
  coveredByMove?: { amount: number; shortfall?: number; from: { accountId: string; name: string; amount: number; label?: string }[] } | null;
  shortAfterCover?: number | null;
  /** G410: set aside in this account for a suggested move out of it (already excluded from `spendFrom`). */
  earmarkedTotal?: number | null;
  earmarksOut?: { toAccountId: string; toName: string; amount: number }[] | null;
  /** G422: an own-savings standing order this account cannot fund. `amount` is the part of the negative figures it explains; it is never a payment shortfall and never red. */
  savingsAtRisk?: { amount: number; covered: number; noCover: boolean; note: string; orders: { name: string; label: string; amount: number; expectedDate: string | null; toName: string }[] } | null;
};

export type UpcomingAccountSummary = {
  id: string;
  bank: string;
  name: string;
  opening: number | null;
  income: number;
  transfersIn: number;
  outgoing: number;
  closing: number | null;
  shortfall: number | null;
  status: "short" | "unfunded" | "covered" | "unknown";
  firstShortDate: string | null;
  /** G266: the payment that sets the peak shortfall, named so the sheet can say what is at risk. Null unless status is "short". */
  shortFor?: { label: string; date: string; cardRepayment: boolean } | null;
  /** G266: a recommendation (never a button) from the cover-plan engine, when an account has room. */
  coverSuggestion?: { amount: number; shortfall?: number; fromName: string; fromCount: number; shortAfterCover: number } | null;
  hasUnassignedIncome: boolean;
  events: UpcomingAccountEvent[];
  /** G238: server position for this account, when the API supplied it. */
  position?: UpcomingAccountPosition;
  /** G416: display-only live recommendations, kept outside the payment walk. */
  suggestedMoves?: UpcomingSuggestedMove[];
};

export type UpcomingSuggestedMove = {
  id: string;
  counterpartId: string;
  counterpartName: string;
  /** Signed pounds: a suggested credit is positive, a suggested debit negative. */
  amount: number;
  /** A payment deadline, not a scheduled transfer date. Null when not supplied. */
  byDate: string | null;
  /** G421: counterpartName is already the engine's G337 label; never re-derive it from raw account text. */
  labelled?: boolean;
};

/** Shared coverage boundary: the day before payday, always. G360 removed the
 * final-day lookahead, so next-period bills never count against this period.
 * `nowMs` and `daysToPayday` are kept so existing callers stay valid. */
export function upcomingAccountWindow(periodEndMs: number, _nowMs?: number, _daysToPayday?: number): number {
  return periodEndMs + 86400000 - 1;
}

/** Convenience for consumers needing only the card; no second calculation. */
export function buildUpcomingAccountSummaries(
  cashflow: Pick<CashflowData, "upcoming_bills" | "upcoming_income" | "internal_inflows">,
  endMs: number,
): UpcomingAccountSummary[] {
  return walkUpcomingAccounts(cashflow, endMs).accounts;
}

/**
 * G360: one verdict per account. The server position (the same figures Home and
 * the Accounts list use) decides short versus covered; the client walk still
 * supplies the named bill and the dated events. Server short (after payments or
 * low point below zero) is never shown as covered; server covered (both at or
 * above zero) is never shown as short. When the server says short but the walk
 * found no short payment, the shortfall is the more negative server figure.
 */
export function reconcileWithServerPosition(account: UpcomingAccountSummary, position: UpcomingAccountPosition | undefined): UpcomingAccountSummary {
  if (!position) return account;
  const figures = [position.afterPayments, position.lowPoint].filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (figures.length === 0) return { ...account, position };
  const lowest = Math.min(...figures);
  // G422: a gap wholly explained by an own-savings standing order is amber and
  // never a payment shortfall, whatever the server's walk figures say.
  const savings = position.savingsAtRisk?.amount ?? 0;
  // G426: also when the client walk calls it short because a later real bill cascades off the order; the server's payment-only walk says the payments alone clear.
  if (lowest < 0 && savings > 0 && -lowest <= savings + 0.005) {
    return { ...account, position, status: "unfunded", shortfall: Math.max(account.shortfall ?? 0, -lowest), firstShortDate: account.firstShortDate ?? account.events.find((event) => event.after !== null && event.after < 0)?.date ?? null, shortFor: null };
  }
  if (lowest < 0) {
    // G372: a negative server figure is short even when the server flags the
    // position uncertain (an uncertain plan overlap says nothing about payments).
    if (account.status === "short" && account.shortfall !== null && account.shortfall > 0) return { ...account, position };
    return { ...account, position, status: "short", shortfall: Math.max(account.shortfall ?? 0, -lowest), firstShortDate: account.firstShortDate ?? account.events.find((event) => event.after !== null && event.after < 0)?.date ?? null, shortFor: account.shortFor ?? null };
  }
  if (position.uncertain) return { ...account, position };
  if (account.status === "short" || account.status === "unfunded") {
    return { ...account, position, status: "covered", shortfall: 0, firstShortDate: null, shortFor: null, coverSuggestion: null };
  }
  return { ...account, position };
}

/** G372: the payment gap to show for an account, in pounds, or null when it is
 * not short. The reconciled status decides; a negative server figure on the
 * position is also short, so a sheet can never say "covered" beside a negative
 * After payments whatever path built the summary. */
export function accountPaymentGap(account: UpcomingAccountSummary): number | null {
  const figures = [account.position?.afterPayments, account.position?.lowPoint].filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  // G422: what an own-savings standing order explains is not a payment gap.
  const savings = account.position?.savingsAtRisk?.amount ?? 0;
  const rawGap = figures.length ? Math.max(0, -Math.min(...figures)) : 0;
  const serverGap = savings > 0 ? (rawGap - savings > 0.005 ? rawGap - savings : 0) : rawGap;
  const walkGap = account.status === "short" && account.shortfall !== null ? account.shortfall : 0;
  const gap = Math.max(serverGap, walkGap);
  return gap > 0 ? gap : null;
}

/** G238: map GET /today's `account_eligibility` onto the sheet's position type.
 * Entries from an old API (no position fields) are skipped so the sheet keeps
 * its own arithmetic. */
export function positionsFromToday(
  eligibility: Record<string, AccountEligibility> | null | undefined,
  accounts: Pick<Account, "id" | "type" | "subtype">[],
): Record<string, UpcomingAccountPosition> | null {
  if (!eligibility) return null;
  const out: Record<string, UpcomingAccountPosition> = {};
  const isCurrent = (id: string) => {
    const account = accounts.find((a) => a.id === id);
    return Boolean(account) && sourceClass(account as Account) === "current";
  };
  for (const [id, entry] of Object.entries(eligibility)) {
    if (typeof entry.uncertain !== "boolean" || typeof entry.plans_reserved !== "number") continue;
    out[id] = {
      afterPayments: typeof entry.after_payments === "number" ? entry.after_payments : null,
      lowPoint: typeof entry.low_point === "number" ? entry.low_point : null,
      plansReserved: entry.plans_reserved,
      afterPaymentsAndPlans: typeof entry.after_payments_and_plans === "number" ? entry.after_payments_and_plans : null,
      lowPointAndPlans: typeof entry.low_point_and_plans === "number" ? entry.low_point_and_plans : null,
      // Home's Spend from (G111) is current accounts only, using sourceClass.
      // Same predicate here, so a savings pot or ISA (or an account not yet
      // loaded) never gets a Spend from line on the sheet.
      spendFrom: isCurrent(id) && !entry.uncertain && typeof entry.spend_from_headroom === "number" ? entry.spend_from_headroom : null,
      spendFromRequiresMove: entry.spend_from_requires_move === true,
      uncertain: entry.uncertain,
      coveredByMove: entry.covered_by_move
        ? { amount: entry.covered_by_move.amount, shortfall: typeof entry.covered_by_move.shortfall === "number" ? entry.covered_by_move.shortfall : undefined, from: entry.covered_by_move.from.map((f) => ({ accountId: f.account_id, name: f.name, amount: f.amount, ...(f.display_label?.trim() ? { label: f.display_label.trim() } : {}) })) }
        : null,
      shortAfterCover: typeof entry.short_after_cover === "number" ? entry.short_after_cover : null,
      earmarkedTotal: typeof entry.earmarked_total === "number" ? entry.earmarked_total : null,
      earmarksOut: entry.earmarks_out ? entry.earmarks_out.map((e) => ({ toAccountId: e.to_account_id, toName: e.to_name, amount: e.amount })) : null,
      savingsAtRisk: entry.savings_at_risk && typeof entry.savings_at_risk.amount === "number" && typeof entry.savings_at_risk.note === "string"
        ? { amount: entry.savings_at_risk.amount, covered: entry.savings_at_risk.covered ?? 0, noCover: entry.savings_at_risk.no_cover === true, note: entry.savings_at_risk.note, orders: (entry.savings_at_risk.orders ?? []).map((o) => ({ name: o.name, label: o.label, amount: o.amount, expectedDate: o.expected_date ?? null, toName: o.to_name })) }
        : null,
    };
  }
  return out;
}

/** G327: "Payments through Thu 29 Oct", from the account window's last day (UTC). */
export function paymentsThroughLabel(accountEndMs: number): string {
  return `Payments through ${new Date(accountEndMs).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}`;
}

/**
 * G420: does this account belong in By account? Only if, in the period window
 * the list already uses, it has an expected payment or income event, a plan or
 * set-aside drawn from it, an earmarked or suggested move in or out, or a
 * shortfall. Reads fields already on the summary, the server position and the
 * plans; no new arithmetic. Mirrors backend `account_has_period_activity`.
 */
export function accountHasPeriodActivity(summary: UpcomingAccountSummary, position: UpcomingAccountPosition | undefined = summary.position, plans: Plan[] = []): boolean {
  if (summary.events.length > 0) return true;
  if (plans.some((plan) => plan.active && plan.sourceId === summary.id && hasPlanSource(plan) && (plan.amountUnavailable || remaining(plan) > 0))) return true;
  if ((summary.suggestedMoves?.length ?? 0) > 0 || summary.coverSuggestion) return true;
  if (summary.status === "short" || summary.status === "unfunded" || accountPaymentGap(summary) !== null) return true;
  if (position) {
    if (position.plansReserved > 0) return true;
    if ((position.earmarkedTotal ?? 0) > 0 || (position.earmarksOut?.length ?? 0) > 0) return true;
    if (position.coveredByMove || (position.shortAfterCover ?? 0) > 0) return true;
  }
  return false;
}

/** G420: the accounts By account lists, in their existing order. While plans
 * are still loading the plan clause cannot be judged, so only the server
 * position (`plansReserved`, which already counts every plan drawing on the
 * account) stands in for it; the list is therefore the same once plans arrive
 * for every account the server knows a plan draws on, and never shrinks then
 * grows for them. */
export function accountsWithPeriodActivity(summaries: UpcomingAccountSummary[], plans: Plan[] = []): UpcomingAccountSummary[] {
  return summaries.filter((summary) => accountHasPeriodActivity(summary, summary.position, plans));
}
