import type { CycleStory } from "@/lib/api";

// Fixture CycleStory exercising every slide kind StoryPlayer can build:
// title → spending → whereItWent (5 ranked categories, biggest first, so
// the spotlight has a real "largest row" to find) → cards (material, with a
// 4-row breakdown mixing a curated-brand card that grew, one that shrank,
// an uncurated provider so the logo-fallback chip renders too, and a
// dormant £0 card so the smallest/furthest-out logo slot renders too) →
// win (streak) → close. Shape copied from lib/api.ts's CycleStory family.
export const MONTH_STORY_FIXTURE: CycleStory = {
  status: "ok",
  early_days: false,
  period: {
    start: "2026-07-28",
    end: "2026-08-27",
    closed: true,
    days_elapsed: 31,
    days_to_payday: 0,
  },
  chapters: {
    opening: { income_in: 3120, count: 2 },
    cliff: {
      week1_spend: 612,
      period_spend: 1487,
      week1_pct: 41,
      commitments: [{ payee: "Rent", total: 950 }],
    },
    switch: {
      week1_card_pct: 22,
      rest_card_pct: 61,
      switch_day: "2026-08-07",
    },
    spending: {
      total_spend: 1487,
      income_in: 3120,
      top_categories: [
        { category: "Groceries", total: 412 },
        { category: "Eating Out", total: 268 },
        { category: "Transport", total: 191 },
        { category: "Entertainment", total: 134 },
        { category: "Shopping", total: 98 },
      ],
    },
    cards: {
      present: true,
      material: true,
      new_spend: 623,
      payments: 540,
      delta: 83,
      share_of_spend: 0.42,
      // Exercises task C's per-card rows: a curated-brand card that grew
      // (neutral ink), a curated-brand card that shrank (Verified Emerald),
      // and an uncurated provider so the "no broken image" fallback chip
      // renders too. Plus a dormant card (new_spend 0) — compute_cycle_story
      // now returns ALL of a user's cards, not just the active ones, so the
      // logo cluster's smallest/furthest-out slot gets exercised here too.
      breakdown: [
        { account_id: "acc-amex", name: "Amex Platinum", provider: "AMEX", new_spend: 412, delta: 90 },
        { account_id: "acc-barclaycard", name: "Barclaycard", provider: "BARCLAYS", new_spend: 158, delta: -7 },
        { account_id: "acc-unknown", name: "Zopa Credit Card", provider: "Zopa", new_spend: 53, delta: 0 },
        { account_id: "acc-dormant", name: "Halifax Clarity", provider: "Halifax", new_spend: 0, delta: 0 },
      ],
    },
    moves: {
      card_feeding: { count: 3, total: 540 },
      ritual_saving: { count: 1, total: 200 },
      deliberate_saving: { count: 2, total: 350 },
      buffer_draws: { count: 0, total: 0 },
      other_shuffles: { count: 1, total: 60 },
    },
    keeping: { set_aside: 350, drawn_back: 0, external: 0, kept: 350 },
    close: { month_end_cash: 842, card_delta: 83, streak_weeks: 6 },
    self_facts: { traits: [], fired: {} },
  },
  narrative: {
    opening: "Your month opened with £3,120 in.",
    month: "A steady month, spending stayed close to plan.",
    moves: "You moved £350 to savings on purpose.",
    keeping: "You kept everything you set aside.",
    close: "You reached payday with £842 in hand.",
    self: "You've kept a weekly saving streak going for six weeks now, the longest yet.",
    source: "fixture",
  },
  cards_link: true,
  is_preview: false,
  persona: undefined,
  is_demo: true,
};
