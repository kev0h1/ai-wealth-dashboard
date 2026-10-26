import type { Account, AccountEligibility } from "@/lib/api";

export type Case = "mixed" | "unknown" | "early" | "plans" | "excluded" | "loading" | "stale" | "long" | "pence";

export const CASES: { value: Case; label: string }[] = [
  { value: "mixed", label: "Mixed account positions" },
  { value: "unknown", label: "Position needs checking" },
  { value: "early", label: "Lowest point comes first" },
  { value: "plans", label: "Plans make the difference" },
  { value: "excluded", label: "Account not counted" },
  { value: "loading", label: "Position loading" },
  { value: "stale", label: "Last available position" },
  { value: "long", label: "Long account identities" },
  { value: "pence", label: "Pence precision" },
];

export type Event = {
  id: string;
  label: string;
  date: string;
  /** Absolute pounds. `kind` gives the direction or reserve role. */
  amount: number;
  kind: "payment" | "income" | "plan";
};

export type FixtureAccount = {
  account: Account;
  /** Literal `GET /today` account_eligibility entry, never client-derived. */
  position: AccountEligibility | null;
  events: Event[];
};

export type Fixture = {
  current: FixtureAccount[];
  other: Account[];
  phase: "ready" | "loading" | "stale";
  payday: string;
  asOf: string;
  pinnedIds: string[];
};

const PAYDAY = "2026-10-30";
const AS_OF = "2026-10-26T07:10:00Z";
const PINNED_IDS = ["acc1", "acc5"];

const account = (id: string, name: string, provider: string, balance: number): Account => ({
  id,
  name,
  type: "Current",
  subtype: "TRANSACTION",
  balance,
  currency: "GBP",
  provider,
  provider_id: `${id}-consent`,
  status: "connected",
  cover_source_eligible: true,
});

const position = (
  afterPayments: number,
  plansReserved: number,
  afterPlans: number | null,
  lowPoint: number,
  lowPlans: number | null,
  spendFrom: number,
  extra: Partial<AccountEligibility> = {},
): AccountEligibility => ({
  short: spendFrom < 5,
  headroom: spendFrom,
  spend_from_headroom: spendFrom,
  after_payments: afterPayments,
  plans_reserved: plansReserved,
  after_payments_and_plans: afterPlans,
  low_point: lowPoint,
  low_point_and_plans: lowPlans,
  uncertain: false,
  estimated: false,
  ...extra,
});

function mixedCurrent(): FixtureAccount[] {
  return [
    {
      account: account("acc1", "Premier Current Account", "Barclays", 108),
      position: position(68, 50, 18, 58, 8, 8),
      events: [
        { id: "acc1-payment", label: "Energy bill", date: "2026-10-27", amount: 50, kind: "payment" },
        { id: "acc1-income", label: "Refund", date: "2026-10-29", amount: 10, kind: "income" },
        { id: "acc1-plan", label: "Household set-aside", date: "2026-10-30", amount: 50, kind: "plan" },
      ],
    },
    {
      account: account("acc2", "The Number One", "Barclays", 89),
      position: position(89, 0, 89, 89, 89, 89),
      events: [],
    },
    {
      account: account("acc3", "Everyday", "Monzo", 52),
      position: position(-8, 20, -28, -8, -28, 0),
      events: [
        { id: "acc3-payment", label: "Phone bill", date: "2026-10-28", amount: 60, kind: "payment" },
        { id: "acc3-plan", label: "Travel set-aside", date: "2026-10-30", amount: 20, kind: "plan" },
      ],
    },
    {
      account: account("acc4", "Joint Current", "HSBC", 151),
      position: position(61, 20, 41, 61, 41, 41),
      events: [
        { id: "acc4-payment", label: "Council tax", date: "2026-10-28", amount: 90, kind: "payment" },
        { id: "acc4-plan", label: "Home set-aside", date: "2026-10-30", amount: 20, kind: "plan" },
      ],
    },
    {
      account: account("acc5", "Personal", "Starling", 74),
      position: position(74, 20, 54, 74, 54, 54, { estimated: true }),
      events: [{ id: "acc5-plan", label: "Holiday set-aside", date: "2026-10-30", amount: 20, kind: "plan" }],
    },
    {
      account: account("acc6", "Bills", "NatWest", 12),
      position: position(12, 30, -18, 12, -18, 0),
      events: [{ id: "acc6-plan", label: "Bills set-aside", date: "2026-10-30", amount: 30, kind: "plan" }],
    },
  ];
}

function otherAccounts(): Account[] {
  return [
    {
      id: "saving1", name: "Rainy day savings", type: "Savings", subtype: "SAVINGS", balance: 1400,
      currency: "GBP", provider: "Barclays", provider_id: "saving1-consent", status: "connected", cover_source_eligible: true,
    },
    {
      id: "credit1", name: "Credit card", type: "Credit", subtype: "CREDIT_CARD", balance: -2141,
      currency: "GBP", provider: "NatWest", provider_id: "credit1-consent", status: "connected", cover_source_eligible: false,
    },
  ];
}

/**
 * Static, intentionally fictional API-shaped examples. The position fields
 * are server results, so the preview cannot quietly introduce a second
 * account-balance calculation.
 */
export function getFixture(which: Case): Fixture {
  const current = mixedCurrent();
  const other = otherAccounts();
  let phase: Fixture["phase"] = "ready";

  if (which === "unknown") {
    current[2].position = null;
    current[4].position = position(74, 20, null, 74, null, 0, { uncertain: true, estimated: true });
  }

  if (which === "early") {
    current[3] = {
      ...current[3],
      position: position(61, 20, 41, -39, -59, 0),
      events: [
        { id: "acc4-payment-early", label: "Council tax", date: "2026-10-27", amount: 190, kind: "payment" },
        { id: "acc4-income-early", label: "Salary contribution", date: "2026-10-29", amount: 100, kind: "income" },
        { id: "acc4-plan-early", label: "Home set-aside", date: "2026-10-30", amount: 20, kind: "plan" },
      ],
    };
  }

  if (which === "plans") {
    current[2] = {
      ...current[2],
      position: position(52, 80, -28, 52, -28, 0),
      events: [{ id: "acc3-plan-only", label: "Travel set-aside", date: "2026-10-30", amount: 80, kind: "plan" }],
    };
  }

  if (which === "excluded") {
    current[1] = {
      ...current[1],
      account: { ...current[1].account, include_in_safe_to_spend: false },
      position: null,
    };
  }

  if (which === "loading") {
    phase = "loading";
    for (const item of current) item.position = null;
  }

  if (which === "stale") phase = "stale";

  if (which === "long") {
    current[0] = { ...current[0], account: { ...current[0].account, name: "Premier Current Account for household income and bills" } };
    current[1] = { ...current[1], account: { ...current[1].account, name: "The Number One shared current account" } };
    current[3] = { ...current[3], account: { ...current[3].account, name: "Joint Current Account for rent and household costs" } };
  }

  if (which === "pence") {
    current[5] = {
      ...current[5],
      account: { ...current[5].account, balance: 0.4 },
      position: position(-0.2, 0, -0.2, -0.2, -0.2, 0),
      events: [{ id: "acc6-pence-payment", label: "Small bill", date: "2026-10-27", amount: 0.6, kind: "payment" }],
    };
  }

  return { current, other, phase, payday: PAYDAY, asOf: AS_OF, pinnedIds: [...PINNED_IDS] };
}
