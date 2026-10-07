import type { Commitment, CompanionItem, PlanEasePreview } from "@/lib/api";
import type { PlanEasingCardServices } from "@/components/HomeBrief";

// G228 fixtures. No user data. The items match the real `plan_easing`
// CompanionItem payloads the production PlanEasingCard renders
// (backend/app/services/companion.py section 6c), and the services stand-in
// answers the production sheet's two calls (ease-preview and ease) with figures
// worked the way the engine works them: the fixture sits on the first day of a
// pay period, so the current period is one of the counted starts, 24 pay
// periods follow, and every slice is rounded up to £5.

export type EaseState = "eligible" | "capped" | "deferred";

export const PLAN = {
  id: "goal-japan",
  name: "Japan",
  usual: 80,
  remaining: 2000,
  laterPeriods: 24,
  targetDate: "2028-11-01",
  gap: 30,
};

const ceil5 = (v: number) => Math.ceil(v / 5) * 5;

function addMonthsIso(iso: string, n: number) {
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10);
}

/** What GET /commitments/{id}/ease-preview returns for this fixture. */
export function enginePreview(contribution: number, eased12m: number): PlanEasePreview {
  const rest = PLAN.remaining - contribution;
  const keepDateLater = ceil5(rest / PLAN.laterPeriods);
  const needed = Math.ceil(rest / PLAN.usual);
  const extra = Math.max(0, needed - PLAN.laterPeriods);
  const rise = keepDateLater * 4 > PLAN.usual * 5;
  return {
    contribution,
    usual_slice: PLAN.usual,
    remaining: PLAN.remaining,
    remaining_after: PLAN.remaining - contribution,
    later_periods: PLAN.laterPeriods,
    blocked_reason: eased12m >= 2 ? "A plan can only be eased in two periods a year." : null,
    keep_date: {
      later_slice: keepDateLater,
      date_moves_periods: 0,
      target_date: PLAN.targetDate,
      refused: rise ? "That would raise later contributions by more than a quarter." : null,
    },
    keep_amount: {
      later_slice: ceil5(rest / (PLAN.laterPeriods + extra)),
      date_moves_periods: extra,
      target_date: addMonthsIso(PLAN.targetDate, extra),
      refused: extra > 2 ? "That would move the date by more than two pay periods." : null,
    },
  };
}

export function planEasingItem(state: EaseState, eased?: { contribution: number; mode: "keep_date" | "keep_amount" }): CompanionItem {
  const base = {
    plan: { id: PLAN.id, name: PLAN.name },
    usual_slice: PLAN.usual,
    max_easing: PLAN.usual,
    periods_left: PLAN.laterPeriods + 1,
    target_date: PLAN.targetDate,
    paying_account_name: "Premier Current",
  };
  if (state === "deferred") {
    const e = eased ?? { contribution: 30, mode: "keep_date" as const };
    const opts = enginePreview(e.contribution, 1);
    const option = opts[e.mode];
    return {
      id: "plan_easing:goal-japan:2026-10-31:deferred",
      type: "plan_easing",
      headline: "Japan is eased this period",
      body: "",
      action: null,
      estimated: false,
      amount: 0,
      plan_easing: {
        ...base, state: "deferred", gap: 0, target_date: option.target_date, later_slice: option.later_slice,
        eased_this_period: e.contribution, eased_mode: e.mode, eased_count_12m: 1, cap_reason: null,
      },
    } as CompanionItem;
  }
  const capped = state === "capped";
  return {
    id: `plan_easing:goal-japan:2026-10-31:${state}`,
    type: "plan_easing",
    headline: "Cash looks short this period",
    body: "",
    action: null,
    estimated: false,
    amount: PLAN.gap,
    plan_easing: {
      ...base, state, gap: PLAN.gap, later_slice: PLAN.usual, eased_this_period: null, eased_mode: null,
      eased_count_12m: capped ? 2 : 1,
      cap_reason: capped ? "A plan can only be eased in two periods a year." : null,
    },
  } as CompanionItem;
}

/** Fixture services: nothing is fetched or saved. `onEased` reports a save so the page can show the deferred state. */
export function previewServices(state: EaseState, onEased: (e: { contribution: number; mode: "keep_date" | "keep_amount" }) => void): PlanEasingCardServices {
  const eased12m = state === "capped" ? 2 : 1;
  return {
    dismissTodayItem: async () => ({ ok: true }) as never,
    previewPlanEase: async (_id: string, contribution: number) => enginePreview(contribution, eased12m),
    easePlan: async (_id: string, contribution: number, mode: "keep_date" | "keep_amount") => {
      onEased({ contribution, mode });
      return { id: PLAN.id, name: PLAN.name, eased_this_period: contribution } as unknown as Commitment;
    },
  };
}
