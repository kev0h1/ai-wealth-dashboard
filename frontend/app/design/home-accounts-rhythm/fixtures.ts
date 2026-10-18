// G282 fixtures. Synthetic accounts with the shouting names Kevin saw on UAT
// ("THE NUMBER ONE", "MAINGI K M", "PERSONAL GBP"). No live data.
import type { Account, InvestmentAccount } from "@/lib/api";
import { LEDGER_INVESTMENT } from "../g134-home-inventory/fixtures";

const base = { type: "bank", subtype: "TRANSACTION", currency: "GBP", status: "connected" } as const;

export const ACCOUNTS: Account[] = [
  { ...base, id: "g282-1", name: "THE NUMBER ONE", provider: "Barclays", provider_id: "barclays_personal", subtype: "TRANSACTION", balance: 1284.5 },
  { ...base, id: "g282-2", name: "MAINGI K M", provider: "Nationwide", provider_id: "nationwide", subtype: "TRANSACTION", balance: 312.2 },
  { ...base, id: "g282-3", name: "PERSONAL GBP", provider: "Monzo", provider_id: "monzo", subtype: "SAVINGS", balance: 5200 },
  { ...base, id: "g282-4", name: "Premier Current Account", provider: "HSBC", provider_id: "hsbc", subtype: "TRANSACTION", balance: 620 },
  { ...base, id: "g282-5", name: "HSBC ADVANCE", provider: "HSBC", provider_id: "hsbc", subtype: "TRANSACTION", balance: 75 },
  { ...base, id: "g282-6", name: "stocks and shares isa", provider: "Santander", provider_id: "santander", subtype: "SAVINGS", balance: 3000 },
  { ...base, id: "g282-7", name: "Kevin's Pot", provider: "Monzo", provider_id: "monzo", subtype: "SAVINGS", balance: 450 },
  { ...base, id: "g282-8", name: "PLATINUM CASHBACK", provider: "Amex", provider_id: "amex", subtype: "CREDIT_CARD", balance: -731 },
] as Account[];

export const INVESTMENT: InvestmentAccount = LEDGER_INVESTMENT;
export const HOME_PINNED_IDS = ["g282-1", "g282-2", "g282-3"];

/** Two providers needing a reconnect, so the production strip shows "Connections need attention". */
export const RECONNECT_PROVIDERS = [
  { provider: "Barclays", provider_id: "barclays_personal", account_count: 1 },
  { provider: "Nationwide", provider_id: "nationwide", account_count: 1 },
];

export const OFFLINE = [{ id: "g282-off-1", name: "CASH ENVELOPE", label: "Cash", balance: 140 }];
