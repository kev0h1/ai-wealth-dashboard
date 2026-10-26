import type { Account, AccountEligibility, SafeToSpend } from "@/lib/api";

export type Scenario = "third" | "timing" | "combined" | "all" | "uncertain" | "long" | "cards" | "move";
export const SCENARIOS: { value: Scenario; label: string }[] = [
  { value: "third", label: "Another account has room" },
  { value: "timing", label: "Different payment timing" },
  { value: "combined", label: "Shared estimate caps the limits" },
  { value: "all", label: "Every account already shown" },
  { value: "uncertain", label: "One account cannot be checked" },
  { value: "long", label: "Same bank and long names" },
  { value: "cards", label: "Card purchases this period" },
  { value: "move", label: "Move already held back" },
];

function account(id: string, provider: string, provider_id: string, name: string, balance: number): Account {
  return { id, name, provider, provider_id, balance, type: "TRANSACTION", subtype: "CURRENT", currency: "GBP", status: "AUTHORIZED", cover_source_eligible: true, include_in_safe_to_spend: true } as Account;
}

export function fixture(scenario: Scenario) {
  const accounts = [
    account("natwest", "NatWest", "natwest", "Everyday", 246),
    account("starling", "Starling", "starling", "Personal", 154),
    account("barclays", "Barclays", "barclays_personal", "Premier Current Account", 136),
    account("hsbc", "HSBC", "hsbc", "Bills", 0),
  ];
  const eligibility: Record<string, AccountEligibility> = {};
  const pool = scenario === "combined" ? 80 : scenario === "all" ? 200 : 236;
  const limits = [146, 54, scenario === "timing" || scenario === "all" ? 0 : 36, 0];
  accounts.forEach((a, i) => {
    eligibility[a.id] = {
      short: limits[i] < 5, headroom: limits[i] - 10,
      spend_from_headroom: Math.min(pool, limits[i]), account_headroom_raw: limits[i], spend_from_capped: limits[i] > pool,
      after_payments: i === 0 ? 246 : i === 1 ? 154 : limits[i],
      plans_reserved: 0, after_payments_and_plans: i === 0 ? 246 : i === 1 ? 154 : limits[i],
      low_point: limits[i], low_point_and_plans: limits[i], uncertain: false,
    };
  });
  if (scenario === "all") {
    accounts.splice(2);
    accounts[1].balance = 190;
    for (const a of accounts) {
      eligibility[a.id].after_payments = eligibility[a.id].low_point;
      eligibility[a.id].after_payments_and_plans = eligibility[a.id].low_point;
    }
  }
  if (scenario === "uncertain") eligibility.barclays = { ...eligibility.barclays, spend_from_headroom: 0, after_payments_and_plans: null, low_point_and_plans: null, uncertain: true };
  if (scenario === "long") {
    accounts[0] = { ...accounts[0], name: "THE HOUSEHOLD BILLS AND EVERYDAY SPENDING ACCOUNT", provider: "Barclays", provider_id: "barclays_personal" };
    accounts[1] = { ...accounts[1], name: "JOINT CURRENT ACCOUNT", provider: "Barclays", provider_id: "barclays_personal" };
  }
  if (scenario === "move") eligibility.natwest.spend_from_headroom = 126;
  const data: Extract<SafeToSpend, { status: "ok" }> = {
    status: "ok", safe_to_spend: pool, safe_to_spend_cash: pool,
    spendable_now: scenario === "all" ? 436 : 536,
    bills_total: scenario === "all" ? 236 : scenario === "timing" ? 336 : 300,
    income_before_payday: scenario === "all" ? 0 : 200,
    lowest_projected_balance: scenario === "all" ? 200 : 336,
    buffer: scenario === "combined" ? 256 : scenario === "all" ? 0 : 100,
    commitments_reserved: 0, allocations_reserved: 0,
    card_growth_reserved: 0, card_growth_total: scenario === "cards" ? 1947 : 0,
    card_new_spend_total: scenario === "cards" ? 1947 : 0,
    payday_income: 4798, next_payday: "2026-10-30", days_until_payday: 5,
    state: "comfortable", short_reason: null, estimated: false, calculation_status: "complete",
  };
  return { accounts, eligibility, data, pool };
}

// Both fixtures have pooled minimum £336 and £100 buffer -> £236.
// Day 1: NatWest and Starling each pay £100; day 2 each receives £100.
// Day 3: Barclays pays £100 (third) or £136 (timing). The account minima
// are 146/54/36 or 146/54/0; the pooled minimum is on day 1 in both cases.
// These are coherent examples, not a diagnosis of Kevin's private snapshot.
export const TIMELINE = [
  { account: 0, amount: -100 }, { account: 1, amount: -100 },
  { account: 0, amount: 100 }, { account: 1, amount: 100 },
];
