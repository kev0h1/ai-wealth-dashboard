// G303 preview fixtures: synthetic only. Two accounts at different banks, one
// named like a holder ("MAINGI K M") and one a generic product name.
import type { Account } from "@/lib/api";
import { bestSpendAccount, type SpendFromResult } from "@/lib/spendFromAccount";
import { HERO_FIXTURES } from "../safe-to-spend-hero/fixtures";

export type CaseId = "combined" | "per-account" | "same-bank";

const base = { type: "transaction", subtype: "current", currency: "GBP", status: "connected", cover_source_eligible: true } as const;
const BARCLAYS: Account = { ...base, id: "acc-barclays", name: "Premier Current Account", balance: 40, provider: "Barclays", provider_id: "barclays_personal" } as Account;
const HSBC: Account = { ...base, id: "acc-hsbc", name: "MAINGI K M", balance: 30, provider: "HSBC", provider_id: "hsbc_personal" } as Account;
const BARCLAYS_2: Account = { ...base, id: "acc-barclays-2", name: "MAINGI K M", balance: 30, provider: "Barclays", provider_id: "barclays_personal" } as Account;

const E = (v: number, capped: boolean) => ({ short: false, headroom: v, spend_from_headroom: v, spend_from_capped: capped });

export const CASES: { id: CaseId; label: string; note: string; pool: number; spendFrom: SpendFromResult }[] = [
  {
    id: "combined",
    label: "Combined (pool binds)",
    note: "Pool £9, two accounts both capped at £9. One line, bank names, no right-hand column.",
    pool: 9,
    spendFrom: bestSpendAccount({ "acc-barclays": E(9, true), "acc-hsbc": E(9, true) }, [BARCLAYS, HSBC]),
  },
  {
    id: "same-bank",
    label: "Combined, same bank",
    note: "Both accounts at Barclays: the bank is named once.",
    pool: 9,
    spendFrom: bestSpendAccount({ "acc-barclays": E(9, true), "acc-barclays-2": E(9, true) }, [BARCLAYS, BARCLAYS_2]),
  },
  {
    id: "per-account",
    label: "Per account (fits)",
    note: "Pool £120, Barclays £40 and HSBC £30. Unchanged: SPEND FROM column with amounts and its footnote.",
    pool: 120,
    spendFrom: bestSpendAccount({ "acc-barclays": E(40, false), "acc-hsbc": E(30, false) }, [BARCLAYS, HSBC]),
  },
];

export function heroFor(pool: number) {
  return { ...HERO_FIXTURES.comfortable, safe_to_spend: pool, safe_to_spend_cash: pool };
}
