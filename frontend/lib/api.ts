import { getToken } from "./auth";
import type {
  Account, Transaction, MonoAccount, MpesaAccount, KPIs, Insight,
  SavingsInsight, WorkflowStep, WorkflowDef, ChallengeProgress, Challenge,
  ChallengesData, InvestmentAccount, InvestmentHolding, InvestmentNote, BudgetItem,
  DebtInsights, DebtBurndown, UserPreferences, CategoryRule, BillLabel,
  ManualAccount, ManualAccountType, ManualAccountRule, RuleMatchType, RuleMatchField, RuleSign,
  SubscriptionInfo, GrowView,
} from "@wealth/shared";
export type {
  Account, Transaction, MonoAccount, MpesaAccount, KPIs, Insight,
  SavingsInsight, WorkflowStep, WorkflowDef, ChallengeProgress, Challenge,
  ChallengesData, InvestmentAccount, InvestmentHolding, InvestmentNote, BudgetItem,
  DebtInsights, DebtBurndown, UserPreferences, CategoryRule, BillLabel,
  ManualAccount, ManualAccountType, ManualAccountRule, RuleMatchType, RuleMatchField, RuleSign,
  SubscriptionInfo, GrowView,
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
  budget_alerts: boolean;
  goal_milestones: boolean;
  insights: boolean;
  period_digest: boolean;
  bill_alerts: boolean;
};

export type GoalSummary = {
  pillar: "debt" | "savings" | "budget";
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
  resolution: "mine-goal" | "mine-offline" | "someone-else" | "spending";
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
  } | null;
};

export type SpendVerdictMoved = {
  kind: "pots" | "credit_cards" | "investments";
  label: string;
  amount: number;
  payments_count: number;
  goal_names?: string[];
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
  | { status: "insufficient_data" }
  | {
      status: "ok";
      safe_to_spend: number;
      next_payday: string;
      days_until_payday: number;
      bills_total: number;
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

/** Hand-off from "Can I…?" — a ready-to-save commitment prefill. */
export type CanIOffer = {
  name: string;
  amount: number;
  target_date: string;
  per_period: number;
};

/** GET /can-i/suggestions — persistent, personalised chips for the bounded
 * Penny oracle conversation + prompt bar. Backend contract (may not be live
 * yet — every call site degrades to an empty/omitted read). */
export type CanISuggestionChip = { label: string };
export type CanISuggestions = {
  chips: CanISuggestionChip[];
  context_line: string;
};

/** POST /can-i response. `headline`/`facts`/`out_of_scope` are additive —
 * an older backend returns only `reply`/`offer`, and callers must degrade
 * gracefully (render `reply` as plain body text) when they're absent. */
export type CanIResponse = {
  reply: string;
  offer?: CanIOffer | null;
  headline?: string;
  facts?: string[];
  out_of_scope?: boolean;
};

export type MoneyBasic = {
  id: string;
  topic: string;
  icon: string;
  title: string;
  body: string;
  takeaway?: string;
  tax_year: string;
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
  from: MoveMapAccount & { safe_note: string };
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
};

export type CompanionItem = {
  id: string;
  type: "move" | "rhythm" | "celebration" | "info" | "needle" | "ask" | "cliff" | "trajectory" | "payday_plan" | "intent_pace";
  headline: string;
  body: string;
  action: CompanionAction | null;
  estimated: boolean;
  move_map?: MoveMap;
  moves?: PlanMove[];
  summary?: string;
  residual?: string;
  overflow_note?: string;
  income_note?: string;
  assumed_incomes?: { name: string; amount: number; expected_date: string }[];
  plan_dest?: PlanDest;
  covered?: boolean;
  sources_safe?: boolean;
  amount?: number;
  secondary_action?: CompanionAction | null;
  proposal?: PaydayProposal;
  // payday_plan fields — present when type === "payday_plan"
  total?: number;
  preview?: boolean;
  dests?: PaydayPlanDest[];
  salary?: PaydayPlanSalary;
  trimmed?: boolean;
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

// ── Debt Plan View (GET /debt-plan) ────────────────────────────────────────
export type DebtPlanRateSegment = {
  from: string;               // "YYYY-MM"
  until: string | null;       // "YYYY-MM" or null
  apr_pct: number | null;
  source: "promo" | "standard" | "unknown";
  kind: string | null;
};

export type DebtPlanMovement = {
  monthly: number | null;     // positive = balance coming down
  per_period: { start: string; end: string; net: number }[];
  periods_used: number;
  basis: string;
};

export type DebtPlanViewCard = {
  account_id: string;
  name: string;
  provider: string;
  balance: number;            // raw, negative = owed
  currency: string;
  debt: number;               // positive £ owed
  available: number | null;
  movement: DebtPlanMovement;
  rate_schedule: DebtPlanRateSegment[];
  payoff_month: string | null;         // "YYYY-MM"
  months_to_payoff: number | null;
  total_interest: number | null;       // null = never clears at current pace (no capped integral)
  monthly_interest_now: number;        // observed interest-charge debits, median monthly — never derived
  interest_observed_monthly: number;
  paying_interest: boolean;
  terms_contradiction: boolean;
  potential_monthly_interest: number;
  zero_interest_lines: number;
  first_interest_month: string | null; // "YYYY-MM"
  monthly_interest_at_first: number | null;
  flags: {
    terms_missing: boolean;
    standard_rate_missing: boolean;
    thin_history: boolean;
    promo_whole_balance_assumed: boolean;
    assumptions: string[];
  };
  near_term_source: "upcoming bills" | null;
  mapping_ambiguous: boolean;
  classification: "cleared_monthly" | "carried_zero" | "carried_interest" | "unclear" | null;
  classification_evidence: string[];
  usage: "clear_monthly" | "carry" | null;
  usage_conflict: boolean;
  balance_at_first_interest: number | null;
  near_term_bills: { name: string; amount: number; next_date: string; confidence: number; matched: number; occurrences: number }[];
};

export type DebtPlanScenarioB =
  | { months_sooner: null; interest_saved: null; note: string }
  | {
      debt_free_month: string | null;
      total_interest: number;                    // scenario's own interest to clear the pooled cards
      window_months: number | null;              // comparison window = scenario's payoff horizon
      as_is_interest_over_window: number | null; // as-is interest over that window, same pooled cards
      interest_saved: number | null;             // = as_is_interest_over_window − total_interest
      months_sooner: number | null;              // only when BOTH trajectories clear within cap
      as_is_clears: boolean;
      as_is_debt_free_month: string | null;
      pooled_count: number;
      pooled_nonclearing_count: number;
      covers_all_debt: boolean;
      assumption: string;
    };

export type DebtPlanRefinanceOption = {
  source_account_id: string;
  source_name: string;
  destination_account_id: string;
  destination_name: string;
  transferable: number;
  fee: number;
  interest_saved: number;
  net_saving: number;
  window_months: number;
  break_even_weeks: number | null;
  assumptions: string[];
};

export type DebtPlanTotals = {
  debt: number;
  debt_free_month: string | null;
  monthly_interest_now: number;   // Σ observed interest-charge debits across cards, never derived
  potential_monthly_interest: number;  // conditional: what balances WOULD cost at the rates on file
  interest_to_clear: number;      // interest summed ONLY over cards that clear at current pace
  nonclearing: { count: number; total_balance: number; monthly_interest_share: number };
  verdict: "good" | "drifting" | "bad";
  buckets?: {
    cleared_monthly: number;
    carried_zero: number;
    carried_interest: number;
    unclear: number;
    carried_total: number;
    float_total: number;
    carried_card_count: number;
    cleared_card_count: number;
  };
};

export type DebtPlanProjectionPoint = { month: string; total: number };
export type DebtPlanWin = { account_id: string; name: string; payoff_month: string; monthly: number };
export type DebtPlanExtraToClear = { amount: number; debt_free_month: string; horizon_months: number };
export type DebtPlanHistoryPoint = { month: string; total: number };
export type DebtPlanHistory = {
  points: DebtPlanHistoryPoint[];
  trend_3m: number;     // trend over CARRIED cards only
  trend_3m_all: number; // trend over all cards
  rising: boolean;
  assumptions: string[];
};
export type DebtPlanNarration = { text: string; source: "llm" | "fallback"; ask?: { account_id: string; name: string; provider: string; kind: string } | null };

export type DebtPlanView = {
  status: string;
  computed_at: string;
  horizon_months: number;
  cards: DebtPlanViewCard[];
  totals: DebtPlanTotals;
  scenario_b: DebtPlanScenarioB;
  refinance_options: DebtPlanRefinanceOption[];
  projection?: DebtPlanProjectionPoint[];
  whats_working?: DebtPlanWin[];
  extra_to_clear?: DebtPlanExtraToClear | null;
  history?: DebtPlanHistory;
  narration?: DebtPlanNarration | null;
  commitments_reserved?: { total_slice: number; count: number; period_label: string | null } | null;
};

// Lightweight summary variant of DebtPlanView (GET /debt-plan/summary) — totals buckets + per-card rate schedule only.
export type DebtPlanSummary = {
  totals: { buckets: { carried_total: number; float_total: number } };
  cards: { name: string; rate_schedule: { source: string; until: string | null }[] }[];
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
  allTransactions: (days = 365) => get<Transaction[]>(`/transactions?days=${days}`),
  dismissRecurring: (key: string) => post<{ ok: boolean }>("/cashflow/dismiss-recurring", { key }),
  skipUpcomingOccurrence: (key: string, date: string) => post<{ ok: boolean }>("/cashflow/skip-occurrence", { key, date }),
  restoreRecurring: (key: string) => post<{ ok: boolean }>("/cashflow/restore-recurring", { key }),
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
  transactionsSearch: (params: { q?: string; page?: number; page_size?: number; category?: string; merchants?: string; days?: number; from?: string; to?: string } = {}) => {
    const p = new URLSearchParams();
    if (params.q) p.set("q", params.q);
    if (params.page) p.set("page", String(params.page));
    if (params.page_size) p.set("page_size", String(params.page_size));
    if (params.category) p.set("category", params.category);
    if (params.merchants) p.set("merchants", params.merchants);
    if (params.days) p.set("days", String(params.days));
    if (params.from) p.set("from", params.from);
    if (params.to) p.set("to", params.to);
    const qs = p.toString();
    return get<PagedTransactions>(`/transactions/search${qs ? `?${qs}` : ""}`);
  },
  // The movement fork of the teaching sheet (ENGINE.md Destination Rule) —
  // POST /transactions/{id}/resolve-movement. See backend/app/routers/
  // transactions.py:resolve_movement for the full resolution contract.
  resolveMovement: (id: string, body: {
    resolution: "mine-goal" | "mine-offline" | "someone-else" | "spending";
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
  taxChat: (messages: { role: string; content: string }[]) =>
    post<{ reply: string }>("/chat/tax", { messages }),
  canI: (question: string, history?: Array<{ role: "user" | "assistant"; content: string }>) =>
    post<CanIResponse>("/can-i", { question, history }),
  // May 404 until the backend ships it — every caller wraps this in .catch()
  // and treats a failure as "no suggestions yet" (empty chips, no context line).
  canISuggestions: () => get<CanISuggestions>("/can-i/suggestions"),
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
  getDebtPlanView: () => get<DebtPlanView>("/debt-plan"),
  getDebtPlanSummary: () => get<DebtPlanSummary>("/debt-plan/summary"),
  // offset: 0 = current pay period (default), negative = prior closed
  // periods — scopes the Spend page banner's count to the requested period
  // (a series counts only if at least one of its transactions falls inside
  // it). The review-sheet list (getMiscategorised, below) stays all-time.
  getMiscategorisedCount: (offset = 0) => get<{ count: number; ids: string[] }>(`/transactions/miscategorised-count?offset=${offset}`),
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
      }[];
    }>("/transactions/miscategorised"),
  dismissMiscategorised: (id: string) => post<{ ok: boolean }>(`/transactions/${id}/dismiss-miscategorised`, {}),
  dismissMiscategorisedSeries: (seriesKey: string) =>
    post<{ ok: boolean }>("/transactions/dismiss-miscategorised-series", { series_key: seriesKey }),
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
    budget_widgets?: string[] | null;
    home_pinned_widget?: string | null;
    cover_plan_excluded_accounts?: string[];
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
    budget_widgets: string[];
    home_pinned_widget: string | null;
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
  getBudgets: () => get<{ budgets: { category: string; monthly_limit: number }[] }>("/budgets"),
  setBudgets: (budgets: { category: string; monthly_limit: number }[]) =>
    fetch(`${API_BASE}/budgets`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ budgets }),
    }).then((r) => toJson<{ budgets: { category: string; monthly_limit: number }[] }>(r)),
  budgetChat: (messages: { role: string; content: string }[], session_id?: string) =>
    post<{ reply: string; session_id?: string; suggested_budgets?: { category: string; monthly_limit: number }[] }>("/budget/chat", { messages, session_id }),
  getBudgetChatSession: () => get<{ session_id: string; messages: { role: string; content: string }[] }>("/budget/chat/session"),
  newBudgetChatSession: () => post<{ session_id: string; messages: [] }>("/budget/chat/new", {}),
  budgetPaceProfile: () => get<{ curves: Record<string, number[]>; sample_points: number; periods_analysed: number }>("/budget/pace-profile"),
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
  getDailyMoneyBasic: () => get<MoneyBasic>("/money-basics/daily"),
  getMoneyBasics: (topic?: string) =>
    get<{ items: MoneyBasic[]; tax_year: string }>(`/money-basics${topic ? `?topic=${encodeURIComponent(topic)}` : ""}`),
  getGrow: () => get<GrowView>("/grow"),
  getSavingsInsights: () => get<SavingsInsight[]>("/savings-insights"),
  newInsightCount: () => get<{ count: number }>("/savings-insights/new-count"),
  markInsightsViewed: () => post<{ ok: boolean }>("/savings-insights/mark-viewed", {}),
  atRiskCount: () => get<{ count: number }>("/cashflow/at-risk-count"),
  getSpotlightInsight: () => get<SavingsInsight | null>("/savings-insights/spotlight"),
  dismissSpotlightInsight: (id: string) =>
    post<{ status: string }>(`/savings-insights/${encodeURIComponent(id)}/dismiss`, {}),
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
};
