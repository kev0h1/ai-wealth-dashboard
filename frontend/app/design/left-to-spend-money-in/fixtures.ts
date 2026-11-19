// G480 design round fixtures. Kevin's real figures (authorised for public
// /design previews, 2026-11-19). Nothing here calls an API.
//
// Model under review:
//   Left to spend = real balances now, minus every payment due before the
//   period ends (and goals / set-asides). Money in never adds until it lands.
//   Short only when a payment fails even counting money expected on or before
//   its day. A middle state covers payments that rely on money not yet in.

export type ScenarioId = "waiting" | "landed" | "short" | "short-cover" | "on-track" | "mid-period";
export type Status = "on-track" | "waiting" | "short" | "move";

export type Account = { id: string; bank: string; name: string; initials: string; colour: string; balance: number };
export type Row = {
  id: string;
  /** ISO date, used for ordering and the same-day walk. */
  date: string;
  dayLabel: string;
  label: string;
  account: string;
  /** Signed: bills negative, income positive. */
  amount: number;
  kind: "bill" | "in";
  /** Income only: has it landed in the account? */
  landed?: boolean;
  /** Belongs to the next pay period, never counted. */
  nextPeriod?: boolean;
};

export type Scenario = {
  id: ScenarioId;
  tab: string;
  title: string;
  blurb: string;
  todayLabel: string;
  periodLabel: string;
  periodEndLabel: string;
  daysLeft: number;
  accounts: Account[];
  rows: Row[];
  /** The day the preview zooms into on the Upcoming list. */
  focusDate: string;
  focusLabel: string;
  /** Suggested cover move (S3b): a sentence, never a button. */
  coverFrom?: string;
};

const BARCLAYS = { id: "barclays", bank: "Barclays", name: "Current", initials: "BC", colour: "#00aeef" };
const MONZO = { id: "monzo", bank: "Monzo", name: "Current", initials: "MZ", colour: "#ff4f40" };
const HOUSING: Omit<Row, "id"> = { date: "2026-11-23", dayLabel: "Mon 23 Nov", label: "Platform Housing", account: "barclays", amount: -77.91, kind: "bill" };
const MOBILE = { label: "Mobile-Channel", account: "barclays", amount: 509.0, kind: "in" as const };
const MAINGI = { label: "Maingi KM Credit", account: "barclays", amount: 140.59, kind: "in" as const };
const GOLDMAN: Row = { id: "goldman", date: "2026-11-27", dayLabel: "Fri 27 Nov", label: "Goldman Sachs pay", account: "barclays", amount: 5087.95, kind: "in", nextPeriod: true };

export const SCENARIOS: Scenario[] = [
  {
    id: "waiting",
    tab: "S1 Waiting",
    title: "Waiting on money in (today)",
    blurb: "Barclays holds £5.05. Platform Housing is due Mon 23 Nov. £649.59 is expected the same day.",
    todayLabel: "Thu 19 Nov",
    periodLabel: "19 to 27 Nov",
    periodEndLabel: "Fri 27 Nov",
    daysLeft: 8,
    accounts: [{ ...BARCLAYS, balance: 5.05 }],
    rows: [
      { id: "h", ...HOUSING },
      { id: "m", date: "2026-11-23", dayLabel: "Mon 23 Nov", ...MOBILE },
      { id: "k", date: "2026-11-23", dayLabel: "Mon 23 Nov", ...MAINGI },
      GOLDMAN,
    ],
    focusDate: "2026-11-23",
    focusLabel: "Mon 23 Nov",
  },
  {
    id: "landed",
    tab: "S2 Landed",
    title: "Money landed",
    blurb: "The £649.59 has arrived. Balance £654.64, the bill is still due today.",
    todayLabel: "Mon 23 Nov",
    periodLabel: "23 to 27 Nov",
    periodEndLabel: "Fri 27 Nov",
    daysLeft: 4,
    accounts: [{ ...BARCLAYS, balance: 654.64 }],
    rows: [
      { id: "h", ...HOUSING },
      { id: "m", date: "2026-11-23", dayLabel: "Mon 23 Nov", ...MOBILE, landed: true },
      { id: "k", date: "2026-11-23", dayLabel: "Mon 23 Nov", ...MAINGI, landed: true },
      GOLDMAN,
    ],
    focusDate: "2026-11-23",
    focusLabel: "Mon 23 Nov",
  },
  {
    id: "short",
    tab: "S3 Short",
    title: "Genuinely short",
    blurb: "The expected money is due Thu 26 Nov, after the bill on Mon 23 Nov. Nothing else can cover it.",
    todayLabel: "Thu 19 Nov",
    periodLabel: "19 to 27 Nov",
    periodEndLabel: "Fri 27 Nov",
    daysLeft: 8,
    accounts: [{ ...BARCLAYS, balance: 5.05 }],
    rows: [
      { id: "h", ...HOUSING },
      { id: "m", date: "2026-11-26", dayLabel: "Thu 26 Nov", ...MOBILE },
      { id: "k", date: "2026-11-26", dayLabel: "Thu 26 Nov", ...MAINGI },
      GOLDMAN,
    ],
    focusDate: "2026-11-23",
    focusLabel: "Mon 23 Nov",
  },
  {
    id: "short-cover",
    tab: "S3b Move covers",
    title: "Short, a move would cover it",
    blurb: "Same bill, same late money, but Monzo holds £200.00 that could cover Barclays.",
    todayLabel: "Thu 19 Nov",
    periodLabel: "19 to 27 Nov",
    periodEndLabel: "Fri 27 Nov",
    daysLeft: 8,
    accounts: [{ ...BARCLAYS, balance: 5.05 }, { ...MONZO, balance: 200.0 }],
    rows: [
      { id: "h", ...HOUSING },
      { id: "m", date: "2026-11-26", dayLabel: "Thu 26 Nov", ...MOBILE },
      { id: "k", date: "2026-11-26", dayLabel: "Thu 26 Nov", ...MAINGI },
      GOLDMAN,
    ],
    focusDate: "2026-11-23",
    focusLabel: "Mon 23 Nov",
    coverFrom: "monzo",
  },
  {
    id: "on-track",
    tab: "S4 On track",
    title: "On track",
    blurb: "Balance easily covers every payment. A small expected credit is listed but not counted.",
    todayLabel: "Thu 19 Nov",
    periodLabel: "19 to 27 Nov",
    periodEndLabel: "Fri 27 Nov",
    daysLeft: 8,
    accounts: [{ ...BARCLAYS, balance: 1180.3 }],
    rows: [
      { id: "h", ...HOUSING },
      { id: "k", date: "2026-11-23", dayLabel: "Mon 23 Nov", ...MAINGI },
      { id: "o2", date: "2026-11-25", dayLabel: "Wed 25 Nov", label: "O2", account: "barclays", amount: -34.0, kind: "bill" },
      { id: "oct", date: "2026-11-26", dayLabel: "Thu 26 Nov", label: "Octopus Energy", account: "barclays", amount: -92.4, kind: "bill" },
      GOLDMAN,
    ],
    focusDate: "2026-11-23",
    focusLabel: "Mon 23 Nov",
  },
  {
    id: "mid-period",
    tab: "S5 Mid-period pay",
    title: "Paid mid-period, own pay period",
    blurb: "Period runs 1 to 31 Dec, pay lands on the 15th. Two bills fall before it, two after.",
    todayLabel: "Thu 10 Dec",
    periodLabel: "1 to 31 Dec",
    periodEndLabel: "Thu 31 Dec",
    daysLeft: 21,
    accounts: [{ ...BARCLAYS, balance: 210.0 }],
    rows: [
      { id: "ct", date: "2026-12-11", dayLabel: "Fri 11 Dec", label: "Council Tax", account: "barclays", amount: -142.0, kind: "bill" },
      { id: "gym", date: "2026-12-14", dayLabel: "Mon 14 Dec", label: "Gym", account: "barclays", amount: -28.0, kind: "bill" },
      { id: "pay", date: "2026-12-15", dayLabel: "Tue 15 Dec", label: "Harbour Studio pay", account: "barclays", amount: 1200.0, kind: "in" },
      { id: "ph", date: "2026-12-22", dayLabel: "Tue 22 Dec", label: "Phone", account: "barclays", amount: -24.0, kind: "bill" },
      { id: "ins", date: "2026-12-28", dayLabel: "Mon 28 Dec", label: "Car insurance", account: "barclays", amount: -86.2, kind: "bill" },
    ],
    focusDate: "2026-12-15",
    focusLabel: "Tue 15 Dec",
  },
];

export const r2 = (n: number) => Math.round(n * 100) / 100;

export type Derived = {
  now: number;
  payments: number;
  /** Real balances minus payments due this period. Never includes money not yet landed. */
  raw: number;
  moneyIn: Row[];
  moneyInTotal: number;
  /** raw plus every expected credit in the period (the "once it lands" figure). */
  afterIn: number;
  status: Status;
  /** The first failing day, per account, counting money expected on or before that day. */
  failing: { account: Account; row: Row; balance: number } | null;
  /** The first payment that only works because money in lands first. */
  reliesOn: { row: Row; balanceWithout: number; waitingFor: Row[] } | null;
  /** Amount a cover move needs to move, and from where. */
  move: { from: Account; to: Account; amount: number } | null;
  /** Hero figure when nothing is floored. */
  heroRaw: number;
  /** Left to spend after any earmark set aside in the source account. */
  left: number;
  perDay: number | null;
  /** Per-account walk lines for the breakdown. */
  accountLeft: { account: Account; left: number; note: "ok" | "waiting" | "short" | "move" }[];
};

/** Walk each account day by day. Same-day credits land before bills (G163). */
function walk(acc: Account, rows: Row[], countExpected: boolean) {
  const mine = rows.filter((r) => r.account === acc.id && !r.nextPeriod && !(r.kind === "in" && r.landed));
  const days = [...new Set(mine.map((r) => r.date))].sort();
  let bal = acc.balance;
  let firstNeg: { bal: number; row: Row } | null = null;
  for (const d of days) {
    if (countExpected) for (const r of mine.filter((x) => x.date === d && x.kind === "in")) bal = r2(bal + r.amount);
    for (const r of mine.filter((x) => x.date === d && x.kind === "bill")) {
      bal = r2(bal + r.amount);
      if (bal < 0 && !firstNeg) firstNeg = { bal, row: r };
    }
  }
  return firstNeg;
}

export function derive(s: Scenario): Derived {
  const periodRows = s.rows.filter((r) => !r.nextPeriod);
  const bills = periodRows.filter((r) => r.kind === "bill");
  const moneyIn = periodRows.filter((r) => r.kind === "in" && !r.landed);
  const now = r2(s.accounts.reduce((t, a) => t + a.balance, 0));
  const payments = r2(bills.reduce((t, r) => t - r.amount, 0));
  const raw = r2(now - payments);
  const moneyInTotal = r2(moneyIn.reduce((t, r) => t + r.amount, 0));
  const afterIn = r2(raw + moneyInTotal);

  let failing: Derived["failing"] = null;
  let reliesOn: Derived["reliesOn"] = null;
  const accountLeft: Derived["accountLeft"] = [];
  for (const a of s.accounts) {
    const w = walk(a, s.rows, true);
    const wo = walk(a, s.rows, false);
    const accBills = bills.filter((r) => r.account === a.id);
    const accLeft = r2(a.balance - accBills.reduce((t, r) => t - r.amount, 0));
    let note: "ok" | "waiting" | "short" | "move" = "ok";
    if (w) {
      note = "short";
      if (!failing) failing = { account: a, row: w.row, balance: w.bal };
    } else if (wo) {
      note = "waiting";
      if (!reliesOn) reliesOn = { row: wo.row, balanceWithout: wo.bal, waitingFor: moneyIn.filter((r) => r.account === a.id && r.date <= wo.row.date) };
    }
    accountLeft.push({ account: a, left: accLeft, note });
  }

  let move: Derived["move"] = null;
  let status: Status = "on-track";
  if (failing) {
    const donor = s.coverFrom ? s.accounts.find((a) => a.id === s.coverFrom) : undefined;
    const need = r2(-failing.balance);
    if (donor && donor.balance >= need) {
      status = "move";
      move = { from: donor, to: failing.account, amount: need };
      const f = accountLeft.find((x) => x.account.id === failing!.account.id);
      if (f) f.note = "move";
    } else status = "short";
  } else if (reliesOn) status = "waiting";

  const earmark = move ? move.amount : 0;
  const left = r2(raw);
  const heroRaw = left;
  const perDay = status === "on-track" || status === "move" ? (left > 0 ? Math.round(left / s.daysLeft) : null) : null;
  void earmark;
  return { now, payments, raw, moneyIn, moneyInTotal, afterIn, status, failing, reliesOn, move, heroRaw, left, perDay, accountLeft };
}
