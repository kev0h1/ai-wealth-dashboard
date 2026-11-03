"use client";

import type { SafeToSpend } from "@/lib/api";
import type { SpendFromAccount, SpendFromResult } from "@/lib/spendFromAccount";
import ExistingLayoutCard from "./ExistingLayoutCard";
import type { Example } from "./model";
import styles from "./preview.module.css";

// Adapt only invented fixtures to the existing component's payload shape.
// This is not a new forecast or a dated walk. The supplied low-point scene
// intentionally does not reconcile to endpoint totals, as in the actual API.
export function existingPayload(example: Example): SafeToSpend | null {
  if (example.projected === null) return null;
  const value = (label: string) => Math.abs(example.rows.find(row => row.label === label)?.value ?? 0);
  const hold = example.card.hold ?? 0;
  const cash = example.projected + hold;
  return {
    status: "ok", calculation_status: "complete", safe_to_spend: example.projected,
    safe_to_spend_cash: cash,
    lowest_projected_balance: example.lowPoint ?? cash + value("Buffer") + value("Goal contributions") + value("Set-asides"),
    spendable_now: example.lowPoint === undefined ? value("Cash now") : 600,
    bills_total: example.lowPoint === undefined ? value("Bills before payday") : 1000,
    income_before_payday: example.incomeBeforePayday ?? 0,
    buffer: value("Buffer"), commitments_reserved: value("Goal contributions"), allocations_reserved: value("Set-asides"),
    next_payday: example.payday, days_until_payday: example.days, payday_income: example.expectedPay ?? 0,
    state: example.projected < 0 ? "short" : example.status.tone === "good" ? "comfortable" : "tight",
    estimated: false, short_reason: example.id === "card-gap" ? "cards_unconfirmed" : example.projected < 0 ? "bills" : null,
    card_growth_total: example.card.balanceGrowth ?? 0, card_new_spend_total: example.card.purchases ?? 0,
    card_growth_reserved: hold, card_debt: example.card.debt,
  };
}

export default function ExistingLayout({ example, hidden, onNavigate }: {
  example: Example; hidden: boolean; onNavigate: (destination: string) => void;
}) {
  const entries: SpendFromAccount[] = example.sources.map(({ account, limit }) => ({
    account, accountId: account.id, name: account.name, provider: account.provider, headroom: limit,
  }));
  const spendFrom: SpendFromResult = entries.length ? { kind: "account", best: entries[0], alternative: entries[1] ?? null } : { kind: "none" };
  return <div data-g408-existing className={styles.existing}>
    <ExistingLayoutCard data={existingPayload(example)} error={example.projected === null}
      spendFrom={spendFrom} previewBalancesVisible={!hidden}
      syncing={example.syncing ? { kind: "refresh" } : undefined}
      onNavigate={onNavigate} onRetry={() => onNavigate("/refresh")} />
  </div>;
}
