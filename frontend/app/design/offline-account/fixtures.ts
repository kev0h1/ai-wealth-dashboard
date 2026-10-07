import type { Account, Transaction } from "@/lib/api";

// G233 fixtures only, no live data.
export const OFFLINE_ACCOUNT = {
  id: "manual-digital-saver", name: "Digital saver", provider: "Offline", type: "bank", subtype: "SAVINGS",
  currency: "GBP", balance: 2450, status: "connected", manual: true,
} as unknown as Account;

export const BANK_ACCOUNT = {
  id: "acc-premier", name: "Premier current", provider: "Barclays", provider_id: "barclays_personal", type: "bank",
  subtype: "TRANSACTION", currency: "GBP", balance: 1284.5, status: "connected",
} as unknown as Account;

export const TRANSACTIONS: Transaction[] = [
  { id: "g233-1", account_id: "manual-digital-saver", date: "2026-10-03", amount: 150, currency: "GBP", description: "Monthly top-up", category: "Transfer", transaction_type: "credit" },
  { id: "g233-2", account_id: "manual-digital-saver", date: "2026-09-28", amount: 25, currency: "GBP", description: "Birthday gift", category: "Income", transaction_type: "credit" },
  { id: "g233-3", account_id: "manual-digital-saver", date: "2026-09-12", amount: 80, currency: "GBP", description: "Holiday deposit", category: "Travel", transaction_type: "debit" },
];
