// G162 — Upcoming hero, set-aside-only colour/wording round.
//
// Kevin's complaint (payday-eve screenshot): the /upcoming runway hero
// (components/upcoming/UpcomingHeroCard.tsx, rendered by
// app/planning/PlanningPage.tsx) went red with the status word "short"
// when every bill was covered and the only thing dragging the projected
// figure negative was an unfunded set-aside allocation — Available £256,
// bills £0, still to set aside £266, projected −£10, with £4,798 landing
// on payday. The engine is correct and unchanged: `window_income`
// deliberately excludes income arriving on the payday itself
// (backend/app/routers/analytics.py), so the hero is the balance the
// instant before pay lands. The complaint is the colour and the status
// word, and that the hero never says WHY the incoming pay isn't in the
// number.
//
// The SETASIDE scenario below reproduces Kevin's own screenshot figures
// exactly (256 / 0 / 266 / −10 / 4,798) so the three variants are judged
// against his real numbers, not an invented one, per CLAUDE.md's "Kevin
// authorises his real figures in previews" allowance. BILLGAP and HEALTHY
// are invented but self-consistent, built to exercise the other two
// branches every variant must render.
//
// classify() is the one piece of logic that answers "is this negative
// because of bills, or only because of an unfunded set-aside": it mirrors
// PlanningPage.tsx's own arithmetic (`runwayBeforeAllocations` is the same
// spendableNow + runwayIncomeTotal - runwayBillsTotal sub-total the real
// page already computes before allocations are subtracted, see
// PlanningPage.tsx ~line 1092-1097) but names and exposes the
// intermediate step that page throws away. If bills alone would already
// leave the pool short, it's a genuine bill gap and stays red
// (billGap). If bills are covered and only the unfilled set-aside
// remainder pushes the total negative, it's setAsideOnly — the case this
// round proposes amber wording for. Neither true means the pay period is
// healthy.
export interface RunwayShortfall {
  accountId: string;
  bank: string;
  shortfall: number;
}

export interface RunwayTimingRisk {
  accountId: string;
  bank: string;
  dueDate?: string;
}

export interface RunwayScenario {
  isCalendarMonth: boolean;
  daysToPayday: number;
  paydayLabel: string;
  spendableNow: number;
  runwayIncomeTotal: number;
  runwayBillsTotal: number;
  allocationsRemainingTotal: number;
  savingsNow: number;
  genuineShortfalls: RunwayShortfall[];
  timingShortfalls: RunwayTimingRisk[];
  /** On-payday income, deliberately excluded from every figure above — the fact Kevin asked the hero to say plainly. */
  paydayIncomeAmount: number;
}

export interface RunwayClassification {
  runway: number;
  runwayBeforeAllocations: number;
  billGap: boolean;
  setAsideOnly: boolean;
  healthy: boolean;
}

export function classify(s: RunwayScenario): RunwayClassification {
  const runwayBeforeAllocations = s.spendableNow + s.runwayIncomeTotal - s.runwayBillsTotal;
  const runway = runwayBeforeAllocations - s.allocationsRemainingTotal;
  const billGap = runwayBeforeAllocations < 0;
  const setAsideOnly = !billGap && runway < 0;
  return { runway, runwayBeforeAllocations, billGap, setAsideOnly, healthy: runway >= 0 };
}

// Kevin's own screenshot, verbatim: Available £256, bills £0, still to set
// aside £266, projected −£10, £4,798 landing on payday tomorrow.
export const SCENARIO_SETASIDE: RunwayScenario = {
  isCalendarMonth: false,
  daysToPayday: 1,
  paydayLabel: "Fri 26 Sep",
  spendableNow: 256,
  runwayIncomeTotal: 0,
  runwayBillsTotal: 0,
  allocationsRemainingTotal: 266,
  savingsNow: 0,
  genuineShortfalls: [],
  timingShortfalls: [],
  paydayIncomeAmount: 4798,
};

// A genuine bill gap: bills alone (£340) already exceed what's available
// plus income before payday (£180), before the £60 set-aside remainder is
// even considered. Red must stay exactly as it does today.
export const SCENARIO_BILLGAP: RunwayScenario = {
  isCalendarMonth: false,
  daysToPayday: 3,
  paydayLabel: "Wed 1 Oct",
  spendableNow: 180,
  runwayIncomeTotal: 0,
  runwayBillsTotal: 340,
  allocationsRemainingTotal: 60,
  savingsNow: 400,
  genuineShortfalls: [{ accountId: "acc-monzo", bank: "Monzo", shortfall: 160 }],
  timingShortfalls: [],
  paydayIncomeAmount: 2150,
};

// Comfortably covered even after bills and the full set-aside remainder.
export const SCENARIO_HEALTHY: RunwayScenario = {
  isCalendarMonth: false,
  daysToPayday: 5,
  paydayLabel: "Mon 5 Oct",
  spendableNow: 1120,
  runwayIncomeTotal: 0,
  runwayBillsTotal: 410,
  allocationsRemainingTotal: 150,
  savingsNow: 2200,
  genuineShortfalls: [],
  timingShortfalls: [],
  paydayIncomeAmount: 2150,
};

export const SCENARIOS: Record<"setaside" | "billgap" | "healthy", RunwayScenario> = {
  setaside: SCENARIO_SETASIDE,
  billgap: SCENARIO_BILLGAP,
  healthy: SCENARIO_HEALTHY,
};
