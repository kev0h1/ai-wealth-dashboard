import { scenarios } from "./fixtures";
import type { Scenario } from "./types";
import type { PlanCaseId, PlanPreviewItem } from "./PlanPreview.types";

export interface PlanFixture {
  id: PlanCaseId;
  label: string;
  scenario: Scenario;
  plans: PlanPreviewItem[];
  status: "ready" | "loading" | "error";
  /** Preloaded totals from the same sample records, never a client calculation. */
  planWorking: Record<string, number>;
}

const trip: PlanPreviewItem = { id: "winter-trip", kind: "goal", name: "Winter trip", sourceId: null, sourceBasis: "unknown", periodPence: 33656, filledPence: 0, remainingPence: 33656, state: "active" };
const annual: PlanPreviewItem = { id: "annual-renewals", kind: "set-aside", name: "Annual renewals", sourceId: "natwest", sourceBasis: "chosen", periodPence: 10000, filledPence: 4000, remainingPence: 6000, state: "active", feedLabel: "Annual renewal payments" };
const course: PlanPreviewItem = { id: "weekend-course", kind: "goal", name: "Weekend course", sourceId: "natwest", sourceBasis: "chosen", periodPence: 5000, filledPence: 2500, remainingPence: 2500, state: "active" };

// The stored available figures include the plan requirements. Dated payment
// positions deliberately remain unchanged. These are separate preloaded
// records, not a forecast recomputed when a preview control is used.
const populated: Scenario = {
  ...scenarios.single,
  accounts: scenarios.single.accounts.map(account => account.id === "natwest" ? { ...account, cashNowPence: 15000, afterPaymentsPence: 10000, paymentLowPence: 10000, availabilityPence: 1500 } : account),
  payments: scenarios.single.payments.map(payment => payment.accountId === "natwest" ? { ...payment, afterPence: 10000 } : payment),
};
const several: Scenario = {
  ...scenarios.several,
  accounts: scenarios.several.accounts.map(account => account.id === "natwest" ? { ...account, cashNowPence: 15000, afterPaymentsPence: 10000, paymentLowPence: 10000, availabilityPence: 4000 } : account.id === "joint" ? { ...account, availabilityPence: -10640 } : account),
  payments: scenarios.several.payments.map(payment => payment.accountId === "natwest" ? { ...payment, afterPence: 10000 } : payment),
};

export const planFixtures: Record<PlanCaseId, PlanFixture> = {
  current: { id: "current", label: "Current example", scenario: scenarios.single, plans: [trip], status: "ready", planWorking: {} },
  populated: { id: "populated", label: "Set-asides and goals", scenario: populated, plans: [annual, course, trip], status: "ready", planWorking: { natwest: 8500 } },
  several: { id: "several", label: "Several accounts", scenario: several, plans: [annual, { ...course, sourceId: "joint", periodPence: 4000, filledPence: 2000, remainingPence: 2000 }, trip], status: "ready", planWorking: { natwest: 6000, joint: 2000 } },
  shared: { id: "shared", label: "Conditional available amounts", scenario: scenarios.shared, plans: [trip], status: "ready", planWorking: {} },
  empty: { id: "empty", label: "No plans yet", scenario: scenarios.clear, plans: [], status: "ready", planWorking: {} },
  checking: { id: "checking", label: "Checking plans", scenario: scenarios.checking, plans: [{ ...annual, sourceId: "annual-costs", name: "Annual costs", periodPence: 10000, filledPence: 0, remainingPence: 10000 }, { ...trip, periodPence: null, filledPence: null, remainingPence: null }], status: "loading", planWorking: { "annual-costs": 10000 } },
  error: { id: "error", label: "Plans unavailable", scenario: scenarios.checking, plans: [{ ...annual, sourceId: "annual-costs", name: "Annual costs", periodPence: 10000, filledPence: 0, remainingPence: 10000 }, { ...trip, periodPence: null, filledPence: null, remainingPence: null }], status: "error", planWorking: { "annual-costs": 10000 } },
  long: {
    id: "long", label: "Long names and plan states", status: "ready", planWorking: { "barclays-reserve": 6000 },
    scenario: { ...scenarios.many, accounts: scenarios.many.accounts.map(account => account.id === "barclays-reserve" ? { ...account, availabilityPence: 19500 } : account) },
    plans: [
      { ...annual, name: "Annual home and household renewals", sourceId: "barclays-reserve", sourceBasis: "recent-transfers", feedLabel: "Household renewal and annual service payments" },
      { id: "next-period", kind: "set-aside", name: "Next period’s seasonal costs", sourceId: null, sourceBasis: "unknown", periodPence: 5000, filledPence: 0, remainingPence: 5000, state: "pending", startsLabel: "27 Nov" },
      { id: "complete", kind: "set-aside", name: "Birthday money", sourceId: "natwest", sourceBasis: "chosen", periodPence: 2000, filledPence: 2000, remainingPence: 0, state: "complete" },
      { ...trip, name: "A longer trip with the family next spring" },
      { id: "unknown-goal", kind: "goal", name: "A goal amount that needs checking", sourceId: null, sourceBasis: "unknown", periodPence: null, filledPence: null, remainingPence: null, state: "active" },
    ],
  },
};

export const planCaseOptions = Object.values(planFixtures).map(({ id, label }) => ({ id, label }));
