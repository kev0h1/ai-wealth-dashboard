"use client";

import UpcomingAttentionDay from "@/components/upcoming/UpcomingAttentionDay";
import type { UpcomingRowModel } from "@/components/upcoming/UpcomingRow";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { getCategoryColour } from "@/lib/categories";
import { bankLabel, accountLabel, dateLabel } from "./ui";
import type { Scenario } from "./types";

/** The live dated payment renderer is intentionally reused without a variant
 * prop, scoped CSS override, reordered row or replacement payment component. */
export default function PaymentContext({ scenario, onOpen, onDismiss }: {
  scenario: Scenario;
  onOpen: (payment: UpcomingRowModel) => void;
  onDismiss: (payment: UpcomingRowModel) => void;
}) {
  const rows: UpcomingRowModel[] = scenario.payments.map(payment => {
    const account = scenario.accounts.find(item => item.id === payment.accountId);
    const cash = payment.kind !== "card-charge" && payment.kind !== "settling";
    return {
      rowKey: payment.id,
      identity: payment.id,
      type: payment.kind === "income" ? "income" : "bill",
      name: payment.name,
      amount: Math.abs(payment.amountPence) / 100,
      expectedDate: payment.date,
      category: payment.category,
      accountLabel: account ? `${bankLabel(account)} · ${accountLabel(account)}` : null,
      isCreditCard: payment.kind === "card-charge",
      isSettling: payment.kind === "settling",
      isMovement: payment.kind === "transfer",
      assessment: payment.afterPence === null && cash ? "unverified" : undefined,
      coverage: cash && payment.afterPence !== null ? { shortfall: Math.max(0, -payment.afterPence) / 100 } : undefined,
      after: payment.kind === "card-charge" ? { kind: "credit-card" } : payment.kind === "settling" ? { kind: "settling" } : { kind: "balance", value: (payment.afterPence ?? 0) / 100 },
      categoryColour: getCategoryColour(payment.category, {}),
      CategoryIcon: getCategoryIcon(payment.category, {}),
    };
  });
  const dates = [...new Set(rows.map(row => row.expectedDate))].sort();
  return <section className="space-y-3" data-preserved-payments aria-labelledby="upcoming-ledger-heading">
    <div className="flex items-end justify-between gap-3 px-1">
      <h2 id="upcoming-ledger-heading" className="text-sm font-semibold text-slate-800 dark:text-slate-100">Upcoming</h2>
      <p className="text-xs text-slate-600 dark:text-slate-400">Covered payments stay folded</p>
    </div>
    {dates.map(date => <UpcomingAttentionDay key={date} dayKeyIso={date} heading={`${date === "2026-11-22" ? "Today · " : date === "2026-11-23" ? "Tomorrow · " : ""}${dateLabel(date)}`} rows={rows.filter(row => row.expectedDate === date)} onOpen={onOpen} onDismiss={onDismiss} />)}
  </section>;
}
