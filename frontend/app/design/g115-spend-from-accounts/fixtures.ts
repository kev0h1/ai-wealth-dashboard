// G115 uses typed, local fixtures only. The account list deliberately mixes
// three current accounts, a savings pot and a credit card so the real
// bestSpendAccount() selector proves the cash-led constraints instead of the
// preview hand-picking whatever looks convenient. The default state mirrors
// the G114 failure shape without copying any real account names or balances:
// a live cover plan reserves £20 from Everyday, leaving £25 genuinely spare.

import type { Account, AccountEligibility, CompanionItem, SafeToSpend } from "@/lib/api";
import { bestSpendAccount, type SpendFromResult } from "@/lib/spendFromAccount";

export type PreviewState =
  | "reserved" | "clear" | "one" | "unbundled" | "savings" | "hidden"
  // G148 (2026-09-23): the two states the production card used to render as
  // NOTHING. They are here so the absent rail is something Kevin can look at
  // on a real screen, not a claim in a test report. Variant A renders the
  // shipped SafeToSpendCard with no override, so these are the real
  // treatments, not preview markup.
  | "missing" | "failed"
  // G165 (2026-09-25): the rail is always at most two rows (best +
  // alternative, spendFromTreatmentPlan filters to just those), so a single
  // rail can never hold three distinct digit-length figures at once. This
  // state instead spans the two extremes, a 1-digit headroom next to a
  // 5-digit one, on the reasoning that if the fixed icon column survives
  // that gap undisturbed, the 3-digit gap from Kevin's own screenshot
  // (£275 vs £22) is already covered in between.
  | "wideDigits";

export type G115Fixture = {
  label: string;
  description: string;
  safeToSpend: Extract<SafeToSpend, { status: "ok" }>;
  spendFrom: SpendFromResult;
  coverPlan: CompanionItem | null;
  moveLinked: boolean;
  savingsMove: boolean;
  hidden: boolean;
};

const EVERYDAY = {
  id: "g115-everyday",
  name: "Everyday",
  type: "bank",
  subtype: "TRANSACTION",
  balance: 286,
  currency: "GBP",
  provider: "Monzo",
  provider_id: "monzo",
  status: "AUTHORIZED",
  cover_source_eligible: true,
} satisfies Account;

const FLEX = {
  id: "g115-flex",
  name: "Flex current",
  type: "bank",
  subtype: "TRANSACTION",
  balance: 174,
  currency: "GBP",
  provider: "Chase",
  provider_id: "chase_uk",
  status: "AUTHORIZED",
  cover_source_eligible: true,
} satisfies Account;

const BILLS = {
  id: "g115-bills",
  name: "Bills current",
  type: "bank",
  subtype: "TRANSACTION",
  balance: 113,
  currency: "GBP",
  provider: "Barclays",
  provider_id: "barclays_personal",
  status: "AUTHORIZED",
  cover_source_eligible: true,
} satisfies Account;

const METRO = {
  id: "g115-metro",
  name: "Household account",
  type: "bank",
  subtype: "TRANSACTION",
  balance: 142,
  currency: "GBP",
  provider: "Metro Bank",
  status: "AUTHORIZED",
  cover_source_eligible: true,
} satisfies Account;

const RAINY_DAY = {
  id: "g115-rainy-day",
  name: "Rainy day",
  type: "bank",
  subtype: "SAVINGS",
  balance: 680,
  currency: "GBP",
  provider: "Nationwide",
  provider_id: "nationwide",
  status: "AUTHORIZED",
  cover_source_eligible: true,
} satisfies Account;

const CREDIT = {
  id: "g115-credit",
  name: "Everyday card",
  type: "credit_card",
  subtype: "CREDIT_CARD",
  balance: -420,
  currency: "GBP",
  provider: "American Express",
  provider_id: "amex",
  status: "AUTHORIZED",
  cover_source_eligible: false,
} satisfies Account;

const BASE_ACCOUNTS: Account[] = [EVERYDAY, FLEX, BILLS, RAINY_DAY, CREDIT];

function daysFromNow(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

function shortDateFromNow(days: number): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(daysFromNow(days)));
}

function safeToSpend(amount: number): Extract<SafeToSpend, { status: "ok" }> {
  const setAsides = 90 + 60 + 44;
  const lowestProjectedBalance = amount + setAsides;
  return {
    status: "ok",
    safe_to_spend: amount,
    safe_to_spend_cash: amount,
    next_payday: daysFromNow(5),
    days_until_payday: 5,
    bills_total: 140,
    income_before_payday: 0,
    buffer: 90,
    state: "tight",
    short_reason: null,
    estimated: false,
    spendable_now: lowestProjectedBalance + 140,
    lowest_projected_balance: lowestProjectedBalance,
    commitments_reserved: 60,
    allocations_reserved: 44,
    payday_income: 2400,
    card_growth_total: 0,
    card_new_spend_total: 0,
    card_growth_reserved: 0,
    calculation_status: "complete",
    last_synced: new Date().toISOString(),
  };
}

function coverPlan(source: Account, amount: number, destination: Account): CompanionItem {
  const sourceAccount = {
    account_id: source.id,
    name: source.name,
    provider: source.provider,
    balance: source.balance,
  };
  const destinationAccount = {
    account_id: destination.id,
    name: destination.name,
    provider: destination.provider,
    balance: destination.balance,
  };
  return {
    id: `g115-cover-${source.id}`,
    type: "move",
    headline: `Move £${amount} to ${destination.name}`,
    body: `£${amount} keeps three payments clearing from ${destination.name}.`,
    action: { label: "See what’s due", route: "#cover-plan" },
    estimated: false,
    brief_lead: { value: `£${amount}`, companion: `to ${destination.name}` },
    plan_dest: {
      ...destinationAccount,
      needs_total: 133,
      needs_by: shortDateFromNow(5),
      bills: [
        { label: "Energy", amount: 58 },
        { label: "Broadband", amount: 45 },
        { label: "Insurance", amount: 30 },
      ],
    },
    moves: [{
      headline: `Move £${amount} from ${source.name}`,
      amount,
      move_map: {
        from: { ...sourceAccount, safe_note: "Covers its own bills" },
        to: { ...destinationAccount, incoming: "£133 due" },
      },
    }],
    covered: true,
    sources_safe: true,
    envelope_reserved: true,
    amount,
  };
}

function fixture(
  accounts: Account[],
  eligibility: Record<string, AccountEligibility>,
  options: Omit<G115Fixture, "safeToSpend" | "spendFrom"> & { hero: number },
): G115Fixture {
  return {
    ...options,
    safeToSpend: safeToSpend(options.hero),
    spendFrom: bestSpendAccount(eligibility, accounts),
  };
}

const RESERVED_ELIGIBILITY: Record<string, AccountEligibility> = {
  [EVERYDAY.id]: { short: false, headroom: 45, spend_from_headroom: 25 },
  [FLEX.id]: { short: false, headroom: 18, spend_from_headroom: 18 },
  [BILLS.id]: { short: false, headroom: 12, spend_from_headroom: 12 },
  [RAINY_DAY.id]: { short: false, headroom: 280, spend_from_headroom: 280 },
  [CREDIT.id]: { short: false, headroom: 500, spend_from_headroom: 500 },
};

export const FIXTURES: Record<PreviewState, G115Fixture> = {
  reserved: fixture(BASE_ACCOUNTS, RESERVED_ELIGIBILITY, {
    label: "Cover move reserved",
    description: "Everyday had £45 standing room. The live £20 move is already held back, so only £25 is shown as spendable there.",
    hero: 86,
    coverPlan: coverPlan(EVERYDAY, 20, BILLS),
    moveLinked: true,
    savingsMove: false,
    hidden: false,
  }),
  clear: fixture(BASE_ACCOUNTS, {
    [EVERYDAY.id]: { short: false, headroom: 34, spend_from_headroom: 34 },
    [FLEX.id]: { short: false, headroom: 21, spend_from_headroom: 21 },
    [BILLS.id]: { short: false, headroom: 12, spend_from_headroom: 12 },
    [RAINY_DAY.id]: { short: false, headroom: 280, spend_from_headroom: 280 },
    [CREDIT.id]: { short: false, headroom: 500, spend_from_headroom: 500 },
  }, {
    label: "No cover move",
    description: "Two current accounts have room. Savings and card balances remain outside the spend-from answer.",
    hero: 86,
    coverPlan: null,
    moveLinked: false,
    savingsMove: false,
    hidden: false,
  }),
  one: fixture(BASE_ACCOUNTS, {
    [EVERYDAY.id]: { short: false, headroom: 14, spend_from_headroom: 14 },
    [FLEX.id]: { short: true, headroom: 4, spend_from_headroom: 4 },
    [BILLS.id]: { short: true, headroom: 0, spend_from_headroom: 0 },
    [RAINY_DAY.id]: { short: false, headroom: 280, spend_from_headroom: 280 },
    [CREDIT.id]: { short: false, headroom: 500, spend_from_headroom: 500 },
  }, {
    label: "One account",
    description: "Only one current account clears the same £5 source floor the cover-plan finder uses.",
    hero: 46,
    coverPlan: null,
    moveLinked: false,
    savingsMove: false,
    hidden: false,
  }),
  unbundled: fixture([METRO, EVERYDAY, FLEX, RAINY_DAY, CREDIT], {
    [METRO.id]: { short: false, headroom: 32, spend_from_headroom: 32 },
    [EVERYDAY.id]: { short: false, headroom: 24, spend_from_headroom: 24 },
    [FLEX.id]: { short: false, headroom: 15, spend_from_headroom: 15 },
    [RAINY_DAY.id]: { short: false, headroom: 280, spend_from_headroom: 280 },
    [CREDIT.id]: { short: false, headroom: 500, spend_from_headroom: 500 },
  }, {
    label: "Bank has no logo",
    description: "Metro Bank has no bundled mark, so the icon treatment falls back to names and amounts instead of an initials stack.",
    hero: 86,
    coverPlan: null,
    moveLinked: false,
    savingsMove: false,
    hidden: false,
  }),
  savings: fixture(BASE_ACCOUNTS, {
    [EVERYDAY.id]: { short: true, headroom: 3, spend_from_headroom: 3 },
    [FLEX.id]: { short: true, headroom: 2, spend_from_headroom: 2 },
    [BILLS.id]: { short: true, headroom: 0, spend_from_headroom: 0 },
    [RAINY_DAY.id]: { short: false, headroom: 280, spend_from_headroom: 255 },
    [CREDIT.id]: { short: false, headroom: 500, spend_from_headroom: 500 },
  }, {
    label: "Savings move needed",
    description: "No current account has room. The honest next step is the savings move already shown above, not a savings account dressed up as spendable cash.",
    hero: 46,
    coverPlan: coverPlan(RAINY_DAY, 25, EVERYDAY),
    moveLinked: true,
    savingsMove: true,
    hidden: false,
  }),
  // The live G148 shape: GET /today came back fine and simply carried no
  // account_eligibility, because the payload it was served from was written
  // by code that predates the field. `bestSpendAccount(undefined, ...)` with
  // a settled request is exactly what Home computed on Kevin's phone.
  missing: {
    label: "Eligibility absent",
    description: "GET /today succeeded and carried no per-account eligibility. Before G148 this rendered as nothing at all, which is how the rail stayed missing for a week without anyone seeing an error.",
    safeToSpend: safeToSpend(269),
    spendFrom: bestSpendAccount(undefined, BASE_ACCOUNTS, "ready"),
    coverPlan: null,
    moveLinked: false,
    savingsMove: false,
    hidden: false,
  },
  // The other half of the same silence: the request itself failed and the
  // error was swallowed on purpose (this is a supporting rail, not a
  // blocking failure). Distinguishable from the state above in both the
  // sentence and the retry.
  failed: {
    label: "Check failed",
    description: "The GET /today request failed. The error stays swallowed, because this is a supporting figure rather than a blocking failure, but the absence is now stated and retryable.",
    safeToSpend: safeToSpend(269),
    spendFrom: bestSpendAccount(undefined, BASE_ACCOUNTS, "failed"),
    coverPlan: null,
    moveLinked: false,
    savingsMove: false,
    hidden: false,
  },
  hidden: fixture(BASE_ACCOUNTS, RESERVED_ELIGIBILITY, {
    label: "Balances hidden",
    description: "The real preferences path masks the pooled figure and every account amount together.",
    hero: 86,
    coverPlan: coverPlan(EVERYDAY, 20, BILLS),
    moveLinked: true,
    savingsMove: false,
    hidden: true,
  }),
  // G165: a synthetic digit-width stress test, not a claim about realistic
  // headroom. £8 and £18,240 in the same two-row rail is a harder case than
  // Kevin's real £275-vs-£22 screenshot, exercising the fixed icon column
  // against the widest gap the layout could plausibly meet.
  wideDigits: fixture(BASE_ACCOUNTS, {
    [EVERYDAY.id]: { short: false, headroom: 8, spend_from_headroom: 8 },
    [FLEX.id]: { short: false, headroom: 18240, spend_from_headroom: 18240 },
    [BILLS.id]: { short: true, headroom: 0, spend_from_headroom: 0 },
    [RAINY_DAY.id]: { short: false, headroom: 280, spend_from_headroom: 280 },
    [CREDIT.id]: { short: false, headroom: 500, spend_from_headroom: 500 },
  }, {
    label: "Wide figure range",
    description: "£8 next to £18,240 in the same rail (G165): a 1-digit and a 5-digit figure, proving the icon column holds its line whatever the amount's width.",
    hero: 86,
    coverPlan: null,
    moveLinked: false,
    savingsMove: false,
    hidden: false,
  }),
};

export const STATE_ORDER: PreviewState[] = ["reserved", "clear", "one", "unbundled", "savings", "missing", "failed", "hidden", "wideDigits"];
