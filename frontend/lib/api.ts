import { getToken } from "./auth";
import type {
  Account, Transaction, MonoAccount, MpesaAccount, KPIs, Insight,
  SavingsInsight, WorkflowStep, WorkflowDef, ChallengeProgress, Challenge,
  ChallengesData, InvestmentAccount, InvestmentHolding, InvestmentNote, BudgetItem,
  DebtInsights, DebtBurndown, UserPreferences, CategoryRule, BillLabel,
  ManualAccount, ManualAccountType, ManualAccountRule, RuleMatchType, RuleMatchField, RuleSign,
  SubscriptionInfo, GrowView,
  MoneyShape, MoneyShapeJob, MoneyShapePeriod, MoneyShapeTrend, MoneyShapeEvidenceRow,
  MoneyShapeTrait, MoneyShapeProposal, MoneyShapeWhatWorks,
  MoneyShapePeriodEntry, MoneyShapeAverageEntry,
} from "@wealth/shared";
export type {
  Account, Transaction, MonoAccount, MpesaAccount, KPIs, Insight,
  SavingsInsight, WorkflowStep, WorkflowDef, ChallengeProgress, Challenge,
  ChallengesData, InvestmentAccount, InvestmentHolding, InvestmentNote, BudgetItem,
  DebtInsights, DebtBurndown, UserPreferences, CategoryRule, BillLabel,
  ManualAccount, ManualAccountType, ManualAccountRule, RuleMatchType, RuleMatchField, RuleSign,
  SubscriptionInfo, GrowView,
  MoneyShape, MoneyShapeJob, MoneyShapePeriod, MoneyShapeTrend, MoneyShapeEvidenceRow,
  MoneyShapeTrait, MoneyShapeProposal, MoneyShapeWhatWorks,
  MoneyShapePeriodEntry, MoneyShapeAverageEntry,
} from "@wealth/shared";

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "/api";

export const logoUrl = (domain: string) => `${API_BASE}/logo/${encodeURIComponent(domain)}`;

/** What a category *means*. Mirrors backend/app/services/categories.py.
 *  "income" is backend-internal (only ever seen on the built-in Income
 *  category) and is not offerable when creating a custom category. */
export type CategoryKind = "discretionary" | "commitment" | "movement" | "income";

export interface CategoriesResponse {
  builtin: string[];
  custom: string[];
  all: string[];
  /** Kind for every category, built-in and custom — one source of truth. */
  kinds: Record<string, CategoryKind>;
}

export interface PagedTransactions {
  items: Transaction[];
  total: number;
  page: number;
  pages: number;
}

export interface AccountCategorySummary {
  name: string;
  total: number;
  count: number;
  pct: number;
}

export type NotificationPrefs = {
  transactions: boolean;
  goal_milestones: boolean;
  insights: boolean;
  period_digest: boolean;
  bill_alerts: boolean;
  category_pace?: boolean;
  classification_attention?: boolean;
};

export type GoalSummary = {
  pillar: "debt" | "savings";
  label: string;
  detail: string;
  pct: number;
  done: boolean;
  at_risk?: boolean;
  url: string;
};

export type CashflowWeek = {
  label: string;
  projected_income: number;
  projected_spend: number;
  projected_bills: number;
};

export type UpcomingBill = {
  name: string;
  amount: number;
  expected_date: string;
  days_away: number;
  account_id?: string | null;
  account_name?: string | null;
  account_bank?: string | null;
  account_balance?: number | null;
  is_credit_card?: boolean;
  category?: string | null;
  edited?: boolean;
  rule_label?: string | null;
  pending?: boolean;
  original_date?: string | null;
  planned?: boolean;
  planned_id?: string;
  days_past_due?: number;
  /**
   * "commitment" (real spend, not freely chosen) | "discretionary" (real
   * spend, freely chosen) | "movement" (not spend — money moved, not
   * consumed: transfers, savings, investment STOs). Resolved backend-side
   * from app/services/categories.py's kind model. Optional because cached
   * payloads computed before this field existed won't carry it.
   *
   * Fallback for a missing/unrecognised kind: treat it as real spend (i.e.
   * NOT "movement"). This fails safe in the dangerous direction — an
   * unknown kind still counts toward bill totals and can still render the
   * at-risk treatment, rather than silently vanishing from a total or
   * being waved through as riskless. Consumers should test `kind ===
   * "movement"` explicitly rather than `kind !== "movement"` when they
   * need the safe/inclusive read; see lib/comingUp.tsx's `isSpend`.
   */
  kind?: "commitment" | "discretionary" | "movement";
  /**
   * Present only when a movement's destination was traced (learned pair).
   * `dest_account_spendable: true` means the destination is inside the same
   * spendable pool as the source, so this movement is a pooled no-op: the
   * money never leaves the "everywhere" total, it only reallocates within
   * it. A missing/null flag is NOT a no-op, it still debits as before, see
   * the isPooledNoOp helper in PlanningPage.tsx that is the single place
   * allowed to interpret this pair.
   */
  dest_account_id?: string | null;
  dest_account_spendable?: boolean | null;
  /**
   * Present only for a credit-card repayment bill whose amount was derived
   * from the card's live balance/spend rather than plain recurring history.
   * "balance_estimate" is currently the only value. Absent = the amount is
   * an ordinary prediction, render exactly as today. When present, callers
   * should mark the figure as an estimate (a leading "~"), never treat it
   * as a confirmed amount.
   */
  amount_basis?: "balance_estimate" | null;
  /** Set when Penny (agent mode v1) created this planned payment via a
   * confirmed proposal, rather than the user adding it by hand in Planning.
   * Origin badge only — see Allocation's own `created_via` comment for the
   * full doctrine. Only ever meaningful alongside `planned: true`. */
  created_via?: "penny" | null;
  /**
   * True only on an entry inside `CashflowData.observed_pending_bills`
   * (never on a plain `upcoming_bills` row — the backend excludes a
   * matched occurrence from that list entirely once this is true). Means
   * a bank-side PENDING debit (not yet in the settled feed) already
   * matches this bill: the account balance has already moved, so this is
   * never at-risk and never double-debited by any walk. Render as calm,
   * non-red "left earlier today, still settling" copy — see
   * backend/app/services/pending_transactions.py.
   */
  observed_pending?: boolean;
};

export type PlannedExpense = { id: string; name: string; amount: number; date: string; account_id?: string | null; created_at?: string };
export type PlannedImpact = { safe_to_spend_before: number | null; safe_to_spend_after: number | null; state_after: "comfortable" | "tight" | "short" | null };

export type IncomeSuggestion = {
  key: string;
  avg_amount: number;
  schedule_label: string | null;
  next_date: string;
};

export type IncomeSchedule = {
  type: "weekly" | "biweekly" | "day_of_month" | "last_weekday";
  weekday?: number;
  day?: number;
  anchor?: string;
};

export type IncomeStream = {
  key: string;
  avg_amount: number;
  occurrences: number;
  schedule: IncomeSchedule | null;
  schedule_label: string | null;
  next_date: string | null;
  status: "confirmed" | "rejected" | "suggested";
};

/**
 * The DESTINATION side of an internal standing order that also appears in
 * `upcoming_bills` as a "movement" kind bill on the SOURCE account. The
 * projection used to debit the source and never credit the destination, so
 * an account fed entirely by an incoming transfer looked short even though
 * the money was demonstrably on its way (e.g. a payday Barclays→HSBC STO).
 * Each entry mirrors exactly one outbound movement bill: same amount, same
 * `expected_date`, same `days_away`, credited to the destination instead.
 * Optional, defaults to `[]`. Absent on caches computed before this field
 * existed.
 */
export type InternalInflow = {
  name: string;
  amount: number;
  expected_date: string;
  days_away: number;
  account_id: string;
  account_name?: string | null;
  account_bank?: string | null;
  source_account_id?: string | null;
  source_account_name?: string | null;
  /**
   * True when the destination account is inside the SPENDABLE pool by the
   * exact rules backend/app/routers/analytics.py's `_split_balances`
   * applies (GBP current accounts, not savings-subtype, not credit).
   * False for a destination that's a savings pot, an internal transfer
   * into savings genuinely leaves the spendable pool even though the
   * account is still the user's own. Optional: absent on caches computed
   * before this field existed, or on any older cached response, callers
   * doing POOLED arithmetic (the "everywhere" runway/at-risk totals) must
   * treat a missing value as NOT spendable (fail safe: undercount the
   * credit rather than overstate available cash). Per-account arithmetic
   * is unaffected by this flag entirely, see PlanningPage.tsx.
   */
  destination_spendable?: boolean;
};

export type CashflowData = {
  weekly_projection: CashflowWeek[];
  upcoming_bills: UpcomingBill[];
  upcoming_income: UpcomingBill[];
  avg_daily_spend: number;
  available_balance: number;
  /** Spendable cash only (excludes savings) — same pool as the Home Safe-to-Spend hero. Absent on caches computed before this field existed. */
  spendable_balance?: number | null;
  /** Savings-account balances, shown as a separate quiet line — never silently folded into runway. */
  savings_balance?: number;
  next_payday: string | null;
  payday_source: "confirmed" | "period" | null;
  income_suggestion: IncomeSuggestion | null;
  /** See `InternalInflow`. Optional, defaults to `[]` for older cached responses. */
  internal_inflows?: InternalInflow[];
  /**
   * Bills matched to a bank-side PENDING debit — see `UpcomingBill.observed_pending`.
   * Deliberately NOT part of `upcoming_bills` (every at-risk/shortfall/
   * runway walk reads that list only, so these are structurally excluded
   * from all of them); display-only. Optional, defaults to `[]` for older
   * cached responses.
   */
  observed_pending_bills?: UpcomingBill[];
  /** Same enriched shape as GET /allocations. Optional — absent on caches
   * computed before allocations existed; callers must treat a missing value
   * as "no allocations to subtract", never as an error. */
  allocations?: Allocation[];
};

export type TransportMode = {
  name: string;
  total: number;
  count: number;
  pct: number;
  colour: string;
  monthly: number;
};

export type TransportTx = {
  name: string;
  amount: number;
  date: string;
  mode: string;
};

export type TransportSummary = {
  period_days: number;
  total_spend: number;
  weekly_avg: number;
  monthly_avg: number;
  modes: TransportMode[];
  car_total: number;
  car_monthly: number;
  rideshare_total: number;
  rideshare_monthly: number;
  pt_total: number;
  pt_monthly: number;
  office_days: number;
  wfh_days: number;
  weekdays_in_period: number;
  weekly_commute_cost: number;
  annual_commute_projection: number;
  top_transactions: TransportTx[];
};

export type ValueDelivered = {
  insights_acted_on: number;
  total_monthly_saving: number;
  verified_monthly_saving?: number;
  breakdown: { title: string; monthly_saving: number; estimate_label: string }[];
};

export type MirrorTrait = {
  id: string;
  title: string;
  narrative: string;
  evidence: string[];
  kind: "structure" | "habit" | "pleasure" | "hygiene";
  choice: "keep" | "change" | null;
  // Category the trait is anchored to (e.g. "Eating Out" for signature_pleasure).
  // Optional — older portraits won't have it; the Mirror falls back to parsing
  // "Your Signature: {X}" from the title.
  ref_category?: string | null;
};

export type MirrorPortrait =
  | { status: "insufficient_data" }
  | {
      status: "ok";
      computed_at: string;
      window_days: number;
      traits: MirrorTrait[];
    };

export type PaceState = "short" | "early" | "comfortable" | "on_pace" | "ahead" | "unavailable";

export type PaceNotableDay = {
  date: string;
  weekday: string;
  amount: number;
  usual: number;
  multiple: number;
  top_categories: { category: string; total: number }[];
};

export type PaceSeriesPoint = {
  date: string;
  cumulative_discretionary: number | null;
  sustainable_line: number | null;
};

export type Checkpoint = {
  id: string;
  aim_amount: number;
  spent_so_far: number;
  days_left: number;
  on_track: boolean;
};

// GET /checkpoints also returns `ref` — the category the aim is anchored to.
export type ActiveAim = Checkpoint & { ref: string };

export type PaceChoice = {
  category: string;
  spent: number;
  rate_per_day: number;
  multiple: number | null;
  share_of_discretionary: number | null;
  txn_count: number;
  usual_rate_per_day: number | null;
  txn_ids: string[];
  // Door fields — optional so stale backend responses don't break the page
  checkpoint?: Checkpoint | null;
  intent?: "one_off" | "new_normal" | null;
  door_engaged?: boolean;
  suggested_aim?: number | null;
};

export type CategorySignal = {
  usual_rate_per_day: number | null;
  multiple: number | null;
  suggested_aim: number | null;
  checkpoint: Checkpoint | null;
  intent: "one_off" | "new_normal" | null;
  door_engaged: boolean;
};

export type CategorySignals = {
  period: { start: string; end: string; days_elapsed: number; days_left: number | null; offset: number; closed: boolean };
  signals: Record<string, CategorySignal>;
};

// ── GET /spend/verdict — mirrors backend/app/services/spend_verdict.py's
// `assemble_verdict` return shape exactly (field-for-field). Every notable/
// majority/moved figure here is server-computed (Show Your Working Rule —
// "the model narrates; Python counts"); the frontend only formats. ─────────
// ── PATCH /transactions/{id} + POST /transactions/{id}/resolve-movement —
// mirrors backend/app/routers/transactions.py field-for-field. The teaching
// sheet's propagation offer ("Always file X as Y? Matches N past payments")
// reads matches_past/rule_suggestion straight off the PATCH response — no
// second round-trip. ───────────────────────────────────────────────────────
export type PatchTransactionResult = {
  updated: string;
  custom_category: string;
  bulk_count: number;
  merchant_key: string;
  matches_past: number;
  rule_suggestion: { pattern: string; category: string } | null;
};

export type ResolveMovementResult = {
  updated: string;
  resolution: "mine-here" | "mine-goal" | "mine-offline" | "someone-else" | "spending";
  custom_category?: string | null;
  linked_goal_id?: string;
  linked_offline_account_id?: string;
  offline_pot_name?: string;
};

export type SpendVerdictState = "normal" | "nothing" | "everything" | "nobaseline" | "early";

export type SpendVerdictCause = { name: string; amount: number };

export type SpendVerdictNotable = {
  category: string;
  spent: number;
  multiple: number;
  excess: number;
  payments_count: number;
  cause: SpendVerdictCause[];
  pace: { spent: number; usual_by_now: number };
  // ── Spend card lifecycle additions (optional, additive — an old payload
  // without these renders exactly as before, minus the retired pace bar). ──
  // consequence_line — the priced consequence of this category running over
  // usual, one plain sentence, rendered directly below the pace line.
  // Absent when the engine has nothing priced for this category yet.
  consequence_line?: { text: string } | null;
  // prior_intent — set when this category was already filed "new normal" in
  // an earlier period and is running over usual again: carries a softened
  // repeat-ask question that replaces the default "Was this a one-off, or
  // the new normal?" prompt.
  prior_intent?: { question: string } | null;
};

// Qualifying categories that overflowed past the NOTABLE_CAP (3) — never
// rendered as their own cards, only as a quiet tag on their majority row.
export type SpendVerdictQuietFlag = {
  category: string;
  spent: number;
  multiple: number;
  excess: number;
  payments_count: number;
};

export type SpendVerdictMajorityRow = {
  category: string;
  spent: number;
  payments_count: number;
  has_baseline: boolean;
  elevated: boolean;
};

export type SpendVerdictUnresolved = {
  total: number;
  payments_count: number;
  ask_worthy: boolean;
  weight: "material" | "routine";
  largest: {
    id: string;
    display_name: string | null;
    raw_description: string;
    amount: number;
    date: string;
    /** The account this payment left from — optional/additive, absent on a
     *  payload cached before this field existed. Lets the ask card and its
     *  teaching-sheet handoff (SpendPage.tsx's onAskCorrect) show the real
     *  account instead of a derived, often-useless provider display name. */
    account_id?: string;
  } | null;
};

export type SpendVerdictMoved = {
  kind: "pots" | "credit_cards" | "investments" | "own_accounts";
  label: string;
  amount: number;
  payments_count: number;
  goal_names?: string[];
  /** Underlying spend categories this moved-money row aggregates (e.g.
   *  ["Savings"] for pots) — optional/additive. Lets the row route into
   *  /transactions scoped to exactly these categories; absent on an older
   *  payload leaves the row non-interactive, same as before this field
   *  existed. */
  categories?: string[];
};

export type SpendVerdictPills = { spent: number; income: number; net: number };

export type SpendVerdictPeriod = {
  start: string;
  end: string;
  days_elapsed: number;
  days_left: number | null;
  offset: number;
  closed: boolean;
};

// One point on the SpendHeader pace strip: cumulative spend by day `day`,
// `actual` always known, `usual` null when there's no baseline yet.
export type SpendVerdictPaceEntry = {
  day: number;
  actual: number;
  usual: number | null;
};

export type SpendVerdict = {
  state: SpendVerdictState;
  reading: string;
  notables: SpendVerdictNotable[];
  quiet_flags: SpendVerdictQuietFlag[];
  majority: SpendVerdictMajorityRow[];
  unresolved: SpendVerdictUnresolved;
  moved: SpendVerdictMoved[];
  pills: SpendVerdictPills;
  period: SpendVerdictPeriod;
  /** Cumulative actual-vs-usual series for SpendHeader's pace-strip
   *  instrument. Optional/additive: absent on older payloads, in which case
   *  the header renders with no strip (see components/SpendHeader.tsx). */
  pace_series?: SpendVerdictPaceEntry[];
  /** Server-computed sum of `moved`, for SpendHeader's Moved cell. Optional/
   *  additive: absent on older payloads, in which case the header falls
   *  back to a two-cell Out | In row. */
  moved_total?: number;
  /** Same figure as `unresolved.total` (always counted inside `pills.spent`,
   *  the OUT figure), duplicated at the top level for symmetry with
   *  `moved_total` — SpendHeader's OUT-pill footnote reads this directly. */
  unresolved_total?: number;
  /** Whether `unresolved_total` is material enough, relative to the
   *  period's pace excess, to footnote the OUT pill and hedge the reading.
   *  Server-computed (spend_impact.is_unresolved_material) so the footnote
   *  and the reading text can never disagree. */
  unresolved_material?: boolean;
  /** The period-level priced consequence the backend now ships. Optional/
   *  additive, unread by any consumer yet — typed here so future work
   *  (a period-level consequence surface) doesn't need to touch this file
   *  again. `move`/`horizon` are populated only for the matching
   *  `consequence` kind; both null for "bills_risk"/"permission"/null. */
  impact?: {
    consequence: "bills_risk" | "move_delta" | "horizon" | "permission" | null;
    move?: { usual: number; projected: number } | null;
    horizon?: { kind: "debt" | "goal"; name: string; from_month: string; to_month: string } | null;
    /** Whether the reading's unresolved-money hedge fired this request —
     *  see `unresolved_material` above, the field actually meant for
     *  frontend use; this is the raw backend flag, unread by any consumer. */
    unresolved_hedge?: boolean;
  } | null;
};

export type PaceDetail =
  | { status: "unavailable" }
  | {
      status: "ok";
      period: {
        start: string;
        end: string;
        days_elapsed: number;
        days_left?: number;
        offset: number;
        closed: boolean;
      };
      pace: {
        state?: PaceState;
        pot?: number;
        sustainable?: number | null;
        actual: number;
        discretionary_so_far: number;
      };
      choices: PaceChoice[];
      notable_day: PaceNotableDay | null;
    };


export type Pace = {
  state: PaceState;
  pot?: number;
  days_left?: number;
  days_elapsed?: number;
  period_start?: string;
  discretionary_so_far?: number;
  sustainable?: number;
  actual?: number;
  period_allowance?: number;
  notable_day?: PaceNotableDay | null;
  split?: { commitment_total: number; discretionary_total: number; non_spend_total: number; planned_total: number; commitment_count: number; discretionary_count: number };
  series?: PaceSeriesPoint[];
};

export type SafeToSpend =
  | {
      status: "insufficient_data";
      calculation_status?: "unsupported" | "unavailable";
      unavailable_components?: string[];
    }
  | {
      status: "ok";
      /** Single source of truth for "what's free right now" — NET of any
       * unpaid credit card growth reserved against the pot. */
      safe_to_spend: number;
      next_payday: string;
      days_until_payday: number;
      bills_total: number;
      /** Own-account movements excluded because both accounts are already in
       * the spendable pool; exposed so the calculation can say this plainly. */
      pooled_transfers_excluded?: number;
      income_before_payday: number;
      buffer: number;
      state: "comfortable" | "tight" | "short";
      estimated: boolean;
      spendable_now?: number;
      payday_income?: number;
      card_debt?: number;
      pace?: Pace;
      last_synced?: string | null;
      /** £/period reserved for active commitments — absent or 0 when none. */
      commitments_reserved?: number;
      commitments_count?: number;
      /** Pay-period rhythm ("monthly", "weekly", "every 2 weeks") backing
       * commitments_reserved, so the line can say "each pay period
       * (monthly)" instead of the ambiguous "/period". Null/absent when
       * the user's rhythm is custom/irregular — render unqualified. */
      commitments_reserved_period_label?: string | null;
      /** The old cash-only runway (after commitments, before the card
       * reserve) — kept for reference, not the figure to lead with. */
      safe_to_spend_cash?: number;
      /** Lowest projected balance after scheduled bills and pre-payday income,
       * before buffer, plans, allocations, and card-spending reserves. */
      lowest_projected_balance?: number;
      /** >= 0, unpaid credit card growth reserved out of the pot. */
      card_growth_reserved?: number;
      /** Unfilled allocation envelopes reserved from this pay period. */
      allocations_reserved?: number;
      allocations_count?: number;
      /** Optional calculation health for rolling API deployments. */
      calculation_status?: "complete" | "degraded";
      unavailable_components?: string[];
      /** Non-null only when state === "short" — which kind of shortfall. */
      short_reason?: "bills" | "cards" | null;
    };

// ── Commitments — named future big expenses (holiday, car, fees) ─────────────

/** One funding pot linked to a commitment (goals v2 — multiple pots). */
export type CommitmentPot = {
  account_id: string;
  name: string | null;
  /** "connected" = live bank pot; "manual" = offline, updated by the user.
   * Offline pots never receive automated payday-plan legs. */
  kind: "connected" | "manual";
  /** When true the pot's whole balance counts (baseline 0) — chosen at link
   * time; otherwise only growth since linking counts. */
  count_existing: boolean;
  /** £ this pot currently contributes toward progress. */
  contributing_balance: number;
};

export type Commitment = {
  id: string;
  name: string;
  amount: number;
  target_date: string; // ISO date, first of the target month
  /** Funding pots (goals v2). Absent only on stale payloads — fall back to
   * funding_account_id. */
  funding_pots?: CommitmentPot[];
  /** @deprecated Mirrors the first pot for one release — prefer funding_pots. */
  funding_account_id: string | null;
  /** @deprecated Mirrors the first pot for one release — prefer funding_pots. */
  funding_account_name: string | null;
  source: "manual" | "can_i";
  status: "active" | "done" | "cancelled";
  progress: number;
  remaining: number;
  periods_left: number;
  per_period_slice: number;
  /** Pay-period rhythm ("monthly", "weekly", "every 2 weeks") backing
   * per_period_slice — null when the user's rhythm is custom/irregular,
   * in which case surfaces should render unqualified ("a period"). */
  period_label?: string | null;
  on_track: boolean;
  /** Feasibility class — null when the underlying maths is unavailable. */
  feasibility?: CommitmentFeasibility | null;
  /** Hedged one-liner matching feasibility; absent when feasibility is null. */
  feasibility_note?: string;
  /** "caution" renders amber (debt-aware note); "info" is the normal slate
   * read. Falls back to feasibility === "stretch" when absent/null on older
   * payloads. */
  feasibility_tone?: "info" | "caution" | null;
  /** Sorted unique names of other ACTIVE goals sharing >=1 funding pot with
   * this one (the pot ledger — a pound is claimed by only the oldest goal).
   * Empty when this goal shares no pot with anything else. */
  shared_pot_goals: string[];
  /** Spend -> Plan bridge: set only when this period's spend is running far
   * enough ahead of usual that it could plausibly squeeze this plan's own
   * per-period slice. null otherwise (list_commitments only). */
  pace_note?: { text: string; link: "spend" } | null;
  /** Set when Penny (agent mode v1) created this goal via a confirmed
   * proposal, rather than the user creating it by hand. Origin badge only —
   * see Allocation's own `created_via` comment for the full doctrine. */
  created_via?: "penny" | null;
};

/** "surplus" fits the monthly spare rate; "savings" likely dips into savings;
 * "stretch" is neither (attention — amber, never red); "funded" has nothing
 * left to save (remaining <= 0) — render exactly like "surplus". */
export type CommitmentFeasibility = "surplus" | "savings" | "stretch" | "funded";

/** Per-pot conflict detail on a commitment preview — who ELSE is drawing
 * from this pot (through the shared pot ledger) and what's left free. */
export type CommitmentPreviewPot = {
  account_id: string;
  also_funding: { name: string; amount: number }[];
  free: number;
};

/** Soft, non-blocking debt-aware consent step shown before a CREATE saves,
 * when the draft would run while the user's card plan is short or the draft
 * itself is a "stretch". Inform and price, never advise or block — the
 * backend never rejects a save based on this; it's purely a UI gate. */
export type CommitmentConsent = {
  required: boolean;
  title: string;
  lines: string[];
  actions: { anyway: string; later_date: string; debt_first: string };
};

/** Live verdict for a draft commitment — POST /commitments/preview. */
export type CommitmentPreview = {
  per_period_slice: number;
  periods_left: number;
  /** Balance counted up front from count-existing funding pots. */
  starting_progress?: number;
  feasibility: CommitmentFeasibility | null;
  feasibility_note?: string;
  feasibility_tone?: "info" | "caution" | null;
  /** One entry per submitted funding pot — live pot-ledger conflicts. */
  pots_detail: CommitmentPreviewPot[];
  consent: CommitmentConsent | null;
};

/** Per-pay-period envelope (GET/POST/PATCH/DELETE /allocations). Simpler than
 * a Commitment: one fixed amount per period, one fill RULE, no target
 * date/pot ledger. `remaining` is the UNFILLED portion of amount_per_period
 * this period — filled money has already left the balances, so
 * runway/safe-to-spend arithmetic must only ever subtract `remaining`,
 * never `amount_per_period` (that would double-subtract the part already
 * gone). `period_start`/`period_end` are server-authoritative — the card
 * never computes its own period, it just displays what the backend says is
 * "this period" so it resets in step with the data.
 *
 * Owner decision, 2026-08-29 (verbatim): "the same rule we have for the
 * offline account is what we should reuse here, can be exact match or
 * contains, and the effective date can be selected or choose the start of
 * the payment period." The fill rule (`match_type`/`match_value`) is the
 * SAME description-rule mechanism the offline-account mirror rules use —
 * not a whole transaction series. Category-type rules are not offered
 * here: an envelope fills from a specific payment, not a spend category.
 *
 * `recurrence` (owner correction, 2026-08-29, second round: "an allocation
 * isn't necessarily every month, it can be just once"): "every_period"
 * behaves as above forever; "once" applies ONLY to the pay period it was
 * created in — `period_start`/`period_end` then reflect that FIXED period,
 * not today's. Once that period is over the allocation is `completed`:
 * `remaining` is always 0 (it reserves nothing further) but the record
 * stays in listings — never deleted — so history stays honest. */
export type Allocation = {
  id: string;
  name: string;
  amount_per_period: number;
  fill_account_id: string;
  /** "description_equals" (exact, case-insensitive, trimmed) or
   * "description_contains" (substring of description + merchant_name). */
  match_type: "description_equals" | "description_contains";
  /** The text the rule matches against. */
  match_value: string;
  /** Cleaned label for the rule, e.g. "Saving Challenge (2026)" — defaults
   * server-side to the cleaned match_value when not separately given, so
   * the UI can say "fed by X" without re-deriving anything client-side. */
  fill_display_name: string;
  /** Date (YYYY-MM-DD) fill-matching starts counting from. Defaults to the
   * current pay period's start at creation — i.e. unchanged behaviour
   * unless explicitly set later/earlier. */
  effective_from: string;
  recurrence: "every_period" | "once";
  /** True once a "once" allocation's fixed period is in the past. Always
   * false for "every_period". A completed allocation reserves nothing
   * (`remaining` is always 0) but is kept, not deleted. */
  completed: boolean;
  /** True while today is still before the pay period containing
   * `effective_from` — the reserve hasn't started yet, so `remaining` is 0
   * (same double-count-guard shape as `completed`, opposite reason: this
   * one hasn't started rather than having finished). Always false once
   * `effective_from`'s period has arrived, and always false when
   * `completed`. */
  pending: boolean;
  active: boolean;
  filled_this_period: number;
  /** Unfilled remainder this period — the figure that reduces available cash. */
  remaining: number;
  period_start: string;
  period_end: string;
  /** Set when Penny (agent mode v1) created this envelope via a confirmed
   * proposal, rather than the user creating it by hand in the sheet. Origin
   * badge only — "set up with Penny", whisper-tier, no gradient, no icon
   * theatre (owner decisions locked). Absent/null on every hand-created
   * allocation and on any payload cached before agent mode existed. */
  created_via?: "penny" | null;
};

/** One entry from GET /allocations/fill-candidates?account_id=... — a
 * recent (90d) incoming transaction series on that account, grouped by
 * series_key. Powers the "which payment fills it?" picker step in
 * AllocationSheet. */
export type FillCandidate = {
  series_key: string;
  display_name: string;
  last_amount: number;
  last_date: string;
  occurrences_90d: number;
};

/** Hand-off from "Can I…?" — a ready-to-save commitment prefill. */
export type CanIOffer = {
  name: string;
  amount: number;
  target_date: string;
  per_period: number;
};

/** GET /can-i/suggestions — persistent, personalised chips for the bounded
 * Penny oracle conversation + prompt bar. Backend contract (may not be live
 * yet — every call site degrades to an empty/omitted read).
 *
 * `chip_id`/`params` (2026-09-06, Penny usage ring round) let a personalised
 * suggestion be answered for free through POST /penny/chip instead of a full
 * /can-i round-trip — currently only `chip_id: "can_i_amount"` with
 * `params: { amount, occasion }`. Both optional: a suggestion without a
 * `chip_id` behaves exactly as before (populates/sends as free text). See
 * PennyConversation.tsx's `sendChip`. */
export type CanISuggestionChip = { label: string; chip_id?: string; params?: Record<string, unknown> };
export type CanISuggestions = {
  chips: CanISuggestionChip[];
  context_line: string;
};

/** POST /penny/chip response (2026-09-06). `kind` tells the caller how this
 * was answered:
 * - "engine"/"explain": `answer` is a ready-to-render string, no LLM call
 *   was made — see PennyConversation.tsx's `sendChip`, which renders it as
 *   a normal (unmarked) assistant bubble.
 * - "llm": the backend has no free answer for this chip; the caller falls
 *   back to an ordinary api.canI() round-trip with the chip's own label as
 *   the typed question.
 * `facts` is opaque/unused today, typed loosely so a future chip can carry
 * structured data without another type change here. */
export type PennyChipResponse = {
  chip_id: string;
  kind: "engine" | "explain" | "llm";
  answer?: string;
  facts?: Record<string, unknown>;
};

/** Thrown by api.canI on a 402 with `detail.code === "PENNY_LIMIT_REACHED"`
 * — the monthly Penny message cap (see /subscription's `usage.penny_limit`/
 * `penny_remaining`). Callers should catch this specifically (`instanceof
 * PennyLimitError`) to flip the composer into its resting state and record
 * the fresh usage figures, rather than showing the generic ErrorRetry
 * bubble a plain network/server error gets. Still an `Error` subclass, so a
 * caller that doesn't know about this type sees an ordinary rejection. */
export class PennyLimitError extends Error {
  readonly code = "PENNY_LIMIT_REACHED" as const;
  readonly used: number;
  readonly limit: number;
  readonly resets_on: string;
  readonly tier: string;
  constructor(detail: { used: number; limit: number; resets_on: string; tier: string }) {
    super("Penny message limit reached for this month");
    this.used = detail.used;
    this.limit = detail.limit;
    this.resets_on = detail.resets_on;
    this.tier = detail.tier;
  }
}

/** POST /can-i response. `headline`/`facts`/`out_of_scope` are additive —
 * an older backend returns only `reply`/`offer`, and callers must degrade
 * gracefully (render `reply` as plain body text) when they're absent.
 *
 * `scenario`/`items`/`rejected`/`prefilled`/`clarify` are ALSO additive: they
 * appear only when the deterministic classifier in
 * backend/app/routers/scenario.py's `looks_like_scenario` fired instead of a
 * normal affordability answer (see that router's /can-i short-circuit). When
 * `scenario` is true, `facts` is always `[]` and `out_of_scope` is always
 * false — the real payload lives in `items`/`rejected`/`prefilled`/`clarify`.
 * `clarify` non-null means extraction found nothing usable; render `reply`
 * as an ordinary message, no confirm card. Otherwise `items` (max 3, backend-
 * capped) is the slot-extraction result the user must confirm/edit before
 * anything is simulated — see ScenarioItem below.
 *
 * `explainer`/`topic` are the fold-in of the retired TaxChat popup: a
 * general-knowledge answer (e.g. tax) that isn't grounded in the user's own
 * balances, so it gets no verdict headline, just a markdown `reply` under a
 * quiet topic label. Checked in PennyConversation's `ask()` BEFORE the
 * `headline` branch, since a backend could in principle set both. */
export type CanIResponse = {
  reply: string;
  offer?: CanIOffer | null;
  /** The backend sends explicit JSON `null` here on the explainer/tax path
   * and on the AI-unavailable fallback, not just "field absent" — `| null`
   * reflects that wire shape (see backend/app/routers/can_i.py's resp_body
   * literals). Every call site already uses a truthy check, so `null` and
   * `undefined` behave identically today. */
  headline?: string | null;
  facts?: string[];
  out_of_scope?: boolean;
  explainer?: boolean;
  /** Explicit JSON `null` on every non-explainer path (same reasoning as
   * `headline` above), `"tax"` on the one path that's live today. */
  topic?: string | null;
  scenario?: boolean;
  items?: ScenarioItem[];
  rejected?: string[];
  /** True when the backend guessed an amount the user never stated (e.g.
   * "what if I lose my job" prefilled from median income) — always paired
   * with an `income_change` kind item, since that's the only case the
   * backend ever prefills. Mark that field as an assumption to check, not
   * as a stated fact. */
  prefilled?: boolean;
  clarify?: string | null;
  /** Agent mode v1 — two more branches parallel to the scenario branch
   * above (`scenario`/`items`/`rejected`/`prefilled`/`clarify`), mutually
   * exclusive with it and with each other on any one response. `proposal`
   * is present when Penny drafted a concrete action that needs an explicit
   * yes; `consent_required` is present instead, with no proposal, when the
   * ask was action-shaped but the user has never said yes to Penny acting
   * on their behalf at all — see PennyConversation.tsx's ProposalMsg /
   * ConsentMsg for how each renders. */
  proposal?: PennyProposal | null;
  consent_required?: boolean;
};

/** Agent mode v1's confirm card (owner decisions locked: confirm-as-is, no
 * inline edits, one-time consent, origin badges, 15-min server-enforced
 * TTL) — Penny drafted a concrete action (an envelope, a goal, a one-off)
 * and needs an explicit yes before anything happens. `params` is opaque to
 * this frontend (whatever POST /penny/proposals/{id}/execute needs
 * server-side to actually create the thing) and is never read or edited
 * here — only `summary`/`consequence` render, because inline editing isn't
 * offered at all: if the user wants it different, they say so in chat and
 * get a fresh proposal. `proposal_id` is short-lived; an expired/cancelled
 * execute attempt rejects with a human `detail` string (see
 * api.executePennyProposal). See PennyConversation.tsx's ProposalMsg /
 * ProposalConfirmCard. */
export type PennyProposal = {
  proposal_id: string;
  kind: string;
  summary: string;
  consequence: string;
  params: Record<string, unknown>;
};

/** A single confirmed "what if" scenario item, as sent to POST /scenario/run.
 * Mirrors backend/app/services/scenario.py's `normalise_items` contract
 * exactly (kind/direction/cadence enums, ISO date strings) — the backend
 * silently drops anything it can't validate into `rejected` rather than
 * erroring, so this type is deliberately permissive on the wire (the
 * backend is the source of truth for what's actually accepted). */
export type ScenarioItem = {
  label: string;
  amount: number;
  direction: "out" | "in";
  cadence: "monthly" | "weekly" | "annual" | "one_off";
  starts: string; // ISO date
  ends?: string | null; // ISO date, optional
  kind: "new_outgoing" | "removal" | "income_change";
  category?: string | null; // only meaningful when kind === "removal"
};

/** Cash-flow re-projection block. Null when there's under 2 months of
 * transaction history to project from (see scenario.py's `thin_history`). */
export type ScenarioCashBlock = {
  surplus_now: number;
  surplus_after: number;
  per_month: number[];
  first_tight_month: string | null;
  months_negative: number;
};

/** Debt re-projection block. Null when no card has both a balance and
 * demonstrated monthly movement to project against. Individual date fields
 * can still be null even when the block itself isn't (e.g. no canonical
 * debt-free date exists within the projection window). */
export type ScenarioDebtBlock = {
  debt_free_month_now: string | null;
  debt_free_month_after: string | null;
  months_later: number | null;
  extra_interest: number | null;
  movement_exhausted: boolean;
  clears_after: boolean;
};

export type ScenarioPlanItem = {
  name: string;
  feasibility_now: string | null;
  feasibility_after: string | null;
  target_date: string | null;
  slipped: boolean;
};

/** Plans/goals re-check block. Null when there are no active plans, or
 * feasibility couldn't be computed at all. */
export type ScenarioPlansBlock = {
  items: ScenarioPlanItem[];
  any_worse: boolean;
};

/** Emergency-fund cover block. Null when there's not enough spending
 * history yet. `months_cover_after` can itself be null within a non-null
 * block (adjusted spending resolves to zero). */
export type ScenarioGrowBlock = {
  months_cover_now: number;
  months_cover_after: number | null;
  current_savings: number;
};

export type ScenarioAbsorbCandidate = { category: string; monthly: number };

/** "Where this comes from" block. Null whenever the scenario doesn't
 * reduce spare cash (a cancellation/income rise) — there's nothing to
 * absorb, not an error. */
export type ScenarioAbsorbBlock = {
  shortfall: number;
  covered_by_surplus: number;
  candidates: ScenarioAbsorbCandidate[];
};

/** Per-block null reasons, one slot per axis. Each is the plain-English
 * reason that axis's block is null (e.g. cash's "Fewer than 2 months of
 * transaction history..."), or null when that block isn't null / has no
 * reason to report. Replaces the old approach of folding every block's
 * reason into the flat `assumptions` array and recovering it client-side by
 * matching fixed backend string prefixes — see git history on
 * ScenarioPage.tsx for that (retired) approach. `assumptions` now carries
 * only GLOBAL notes with no single block to attach to (e.g. the payday/
 * rhythm line). */
export type ScenarioReasons = {
  cash: string | null;
  debt: string | null;
  plans: string | null;
  grow: string | null;
  absorb: string | null;
};

/** POST /scenario/run response. Every one of cash/debt/plans/grow/absorb
 * can legitimately be null — each null is always paired with a plain-
 * English reason in `reasons`, never a silent gap. See
 * backend/app/services/scenario.py's `simulate()` docstring for the full
 * doctrine (every figure computed from real inputs, never a guess). */
export type ScenarioRunResponse = {
  horizon_months: number;
  items: ScenarioItem[];
  rejected: string[];
  baseline: {
    monthly_surplus: number;
    monthly_income: number;
    monthly_spending: number;
    n_months: number;
  };
  recurring_delta: number;
  cash: ScenarioCashBlock | null;
  debt: ScenarioDebtBlock | null;
  plans: ScenarioPlansBlock | null;
  grow: ScenarioGrowBlock | null;
  absorb: ScenarioAbsorbBlock | null;
  reasons: ScenarioReasons;
  /** True when some of this scenario lands in specific months rather than
   * being spread evenly (an annual/one-off dominated scenario) — see
   * backend/app/routers/scenario.py's `_is_lumpy_scenario`. Replaces the old
   * client-side `assumptions` substring match for the same signal. */
  lumpy: boolean;
  assumptions: string[];
  headline: string;
};

export type CompanionAction = {
  label: string;
  route: string;
  kind?: string;
};

export type MoveMapAccount = {
  account_id: string;
  name: string;
  provider: string;
  balance: number;
};

export type MoveMap = {
  from: MoveMapAccount & {
    safe_note: string;
    /**
     * £ already held back this period for own-account allocations (e.g. a
     * "Saving Challenge" envelope) THIS source funds — 0 when none. Disclosure
     * only: the move amount above already accounts for it server-side (see
     * backend/app/services/companion.py's `_reserved_for_allocations`, owner
     * fix 2026-08-31).
     */
    reserved_for_allocations?: number;
  };
  to: MoveMapAccount & { incoming: string };
};

export type PlanMove = {
  headline: string;
  amount?: number;
  move_map: MoveMap;
};

export type PlanDestBill = { label: string; amount: number };
export type PlanDest = {
  account_id: string;
  name: string;
  provider: string;
  balance: number;
  needs_total: number;
  needs_by: string;
  bills: PlanDestBill[];
  // True when this destination has no in-window bill at all — the account
  // is simply overdrawn right now (a live balance read, not a projection).
  // `needs_total`/`bills`/`needs_by` carry no meaning in that case.
  is_overdraft?: boolean;
};

export type PaydayProposal = {
  key: string;
  merchant: string;
  amount: number;
  occurrences: number;
  schedule: { type: string; weekday?: number };
  schedule_label: string;
  payday_phrase: string;
  pay_period_config: unknown;
  next_date: string;
  last_seen: string;
  account_id: string;
};

export type ConfirmPaydayResponse = {
  ok: boolean;
  payday: string;
  schedule: { type: string; weekday?: number };
  schedule_label: string;
  payday_phrase: string;
  pay_period_config: unknown;
  merchant: string;
  amount: number;
  period: { start: string; end: string };
};

export type PaydayPlanSalary = {
  account_id: string;
  name: string;
  provider: string;
  amount: number;
  stays: number;
};

export type PaydayPlanDest = {
  account_id: string;
  name: string;
  provider: string;
  balance: number;
  bills_total: number;
  bill_count: number;
  spend_typical: number;
  buffer: number;
  target: number;
  move: number;
  usual: number | null;
  /**
   * Active commitment(s) (goals v2) whose per-period slice is flooring this
   * dest's move — e.g. ["Summer holiday"] on a Saving Challenge leg. Absent
   * when no commitment routes here. See backend/app/services/companion.py's
   * `_active_commitment_slices` and the `_dest_entry["commitment_names"]`
   * assignment in the payday-plan dest-building loop.
   */
  commitment_names?: string[];
  /**
   * Sum of MOVEMENT bills on this account excluded from `bills_total`
   * because their learned destination is one of the user's own accounts
   * (backend/app/services/companion.py's `_is_own_transfer_bill`, owner
   * directive 2026-08-29: the plan sizes off payments and card cadence,
   * "not taking into account any transfers"). Disclosure only — not yet
   * rendered by PaydayPlanCard.
   */
  own_transfers_skipped?: number;
};

/**
 * Items scheduled ON payday itself (2026-08-28 decision: payday-day items
 * belong to the NEXT pay period's arithmetic, not the one ending today, but
 * stay visible as a distinct "payday split"). Present on a `payday_plan`
 * CompanionItem only when payday-day bills/movements exist — see
 * backend/app/services/companion.py section 5c and app/services/
 * pay_period.py's is_payday_day.
 */
export type PaydaySplit = {
  total: number;
  count: number;
  expected_in: number;
  accounts: { account_id: string; name: string; out: number }[];
};

/**
 * Present only when an account funding the payday_split is at risk of
 * missing it if the salary lands late. Omitted entirely (not null) when no
 * account is at risk — see companion.py section 5c. `copy` arrives
 * pre-written and hedged; render it verbatim, never re-derive its wording.
 */
export type PaydaySplitRisk = {
  account_id: string;
  name: string;
  shortfall: number;
  copy: string;
};

/**
 * One entry inside an "unfunded_move" CompanionItem's `moves` list — a
 * pending OWN transfer (movement) the conservative walk says the source
 * account can't fund. Shape confirmed against the actual emission in
 * backend/app/services/companion.py's `_um_moves` build (2026-08-27, the
 * owner's due-but-unfunded-movement extension), NOT the earlier placeholder
 * spec this was first drafted against — `key` (not `name`) is the series
 * identifier api.skipUpcomingOccurrence needs as its `key` param,
 * `expected_date` is already the ORIGINAL due date (backend resolves
 * original_date ?? expected_date before emitting), and `amount` arrives
 * pre-rounded to whole pounds (`int(round(...))` server-side), not pence.
 */
export type UnfundedMoveEntry = {
  key: string;
  label: string;
  amount: number;
  expected_date: string | null;
  days_past_due: number;
  source_account_id: string;
  source_name: string;
  source_bank: string;
};

export type CompanionItem = {
  id: string;
  type: "move" | "rhythm" | "celebration" | "info" | "needle" | "ask" | "cliff" | "trajectory" | "payday_plan" | "intent_pace" | "unfunded_move";
  headline: string;
  body: string;
  action: CompanionAction | null;
  estimated: boolean;
  move_map?: MoveMap;
  // `PlanMove[]` when type === "move" (MoveCard's leg list). When type ===
  // "unfunded_move" the backend reuses this SAME field name for an
  // unrelated shape (see UnfundedMoveEntry above, confirmed against
  // backend/app/services/companion.py's `_um_moves`/item_doc build,
  // 2026-08-27) — kept declared as `PlanMove[]` here rather than a widened
  // union so MoveCard's existing `m.move_map` reads stay soundly typed;
  // UnfundedMoveCard casts its own read of `item.moves` to
  // `UnfundedMoveEntry[]` instead, since `item.type` is the true
  // discriminant at runtime even though these two optional fields can't
  // share a TS-narrowable shape under one flat interface.
  moves?: PlanMove[];
  summary?: string;
  residual?: string;
  overflow_note?: string;
  income_note?: string;
  assumed_incomes?: { name: string; amount: number; expected_date: string }[];
  plan_dest?: PlanDest;
  covered?: boolean;
  sources_safe?: boolean;
  /**
   * True when at least one source leg's contribution to this move was
   * reduced by an envelope (allocation) reservation — see
   * `MoveMap.from.reserved_for_allocations` and backend/app/services/
   * companion.py's `_reserved_for_allocations` (owner fix, 2026-08-31).
   * Drives the assurance line's "...and envelopes" extra clause.
   */
  envelope_reserved?: boolean;
  amount?: number;
  secondary_action?: CompanionAction | null;
  proposal?: PaydayProposal;
  // payday_plan fields — present when type === "payday_plan"
  total?: number;
  preview?: boolean;
  /**
   * ISO date of the REAL next payday this preview's simulated salary credit
   * is dated at (2026-08-29 FIX B — "the payday plan should forecast how we
   * should move money for the next period not today"). Present only on a
   * genuine `preview: true` item; drives the dated, hedged heading in
   * PaydayPlanCard. Absent on a live or `executed` item — there's nothing
   * to hedge, the plan already ran (or already happened).
   */
  next_pay?: string;
  /**
   * True when this item is a quiet summary of a plan that has ALREADY
   * auto-verified ("done") for the current window — no computation ran,
   * this is the persisted record. See companion.py's FIX A gate
   * (`_executed_payday_plan_item`). Mutually exclusive with `preview`.
   */
  executed?: boolean;
  dests?: PaydayPlanDest[];
  salary?: PaydayPlanSalary;
  trimmed?: boolean;
  payday_split?: PaydaySplit;
  payday_split_risk?: PaydaySplitRisk;
  // payload — present when type === "rhythm"; carries category, multiple, spent, period_end, dominant
  payload?: {
    category?: string;
    multiple?: number;
    spent?: number;
    period_end?: string;
    dominant?: { name: string; amount: number; date: string } | null;
  } | null;
};

export type TodayResponse = {
  status: "ok";
  items: CompanionItem[];
};

export type SuggestedPlan = {
  mode?: "add" | "replace";
  kind?: "debt" | "savings";
  target_months?: number;
  target_amount?: number;
  milestones: { type: string; text: string; target_balance?: number }[];
};

export type SavingsAccountOption = {
  account_id: string;
  name: string;
  provider: string;
  balance: number;
  selected: boolean;
  manual: boolean;
};

export type SavingsInsights = {
  configured: boolean;
  accounts: SavingsAccountOption[];
  current_savings: number;
  target_amount: number;
  target_type: "months" | "amount" | null;
  target_months: number | null;
  pct_funded: number;
  months_funded: number;
  monthly_income: number;
  monthly_spending: number;
  monthly_surplus: number;
  months_to_target: number;
  funded_date: string | null;
  has_data: boolean;
};

export type SavingsGoalInput = {
  target_type: "months" | "amount";
  target_months?: number;
  target_amount?: number;
  account_ids: string[];
};

export type SavingsPlanMilestone = {
  id: string;
  type: "savings" | "action";
  text: string;
  target_balance: number | null;
  done: boolean;
  done_at: string | null;
  live_category?: string;
  live_target?: number;
  live_spend?: number;
};

export type SavingsPlan = {
  target_amount: number | null;
  savings_at_creation: number | null;
  created_at: string | null;
  milestones: SavingsPlanMilestone[];
  done_count: number;
  total_count: number;
  current_savings: number;
};

export function authHeaders(): HeadersInit {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Private go-live readiness page (/ops/go-live) — see backend/app/routers/ops.py.
export type GoLiveDoc = { markdown: string; updated_at: string };
export type GoLiveResponse = {
  files: {
    todo?: GoLiveDoc;
    compliance?: GoLiveDoc;
    pricing?: GoLiveDoc;
  };
  jira_base_url: string | null;
};

// A fetch that dies on a flaky network (e.g. WiFi→mobile handover mid-transfer)
// otherwise hangs indefinitely and pages spin forever waiting on Promise.all.
// Abort stalled GETs and retry once — GETs are safe to repeat.
async function get<T>(path: string, attempt = 0): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: authHeaders(),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json();
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === "AbortError";
    const networkErr = e instanceof TypeError; // fetch network failure
    if ((aborted || networkErr) && attempt < 1) return get<T>(path, attempt + 1);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

// Every hand-rolled `fetch(...).then(r => r.json())` call below used to skip
// the ok check that get<T>/post<T> do — a FastAPI error body is still valid
// JSON, so those promises resolved on 4xx/5xx and callers never saw a
// rejection (design re-gate P0: teaching sheet reported success on a 401).
// Route every one of them through this so a non-2xx always throws.
async function toJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
    } catch {
      /* body wasn't JSON — keep the status line */
    }
    throw new Error(detail);
  }
  return res.json();
}

export type UserProfile = {
  full_name: string;
  name_tokens: string[];
  onboarding_complete: boolean;
  postcode: string | null;
  lat: number | null;
  lng: number | null;
};

export type FuelStation = {
  node_id: string;
  brand: string | null;
  name: string | null;
  postcode: string | null;
  city: string | null;
  lat: number;
  lng: number;
  distance_km: number;
  ppl: number;
  updated: string | null;
  is_supermarket: boolean;
};

export type FuelNearby = {
  grade: string;
  grade_label: string;
  anchor: { lat: number; lng: number };
  radius_km: number;
  paid_ppl: number | null;
  count: number;
  cheapest_ppl: number | null;
  median_ppl: number | null;
  savings_ppl: number | null;
  snapshot_fetched_at: string | null;
  stations: FuelStation[];
};

export type BasketItem = {
  name: string;
  qty: number;
  unit_price: number | null;
  line_price: number | null;
  category: string;
};

export type Basket = {
  id: string;
  shop: string | null;
  purchased_at: string | null;
  date_estimated?: boolean;
  currency: string;
  total: number | null;
  item_count: number;
  items: BasketItem[];
  created_at: string | null;
};

export type ItemTrend = {
  key: string;
  name: string;
  latest: number;
  previous: number;
  pct_change: number;
  currency: string;
  store: string | null;
  date: string | null;
};

export type StorePrice = {
  key: string;
  name: string;
  cheapest_store: string;
  cheapest_price: number;
  dearest_store: string;
  dearest_price: number;
  saving: number;
  currency: string;
};

export type BasketInsights = {
  receipt_count: number;
  item_trends: ItemTrend[];
  store_prices: StorePrice[];
  headline: string | null;
};

export type NeedleClosed = {
  period_start: string;
  period_end: string;
  card_delta: number;
  month_end_cash: number;
  lines: { headline: string; movement: string; cash: string; streak?: string };
};

export type NeedleSummary = {
  status: string;
  last_closed: NeedleClosed | null;
  current: { card_delta_so_far: number; cash_now: number; days_to_payday: number; days_into_period: number };
};

export type CardsStoryCard = {
  account_id: string;
  name: string;
  provider: string;
  balance: number;
  delta: number;
  apr: number | null;
};

export type CardsStory = {
  status: string;
  period: { start: string; end: string; days_elapsed: number };
  movement: { delta: number; new_spend: number; payments: number };
  per_card: CardsStoryCard[];
  drivers: { category: string; total: number }[];
  pattern_line: string | null;
  trajectory: { period_end: string; delta: number }[];
};

// ── Card terms (asked, never inferred — open banking has no APR data) ──────
export type CardPromoKind = "purchases" | "balance_transfer" | "both";
export type BtOffer = { ends: string | null; fee_pct: number | null; note: string | null };
export type CardPromo = { kind: CardPromoKind; apr_pct: number; until: string };

export type CardTerms = {
  apr_pct: number | null;
  promos: CardPromo[];
  min_payment_note: string | null;
  bt_offers: BtOffer[];
  status: "confirmed" | "skipped" | null;
  confirmed_at: string | null;
  product_key: string | null;
  usage: "clear_monthly" | "carry" | null;
};

export type CardTermsCard = {
  account_id: string;
  name: string;
  provider: string;
  balance: number;
  currency: string;
  source: string;
  terms: CardTerms | null;
  ask_eligible: boolean;
};

export type CardTermsList = {
  status: string;
  cards: CardTermsCard[];
  /** Honest-phrasing hook: a representative rate is not the user's own rate. */
  rate_note: string;
};

export type CardTermsLookup = {
  status: string;
  product_key: string | null;
  display_name: string | null;
  representative_apr: number | null;
  stale: boolean;
  candidates: string[];
  lookup_status: string;
  source_url: string | null;
  ambiguous: boolean;
  rate_basis: string;
  rate_note: string;
};

export type CardTermsSaveBody = {
  status: "confirmed" | "skipped";
  apr_pct?: number | null;
  promos?: CardPromo[];
  min_payment_note?: string | null;
  bt_offers?: BtOffer[];
  product_key?: string | null;
  usage?: "clear_monthly" | "carry" | null;
};

export interface CycleStoryPeriod {
  start: string;
  end: string;
  closed: boolean;
  days_elapsed: number;
  days_to_payday: number;
}

export interface CycleStoryChapters {
  opening: { income_in: number; count: number };
  cliff: { week1_spend: number; period_spend: number; week1_pct: number; commitments: { payee: string; total: number }[] } | null;
  switch?: { week1_card_pct: number; rest_card_pct: number; switch_day: string | null } | null;
  spending?: {
    total_spend: number;
    income_in: number;
    top_categories: { category: string; total: number }[];
  };
  cards?: {
    present: boolean;
    material: boolean;
    new_spend: number;
    payments: number;
    delta: number;
    share_of_spend: number;
    /** Per-card spend breakdown, sorted new_spend descending, dormant cards
     *  excluded. Optional: older cached stories predate this field. */
    breakdown?: Array<{ account_id: string; name: string; provider: string; new_spend: number; delta: number }>;
  };
  moves: Record<"card_feeding" | "ritual_saving" | "deliberate_saving" | "buffer_draws" | "other_shuffles", { count: number; total: number }>;
  keeping: { set_aside: number; drawn_back: number; external: number; kept: number };
  close: { month_end_cash: number; card_delta: number; streak_weeks: number | null } | null;
  self_facts: { traits: { id: string; title: string; choice: string | null }[]; fired: Record<string, boolean> };
}

export interface CycleStoryNarrative {
  opening: string;
  month: string;
  moves: string;
  keeping: string;
  close: string;
  self: string;
  source: string;
}

export interface CycleStoryTomorrow {
  push_title: string;
  push_body: string;
  brief_headline: string;
  brief_body: string;
}

export interface CycleStory {
  status: "ok" | "no_data";
  early_days?: boolean;
  period?: CycleStoryPeriod;
  chapters?: CycleStoryChapters;
  narrative?: CycleStoryNarrative;
  cards_link?: boolean;
  tomorrow?: CycleStoryTomorrow;
  is_preview?: boolean;
  persona?: string;
  is_demo?: boolean;
}

// ── Debt plan rate-segment shape ───────────────────────────────────────────
// DebtPlanView/DebtPlanViewCard and friends (the full GET /debt-plan payload
// the retired /debt-plan page, DebtPlanPage.tsx, used to render) were
// removed in the debt-plan page cleanup (2026-08-30) — DebtPlanRateSegment
// survives because DebtPlanSummary below still uses it.
export type DebtPlanRateSegment = {
  from: string;               // "YYYY-MM"
  until: string | null;       // "YYYY-MM" or null
  apr_pct: number | null;
  source: "promo" | "standard" | "unknown";
  kind: string | null;
};

// "What-if" overrides for the Spend page's debt_burndown widget — local
// experimentation on top of the real stored balances/APRs, persisted like
// any other widget preference (never written back to card_terms/accounts).
// `monthly: null` and an empty `aprs` map means "use the real figures".
export type DebtBurndownOverrides = {
  monthly: number | null;
  aprs: Record<string, number>;
};

// Lightweight summary variant of DebtPlanView (GET /debt-plan/summary) — totals
// buckets + per-card balance/rate schedule/demonstrated monthly payment, all
// pulled from the same 90s-cached deterministic plan the Planning "Card plan"
// entry card already reads (no extra cashflow fetch or LLM narration call).
// index 0 of a card's rate_schedule is always "the segment covering now",
// same contract the original minimal shape carried.
export type DebtPlanSummary = {
  totals: {
    buckets: { carried_total: number; float_total: number };
    // Σ demonstrated monthly paydown across cards carrying a balance. null
    // when no carried card has enough history for a movement figure —
    // distinct from a genuine £0.
    monthly_payment: number | null;
  };
  cards: {
    account_id: string;
    name: string;
    debt: number;
    currency: string;
    classification: "cleared_monthly" | "carried_zero" | "carried_interest" | "unclear" | null;
    monthly: number | null;
    rate_schedule: DebtPlanRateSegment[];
  }[];
  // Total card balance projected forward month by month at the demonstrated
  // paydown pace (same _amortise walk that produces Penny's payoff months
  // — a chart built off this can never drift from Penny's own answers).
  // Optional/additive: absent when the frontend is deployed ahead of the
  // backend field, in which case SpendTrends' debt_burndown widget treats
  // it exactly like an older payload (quiet empty state, never a crash).
  // month is "YYYY-MM"; the array is anchored with the current month at
  // today's total and can run up to HORIZON_MONTHS long when any card never
  // clears at the current pace, see debt_plan.py.
  projection?: { month: string; total: number }[];
};

// Whether a given native (Capacitor) device token is actually registered
// with the backend, not just whether the OS granted permission.
export type NativePushStatus = {
  registered: boolean;
  platform: "android" | "ios" | null;
};

// Per-transport delivery tally in a TestPushResult's `result`. `webpush`
// genuinely has no `configured` key (there's no separate "is web push set
// up" concept the way there is a VAPID/FCM/APNs credential check), so it
// deliberately omits the field rather than padding it in.
export type PushDeliveryStats = { attempted: number; delivered: number; failed: number; pruned: number };
export type PushDeliveryStatsWithConfig = PushDeliveryStats & { configured: boolean };

// Response for a one-off test push fanned out to every device registered
// for this user. `detail` is only populated on the ok:false path (no
// devices registered). `result` is the optional per-transport breakdown;
// nothing reads it today, it's here so the type matches what the backend
// actually returns.
export type TestPushResult = {
  ok: boolean;
  sent: boolean;
  devices: { apns: number; fcm: number; webpush: number };
  detail?: string;
  result?: {
    apns: PushDeliveryStatsWithConfig;
    fcm: PushDeliveryStatsWithConfig;
    webpush: PushDeliveryStats;
  };
};

// A single external identity linked to this account (Phase 1: Apple only).
// `relay` is true when the email is an Apple "Hide My Email" private relay
// address rather than the user's real one — surfaced so Settings can say so.
// `auto` is true when this identity created its own account via OPEN_SIGNUP
// (an Apple relay sign-in with no prior account to link from) rather than
// being explicitly linked from an existing account.
export type LinkedIdentity = {
  provider: "apple";
  relay: boolean;
  auto: boolean;
  email_masked: string;
  linked_at: string | null;
};

export type IdentitiesResponse = {
  primary_email: string;
  linked: LinkedIdentity[];
};

// One leg (credit or debit) of a suggested cross-account transfer pair —
// mirrors backend/app/routers/analytics.py's `_pair_leg` field-for-field.
// `category` is the effective category (custom_category always wins, though
// a suggested pair never has one — manual choices exclude a leg entirely).
export type TransferPairLeg = {
  id: string;
  account_id: string;
  date: string;
  amount: number;
  description: string | null;
  merchant_name: string | null;
  category: string | null;
};

// A candidate cross-account transfer pair the sync-time byte-identical
// matcher missed — see GET /transactions/transfer-pair-suggestions.
// `pair_key` is the two transaction _ids sorted and joined ("id1:id2"),
// stable across requests, used both to dismiss (permanent, per-instance)
// and to key React lists.
export type TransferPairSuggestion = {
  pair_key: string;
  date_diff_days: number;
  credit: TransferPairLeg;
  debit: TransferPairLeg;
};

// GET /dismissed-series — mirrors backend/app/routers/analytics.py field
// for field. Two genuinely distinct provenances:
//
//   "user"   rows come from `dismissed_recurring` in preferences — a bare
//            list of series-key strings, no dismissal timestamp stored.
//            `dismissed_at` reflects that: it's nullable rather than
//            invented.
//
//   "engine" rows come from `engine_vetoed_recurring` — the recurring
//            judge's own vetoes, which DO store a reason, a confidence
//            score and a real `vetoed_at`, so those are allowed to be
//            non-null in practice, but the type still admits null because
//            an old/partial record shouldn't crash the page.
//
// Both provenances share the same enrichment fields, and all of them are
// nullable: a series the backend can't enrich still comes back with its
// raw `key` so the row has something honest to show (fall back to `key`
// as the display name, omit any detail line whose field is null).
export type DismissedUserRow = {
  key: string;
  display_name: string | null;
  bank: string | null;
  typical_amount: number | null;
  cadence_label: string | null;
  last_seen: string | null;
  dismissed_at: string | null;
};

export type DismissedEngineRow = {
  key: string;
  display_name: string | null;
  bank: string | null;
  typical_amount: number | null;
  cadence_label: string | null;
  last_seen: string | null;
  reason: string | null;
  confidence: number | null;
  vetoed_at: string | null;
};

export type DismissedSeriesResponse = {
  user: DismissedUserRow[];
  engine: DismissedEngineRow[];
};

export const api = {
  health: () => get<{ status: string; truelayer_configured: boolean }>("/health"),
  getProfile: () => get<UserProfile>("/profile"),
  updateProfile: async (full_name: string, postcode?: string, complete = true): Promise<UserProfile> => {
    const body: Record<string, unknown> = { full_name, complete };
    if (postcode !== undefined) body.postcode = postcode;
    const res = await fetch(`${API_BASE}/profile`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "Failed to save");
    return data as UserProfile;
  },
  fuelNearby: (opts: { grade: string; paid?: number; lat?: number; lng?: number; radiusKm?: number }) => {
    const p = new URLSearchParams({ grade: opts.grade });
    if (opts.paid !== undefined) p.set("paid", String(opts.paid));
    if (opts.lat !== undefined) p.set("lat", String(opts.lat));
    if (opts.lng !== undefined) p.set("lng", String(opts.lng));
    if (opts.radiusKm !== undefined) p.set("radius_km", String(opts.radiusKm));
    return get<FuelNearby>(`/fuel/nearby?${p.toString()}`);
  },
  scanReceipt: async (image: string): Promise<Basket> => {
    const res = await fetch(`${API_BASE}/baskets/scan-receipt`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ image }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "Couldn't scan that receipt");
    return data as Basket;
  },
  listBaskets: () => get<Basket[]>("/baskets"),
  basketInsights: () => get<BasketInsights>("/baskets/insights"),
  getBasket: (id: string) => get<Basket>(`/baskets/${encodeURIComponent(id)}`),
  deleteBasket: (id: string) =>
    fetch(`${API_BASE}/baskets/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: authHeaders(),
    }).then((r) => toJson<{ ok: boolean }>(r)),
  accounts: () => get<Account[]>("/accounts"),
  syncAccounts: () => post<{ message: string; total_accounts: number }>("/accounts/sync"),
  transactions: (accountId: string, opts?: {
    page?: number; pageSize?: number; q?: string; category?: string; days?: number;
    txnType?: "debit" | "credit";
  }) => {
    const p = new URLSearchParams();
    if (opts?.page) p.set("page", String(opts.page));
    if (opts?.pageSize) p.set("page_size", String(opts.pageSize));
    if (opts?.q) p.set("q", opts.q);
    if (opts?.category) p.set("category", opts.category);
    if (opts?.days) p.set("days", String(opts.days));
    if (opts?.txnType) p.set("txn_type", opts.txnType);
    const qs = p.toString();
    return get<PagedTransactions>(`/accounts/${accountId}/transactions${qs ? `?${qs}` : ""}`);
  },
  accountCategories: (accountId: string, txnType?: "debit" | "credit") =>
    get<AccountCategorySummary[]>(`/accounts/${accountId}/categories${txnType ? `?txn_type=${txnType}` : ""}`),
  kpis: () => get<KPIs>("/kpis"),
  safeToSpend: (opts?: { series?: boolean }) => get<SafeToSpend>(`/safe-to-spend${opts?.series ? "?include=series" : ""}`),
  paceDetail: (offset = 0) => get<PaceDetail>(`/pace/detail?offset=${offset}`),
  categorySignals: (offset = 0) => get<CategorySignals>(`/spend/category-signals?offset=${offset}`),
  spendVerdict: (offset = 0) => get<SpendVerdict>(`/spend/verdict?offset=${offset}`),
  dismissUnresolvedAsk: (txnId: string) =>
    post<{ ok: boolean }>("/spend/verdict/dismiss-unresolved", { txn_id: txnId }),
  cashflow: () => get<CashflowData>("/cashflow"),
  valueDelivered: () => get<ValueDelivered>("/value-delivered"),
  getMirror: (refresh = false) =>
    get<MirrorPortrait>(`/mirror${refresh ? "?refresh=1" : ""}`),
  setMirrorChoice: (trait_id: string, choice: "keep" | "change") =>
    post<{ ok: boolean; trait_id: string; choice: string }>("/mirror/choice", { trait_id, choice }),
  transportSummary: () => get<TransportSummary>("/transport/summary"),
  oldestTransaction: () => get<{ date: string | null }>("/transactions/oldest"),
  goalsSummary: () => get<{ goals: GoalSummary[] }>("/goals/summary"),
  // 365 is a deliberate default, not a leftover — see lib/useAllTransactions.ts's
  // module-cache comment for the window audit behind it (SpendTrends'
  // PeriodCompareWidget only ever needs ~6 pay periods back, but the
  // AccountsPage rule-builder's match-preview pool wants as much real
  // history as it can get).
  allTransactions: (days = 365) => get<Transaction[]>(`/transactions?days=${days}`),
  dismissRecurring: (key: string) => post<{ ok: boolean }>("/cashflow/dismiss-recurring", { key }),
  skipUpcomingOccurrence: (key: string, date: string) => post<{ ok: boolean }>("/cashflow/skip-occurrence", { key, date }),
  restoreRecurring: (key: string) => post<{ ok: boolean }>("/cashflow/restore-recurring", { key }),
  // "Set aside" (/planning/dismissed): the two provenances behind a
  // dismissed/vetoed recurring series never fully overlap in what they
  // store (see DismissedUserRow/DismissedEngineRow below), so the backend
  // hands back two separate arrays rather than one normalised shape.
  // Enrichment fields (display_name, bank, typical_amount, cadence_label,
  // last_seen) are nullable: a series the backend can't enrich still comes
  // back with its raw key so the row has something honest to show.
  dismissedSeries: () => get<DismissedSeriesResponse>("/dismissed-series"),
  // Quiet "Delete" affordance, both provenances: hides the row from this
  // list without touching the underlying exclusion (it was already out of
  // projections). hidden:false is the undo.
  hideDismissedSeries: (key: string, provenance: "user" | "engine", hidden: boolean) =>
    post<{ ok: boolean }>("/dismissed-series/hide", { key, provenance, hidden }),
  // Engine-row "Bring back": a user override of the recurring judge's own
  // veto, the series returns to projections. No corresponding "un-override"
  // endpoint exists, so this action's toast does not offer undo.
  overrideDismissedSeries: (key: string) => post<{ ok: boolean }>("/dismissed-series/override", { key }),
  editUpcoming: (params: { key: string; date: string; new_date?: string | null; new_amount?: number | null; scope: "one" | "future" }) =>
    post<{ ok: boolean }>("/cashflow/edit-upcoming", params),
  clearUpcomingOverride: (params: { key: string; date: string }) =>
    post<{ ok: boolean }>("/cashflow/clear-override", params),
  previewUpcomingRule: (params: { key: string; text: string; anchor_date: string }) =>
    post<{ ok: boolean; schedule?: Record<string, unknown>; label?: string; next_dates?: string[]; error?: string }>("/cashflow/preview-rule", params),
  applyUpcomingRule: (params: { key: string; schedule: Record<string, unknown> }) =>
    post<{ ok: boolean; label?: string }>("/cashflow/apply-rule", params),
  clearUpcomingRule: (params: { key: string }) =>
    post<{ ok: boolean }>("/cashflow/clear-rule", params),
  deleteUserAccount: async (): Promise<{ deleted: boolean }> => {
    const res = await fetch(`${API_BASE}/account`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ confirm: "DELETE" }),
    });
    if (!res.ok) throw new Error("Delete failed");
    return res.json();
  },
  insights: () => get<Insight[]>("/insights"),
  truelayerProviders: () => get<{ id: string; name: string; logo: string }[]>("/auth/truelayer/providers"),
  connectLink: (provider?: string) => get<{ auth_url: string }>(`/auth/truelayer/link${provider ? `?provider=${encodeURIComponent(provider)}` : ""}`),
  finexerProviders: () => get<{ id: string; name: string; logo: string }[]>("/auth/finexer/providers"),
  finexerConnectLink: (provider?: string) => get<{ auth_url: string; connection_id: string }>(`/auth/finexer/link${provider ? `?provider=${encodeURIComponent(provider)}` : ""}`),
  mockData: () => get<unknown>("/test/mock-data"),
  validateSession: () =>
    fetch(`${API_BASE}/auth/session/validate`, {
      method: "POST",
      headers: authHeaders(),
    }).then((r) => r.ok),
  patchTransaction: (id: string, data: { category: string; additional_ids?: string[] }) =>
    fetch(`${API_BASE}/transactions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(data),
    }).then((r) => toJson<PatchTransactionResult>(r)),
  similarTransactions: (id: string, scope: "all" | "future") =>
    get<Transaction[]>(`/transactions/${id}/similar?scope=${scope}`),
  // Global, paginated, searchable transaction list spanning every connected
  // source — backs the /transactions hub (Task 2). Read-only, no writes.
  // `from`/`to` (ISO dates) scope to a pay period as a removable chip on the
  // hub — mirrors backend/app/routers/transactions.py's `from`/`to` query
  // params field-for-field. Both optional; omitted means all history.
  transactionsSearch: (params: { q?: string; page?: number; page_size?: number; category?: string; categories?: string[]; merchants?: string; days?: number; from?: string; to?: string; txn_type?: "debit" | "credit" } = {}) => {
    const p = new URLSearchParams();
    if (params.q) p.set("q", params.q);
    if (params.page) p.set("page", String(params.page));
    if (params.page_size) p.set("page_size", String(params.page_size));
    // `categories` is the repeated-query-param form (one `categories=` per
    // name, no delimiter) — a custom category name can legally contain a
    // comma, so this is the only unambiguous way to send several names at
    // once (e.g. a "money you moved" row spanning Savings/Transfer/custom
    // pots). Wins server-side over `category` when present and non-empty.
    if (params.categories && params.categories.length > 0) {
      for (const c of params.categories) p.append("categories", c);
    } else if (params.category) {
      p.set("category", params.category);
    }
    if (params.merchants) p.set("merchants", params.merchants);
    if (params.days) p.set("days", String(params.days));
    if (params.from) p.set("from", params.from);
    if (params.to) p.set("to", params.to);
    if (params.txn_type) p.set("txn_type", params.txn_type);
    const qs = p.toString();
    return get<PagedTransactions>(`/transactions/search${qs ? `?${qs}` : ""}`);
  },
  // The movement fork of the teaching sheet (ENGINE.md Destination Rule) —
  // POST /transactions/{id}/resolve-movement. See backend/app/routers/
  // transactions.py:resolve_movement for the full resolution contract.
  resolveMovement: (id: string, body: {
    resolution: "mine-here" | "mine-goal" | "mine-offline" | "someone-else" | "spending";
    goal_id?: string;
    offline_pot_name?: string;
    note?: string;
    category?: string;
  }) =>
    fetch(`${API_BASE}/transactions/${encodeURIComponent(id)}/resolve-movement`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    }).then((r) => toJson<ResolveMovementResult>(r)),
  syncAll: () => post<{ message: string }>("/accounts/sync", {}),
  autoCategorise: () => post<{ message: string }>("/transactions/auto-categorise", {}),
  /** `context` (added 2026-08-25) is LLM grounding ONLY — e.g. "Planning
   * screen: £165 free · 4 days left" — passed as its own field, NEVER
   * concatenated into `question`. The backend's deterministic gates
   * (`_extract_amount`, the spend/planning/debt domain router's tier-1
   * checks, `_is_out_of_scope`, `_is_tax_question`) all read `question`
   * verbatim; folding a context string like a bare "£165" into it makes an
   * amount-free question look amount-bearing and silently breaks routing.
   * See PennyConversation.tsx's `send()` for the one call site that uses
   * this, and its header comment for the incident this fixes.
   *
   * `screen` (added 2026-08-26) is a DIFFERENT kind of context from
   * `context` above, and the two are not interchangeable: `context` is a
   * one-shot summary sent only on the first request of a screen's session
   * (deliberately, per its own comment); `screen` is cheap structured data
   * (one of PennyAskContext's enum values, e.g. "planning"/"spend") sent on
   * EVERY request while the sheet is open, because any question mid-
   * conversation can reference "this page" and the backend needs to know
   * what that page is each time, not just at the start. See
   * PennyConversation.tsx's `ask()`/`send()` for the call site. */
  // A hand-rolled fetch, not the plain `post<T>` helper: a 402 here carries
  // a STRUCTURED `detail` object (`{code, used, limit, resets_on, tier}`),
  // not the human string every other `detail` on this file is. `post<T>`'s
  // generic `throw new Error(`${status} ${statusText}`)` would lose that
  // shape entirely, and PennyConversation.tsx's resting-composer flow needs
  // it (see PennyLimitError above) to know the limit/reset date without a
  // second round-trip to /subscription.
  canI: async (
    question: string,
    history?: Array<{ role: "user" | "assistant"; content: string }>,
    context?: string,
    screen?: string
  ): Promise<CanIResponse> => {
    const res = await fetch(`${API_BASE}/can-i`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ question, history, context, screen }),
    });
    if (res.status === 402) {
      let detail: unknown = null;
      try {
        detail = (await res.json())?.detail;
      } catch {
        /* body wasn't JSON — fall through to the generic error below */
      }
      if (detail && typeof detail === "object" && (detail as { code?: string }).code === "PENNY_LIMIT_REACHED") {
        throw new PennyLimitError(detail as { used: number; limit: number; resets_on: string; tier: string });
      }
      throw new Error("402 Payment Required");
    }
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
  },
  // POST /penny/chip — cheap, engine-answered chip questions (see
  // lib/pennyScreenConfig.tsx's `chipId` and CanISuggestionChip's `chip_id`
  // above). Never counts against the Penny message allowance. Returns
  // `null` on a 404 (unknown chip id — an older/rolling backend, or a chip
  // id this frontend build knows about that the deployed API doesn't yet)
  // so every call site can fall back to an ordinary api.canI() round-trip
  // the same way a `kind: "llm"` response asks them to. See
  // PennyConversation.tsx's `sendChip`.
  pennyChip: async (
    chip_id: string,
    params?: Record<string, unknown>,
    screen?: string
  ): Promise<PennyChipResponse | null> => {
    const res = await fetch(`${API_BASE}/penny/chip`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ chip_id, params, screen }),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
  },
  // Confirmed (possibly user-edited) "what if" scenario items -> full
  // deterministic projection + one LLM-composed headline. See
  // backend/app/routers/scenario.py's /scenario/run for the validation and
  // simulate() call this wraps; up to 10 items, backend caps to 3 and
  // returns the rest in `rejected` with a plain-English reason each.
  scenarioRun: (items: ScenarioItem[]) =>
    post<ScenarioRunResponse>("/scenario/run", { items }),
  // May 404 until the backend ships it — every caller wraps this in .catch()
  // and treats a failure as "no suggestions yet" (empty chips, no context line).
  canISuggestions: () => get<CanISuggestions>("/can-i/suggestions"),
  // Agent mode v1 — Confirm/Cancel on a ProposalConfirmCard. Both routed
  // through `toJson` (not the plain `post` helper) so an expired/cancelled/
  // already-actioned proposal rejects with the backend's own human `detail`
  // string rather than a bare "409 Conflict" — PennyConversation.tsx renders
  // that string verbatim rather than inventing its own error copy.
  // Idempotent server-side per the contract; PennyConversation.tsx also
  // guards double-taps client-side (a proposal card disables itself the
  // instant Confirm is pressed, before this call even starts).
  executePennyProposal: (proposalId: string) =>
    fetch(`${API_BASE}/penny/proposals/${encodeURIComponent(proposalId)}/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
    }).then((r) => toJson<{ ok: boolean; result?: unknown }>(r)),
  cancelPennyProposal: (proposalId: string) =>
    fetch(`${API_BASE}/penny/proposals/${encodeURIComponent(proposalId)}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
    }).then((r) => toJson<{ ok: boolean }>(r)),
  // Agent mode v1's one-time consent moment (ConsentCard). Records consent;
  // preferences then carry a `penny_agent_consent` timestamp (see
  // getPreferences below). No corresponding revoke/toggle-off endpoint is
  // in the contract yet — SettingsPage.tsx renders that state read-only
  // until one exists (flagged there and in this feature's own report).
  grantPennyAgentConsent: () => post<{ ok: boolean }>("/penny/agent-consent", {}),
  listCommitments: () => get<{ items: Commitment[] }>("/commitments"),
  createCommitment: (body: {
    name: string;
    amount: number;
    target_date: string;
    /** Goals v2 — multiple pots, each with a count-existing choice. */
    funding_pots?: { account_id: string; count_existing: boolean }[];
    /** @deprecated Single-pot shape — prefer funding_pots. */
    funding_account_id?: string | null;
    source?: "manual" | "can_i";
  }) => post<Commitment>("/commitments", body),
  updateCommitment: (id: string, body: {
    name?: string;
    amount?: number;
    target_date?: string;
    /** Goals v2 — replaces the pot set; baselines re-capture server-side. */
    funding_pots?: { account_id: string; count_existing: boolean }[];
    /** @deprecated Single-pot shape — prefer funding_pots. */
    funding_account_id?: string | null;
    status?: "active" | "done" | "cancelled";
    contribute_delta?: number;
  }) =>
    fetch(`${API_BASE}/commitments/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    }).then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return r.json();
    }) as Promise<Commitment>,
  previewCommitment: (
    amount: number,
    target_date: string,
    funding_pots?: { account_id: string; count_existing: boolean }[],
    commitment_id?: string,
  ) =>
    post<CommitmentPreview>("/commitments/preview", {
      amount,
      target_date,
      ...(funding_pots && funding_pots.length > 0 ? { funding_pots } : {}),
      ...(commitment_id ? { commitment_id } : {}),
    }),
  cancelCommitment: (id: string) =>
    fetch(`${API_BASE}/commitments/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: authHeaders(),
    }).then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    }),

  // Allocations — per-pay-period envelopes. See the `Allocation` type for
  // the remaining-vs-amount distinction; every read here is the enriched
  // server shape, no client-side fill/remaining maths.
  // Wrapped in `items`, same shape as GET /commitments (verified live
  // 2026-08-29 against the real endpoint, NOT a bare array).
  listAllocations: () => get<{ items: Allocation[] }>("/allocations").then((d) => d.items),
  // GET /allocations/fill-candidates — powers the "which payment fills it?"
  // picker step, own accounts only, most-recent series first.
  allocationFillCandidates: (accountId: string) =>
    get<{ items: FillCandidate[] }>(`/allocations/fill-candidates?account_id=${encodeURIComponent(accountId)}`)
      .then((d) => d.items),
  createAllocation: (body: {
    name: string;
    amount_per_period: number;
    fill_account_id: string;
    match_type: "description_equals" | "description_contains";
    match_value: string;
    recurrence: "every_period" | "once";
    /** Optional — date (YYYY-MM-DD). Omit to default to the current pay
     * period's start. */
    effective_from?: string;
    /** Optional — defaults server-side to the cleaned match_value. */
    fill_display_name?: string;
  }) => post<Allocation>("/allocations", body),
  updateAllocation: (id: string, body: {
    name?: string;
    amount_per_period?: number;
    fill_account_id?: string;
    match_type?: "description_equals" | "description_contains";
    match_value?: string;
    fill_display_name?: string;
    effective_from?: string;
    recurrence?: "every_period" | "once";
    active?: boolean;
  }) =>
    fetch(`${API_BASE}/allocations/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    }).then((r) => toJson<Allocation>(r)),
  deleteAllocation: (id: string) =>
    fetch(`${API_BASE}/allocations/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: authHeaders(),
    }).then((r) => toJson<{ ok: boolean }>(r)),

  getDebtPlanSummary: () => get<DebtPlanSummary>("/debt-plan/summary"),
  // offset: 0 = current pay period (default), negative = prior closed
  // periods — scopes the Spend page banner's count to the requested period
  // (a series counts only if at least one of its transactions falls inside
  // it). The review-sheet list (getMiscategorised, below) stays all-time.
  // pair_count — additive: suggested cross-account transfer pairs (see
  // getTransferPairSuggestions below) with a leg dated inside the requested
  // period. Folds into the Spend banner's total alongside `count`.
  // review_total — additive, all-time: mirrors exactly what the review sheet
  // shows (series + pairs, uncapped-series-count + capped-pairs-count).
  // Authoritative for the Spend banner when present; older cached payloads
  // without it fall back to the period-scoped count/pair_count above.
  getMiscategorisedCount: (offset = 0) => get<{ count: number; ids: string[]; pair_count?: number; review_total?: number }>(`/transactions/miscategorised-count?offset=${offset}`),
  getMiscategorised: () =>
    get<{
      items: {
        id: string;
        ids: string[];
        count: number;
        series_key: string;
        merchant_name: string | null;
        description: string | null;
        amount: number;
        amount_min: number | null;
        amount_max: number | null;
        date: string;
        first_date: string | null;
        currency: string;
        category: string | null;
        transaction_type: string;
        /** The account this series left from — optional/additive, absent on
         *  a payload cached before this field existed. */
        account_id?: string;
        /** The individual payments this series groups (count > 1 rows) —
         *  optional/additive, backs the review sheet's "see the payments"
         *  disclosure. Absent on an older payload just hides that disclosure. */
        members?: {
          id: string;
          date: string;
          amount: number;
          account_id: string;
          description: string | null;
          merchant_name: string | null;
        }[];
        /** Why this row was flagged as an own-transfer — optional/additive,
         *  absent on a payload cached before this field existed. */
        reason?: { kind: "name" } | { kind: "account"; account_id: string };
      }[];
    }>("/transactions/miscategorised"),
  dismissMiscategorised: (id: string) => post<{ ok: boolean }>(`/transactions/${id}/dismiss-miscategorised`, {}),
  dismissMiscategorisedSeries: (seriesKey: string) =>
    post<{ ok: boolean }>("/transactions/dismiss-miscategorised-series", { series_key: seriesKey }),
  // Cross-account transfer-pair suggestions — companion to the
  // miscategorised-transfers guardrail above. A candidate pair the sync-time
  // byte-identical matcher missed (different descriptions on the two legs);
  // confirming teaches the engine the description PAIR so future occurrences
  // auto-match at the next sync.
  getTransferPairSuggestions: () => get<{ items: TransferPairSuggestion[] }>("/transactions/transfer-pair-suggestions"),
  confirmTransferPair: (creditId: string, debitId: string) =>
    post<{ ok: boolean; credit_category: string; debit_category: string; learned: boolean }>(
      "/transactions/confirm-transfer-pair",
      { credit_id: creditId, debit_id: debitId },
    ),
  dismissTransferPair: (pairKey: string) =>
    post<{ ok: boolean }>("/transactions/dismiss-transfer-pair", { pair_key: pairKey }),
  savingsInsights: () => get<SavingsInsights>("/savings/insights"),
  saveSavingsGoal: (goal: SavingsGoalInput) =>
    fetch(`${API_BASE}/savings/goal`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(goal),
    }).then((r) => toJson<SavingsInsights>(r)),
  deleteSavingsGoal: () =>
    fetch(`${API_BASE}/savings/goal`, {
      method: "DELETE",
      headers: authHeaders(),
    }).then((r) => toJson<{ configured: boolean }>(r)),
  addSavingsManualAccount: (body: { name: string; balance: number }) =>
    fetch(`${API_BASE}/savings/manual-account`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    }).then((r) => toJson<SavingsInsights>(r)),
  updateSavingsManualAccount: (id: string, body: { name?: string; balance?: number }) =>
    fetch(`${API_BASE}/savings/manual-account/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    }).then((r) => toJson<SavingsInsights>(r)),
  deleteSavingsManualAccount: (id: string) =>
    fetch(`${API_BASE}/savings/manual-account/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: authHeaders(),
    }).then((r) => toJson<SavingsInsights>(r)),
  getSavingsPlan: () => get<{ plan: SavingsPlan | null }>("/savings/plan"),
  saveSavingsPlan: (plan: SuggestedPlan) =>
    fetch(`${API_BASE}/savings/plan`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(plan),
    }).then((r) => toJson<{ plan: SavingsPlan | null }>(r)),
  addSavingsPlanMilestones: (plan: SuggestedPlan) =>
    fetch(`${API_BASE}/savings/plan/milestones`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(plan),
    }).then((r) => toJson<{ plan: SavingsPlan | null; added: number }>(r)),
  toggleSavingsPlanStep: (stepId: string, done: boolean) =>
    fetch(`${API_BASE}/savings/plan/step/${encodeURIComponent(stepId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ done }),
    }).then((r) => toJson<{ plan: SavingsPlan | null }>(r)),
  deleteSavingsPlanStep: (stepId: string) =>
    fetch(`${API_BASE}/savings/plan/step/${encodeURIComponent(stepId)}`, {
      method: "DELETE",
      headers: authHeaders(),
    }).then((r) => toJson<{ plan: SavingsPlan | null }>(r)),
  deleteSavingsPlan: () =>
    fetch(`${API_BASE}/savings/plan`, {
      method: "DELETE",
      headers: authHeaders(),
    }).then((r) => toJson<{ plan: SavingsPlan | null }>(r)),
  getPreferences: () => get<{
    hide_net_worth: boolean;
    dark_mode?: boolean;
    notification_prefs?: NotificationPrefs;
    income_bracket?: string;
    income_value?: number;
    pension_annual?: number;
    has_child_benefit?: boolean;
    home_pinned_accounts?: string[];
    home_pinned_cards?: string[];
    recurring_categories?: string[];
    dismissed_recurring?: string[];
    spend_widgets?: string[] | null;
    home_pinned_widget?: string | null;
    debt_burndown_overrides?: DebtBurndownOverrides | null;
    cover_plan_excluded_accounts?: string[];
    /** ISO timestamp of when the user accepted Penny's one-time agent-mode
     * consent (POST /penny/agent-consent), or null/absent if they never
     * have. SettingsPage.tsx reads this to reflect consent state; see that
     * row's own comment for why it's currently read-only. */
    penny_agent_consent?: string | null;
  }>("/preferences"),
  getTaxAnnualisedIncome: () => get<{ annualised_income: number | null }>("/tax/annualised-income"),
  updatePreferences: (body: Partial<{
    hide_net_worth: boolean;
    dark_mode: boolean;
    pay_period_config: unknown;
    notification_prefs: NotificationPrefs;
    income_bracket: string;
    income_value: number;
    pension_annual: number;
    has_child_benefit: boolean;
    home_pinned_accounts: string[];
    home_pinned_cards: string[];
    recurring_categories: string[];
    spend_widgets: string[];
    home_pinned_widget: string | null;
    debt_burndown_overrides: DebtBurndownOverrides | null;
    cover_plan_excluded_accounts: string[];
  }>) =>
    fetch(`${API_BASE}/preferences`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    }).then((r) => toJson<{ hide_net_worth: boolean; dark_mode?: boolean }>(r)),
  getCategories: () => get<CategoriesResponse>("/categories"),
  addCategory: (name: string, kind: CategoryKind = "discretionary") =>
    post<CategoriesResponse>("/categories", { name, kind }),
  deleteCategory: (name: string) =>
    fetch(`${API_BASE}/categories/${encodeURIComponent(name)}`, {
      method: "DELETE",
      headers: authHeaders(),
    }).then((r) => toJson<{ deleted: string }>(r)),
  getChatSession: () => get<{ session_id: string; messages: { role: string; content: string }[] }>("/debt/chat/session"),
  newChatSession: () => post<{ session_id: string; messages: [] }>("/debt/chat/new", {}),
  // Budget-page API functions (getBudgets/setBudgets/budgetChat/*BudgetChatSession/
  // budgetPaceProfile) removed 2026-08-30 (owner decision, option C) — the
  // /budget page and its backend router were retired as zombie code.
  syncHistory: () => post<{ message: string; total_accounts: number }>("/accounts/sync-history"),
  deleteAccount: (accountId: string) =>
    fetch(`${API_BASE}/accounts/${encodeURIComponent(accountId)}`, {
      method: "DELETE",
      headers: authHeaders(),
    }).then((r) => toJson<{ deleted: string }>(r)),

  // Offline (manually-tracked) accounts
  manualAccounts: () => get<ManualAccount[]>("/manual-accounts"),
  createManualAccount: (body: { name: string; balance: number; account_type: ManualAccountType }) =>
    post<ManualAccount>("/manual-accounts", body),
  updateManualAccount: (id: string, body: { name?: string; balance?: number; account_type?: ManualAccountType }) =>
    fetch(`${API_BASE}/manual-accounts/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    }).then((r) => toJson<ManualAccount>(r)),
  deleteManualAccount: (id: string) =>
    fetch(`${API_BASE}/manual-accounts/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: authHeaders(),
    }).then((r) => toJson<{ deleted: string }>(r)),

  // Offline-account ledger (hand-added + rule-posted entries)
  manualTransactions: (accountId: string) =>
    get<Transaction[]>(`/manual-accounts/${encodeURIComponent(accountId)}/transactions`),
  addManualTransaction: (accountId: string, body: { description: string; amount: number; transaction_type: "credit" | "debit"; date?: string }) =>
    post<Transaction>(`/manual-accounts/${encodeURIComponent(accountId)}/transactions`, body),
  updateManualTransaction: (accountId: string, txId: string, body: Partial<{ description: string; amount: number; transaction_type: "credit" | "debit"; date: string }>) =>
    fetch(`${API_BASE}/manual-accounts/${encodeURIComponent(accountId)}/transactions/${encodeURIComponent(txId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    }).then((r) => toJson<Transaction>(r)),
  deleteManualTransaction: (accountId: string, txId: string) =>
    fetch(`${API_BASE}/manual-accounts/${encodeURIComponent(accountId)}/transactions/${encodeURIComponent(txId)}`, {
      method: "DELETE",
      headers: authHeaders(),
    }).then((r) => toJson<{ deleted: string }>(r)),

  // Transaction-mirror rules
  manualAccountRules: () => get<ManualAccountRule[]>("/manual-account-rules"),
  createManualAccountRule: (body: {
    name: string; target_account_id: string;
    match_type: RuleMatchType; match_value: string; sign: RuleSign;
    source_account_id?: string | null;
    match_field?: RuleMatchField | null; backfill?: boolean;
  }) => post<ManualAccountRule>("/manual-account-rules", body),
  updateManualAccountRule: (id: string, body: Partial<{
    name: string; match_type: RuleMatchType; match_value: string; sign: RuleSign; active: boolean;
    source_account_id: string | null;
    match_field: RuleMatchField | null; backfill: boolean;
  }>) =>
    fetch(`${API_BASE}/manual-account-rules/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    }).then((r) => toJson<ManualAccountRule>(r)),
  deleteManualAccountRule: (id: string) =>
    fetch(`${API_BASE}/manual-account-rules/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: authHeaders(),
    }).then((r) => toJson<{ deleted: string }>(r)),

  // Yapily (UK open banking)
  yapilyInstitutions: (country = "GB") =>
    get<{ id: string; name: string; logo: string; countries: string[] }[]>(`/auth/yapily/institutions?country=${country}`),
  yapilyRequisition: (institution_id: string) =>
    post<{ link: string; requisition_id: string }>("/auth/yapily/requisition", { institution_id }),
  yapilySync: () => post<{ message: string }>("/yapily/sync", {}),
  deleteYapilyConnection: (consentToken: string) =>
    fetch(`${API_BASE}/yapily/connections/${encodeURIComponent(consentToken)}`, {
      method: "DELETE",
      headers: authHeaders(),
    }).then((r) => toJson<{ deleted: string }>(r)),

  // Mono (Kenya open banking)
  monoPublicKey: () => get<{ public_key: string }>("/auth/mono/public-key"),
  monoExchange: (code: string) => post<{ message: string; account_id: string }>("/auth/mono/exchange", { code }),
  monoSync: () => post<{ message: string }>("/mono/sync", {}),
  getMonoAccounts: () => get<MonoAccount[]>("/mono/accounts"),
  getMonoTransactions: (id: string) => get<Transaction[]>(`/mono/accounts/${id}/transactions`),
  deleteMonoConnection: (id: string) =>
    fetch(`${API_BASE}/mono/connections/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    }).then((r) => toJson<{ deleted: boolean }>(r)),

  // M-Pesa CSV upload (legacy — kept for backward compat)
  uploadMpesa: (file: File, password?: string) => {
    const form = new FormData();
    form.append("file", file);
    if (password) form.append("password", password);
    return fetch(`${API_BASE}/mpesa/upload`, {
      method: "POST",
      headers: authHeaders(),
      body: form,
    }).then(async r => {
      if (!r.ok) {
        const text = await r.text();
        throw new Error(text || `${r.status}`);
      }
      return r.json() as Promise<{ inserted: number; account_id: string }>;
    });
  },

  // Generic bank statement upload (any bank, any region)
  uploadStatement: async (file: File, password?: string, region = "Kenya") => {
    const form = new FormData();
    form.append("file", file);
    if (password) form.append("password", password);
    form.append("region", region);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 150_000); // 2.5 min

    let r: Response;
    try {
      r = await fetch(`${API_BASE}/statement/upload`, {
        method: "POST",
        headers: authHeaders(),
        body: form,
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timer);
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new Error("The request timed out — the file may be too large or the server is busy. Please try again.");
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Network error: ${msg}`);
    }
    clearTimeout(timer);

    if (!r.ok) {
      let detail = `Server error (${r.status})`;
      try {
        const body = await r.json();
        if (body?.detail) detail = body.detail;
      } catch {
        try { detail = await r.text() || detail; } catch { /* ignore */ }
      }
      throw new Error(detail);
    }

    return r.json() as Promise<{
      inserted: number;
      skipped: number;
      account_id: string;
      bank_name: string;
      account_number: string;
      balance: number | null;
    }>;
  },

  // Investment accounts
  getInvestmentAccounts: () => get<InvestmentAccount[]>("/investment/accounts"),

  uploadInvestmentStatement: async (file: File, password?: string) => {
    const form = new FormData();
    form.append("file", file);
    if (password) form.append("password", password);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 150_000);
    let r: Response;
    try {
      r = await fetch(`${API_BASE}/investment/upload`, {
        method: "POST",
        headers: authHeaders(),
        body: form,
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timer);
      if (err instanceof DOMException && err.name === "AbortError") throw new Error("Request timed out. Please try again.");
      throw new Error(err instanceof Error ? err.message : String(err));
    }
    clearTimeout(timer);
    if (!r.ok) {
      let detail = `Server error (${r.status})`;
      try { const b = await r.json(); if (b?.detail) detail = b.detail; } catch { try { detail = await r.text() || detail; } catch { /* ignore */ } }
      throw new Error(detail);
    }
    return r.json() as Promise<{ account_id: string; provider: string; account_type: string; total_value: number; holdings_count: number }>;
  },

  getInvestmentHoldings: (id: string) =>
    get<InvestmentHolding[]>(`/investment/accounts/${encodeURIComponent(id)}/holdings`),

  deleteInvestmentAccount: (id: string) =>
    fetch(`${API_BASE}/investment/accounts/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: authHeaders(),
    }).then((r) => toJson<{ deleted: string }>(r)),

  refreshInvestmentPrices: async (id: string) => {
    const r = await fetch(`${API_BASE}/investment/accounts/${encodeURIComponent(id)}/refresh`, {
      method: "POST",
      headers: authHeaders(),
    });
    if (!r.ok) {
      const b = await r.json().catch(() => ({})) as Record<string, unknown>;
      throw new Error((b?.detail as string) || `Error ${r.status}`);
    }
    return r.json() as Promise<{ updated: number; new_total: number }>;
  },

  investmentNotes: (accountId: string) =>
    get<InvestmentNote[]>(`/investment/accounts/${encodeURIComponent(accountId)}/notes`),

  uploadInvestmentNote: async (accountId: string, file: File, password?: string) => {
    const form = new FormData();
    form.append("file", file);
    if (password) form.append("password", password);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 150_000);
    let r: Response;
    try {
      r = await fetch(`${API_BASE}/investment/accounts/${encodeURIComponent(accountId)}/notes/upload`, {
        method: "POST",
        headers: authHeaders(),
        body: form,
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timer);
      if (err instanceof DOMException && err.name === "AbortError") throw new Error("Request timed out. Please try again.");
      throw new Error(err instanceof Error ? err.message : String(err));
    }
    clearTimeout(timer);
    if (!r.ok) {
      let detail = `Server error (${r.status})`;
      try { const b = await r.json(); if (b?.detail) detail = b.detail; } catch { try { detail = await r.text() || detail; } catch { /* ignore */ } }
      throw new Error(detail);
    }
    return r.json() as Promise<{ note: InvestmentNote; account: InvestmentAccount }>;
  },

  uploadInvestmentNoteColdStart: async (file: File, password?: string): Promise<{ note: InvestmentNote; account: InvestmentAccount }> => {
    const form = new FormData();
    form.append("file", file);
    if (password) form.append("password", password);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 150_000);
    let r: Response;
    try {
      r = await fetch(`${API_BASE}/investment/notes/upload`, {
        method: "POST",
        headers: authHeaders(),
        body: form,
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timer);
      if (err instanceof DOMException && err.name === "AbortError") throw new Error("Request timed out. Please try again.");
      throw new Error(err instanceof Error ? err.message : String(err));
    }
    clearTimeout(timer);
    if (!r.ok) {
      let detail = `Server error (${r.status})`;
      try { const b = await r.json(); if (b?.detail) detail = b.detail; } catch { try { detail = await r.text() || detail; } catch { /* ignore */ } }
      throw new Error(detail);
    }
    return r.json() as Promise<{ note: InvestmentNote; account: InvestmentAccount }>;
  },

  deleteInvestmentNote: async (noteId: string) => {
    const r = await fetch(`${API_BASE}/investment/notes/${encodeURIComponent(noteId)}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    if (!r.ok) {
      const b = await r.json().catch(() => ({})) as Record<string, unknown>;
      throw new Error((b?.detail as string) || `Error ${r.status}`);
    }
    return r.json() as Promise<{ deleted: string; account: InvestmentAccount }>;
  },

  challenges: () => get<ChallengesData>("/challenges"),
  getRules: () => get<{ rules: { id: string; description: string; pattern: string; category: string; created_at: string }[] }>("/rules"),
  parseRule: (text: string) => post<{ pattern: string; category: string } | { error: string }>("/rules/parse", { text }),
  // `affected` — {id, previous_category} for every sibling transaction the
  // new rule recategorised (backend/app/services/categorisation.py
  // apply_single_rule), so TeachingSheet's "Undo" can revert each one
  // precisely instead of only the primary transaction (fix-round HIGH finding).
  addRule: (description: string, pattern: string, category: string) =>
    post<{
      id: string; description: string; pattern: string; category: string;
      affected: { id: string; previous_category: string | null }[];
    }>("/rules", { description, pattern, category }),
  setTransactionPlanned: (id: string, planned: boolean) =>
    fetch(`${API_BASE}/transactions/${encodeURIComponent(id)}/planned`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ planned }),
    }).then((r) => toJson<{ updated: string; planned: boolean }>(r)),
  deleteRule: (id: string) =>
    fetch(`${API_BASE}/rules/${encodeURIComponent(id)}`, { method: "DELETE", headers: authHeaders() }).then((r) => toJson<{ deleted: string }>(r)),
  getGrow: () => get<GrowView>("/grow"),
  getSavingsInsights: () => get<SavingsInsight[]>("/savings-insights"),
  /** "Your money shape" — the /spend/shape hero + "What works for you"
   *  evidence card (see shared/src/types.ts's MoneyShape for the full
   *  contract). Callers should tolerate a failed/rejected call by falling
   *  back to a synthetic `status: "thin"` shape rather than blocking the
   *  rest of the page — see MoneyShapeHero's own thin-state render and
   *  lib/moneyShape.ts's shared loader (SpendPage.tsx's closing
   *  SpendShapeCard and app/spend/shape/ShapePage.tsx both read through
   *  it). */
  getMoneyShape: () => get<MoneyShape>("/money-shape"),
  newInsightCount: () => get<{ count: number }>("/savings-insights/new-count"),
  markInsightsViewed: () => post<{ ok: boolean }>("/savings-insights/mark-viewed", {}),
  atRiskCount: () => get<{ count: number }>("/cashflow/at-risk-count"),
  getSpotlightInsight: () => get<SavingsInsight | null>("/savings-insights/spotlight"),
  dismissSpotlightInsight: (id: string) =>
    post<{ status: string }>(`/savings-insights/${encodeURIComponent(id)}/dismiss`, {}),
  /** Engagement signal for the copy-tier logic (Insights honesty review,
   *  Package A #1) — call once per card, the first time its evidence
   *  footer/workflow expands or its CTA is tapped. Idempotent server-side
   *  (first-write-wins), so a duplicate call from the same card is harmless. */
  markInsightOpened: (id: string) =>
    post<{ ok: boolean }>(`/savings-insights/${encodeURIComponent(id)}/opened`, {}),
  // researchInsight (the live "Find me alternatives" pull,
  // POST /savings-insights/{id}/research) is retired — owner decision
  // 2026-09-01: every category is researched weekly by the app now, with a
  // displayed TTL per entry (see SavingsInsight.content_valid_until /
  // expiry_line in shared/src/types.ts). There is no client-initiated
  // research action any more.
  pinSavingsInsight: (id: string) =>
    fetch(`${API_BASE}/savings-insights/${encodeURIComponent(id)}/pin`, {
      method: "PATCH",
      headers: authHeaders(),
    }).then((r) => toJson<{ pinned: boolean }>(r)),
  refreshSavingsInsights: () => post<{ message: string }>("/savings-insights/refresh", {}),
  getUnknownBills: () => get<{
    unknown_bills: { merchant_key: string; display_name: string; monthly_amount: number; occurrences: number }[];
    label_options: Record<string, { icon: string; label: string }>;
  }>("/savings-insights/unknown-bills"),
  labelBill: (merchant_key: string, category: string) =>
    post<{ message: string; category: string }>("/savings-insights/label", { merchant_key, category }),
  getWorkflows: () => get<Record<string, WorkflowDef>>("/savings-insights/workflows"),
  saveInsightContext: (insightId: string, context: Record<string, string>) =>
    fetch(`${API_BASE}/savings-insights/${encodeURIComponent(insightId)}/context`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ context }),
    }).then((r) => toJson<{ message: string }>(r)),
  getBillLabels: () => get<{ merchant_key: string; display_name: string; category: string; icon: string; label: string; is_skip: boolean }[]>("/savings-insights/labels"),
  deleteBillLabel: (merchant_key: string) =>
    fetch(`${API_BASE}/savings-insights/labels/${encodeURIComponent(merchant_key)}`, {
      method: "DELETE",
      headers: authHeaders(),
    }).then((r) => toJson<{ deleted: string }>(r)),
  getMpesaAccounts: () => get<MpesaAccount[]>("/mpesa/accounts"),
  getMpesaTransactions: (id: string) => get<Transaction[]>(`/mpesa/accounts/${id}/transactions`),
  getAccountRate: (accountId: string) => get<{ apr: number | null }>(`/accounts/${encodeURIComponent(accountId)}/rate`),
  setAccountRate: (accountId: string, apr: number | null) =>
    fetch(`${API_BASE}/accounts/${encodeURIComponent(accountId)}/rate`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ apr }),
    }).then((r) => toJson<{ apr: number | null }>(r)),

  getVapidPublicKey: () => get<{ public_key: string }>("/push/vapid-public-key"),

  subscribePush: (subscription: PushSubscriptionJSON) =>
    fetch(`${API_BASE}/push/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(subscription),
    }).then((r) => toJson<{ ok: boolean }>(r)),

  unsubscribePush: (endpoint: string) =>
    fetch(`${API_BASE}/push/subscribe`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ endpoint }),
    }).then((r) => toJson<{ ok: boolean }>(r)),

  // Native (Capacitor) push — APNs on iOS, FCM on Android. Mirrors
  // subscribePush/unsubscribePush above but keyed by raw device token
  // instead of a Web Push subscription. `platform` should be
  // Capacitor.getPlatform() from the caller; defaults to "ios" if omitted.
  registerApnsToken: (token: string, platform: string = "ios") =>
    fetch(`${API_BASE}/push/apns/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ token, platform }),
    }).then((r) => toJson<{ ok: boolean }>(r)),

  unregisterApnsToken: (token: string) =>
    fetch(`${API_BASE}/push/apns/register`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ token }),
    }).then((r) => toJson<{ ok: boolean }>(r)),

  // Native (Capacitor) push — FCM on Android. Mirrors
  // registerApnsToken/unregisterApnsToken above but for the Android
  // registration token emitted by @capacitor/push-notifications.
  registerFcmToken: (token: string, platform: string = "android") =>
    fetch(`${API_BASE}/push/fcm/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ token, platform }),
    }).then((r) => toJson<{ ok: boolean }>(r)),

  unregisterFcmToken: (token: string) =>
    fetch(`${API_BASE}/push/fcm/register`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ token }),
    }).then((r) => toJson<{ ok: boolean }>(r)),

  // Truthful read of native push registration state, keyed by the device's
  // own token, so the Settings toggle reflects "the backend actually has
  // this device" rather than just "the OS granted permission" (see
  // isCapacitorPushRegistered in lib/capacitorPush.ts).
  getNativePushStatus: (token: string) =>
    fetch(`${API_BASE}/push/native/status?token=${encodeURIComponent(token)}`, {
      headers: authHeaders(),
    }).then((r) => toJson<NativePushStatus>(r)),

  // Reports a native push registration failure the app cannot otherwise
  // surface, a release TestFlight build has no Safari Web Inspector, so a
  // `registrationError` or a timed-out `register()` call is invisible
  // without this. See reportPushDiagnostic in lib/capacitorPush.ts, which
  // wraps this call and swallows its own errors so a broken diagnostic
  // report can never itself become a second failure to chase.
  reportPushDiagnostic: (stage: string, detail: string, platform?: string) =>
    fetch(`${API_BASE}/push/client-diagnostic`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ stage, detail, platform }),
    }).then((r) => toJson<{ ok: boolean }>(r)),

  // Fires a one-off push at every device registered for this user (APNs,
  // FCM, web push). Rate limited server-side to 5/60s; the pre-check below
  // surfaces that as a distinguishable error before falling through to the
  // shared toJson(...) parsing so the Settings test flow can show a specific
  // "wait a minute" message instead of a generic failure.
  sendTestPush: async (): Promise<TestPushResult> => {
    const res = await fetch(`${API_BASE}/push/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
    });
    if (res.status === 429) throw new Error("429 Too Many Requests");
    return toJson<TestPushResult>(res);
  },

  // Linked sign-in identities (Settings → "Sign-in methods", Phase 1: Apple
  // only). See lib/nativeAuth.ts's linkAppleIdentity for the native-plugin
  // side of the link flow.
  getIdentities: () => get<IdentitiesResponse>("/auth/identities"),

  // 409 means that Apple ID is already linked to a different account —
  // pre-checked and thrown as a distinguishable Error before falling
  // through to the shared toJson(...) parsing, same pattern as the 429
  // pre-check in sendTestPush above, so the caller (nativeAuth.ts) can tell
  // "already linked elsewhere" apart from every other failure.
  linkAppleIdentity: async (
    identityToken: string
  ): Promise<{ ok: true; provider: "apple"; relay: boolean; email_masked: string }> => {
    const res = await fetch(`${API_BASE}/auth/identities/apple`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ identityToken }),
    });
    if (res.status === 409) throw new Error("409 Conflict");
    return toJson<{ ok: true; provider: "apple"; relay: boolean; email_masked: string }>(res);
  },

  unlinkAppleIdentity: () =>
    fetch(`${API_BASE}/auth/identities/apple`, {
      method: "DELETE",
      headers: authHeaders(),
    }).then((r) => toJson<{ ok: boolean; removed: number }>(r)),

  getSubscription: () => get<SubscriptionInfo>("/subscription"),

  getIncomeStreams: () => get<IncomeStream[]>("/income/streams"),
  confirmIncomeStream: (key: string) =>
    post<IncomeStream>("/income/streams/confirm", { key }),
  rejectIncomeStream: (key: string) =>
    post<{ ok: boolean }>("/income/streams/reject", { key }),
  setManualIncome: (schedule: IncomeSchedule, amount?: number) =>
    post<IncomeStream>("/income/streams/manual", { schedule, amount }),
  deleteIncomeStream: (key: string) =>
    fetch(`${API_BASE}/income/streams/${encodeURIComponent(key)}`, {
      method: "DELETE",
      headers: authHeaders(),
    }).then((r) => toJson<{ ok: boolean }>(r)),
  confirmPayday: () => post<ConfirmPaydayResponse>("/income/confirm-payday", {}),

  getToday: (paydayPreview?: boolean) =>
    get<TodayResponse>(paydayPreview ? "/today?payday_preview=1" : "/today"),
  getNeedleSummary: () => get<NeedleSummary>("/needle/summary"),
  getCardsStory: (which: "current" | "last" = "current") => get<CardsStory>(`/cards/story?which=${which}`),

  // Card terms — asked from the user; lookups only prefill a representative rate
  getCardTerms: () => get<CardTermsList>("/card-terms"),
  lookupCardTerms: (accountId: string) =>
    post<CardTermsLookup>(`/card-terms/${encodeURIComponent(accountId)}/lookup`),
  saveCardTerms: (accountId: string, body: CardTermsSaveBody) =>
    post<{ status: string; terms: CardTerms }>(`/card-terms/${encodeURIComponent(accountId)}`, body),
  getCycleStory: (which: "current" | "last", preview?: boolean, persona?: string) =>
    get<CycleStory>(
      persona
        ? `/cycle/story?which=${which}&persona=${encodeURIComponent(persona)}`
        : `/cycle/story?which=${which}${preview ? "&preview_close=1" : ""}`
    ),

  dismissTodayItem: (item_id: string) =>
    post<{ ok: boolean }>("/today/dismiss", { item_id }),

  // Planned one-off expenses
  addPlanned: (params: { name: string; amount: number; date: string; account_id?: string }) =>
    post<{ planned: PlannedExpense; impact: PlannedImpact }>("/planned", params),
  getPlanned: () => get<PlannedExpense[]>("/planned"),
  deletePlanned: (id: string) =>
    fetch(`${API_BASE}/planned/${encodeURIComponent(id)}`, { method: "DELETE", headers: authHeaders() }).then((r) => toJson<{ ok: boolean }>(r)),
  updatePlanned: (id: string, patch: { name?: string; amount?: number; date?: string; account_id?: string | null }) =>
    fetch(`${API_BASE}/planned/${encodeURIComponent(id)}`, { method: "PATCH", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(patch) }).then(r => { if (!r.ok) throw new Error("patch failed"); return r.json(); }) as Promise<PlannedExpense>,

  createCheckpoint: (ref: string, aim_amount?: number) =>
    post<Checkpoint>("/checkpoints", aim_amount == null ? { ref } : { ref, aim_amount }),
  listCheckpoints: () => get<{ checkpoints: ActiveAim[] }>("/checkpoints"),
  cancelCheckpoint: (id: string) =>
    fetch(`${API_BASE}/checkpoints/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: authHeaders(),
    }).then((r) => toJson<{ ok: boolean }>(r)),
  recordTrendIntent: (category: string, answer: "one_off" | "new_normal") =>
    post<{ ok: boolean }>("/trends/intent", { category, answer }),
  // ── Spend card lifecycle — the consent sheet's pre-file preview, and the
  // undo path for a filed "new normal" intent. Both additive/new; a backend
  // that hasn't shipped them yet 404s, which the callers handle gracefully
  // (IntentConsentSheet falls back to a generic line; SpendPage's undo
  // restores local state and shows an inline error). ─────────────────────
  intentPreview: (category: string) =>
    post<{ title: string; lines: string[] }>("/spend/intent-preview", { category }),
  deleteIntent: (category: string) =>
    fetch(`${API_BASE}/spend/intent/${encodeURIComponent(category)}`, {
      method: "DELETE",
      headers: authHeaders(),
    }).then((r) => toJson<{ ok: boolean }>(r)),

  // Private go-live readiness page (/ops/go-live) — owner-only, reads
  // TODO.md and docs/ straight from the repo; see backend/app/routers/ops.py.
  getGoLive: () => get<GoLiveResponse>("/ops/go-live"),
};
