import type { Account, InvestmentAccount, Transaction } from "@wealth/shared";
import { bankToRow, buildEstate, investmentToRow, type Estate, type EstateRow } from "@/lib/accountsEstate";

export const PREVIEW_STATES = [
  "estate",
  "attention",
  "empty",
  "detail-current",
  "detail-expired",
  "detail-credit",
  "detail-manual",
  "detail-investment",
] as const;

export type AccountsPreviewState = (typeof PREVIEW_STATES)[number];

export const PREVIEW_STATE_LABELS: Record<AccountsPreviewState, string> = {
  estate: "Mixed estate",
  attention: "Reconnect needed",
  empty: "Nothing connected",
  "detail-current": "Current account detail",
  "detail-expired": "Expired account detail",
  "detail-credit": "Credit card detail",
  "detail-manual": "Offline account detail",
  "detail-investment": "Investment detail",
};

const bankAccounts: Account[] = [
  {
    id: "hsbc-current",
    name: "MAINGI K M",
    type: "Current",
    balance: 160.41,
    currency: "GBP",
    provider: "HSBC",
    provider_id: "hsbc-consent",
    status: "connected",
  },
  {
    id: "barclays-current",
    name: "Premier Current Account",
    type: "Current",
    balance: 111,
    currency: "GBP",
    provider: "Barclays",
    provider_id: "barclays-consent",
    status: "connected",
  },
  {
    id: "tsb-overdrawn",
    name: "Joint Current Account",
    type: "Current",
    balance: -18.75,
    currency: "GBP",
    provider: "TSB",
    provider_id: "tsb-consent",
    status: "connected",
  },
  {
    id: "marcus-saver",
    name: "Marcus Online Saver",
    type: "Savings",
    balance: 12500,
    currency: "GBP",
    provider: "Marcus",
    provider_id: "marcus-consent",
    status: "connected",
  },
  {
    id: "starling-saver",
    name: "Rainy Day Pot",
    type: "Savings",
    balance: 3400,
    currency: "GBP",
    provider: "Starling",
    provider_id: "starling-consent",
    status: "connected",
  },
  {
    id: "natwest-card",
    name: "MASTERCARD",
    type: "Credit",
    balance: -6222,
    currency: "GBP",
    provider: "NatWest",
    provider_id: "natwest-consent",
    status: "connected",
  },
  {
    id: "amex-card",
    name: "Platinum Cashback",
    type: "Credit",
    balance: -890,
    currency: "GBP",
    provider: "Amex",
    provider_id: "amex-consent",
    status: "connected",
  },
  {
    id: "john-lewis-credit",
    name: "Overpaid Store Card",
    type: "Credit",
    balance: 42.5,
    currency: "GBP",
    provider: "John Lewis",
    provider_id: "john-lewis-consent",
    status: "connected",
  },
  {
    id: "old-current",
    name: "Old Student Account",
    type: "Current",
    balance: 0,
    currency: "GBP",
    provider: "Halifax",
    provider_id: "halifax-consent",
    status: "connected",
  },
];

const expiredAccount: Account = {
  id: "amex-reserve",
  name: "Reserve Card",
  type: "Credit",
  balance: -1523,
  currency: "GBP",
  provider: "Amex",
  provider_id: "amex-old-consent",
  status: "expired",
};

const manualAccount: Account = {
  id: "offline-house-fund",
  name: "House repairs fund",
  type: "Savings",
  balance: 1850,
  currency: "GBP",
  provider: "Offline",
  status: "connected",
  manual: true,
};

const investmentAccounts: InvestmentAccount[] = [
  {
    id: "vanguard-isa",
    provider: "Vanguard",
    account_type: "ISA",
    account_reference: "•••• 4812",
    currency: "GBP",
    total_value: 14078,
    statement_date: "2026-08-31",
    last_refreshed: "2026-09-15T08:30:00Z",
    updated_at: "2026-09-15T08:30:00Z",
    added_since: 0,
    notes_since: 0,
    display_value: 14078,
  },
  {
    id: "vanguard-sipp",
    provider: "Vanguard",
    account_type: "SIPP",
    account_reference: "•••• 7264",
    currency: "GBP",
    total_value: 22340,
    statement_date: "2026-08-31",
    last_refreshed: "2026-09-15T08:30:00Z",
    updated_at: "2026-09-15T08:30:00Z",
    added_since: 800,
    notes_since: 0,
    display_value: 22340,
  },
];

const pinnedIds = ["marcus-saver", "vanguard-sipp"];

export const ESTATE_FIXTURE = buildEstate([...bankAccounts, manualAccount], investmentAccounts, pinnedIds);
export const ATTENTION_ESTATE_FIXTURE = buildEstate([...bankAccounts, expiredAccount, manualAccount], investmentAccounts, pinnedIds);
export const EMPTY_ESTATE_FIXTURE = buildEstate([], [], []);
export function estateForState(state: AccountsPreviewState): Estate {
  if (state === "empty") return EMPTY_ESTATE_FIXTURE;
  if (state === "attention" || state === "detail-expired") return ATTENTION_ESTATE_FIXTURE;
  return ESTATE_FIXTURE;
}

const sharedTransactions: Transaction[] = [
  {
    id: "txn-tesco",
    account_id: "hsbc-current",
    date: "2026-09-14",
    amount: 34.2,
    currency: "GBP",
    description: "TESCO STORES",
    merchant_name: "Tesco",
    category: "Groceries",
    transaction_type: "debit",
  },
  {
    id: "txn-tfl",
    account_id: "hsbc-current",
    date: "2026-09-13",
    amount: 8.9,
    currency: "GBP",
    description: "TFL TRAVEL",
    merchant_name: "TfL Travel",
    category: "Transport",
    transaction_type: "debit",
  },
  {
    id: "txn-salary",
    account_id: "hsbc-current",
    date: "2026-09-12",
    amount: 3450,
    currency: "GBP",
    description: "AURIQ LTD SALARY",
    merchant_name: "Auriq Ltd",
    category: "Income",
    transaction_type: "credit",
  },
  {
    id: "txn-octopus",
    account_id: "hsbc-current",
    date: "2026-09-11",
    amount: 126.4,
    currency: "GBP",
    description: "OCTOPUS ENERGY",
    merchant_name: "Octopus Energy",
    category: "Bills",
    transaction_type: "debit",
  },
];

export type DetailPanelKind = "transactions" | "categories" | "rules" | "holdings";

export interface DetailCategory {
  name: string;
  count: number;
  total: number;
}

export interface DetailRule {
  name: string;
  detail: string;
  active: boolean;
}

export interface DetailHolding {
  name: string;
  units: string;
  value: number;
}

export interface AccountDetailFixture {
  state: AccountsPreviewState;
  row: EstateRow;
  updated: string;
  supporting: string;
  tabs: [string, string];
  defaultPanel: DetailPanelKind;
  terms?: { label: string; risk: boolean };
  reconnect?: boolean;
  transactions?: Transaction[];
  categories?: DetailCategory[];
  rules?: DetailRule[];
  holdings?: DetailHolding[];
}

const currentRow = bankToRow(bankAccounts.find((account) => account.id === "hsbc-current")!, []);
const expiredRow = bankToRow(expiredAccount, []);
const creditRow = bankToRow(bankAccounts.find((account) => account.id === "amex-card")!, []);
const manualRow = bankToRow(manualAccount, []);
const investmentRow = investmentToRow(investmentAccounts.find((account) => account.id === "vanguard-sipp")!);

export const DETAIL_FIXTURES: Record<
  "detail-current" | "detail-expired" | "detail-credit" | "detail-manual" | "detail-investment",
  AccountDetailFixture
> = {
  "detail-current": {
    state: "detail-current",
    row: currentRow,
    updated: "Updated today at 08:30",
    supporting: "£3,450 in · £170 out this pay period",
    tabs: ["Transactions", "Categories"],
    defaultPanel: "transactions",
    transactions: sharedTransactions,
    categories: [
      { name: "Bills", count: 6, total: 812.84 },
      { name: "Groceries", count: 9, total: 286.4 },
      { name: "Transport", count: 12, total: 144.2 },
    ],
  },
  "detail-expired": {
    state: "detail-expired",
    row: expiredRow,
    updated: "Stopped syncing 8 Sep",
    supporting: "Transactions may be incomplete until this connection is restored.",
    tabs: ["Transactions", "Categories"],
    defaultPanel: "transactions",
    terms: { label: "0% until Feb 2027", risk: false },
    reconnect: true,
    transactions: sharedTransactions.slice(0, 2).map((transaction) => ({ ...transaction, account_id: expiredAccount.id })),
    categories: [
      { name: "Shopping", count: 4, total: 214.62 },
      { name: "Eating Out", count: 3, total: 86.2 },
    ],
  },
  "detail-credit": {
    state: "detail-credit",
    row: creditRow,
    updated: "Updated today at 08:30",
    supporting: "£890 owed. The recorded standard rate is currently applying.",
    tabs: ["Transactions", "Categories"],
    defaultPanel: "transactions",
    terms: { label: "19.9% APR", risk: true },
    transactions: sharedTransactions.slice(0, 3).map((transaction) => ({ ...transaction, account_id: creditRow.id })),
    categories: [
      { name: "Groceries", count: 5, total: 190.25 },
      { name: "Shopping", count: 3, total: 162.4 },
      { name: "Bills", count: 2, total: 104.5 },
    ],
  },
  "detail-manual": {
    state: "detail-manual",
    row: manualRow,
    updated: "Updated manually 12 Sep",
    supporting: "This balance changes from your entries and matching rules.",
    tabs: ["Transactions", "Rules"],
    defaultPanel: "transactions",
    transactions: [
      {
        id: "manual-builder",
        account_id: manualRow.id,
        date: "2026-09-12",
        amount: 250,
        currency: "GBP",
        description: "Builder deposit",
        merchant_name: "Builder deposit",
        category: "Home",
        transaction_type: "debit",
      },
      {
        id: "manual-transfer",
        account_id: manualRow.id,
        date: "2026-09-01",
        amount: 400,
        currency: "GBP",
        description: "Monthly transfer",
        merchant_name: "Monthly transfer",
        category: "Transfer",
        transaction_type: "credit",
      },
    ],
    rules: [
      { name: "House fund transfer", detail: "Contains “HOUSE FUND” · add money", active: true },
      { name: "Old renovation rule", detail: "Category Home · remove money", active: false },
    ],
  },
  "detail-investment": {
    state: "detail-investment",
    row: investmentRow,
    updated: "Prices refreshed today at 08:30",
    supporting: "Statement value plus contract notes since 31 Aug.",
    tabs: ["Holdings", "Notes"],
    defaultPanel: "holdings",
    holdings: [
      { name: "FTSE Global All Cap", units: "83.418 units", value: 15240 },
      { name: "LifeStrategy 80% Equity", units: "42.109 units", value: 7100 },
    ],
    rules: [
      { name: "Pension contribution", detail: "£800 · 5 Sep 2026", active: true },
      { name: "Statement baseline", detail: "£21,540 · 31 Aug 2026", active: true },
    ],
  },
};

export function isDetailState(
  state: AccountsPreviewState
): state is keyof typeof DETAIL_FIXTURES {
  return state.startsWith("detail-");
}
