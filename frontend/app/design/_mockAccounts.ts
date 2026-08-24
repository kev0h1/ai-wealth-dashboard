// Pure-data fixture module for the accounts-redesign design previews
// (accounts-rows, accounts-tiles, account-detail, accounts-preview).
// No "use client", no JSX — shared verbatim by all preview pages so the
// comparison between layout variants is apples-to-apples.
//
// Amounts follow the app-wide convention: Account.balance is SIGNED
// (negative = credit-card debt); Transaction.amount is an UNSIGNED
// magnitude with direction carried separately by transaction_type.

import type { Account, Transaction } from "@/lib/api";

export interface MockAccount extends Account {
  /** Shown pinned-first in "Your estate" and in grouped lists. */
  pinned?: boolean;
  /** Confirmed card-terms label for credit accounts, e.g. "0% until Aug 2027". */
  terms?: string;
  /** Freshness caption for accounts without recent transaction activity (e.g. ISA). */
  updated?: string;
  /** 30-point balance history, most-recent-last, literal/hardcoded. Asset accounts only. */
  series?: number[];
  /** Most recent transaction, for the tile/row "last activity" line. Asset accounts only. */
  lastTxn?: { merchant: string; amount: number; daysAgo: number };
  /** Credit limit, used for the utilisation bar. Credit accounts only. */
  limit?: number;
  /** Zero-balance account with no recent activity — e.g. an old closed
   *  current account kept connected for records. Rendered muted, in the
   *  collapsed "Inactive" group, excluded from the live grouped sections. */
  dormant?: boolean;
  /** Bank connection is broken and needs re-auth (expired token, revoked
   *  consent, etc). Rendered with an amber "Reconnect" affordance, in the
   *  collapsed "Inactive" group, excluded from the live grouped sections. */
  disconnected?: boolean;
}

export const moreCount = 17;

// ── The 25 accounts ─────────────────────────────────────────────────────────

export const mockAccounts: MockAccount[] = [
  // ── Original 10 (unchanged) ────────────────────────────────────────────
  {
    id: "acc-1",
    name: "Premier Current Account",
    type: "Current",
    balance: 111.0,
    currency: "GBP",
    provider: "Barclays",
    status: "connected",
    pinned: true,
    series: [
      950, 902, 887, 860, 810, 795, 760, 705, 690, 655,
      610, 590, 560, 530, 505, 480, 450, 420, 395, 360,
      330, 300, 270, 240, 210, 185, 160, 140, 125, 111,
    ],
    lastTxn: { merchant: "Tesco", amount: 34.2, daysAgo: 1 },
  },
  {
    id: "acc-2",
    name: "THE NUMBER ONE",
    type: "Current",
    balance: 119.0,
    currency: "GBP",
    provider: "NatWest",
    status: "connected",
    series: [
      80, 95, 110, 130, 160, 610, 580, 540, 500, 470,
      440, 410, 380, 350, 320, 300, 280, 260, 240, 220,
      200, 185, 170, 158, 148, 140, 132, 126, 121, 119,
    ],
    lastTxn: { merchant: "Sainsbury's", amount: 22.5, daysAgo: 2 },
  },
  {
    id: "acc-3",
    name: "MAINGI K M",
    type: "Current",
    balance: 160.41,
    currency: "GBP",
    provider: "HSBC",
    status: "connected",
    series: [
      40.2, 55.1, 610.0, 580.4, 545.2, 510.75, 480.1, 450.6, 420.15, 390.8,
      365.3, 340.1, 315.6, 295.4, 275.1, 255.9, 240.3, 225.1, 210.8, 200.4,
      195.2, 188.6, 182.1, 178.4, 174.9, 170.2, 167.1, 164.3, 162.0, 160.41,
    ],
    lastTxn: { merchant: "TfL Travel", amount: 8.9, daysAgo: 0 },
  },
  {
    id: "acc-4",
    name: "Kevin Mbithi Maingi",
    type: "Current",
    balance: 37.0,
    currency: "GBP",
    provider: "Monzo",
    status: "connected",
    series: [
      210, 195, 205, 180, 165, 170, 145, 130, 140, 115,
      100, 108, 90, 82, 75, 88, 70, 62, 55, 60,
      48, 42, 50, 38, 44, 33, 40, 30, 35, 37,
    ],
    lastTxn: { merchant: "Deliveroo", amount: 18.4, daysAgo: 0 },
  },
  {
    id: "acc-5",
    name: "Personal GBP",
    type: "Savings",
    balance: 0.0,
    currency: "GBP",
    provider: "Barclays",
    status: "connected",
    dormant: true,
    series: [
      250, 250, 240, 240, 220, 220, 200, 190, 180, 170,
      160, 150, 140, 130, 120, 110, 100, 90, 80, 70,
      60, 52, 44, 36, 28, 20, 14, 8, 3, 0,
    ],
    lastTxn: { merchant: "Transfer to Premier account", amount: 250.0, daysAgo: 5 },
  },
  {
    id: "acc-6",
    name: "MASTERCARD",
    type: "Credit",
    balance: -6222.0,
    currency: "GBP",
    provider: "NatWest",
    status: "connected",
    terms: "0% until Aug 2027",
    limit: 7000,
  },
  {
    id: "acc-7",
    name: "MASTERCARD",
    type: "Credit",
    balance: -7139.0,
    currency: "GBP",
    provider: "NatWest",
    status: "connected",
    terms: "0% until Aug 2027",
    limit: 7500,
  },
  {
    id: "acc-8",
    name: "IBCM PLATINUM",
    type: "Credit",
    balance: -3147.0,
    currency: "GBP",
    provider: "Barclays",
    status: "connected",
    terms: "0% until May 2027",
    limit: 5000,
  },
  {
    id: "acc-9",
    name: "MAINGI,KEVIN MBITHI/MR",
    type: "Credit",
    balance: -412.0,
    currency: "GBP",
    provider: "HSBC",
    status: "connected",
    terms: "0% until Nov 2026",
    limit: 3000,
  },
  {
    id: "acc-10",
    name: "ISA",
    type: "ISA (Investment)",
    balance: 14078.0,
    currency: "GBP",
    provider: "Vanguard",
    status: "connected",
    updated: "6 Aug",
    series: [
      13650, 13680, 13705, 13690, 13720, 13760, 13740, 13790, 13820, 13800,
      13850, 13880, 13860, 13900, 13930, 13910, 13950, 13980, 13960, 14000,
      14030, 14010, 14050, 14080, 14060, 14020, 14050, 14070, 14090, 14078,
    ],
    lastTxn: { merchant: "Vanguard top-up", amount: 500, daysAgo: 6 },
  },

  // ── New 15 (expanding bank + type coverage for real navigation testing) ──
  {
    id: "acc-11",
    name: "Everyday Account",
    type: "Current",
    balance: 892.5,
    currency: "GBP",
    provider: "Halifax",
    status: "connected",
    lastTxn: { merchant: "Amazon", amount: 41.99, daysAgo: 1 },
  },
  {
    id: "acc-12",
    name: "Rainy Day Pot",
    type: "Savings",
    balance: 3400.0,
    currency: "GBP",
    provider: "Starling",
    status: "connected",
    lastTxn: { merchant: "Round-up transfer", amount: 4.3, daysAgo: 3 },
  },
  {
    id: "acc-13",
    name: "Old Student Account",
    type: "Current",
    balance: 0.0,
    currency: "GBP",
    provider: "Halifax",
    status: "connected",
    dormant: true,
  },
  {
    id: "acc-14",
    name: "Platinum Cashback",
    type: "Credit",
    balance: -890.0,
    currency: "GBP",
    provider: "Amex",
    status: "connected",
    terms: "19.9% APR",
    limit: 4000,
  },
  {
    id: "acc-15",
    name: "Reserve Card",
    type: "Credit",
    balance: -1523.0,
    currency: "GBP",
    provider: "Amex",
    status: "expired",
    disconnected: true,
    terms: "0% until Feb 2027",
    limit: 6000,
  },
  {
    id: "acc-16",
    name: "Chase Saver",
    type: "Savings",
    balance: 5230.0,
    currency: "GBP",
    provider: "Chase",
    status: "connected",
    lastTxn: { merchant: "Interest payment", amount: 12.4, daysAgo: 4 },
  },
  {
    id: "acc-17",
    name: "Chase Current",
    type: "Current",
    balance: 275.3,
    currency: "GBP",
    provider: "Chase",
    status: "connected",
    lastTxn: { merchant: "Uber", amount: 9.6, daysAgo: 0 },
  },
  {
    id: "acc-18",
    name: "Marcus Online Saver",
    type: "Savings",
    balance: 12500.0,
    currency: "GBP",
    provider: "Marcus",
    status: "connected",
    pinned: true,
    lastTxn: { merchant: "Interest payment", amount: 38.2, daysAgo: 12 },
  },
  {
    id: "acc-19",
    name: "Everyday Saver",
    type: "Savings",
    balance: 1840.0,
    currency: "GBP",
    provider: "Nationwide",
    status: "connected",
    lastTxn: { merchant: "Standing order", amount: 100.0, daysAgo: 8 },
  },
  {
    id: "acc-20",
    name: "FlexPlus Current",
    type: "Current",
    balance: 502.15,
    currency: "GBP",
    provider: "Nationwide",
    status: "connected",
    lastTxn: { merchant: "Netflix", amount: 15.99, daysAgo: 2 },
  },
  {
    id: "acc-21",
    name: "Lloyds Classic",
    type: "Current",
    balance: 64.2,
    currency: "GBP",
    provider: "Lloyds",
    status: "connected",
    lastTxn: { merchant: "Greggs", amount: 4.6, daysAgo: 0 },
  },
  {
    id: "acc-22",
    name: "Lloyds Credit Card",
    type: "Credit",
    balance: -2210.0,
    currency: "GBP",
    provider: "Lloyds",
    status: "connected",
    terms: "0% until Jan 2027",
    limit: 4500,
  },
  {
    id: "acc-23",
    name: "Santander 123",
    type: "Current",
    balance: 340.0,
    currency: "GBP",
    provider: "Santander",
    status: "connected",
    lastTxn: { merchant: "Spotify", amount: 11.99, daysAgo: 1 },
  },
  {
    id: "acc-24",
    name: "Santander Edge Saver",
    type: "Savings",
    balance: 780.0,
    currency: "GBP",
    provider: "Santander",
    status: "connected",
    lastTxn: { merchant: "Standing order", amount: 50.0, daysAgo: 9 },
  },
  {
    id: "acc-25",
    name: "Vanguard SIPP",
    type: "SIPP (Investment)",
    balance: 22340.0,
    currency: "GBP",
    provider: "Vanguard",
    status: "connected",
    pinned: true,
    updated: "10 Aug",
    series: [
      19800, 20050, 19920, 20180, 20340, 20260, 20510, 20440, 20690, 20820,
      20760, 21010, 21180, 21090, 21340, 21460, 21380, 21620, 21740, 21690,
      21900, 22010, 21960, 22120, 22200, 22150, 22260, 22300, 22280, 22340,
    ],
    lastTxn: { merchant: "Vanguard SIPP top-up", amount: 800, daysAgo: 14 },
  },

  // ── Sign-direction coverage: a credit card in credit (balance > 0, the
  // bank owes you) and an overdrawn current account (balance < 0, genuine
  // risk) — exercises the "in credit" / "overdrawn" caption states so the
  // corrected AccountLedgerRow/AccountTile logic is actually visible here. ──
  {
    id: "acc-26",
    name: "Overpaid Store Card",
    type: "Credit",
    balance: 42.5,
    currency: "GBP",
    provider: "John Lewis",
    status: "connected",
    terms: "0% until Mar 2027",
    limit: 2000,
  },
  {
    id: "acc-27",
    name: "Joint Current Account",
    type: "Current",
    balance: -18.75,
    currency: "GBP",
    provider: "TSB",
    status: "connected",
    lastTxn: { merchant: "Direct debit", amount: 40.0, daysAgo: 1 },
  },
];

// ── Detail-page fixtures ────────────────────────────────────────────────────

export const detailAccount = mockAccounts[2]; // acc-3, MAINGI K M (HSBC)

export const detailCategories = [
  { name: "Bills", total: 5078.01, count: 9 },
  { name: "Transfer", total: 229.0, count: 3 },
  { name: "Debt", total: 213.27, count: 3 },
];

export const detailTransactions: Transaction[] = [
  {
    id: "txn-1",
    account_id: "acc-3",
    date: "2026-05-25",
    amount: 5.0,
    currency: "GBP",
    description: "MAINGI K M HSBC",
    merchant_name: "MAINGI K M HSBC",
    category: "Transfer",
    transaction_type: "credit",
  },
  {
    id: "txn-2",
    account_id: "acc-3",
    date: "2026-05-25",
    amount: 13.0,
    currency: "GBP",
    description: "HSBC CREDIT CARD",
    merchant_name: "HSBC CREDIT CARD",
    category: "Debt",
    transaction_type: "debit",
  },
  {
    id: "txn-3",
    account_id: "acc-3",
    date: "2026-05-11",
    amount: 5.0,
    currency: "GBP",
    description: "MAINGI K M HSBC",
    merchant_name: "MAINGI K M HSBC",
    category: "Transfer",
    transaction_type: "credit",
  },
  {
    id: "txn-4",
    account_id: "acc-3",
    date: "2026-04-30",
    amount: 120.0,
    currency: "GBP",
    description: "MAINGI K M HSBC",
    merchant_name: "MAINGI K M HSBC",
    category: "Transfer",
    transaction_type: "credit",
  },
  {
    id: "txn-5",
    account_id: "acc-3",
    date: "2026-04-30",
    amount: 428.86,
    currency: "GBP",
    description: "M&S LOANS",
    merchant_name: "M&S LOANS",
    category: "Bills",
    transaction_type: "debit",
  },
  {
    id: "txn-6",
    account_id: "acc-3",
    date: "2026-04-30",
    amount: 1124.44,
    currency: "GBP",
    description: "MTG 40048885827221",
    merchant_name: "MTG 40048885827221",
    category: "Bills",
    transaction_type: "debit",
  },
  {
    id: "txn-7",
    account_id: "acc-3",
    date: "2026-04-28",
    amount: 139.37,
    currency: "GBP",
    description: "NOVUNA PERSONAL FI",
    merchant_name: "NOVUNA PERSONAL FI",
    category: "Bills",
    transaction_type: "debit",
  },
];

// ── Grouping helpers ─────────────────────────────────────────────────────────

export const ACCOUNT_GROUPS = ["Current", "Savings", "Credit cards", "Investments"] as const;
export type AccountGroupLabel = (typeof ACCOUNT_GROUPS)[number];

function groupForType(type: string): AccountGroupLabel | null {
  if (type === "Current") return "Current";
  if (type === "Savings") return "Savings";
  if (type === "Credit") return "Credit cards";
  // Covers "ISA (Investment)", "SIPP (Investment)", and any future
  // investment subtype — matched by substring rather than an exact string
  // so new investment wrapper types don't silently fall through the cracks.
  if (type.includes("Investment")) return "Investments";
  return null;
}

export interface AccountGroup {
  label: AccountGroupLabel;
  accounts: MockAccount[];
  subtotal: number;
}

export function groupedAccounts(accounts: MockAccount[]): AccountGroup[] {
  const groups: AccountGroup[] = [];
  for (const label of ACCOUNT_GROUPS) {
    const inGroup = accounts.filter((a) => groupForType(a.type) === label);
    if (inGroup.length === 0) continue;
    const sorted = [...inGroup].sort((a, b) => {
      if (!!a.pinned === !!b.pinned) return 0;
      return a.pinned ? -1 : 1;
    });
    const subtotal = inGroup.reduce((sum, a) => sum + a.balance, 0);
    groups.push({ label, accounts: sorted, subtotal });
  }
  return groups;
}

export function netWorth(accounts: MockAccount[]): number {
  return accounts.reduce((sum, a) => sum + a.balance, 0);
}

// ── Estate-navigation helpers (accounts-rows preview) ───────────────────────
// Split the estate into: a pinned quick-access band, the "live" grouped
// sections (everything a user actually manages day to day), and an inactive
// bucket (dormant zero-balance accounts + broken connections) that's
// collapsed by default and kept out of the live subtotals/groups so it
// doesn't distort them.

/** Pinned accounts, excluding anything inactive (a broken/dormant account
 *  pinned to the top would be confusing — it belongs in Inactive instead). */
export function pinnedAccounts(accounts: MockAccount[]): MockAccount[] {
  return accounts.filter((a) => a.pinned && !a.dormant && !a.disconnected);
}

/** Same grouping as groupedAccounts, but scoped to live accounts only —
 *  used by the navigable estate so group counts/subtotals reflect accounts
 *  the user actually manages, not stale/broken ones. */
export function liveGroupedAccounts(accounts: MockAccount[]): AccountGroup[] {
  return groupedAccounts(accounts.filter((a) => !a.dormant && !a.disconnected));
}

/** Dormant (zero-balance, unused) and disconnected (broken connection)
 *  accounts, flattened into one list for the collapsed "Inactive" section. */
export function inactiveAccounts(accounts: MockAccount[]): MockAccount[] {
  return accounts.filter((a) => a.dormant || a.disconnected);
}
