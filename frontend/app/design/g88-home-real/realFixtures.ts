// G88 real-data fixture module (single source, per CLAUDE.md: "confine
// every real figure to ONE clearly-commented fixture module so it can be
// swapped out in a single edit later"). Kevin's actual Home payload as of
// 2026-09-18 18:00 UTC, dumped from the live API to /tmp/g88_real.json and
// reshaped into the exact SafeToSpend / CompanionItem types SafeToSpendCard
// and HomeBrief's card components already consume. Every value below is
// copied verbatim, cross-checked field-by-field against that dump — nothing
// here is invented. If Kevin's figures need refreshing later, re-dump and
// replace only this file; nothing else in this preview should need to change.
//
// TO REMOVE REAL DATA: delete this file's contents and either point the
// preview at synthetic fixtures (see ../home-brief-cards/productionFixtures.ts
// for the pattern) or delete the g88-home-real route entirely.
import type { SafeToSpend, CompanionItem } from "@/lib/api";

// Kevin's data was captured Friday 2026-09-18 (verified: date -d 2026-09-18
// +%A). Baked as a label rather than computed from the visitor's clock so
// the preview always reads as the moment this snapshot was taken.
export const REAL_DATA_DATE_LABEL = "Friday 18 September";

export const REAL_SAFE_TO_SPEND: Extract<SafeToSpend, { status: "ok" }> = {
  status: "ok",
  calculation_version: 2,
  calculation_status: "complete",
  unavailable_components: [],
  safe_to_spend: 135.16,
  safe_to_spend_cash: 135.16,
  next_payday: "2026-09-25",
  days_until_payday: 7,
  bills_total: 248.84,
  pooled_transfers_excluded: 106.67,
  income_before_payday: 0,
  buffer: 0,
  state: "tight",
  short_reason: null,
  estimated: false,
  spendable_now: 493.6,
  lowest_projected_balance: 244.76,
  payday_income: 4800.47,
  card_debt: 24996.21,
  card_growth_total: 1089.67,
  card_new_spend_total: 1006.64,
  card_growth_reserved: 0,
  card_growth_wording: "carried",
  card_growth_due_date: null,
  commitments_reserved: 0,
  commitments_count: 0,
  commitments_reserved_period_label: null,
  allocations_reserved: 109.6,
  allocations_count: 2,
  last_synced: "2026-09-18T18:00:43.489000+00:00",
  // Present in the real dump (safe_to_spend.pace) and rendered by
  // SafeToSpendCard's own "£X/day until payday" footer line whenever
  // pace.state is one of comfortable/on_pace/ahead/early and
  // pace.sustainable is set — the throwaway pass dropped this field, which
  // would have silently hidden a real line the shipped card renders today.
  pace: {
    state: "ahead",
    pot: 135.16,
    days_left: 7,
    days_elapsed: 21,
    period_start: "2026-08-28",
    discretionary_so_far: 1227.22,
    sustainable: 19.31,
    actual: 58.44,
    period_allowance: 1362.38,
    notable_day: {
      date: "2026-09-11",
      weekday: "Friday",
      amount: 185.36,
      usual: 77.93,
      multiple: 2.4,
      top_categories: [
        { category: "Entertainment", total: 66.99 },
        { category: "Groceries", total: 65.03 },
        { category: "Transport", total: 22.35 },
      ],
    },
    split: {
      commitment_total: 2650.15,
      discretionary_total: 1227.22,
      non_spend_total: 7912.77,
      planned_total: 0,
      commitment_count: 23,
      discretionary_count: 48,
    },
  },
};

// The three live brief items exactly as companion.py emitted them —
// already CompanionItem-shaped, so no remapping was needed beyond the
// `as CompanionItem` cast TypeScript wants for the string-literal `type`.
// Verified verbatim against /tmp/g88_real.json's `today_items` array.
export const REAL_MOVE_ITEM = {
  id: "plan:2026-09-25:418164179c",
  type: "move",
  headline: "Move £30 to Premier Current Account",
  body: "£30 across 2 moves keeps everything clearing at Premier Current Account.",
  action: { label: "See what's due ›", route: "/upcoming" },
  estimated: false,
  brief_lead: { value: "£30", companion: "to Premier Current Account" },
  moves: [
    {
      headline: "Move £20 from Kevin Mbithi Maingi",
      amount: 20,
      move_map: {
        from: {
          account_id: "c82191f0743e6ea4d1e7c8e6cced6d64",
          name: "Kevin Mbithi Maingi",
          provider: "MONZO",
          balance: 90.18,
          safe_note: "Nothing due from this account before Monday",
          reserved_for_allocations: 59.64,
        },
        to: {
          account_id: "0aa08204bf059bcdf6266bd0f7c18383",
          name: "Premier Current Account",
          provider: "BARCLAYS",
          balance: 89.19,
          incoming: "£5 Renewal Cpm expected Monday",
        },
      },
    },
    {
      headline: "Move £10 from Main G",
      amount: 10,
      move_map: {
        from: {
          account_id: "ba_kchnfbr7DFQ5CVWEuLyQJcuOI",
          name: "Main G",
          provider: "Chase UK",
          balance: 24.0,
          safe_note: "Nothing due from this account before Monday",
          reserved_for_allocations: 0.0,
        },
        to: {
          account_id: "0aa08204bf059bcdf6266bd0f7c18383",
          name: "Premier Current Account",
          provider: "BARCLAYS",
          balance: 89.19,
          incoming: "£5 Renewal Cpm expected Monday",
        },
      },
    },
  ],
  summary: "£30 across 2 moves keeps everything clearing at Premier Current Account.",
  plan_dest: {
    account_id: "0aa08204bf059bcdf6266bd0f7c18383",
    name: "Premier Current Account",
    provider: "BARCLAYS",
    balance: 89.19,
    needs_total: 105,
    needs_by: "today",
    bills: [
      { label: "American Express", amount: 100, expected_date: "2026-09-09", key: "AMERICAN EXPRESS 3751-436040-41009", days_past_due: 9, can_skip: true },
      { label: "Renewal Cpm", amount: 5, expected_date: "2026-09-21" },
    ],
    is_overdraft: false,
  },
  covered: true,
  amount: 30,
  sources_safe: true,
  envelope_reserved: true,
  assumed_incomes: [],
} as unknown as CompanionItem;

export const REAL_CELEBRATION_ITEM = {
  id: "celebrate:plan:2026-09-25:397edc2734",
  type: "celebration",
  headline: "Sorted: THE NUMBER ONE is covered",
  body: "£152 of payments at THE NUMBER ONE are safe.",
  action: null,
  estimated: false,
  brief_lead: { value: "£152", companion: "held aside" },
} as unknown as CompanionItem;

export const REAL_TRAJECTORY_ITEM = {
  id: "trajectory:bad:2026-09",
  type: "trajectory",
  headline: "The cards aren't coming down at your current pace, £24,896 carried across 6 cards.",
  body: "£2,856 will still be on the Ibcm Platinum when its 0% ends in Jun 2027. From then it'd cost about £69 a month unless it's cleared or moved.",
  action: { label: "See the route ›", route: "/debt-plan" },
  estimated: false,
  brief_lead: { value: "£24,896", companion: "carried across 6 cards" },
} as unknown as CompanionItem;

export const REAL_ITEMS: CompanionItem[] = [REAL_MOVE_ITEM, REAL_CELEBRATION_ITEM, REAL_TRAJECTORY_ITEM];
