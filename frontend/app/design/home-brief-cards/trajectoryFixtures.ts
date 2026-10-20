import type { CompanionItem } from "@/lib/api";

/**
 * G103 — the debt-trajectory states, as the PRODUCTION card renders them.
 *
 * Every string below is a verbatim copy of what
 * `app.services.companion.trajectory_copy` returns for the scenario named in
 * each entry's `note`; nothing here is hand-written prose.
 *
 * This file is maintained BY HAND. There is no generator, so when the copy
 * changes you edit these entries yourself. Two backend tests are what keep
 * that honest, and they are the reason hand-maintenance is safe:
 * `test_the_design_preview_shows_the_real_copy` re-derives all eight
 * scenarios from the live function and fails on any drift, and
 * `test_the_preview_shows_every_state_the_gate_knows_about_and_no_others`
 * fails if a ninth is hand-added beside them. Run the backend suite after
 * touching either this file or `trajectory_copy`.
 *
 * The scenario is one carried portfolio of six cards totalling £24,926
 * (American Express £3,180, Barclaycard Platinum £8,420, MBNA £5,980, Halifax
 * Clarity £3,140, Virgin Money £2,706, Santander £1,500), which is the shape
 * of the real card that prompted G103. The states differ only in the
 * movement, how much history sits behind it, how many cards could be read,
 * whether interest is observed, and whether a 0% cliff is on file, so the
 * comparison isolates exactly what the item changes.
 *
 * These are `CompanionItem`s fed to the real `CliffCard` through its real
 * props, not replica markup. The last entry deliberately carries no
 * `brief_lead` at all, which is the shipped behaviour when no direction can
 * be read and there is no interest rate to quote.
 */
export type TrajectoryFixture = {
  key: string;
  /** What the preview page labels this column, for review only. */
  title: string;
  /** Why this state exists, for review only. Never user-facing copy. */
  note: string;
  item: CompanionItem;
};

const ACTION = { label: "See the route", route: "#" };

export const TRAJECTORY_FIXTURES: readonly TrajectoryFixture[] = [
  {
    key: "rising-interest",
    title: "Rising, and interest is being charged",
    note: "Up £412 over three months, £3,180 of the balance visibly charging interest at about £38 a month. Amber dot: not coming down, and it costs money.",
    item: {
      id: "trajectory:bad:2026-09:rising-interest",
      type: "trajectory",
      headline: "You owe more on your cards than 3 months ago. Some of it has interest right now.",
      body: "You owe £24,926 on 6 cards. £3,180 of it has interest, about £38 a month. £21,746 of it is on 0% deals.",
      action: ACTION,
      estimated: false,
      brief_lead: { value: "£412", companion: "more than 3 months ago" },
      tone: "watch",
      trend: "rising",
    },
  },
  {
    key: "rising-promo",
    title: "Rising, but all of it on 0%",
    note: "The same £412 of drift, worded and marked differently because none of it is costing anything yet and no 0% end date is on file. No amber.",
    item: {
      id: "trajectory:bad:2026-09:rising-promo",
      type: "trajectory",
      headline: "You owe more on your cards than 3 months ago. None of it has interest right now.",
      body: "You owe £24,926 on 6 cards. All of it is on 0% deals.",
      action: ACTION,
      estimated: false,
      brief_lead: { value: "£412", companion: "more than 3 months ago" },
      tone: "neutral",
      trend: "rising",
    },
  },
  {
    key: "falling",
    title: "Coming down, but still paying interest",
    note: "£612 less owed than three months ago. The direction is good, so the words say so, but the amber dot stays because £38 a month is still going on interest.",
    item: {
      id: "trajectory:bad:2026-09:falling",
      type: "trajectory",
      headline: "You owe less on your cards than 3 months ago. Some of it still has interest.",
      body: "You owe £24,926 on 6 cards. £3,180 of it has interest, about £38 a month. £21,746 of it is on 0% deals. At this pace, they would be paid off around Mar 2029.",
      action: ACTION,
      estimated: false,
      brief_lead: { value: "£612", companion: "less than 3 months ago" },
      tone: "watch",
      trend: "falling",
    },
  },
  {
    key: "falling-clear",
    title: "Coming down, nothing charging interest",
    note: "The only state that earns the green mark: the balance is falling, nothing on it is being charged, and no 0% end date is on file. This is the state the old card could never show, because its figure was clamped at zero and could only ever express drift.",
    item: {
      id: "trajectory:bad:2026-09:falling-clear",
      type: "trajectory",
      headline: "You owe less on your cards than 3 months ago. None of it has interest right now.",
      body: "You owe £24,926 on 6 cards. All of it is on 0% deals. At this pace, they would be paid off around Mar 2029.",
      action: ACTION,
      estimated: false,
      brief_lead: { value: "£612", companion: "less than 3 months ago" },
      tone: "positive",
      trend: "falling",
    },
  },
  {
    key: "flat",
    title: "Holding steady",
    note: "Inside the £1 flat band the debt engine's own rising flag uses, so the card and the verdict can never disagree. Amber because a stuck balance is still being charged interest.",
    item: {
      id: "trajectory:bad:2026-09:flat",
      type: "trajectory",
      headline: "You owe about the same on your cards as 3 months ago. Some of it still has interest.",
      body: "You owe £24,926 on 6 cards. £3,180 of it has interest, about £38 a month. £21,746 of it is on 0% deals.",
      action: ACTION,
      estimated: false,
      brief_lead: { value: "£0", companion: "change over the last 3 months" },
      tone: "watch",
      trend: "flat",
    },
  },
  {
    key: "rising-promo-cliff",
    title: "Rising on 0%, with an end date on file",
    note: "Same words as the second card, but a known 0% expiry earns the amber dot back and keeps the promo-cliff sentence the old card already carried.",
    item: {
      id: "trajectory:bad:2026-09:rising-promo-cliff",
      type: "trajectory",
      headline: "You owe more on your cards than 3 months ago. None of it has interest right now.",
      body: "You owe £24,926 on 6 cards. All of it is on 0% deals. About £6,100 is expected to be left on the Barclaycard Platinum. Its 0% deal ends in Mar 2027. From then, interest would be about £128 a month, unless it's paid off or moved.",
      action: ACTION,
      estimated: false,
      brief_lead: { value: "£412", companion: "more than 3 months ago" },
      tone: "watch",
      trend: "rising",
    },
  },
  {
    key: "unsynced",
    title: "Rising, with one card unread",
    note: "A card that returned a balance but no transactions is outside the figure, so the words narrow to the cards that were read rather than muting a real rise. The body names the exclusion.",
    item: {
      id: "trajectory:bad:2026-09:unsynced",
      type: "trajectory",
      headline: "You owe more on the cards we have history for. Some of it has interest right now.",
      body: "You owe £24,926 on 6 cards. £3,180 of it has interest, about £38 a month. £21,746 of it is on 0% deals. 1 card has no history yet, so we left it out.",
      action: ACTION,
      estimated: false,
      brief_lead: { value: "£412", companion: "more on the cards we have history for" },
      tone: "watch",
      trend: "rising",
    },
  },
  {
    key: "not-readable",
    title: "Not readable yet",
    note: "With no completed month of card history there is no direction to state and no rate to quote, so the card carries no hero figure at all. It never falls back to the carried total: a position does not greet you on Home.",
    item: {
      id: "trajectory:bad:2026-09:not-readable",
      type: "trajectory",
      headline: "We need more card history to tell if you owe more or less.",
      body: "You owe £24,926 on 6 cards. All of it is on 0% deals. We need at least 1 full month of card history to tell.",
      action: ACTION,
      estimated: false,
      tone: "neutral",
      trend: "unknown",
    },
  },
];

/**
 * What the card said before G103, for side-by-side comparison only. Never
 * rendered as a live state: it is here so the round can be judged against the
 * thing it replaces rather than in isolation.
 */
export const TRAJECTORY_BEFORE: CompanionItem = {
  id: "trajectory:bad:2026-09:before",
  type: "trajectory",
  headline: "The cards aren't coming down at your current pace, \u00a324,926 carried across 6 cards.",
  body: "\u00a36,100 will still be on the Barclaycard Platinum when its 0% ends in Mar 2027. From then it'd cost about \u00a3128 a month unless it's cleared or moved.",
  action: ACTION,
  estimated: false,
  brief_lead: { value: "\u00a324,926", companion: "carried across 6 cards" },
};
