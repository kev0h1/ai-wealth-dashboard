import { ArrowRightLeft, Home, Landmark, ShieldCheck, Smartphone, Wifi, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { UpcomingRowModel } from "@/components/upcoming/UpcomingRow";
import { buildUpcomingAccountSummaries } from "@/lib/upcomingAccounts";

// Invented public-preview data only. All arithmetic is in pence. Each view
// consumes this same per-account walk, including after a local dismissal.
// No income, overdraft, interest or unlisted payments are assumed.
export type Scenario = "mixed" | "short" | "covered" | "moves";
export type FixtureEdits = Record<string, { name: string; pence: number }>;
export type AccountId = "barclays" | "monzo" | "natwest";
export type FixtureAccount = { id: AccountId; name: string; detail: string; bankKey: string };
type Payment = {
  id: string;
  accountId: AccountId;
  name: string;
  moveName: string;
  date: string;
  pence: number;
  Icon: LucideIcon;
  colour: string;
};
export type ForecastPayment = Payment & {
  account: FixtureAccount;
  before: number;
  after: number;
  shortfall: number;
  optionalMove: boolean;
  model: UpcomingRowModel;
};
export type AccountForecast = {
  account: FixtureAccount;
  opening: number;
  outgoing: number;
  closing: number;
  shortfall: number;
  payments: ForecastPayment[];
};
export type Forecast = {
  scenario: Scenario;
  accounts: AccountForecast[];
  payments: ForecastPayment[];
  cash: number;
  outgoing: number;
  closing: number;
  shortfall: number;
  shortAccounts: number;
  optionalMoves: boolean;
};

export const ACCOUNTS: FixtureAccount[] = [
  { id: "barclays", name: "Barclays", detail: "Household account", bankKey: "BARCLAYS" },
  { id: "monzo", name: "Monzo", detail: "Everyday account", bankKey: "MONZO" },
  { id: "natwest", name: "NatWest", detail: "Mortgage account", bankKey: "NATWEST" },
];

export const SCENARIOS: { id: Scenario; label: string }[] = [
  { id: "mixed", label: "Some short" },
  { id: "short", label: "All short" },
  { id: "covered", label: "All covered" },
  { id: "moves", label: "Own transfers" },
];

const OPENING: Record<Scenario, Record<AccountId, number>> = {
  mixed: { barclays: 23000, monzo: 50000, natwest: 50000 },
  short: { barclays: 23000, monzo: 5000, natwest: 50000 },
  covered: { barclays: 42000, monzo: 50000, natwest: 70000 },
  moves: { barclays: 23000, monzo: 50000, natwest: 50000 },
};

const PAYMENTS: Payment[] = [
  { id: "council-tax", accountId: "barclays", name: "Council Tax to Brighton and Hove City Council", moveName: "Move to annual bills savings", date: "2026-09-29", pence: 18000, Icon: Landmark, colour: "#64748b" },
  { id: "mobile", accountId: "monzo", name: "EE mobile plan", moveName: "Move to holiday savings", date: "2026-09-29", pence: 3500, Icon: Smartphone, colour: "#0891b2" },
  { id: "mortgage", accountId: "natwest", name: "Nationwide mortgage payment", moveName: "Move to long-term savings", date: "2026-09-29", pence: 62000, Icon: Home, colour: "#64748b" },
  { id: "broadband", accountId: "barclays", name: "Zen Internet broadband", moveName: "Move to home repairs savings", date: "2026-09-30", pence: 3400, Icon: Wifi, colour: "#0891b2" },
  { id: "energy", accountId: "barclays", name: "Octopus Energy monthly payment", moveName: "Move to emergency savings", date: "2026-09-30", pence: 9600, Icon: Zap, colour: "#64748b" },
  { id: "insurance", accountId: "monzo", name: "Aviva home and contents insurance", moveName: "Move to next year’s insurance savings", date: "2026-09-30", pence: 8000, Icon: ShieldCheck, colour: "#64748b" },
];

export const DAYS = [
  { date: "2026-09-29", heading: "Today · Tue 29 Sept" },
  { date: "2026-09-30", heading: "Tomorrow · Wed 30 Sept" },
];

export function money(pence: number, decimals = false) {
  return `${pence < 0 ? "−" : ""}£${(Math.abs(pence) / 100).toLocaleString("en-GB", {
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

export function dateLabel(iso: string) {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(`${iso}T12:00:00Z`));
}

/** The approved account preview exercises the production source-account walk. */
export function accountSummariesForForecast(forecast: Forecast) {
  return buildUpcomingAccountSummaries({
    upcoming_income: [],
    internal_inflows: [],
    upcoming_bills: forecast.payments.map((payment) => ({
      name: payment.name, amount: payment.pence / 100, expected_date: payment.date,
      days_away: payment.date === DAYS[0].date ? 0 : 1,
      account_id: payment.accountId, account_bank: payment.account.name,
      account_name: payment.account.detail,
      account_balance: forecast.accounts.find((account) => account.account.id === payment.accountId)!.opening / 100,
      kind: payment.optionalMove ? "movement" : "commitment",
    })),
  }, Date.parse("2026-09-30"));
}

export function buildForecast(scenario: Scenario, dismissed: ReadonlySet<string> = new Set(), edits: FixtureEdits = {}): Forecast {
  const balances = { ...OPENING[scenario] };
  let pooled = Object.values(balances).reduce((sum, amount) => sum + amount, 0);
  const optionalMoves = scenario === "moves";
  const payments = PAYMENTS.filter((payment) => !dismissed.has(payment.id)).map((original): ForecastPayment => {
    const payment = { ...original, pence: edits[original.id]?.pence ?? original.pence };
    const account = ACCOUNTS.find((candidate) => candidate.id === payment.accountId)!;
    const before = balances[payment.accountId];
    const after = before - payment.pence;
    balances[payment.accountId] = after;
    pooled -= payment.pence;
    const shortfall = Math.max(0, -after);
    const name = edits[payment.id]?.name ?? (optionalMoves ? payment.moveName : payment.name);
    return {
      ...payment, name, account, before, after, shortfall, optionalMove: optionalMoves,
      model: {
        rowKey: payment.id, type: "bill", name, amount: payment.pence / 100,
        expectedDate: payment.date, accountLabel: account.name,
        accountBalance: before / 100, isMovement: optionalMoves,
        pending: optionalMoves, originalDate: optionalMoves ? "2026-09-25" : undefined,
        daysPastDue: optionalMoves ? 4 : undefined,
        flagged: shortfall > 0 && !optionalMoves,
        categoryColour: optionalMoves ? "#64748b" : payment.colour,
        CategoryIcon: optionalMoves ? ArrowRightLeft : payment.Icon,
        coverage: { shortfall: shortfall / 100, optionalMove: optionalMoves, before: before / 100, after: after / 100 },
        // The shared details distinguish this pooled forecast from the
        // named source-account before/after working above.
        after: { kind: "balance", value: pooled / 100 },
      },
    };
  });
  const accounts = ACCOUNTS.map((account): AccountForecast => {
    const items = payments.filter((payment) => payment.accountId === account.id);
    const opening = OPENING[scenario][account.id];
    const outgoing = items.reduce((sum, payment) => sum + payment.pence, 0);
    const closing = opening - outgoing;
    return { account, opening, outgoing, closing, shortfall: Math.max(0, -closing), payments: items };
  });
  const cash = accounts.reduce((sum, account) => sum + account.opening, 0);
  const outgoing = payments.reduce((sum, payment) => sum + payment.pence, 0);
  return {
    scenario, accounts, payments, cash, outgoing, closing: cash - outgoing,
    shortfall: accounts.reduce((sum, account) => sum + account.shortfall, 0),
    shortAccounts: accounts.filter((account) => account.shortfall > 0).length,
    optionalMoves,
  };
}
