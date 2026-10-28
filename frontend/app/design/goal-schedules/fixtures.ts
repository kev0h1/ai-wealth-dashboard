// Fixtures for the G351 goal-schedules design round. Kevin's own 4p challenge
// (authorised: his real shape, 4p on day one rising by 4p a day for 365 days
// from 1 January 2026, total £2,671.80), as at 28 October 2026. Every figure is
// worked from that schedule: day n saves n x 4p, a pay period is the calendar
// month. Type-only imports from @/lib/api, so nothing here can fetch.
import type { Account, GoalSchedule, GoalSchedulePeriod } from "@/lib/api";

export const SCHEDULE: GoalSchedule = {
  type: "arithmetic", start_pence: 4, step_pence: 4, step_unit: "day",
  start_date: "2026-01-01", count: 365, end_date: null,
};

export const SENTENCE = "4p a day, rising by 4p a day, from 1 Jan 2026 for 365 days";
export const NAME = "4p challenge";
export const TOTAL = 2671.8;
export const THIS_PERIOD = { label: "October", start: "2026-10-01", end: "2026-10-31", amount: 358.36 };
export const NEXT: (GoalSchedulePeriod & { label: string })[] = [
  { label: "November", start: "2026-11-01", end: "2026-11-30", amount: 383.4 },
  { label: "December", start: "2026-12-01", end: "2026-12-31", amount: 434 },
];
/** Every month of the run, for the ladder and the earlier-periods fold. */
export const LADDER: { label: string; amount: number; status: "past" | "current" | "next" }[] = [
  { label: "January", amount: 19.84, status: "past" },
  { label: "February", amount: 50.96, status: "past" },
  { label: "March", amount: 93, status: "past" },
  { label: "April", amount: 126.6, status: "past" },
  { label: "May", amount: 168.64, status: "past" },
  { label: "June", amount: 199.8, status: "past" },
  { label: "July", amount: 244.28, status: "past" },
  { label: "August", amount: 282.72, status: "past" },
  { label: "September", amount: 310.2, status: "past" },
  { label: "October", amount: 358.36, status: "current" },
  { label: "November", amount: 383.4, status: "next" },
  { label: "December", amount: 434, status: "next" },
];
/** What the schedule has asked for up to 28 October (days 1 to 301), and the
 * amount set aside so far: on schedule. */
export const DUE_SO_FAR = 1818.04;
export const SAVED = 1818.04;
export const END_LABEL = "31 Dec 2026";

export const SOURCE = { name: "Monzo current account", basis: "recent-transfers" as const };
export const POT = { name: "Saving Challenge (2026)", kind: "Monzo pot" };
export const REPLACES = "Saving Challenge (2026)";
export const NOTHING_MOVES = "Nothing moves until you move it.";
export const HISTORY_NOTE = "Progress starts from today; the set-aside's past fills stay where they are.";

/** Daily amounts for the sparkline: day n is n x 4p. */
export const DAILY: number[] = Array.from({ length: 365 }, (_, i) => (i + 1) * 0.04);

export const SOURCE_ACCOUNT = { id: "monzo-current", name: "Monzo Current Account", provider: "Monzo", type: "transaction", balance: 412.3, currency: "GBP" } as unknown as Account;
export const POT_ACCOUNT = { id: "monzo-pot", name: "Saving Challenge (2026)", provider: "Monzo", type: "savings", balance: 1818.04, currency: "GBP" } as unknown as Account;

export const money = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
