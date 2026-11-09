/** G446 design fixtures only. No live accounts or transaction identifiers. */
export type PreviewCategory = "Income" | "Transfer" | "Shopping" | "Other";
export type HistoricalCredit = {
  id: string;
  date: string;
  description: string;
  amount: number;
};
export type IncomeSeries = {
  id: string;
  payer: string;
  accountName: string;
  expectedDate: string;
  amount: number;
  cadence: string;
  lastSeen: string;
  history: HistoricalCredit[];
  payBasis?: string;
};
export type PreviewState = "income" | "none" | "partial" | "loading" | "error" | "syncing" | "long" | "save-error";

const history = (id: string, description: string, dates: string[], amount: number): HistoricalCredit[] =>
  dates.map(date => ({ id: `${id}-${date}`, date, description, amount }));

export const BEFORE_PAYDAY: IncomeSeries[] = [
  {
    id: "alder", payer: "Alder Payroll", accountName: "Barclays · Everyday account",
    expectedDate: "2026-11-20", amount: 2850, cadence: "monthly", lastSeen: "2026-10-20",
    history: history("alder", "ALDER PAYROLL", ["2026-10-20", "2026-09-20", "2026-08-20"], 2850),
  },
  {
    id: "morgan", payer: "J Morgan", accountName: "Halifax · Current account",
    expectedDate: "2026-11-18", amount: 3000.05, cadence: "monthly", lastSeen: "2026-10-18",
    history: history("morgan", "J MORGAN ONLINE PAYMENT", ["2026-10-18", "2026-09-18", "2026-08-18"], 3000.05),
  },
  {
    id: "retailer", payer: "High Street Retail refund", accountName: "Barclays · Everyday account",
    expectedDate: "2026-11-23", amount: 210, cadence: "monthly", lastSeen: "2026-10-23",
    history: history("retailer", "HIGH STREET RETAIL REFUND", ["2026-10-23", "2026-09-23", "2026-08-23"], 210),
  },
];

export const EXPECTED_PAY: IncomeSeries = {
  id: "reward", payer: "Account reward", accountName: "Halifax · Current account",
  expectedDate: "2026-12-01", amount: 24, cadence: "monthly", lastSeen: "2026-11-01",
  history: history("reward", "ACCOUNT REWARD", ["2026-11-01", "2026-10-01", "2026-09-01"], 24),
  payBasis: "Sorted is using this recurring income series for Expected pay. It has not been confirmed as pay.",
};

export const ALL_SERIES = [...BEFORE_PAYDAY, EXPECTED_PAY];
export const INCOME_HELP = "These are payments we expect to arrive before payday based on your history. If any are not really income, change their category.";
export const PREVIEW_STATES: { value: PreviewState; label: string }[] = [
  { value: "income", label: "Predicted income" },
  { value: "none", label: "No predicted income" },
  { value: "partial", label: "History unavailable" },
  { value: "loading", label: "Loading history" },
  { value: "error", label: "History failed" },
  { value: "syncing", label: "Updating bank data" },
  { value: "long", label: "Long names" },
  { value: "save-error", label: "Category save failed" },
];

export function shortDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" });
}

export function money(value: number, hidden: boolean, exact = true): string {
  const sign = value < 0 ? "−" : "";
  if (hidden) return `${sign}£••••`;
  const digits = exact || (Math.abs(value) > 0 && Math.abs(value) < 1) ? 2 : 0;
  return `${sign}£${Math.abs(value).toLocaleString("en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function incomingMoney(value: number, hidden: boolean, exact = true): string {
  return `${value > 0 ? "+" : ""}${money(value, hidden, exact)}`;
}

// A fixed, internally reconciled illustration, never a production forecast.
// 8,000 cash + 6,060.05 income - 8,546.84 payments - 600 reserves = 4,913.21.
export const BASE_LEFT_PENCE = 491321;
export const RESERVES_PENCE = 60000;
export const DAYS_LEFT = 22;
