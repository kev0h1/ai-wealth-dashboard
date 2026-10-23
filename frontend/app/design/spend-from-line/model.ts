import { accountBrand } from "@/components/AccountMiniCard";
import { displayAccountName } from "@/lib/accountName";
import type { Account } from "@/lib/api";
import type { Scenario } from "./fixtures";

export type DisplayAccount = {
  id: string;
  account: Account;
  label: string;
  detail: string | null;
  // Null means this account can cover the total already stated once. Do not
  // repeat that amount beside each account and imply it can be added up.
  limit: number | null;
  moveAmount: number | null;
};
export type SpendFromModel = {
  pool: number;
  accounts: DisplayAccount[];
  move: { amount: number; source: string; destination: string } | null;
};
export function displayModel(scenario: Scenario): SpendFromModel {
  const labels = scenario.entries.map(entry => accountBrand(entry.account).label);
  return {
    pool: scenario.pool,
    accounts: scenario.entries.map((entry, index) => ({
      id: entry.accountId, account: entry.account, label: labels[index],
      detail: labels.filter(label => label === labels[index]).length > 1 ? displayAccountName(entry.name) : null,
      limit: Math.round(entry.headroom) >= Math.round(scenario.pool) ? null : entry.headroom,
      moveAmount: scenario.move?.sourceId === entry.accountId ? scenario.move.amount : null,
    })),
    move: scenario.move ? {
      amount: scenario.move.amount,
      source: labels[scenario.entries.findIndex(entry => entry.accountId === scenario.move!.sourceId)],
      destination: accountBrand(scenario.move.destination).label,
    } : null,
  };
}
export const fixtureMoney = (value: number) => `£${value.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
