"use client";

import { Check } from "lucide-react";
import type { UpcomingRowModel } from "./UpcomingRow";
import { getUpcomingStatus, upcomingMoney } from "@/lib/upcomingAttention";

export function upcomingDate(iso: string) {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
}

function LedgerLine({ label, amount }: { label: string; amount: number }) {
  return <div className="flex items-baseline justify-between gap-4"><dt className="text-slate-600 dark:text-slate-300">{label}</dt><dd className="shrink-0 font-mono font-medium tabular-nums text-slate-900 dark:text-slate-100">{upcomingMoney(amount)}</dd></div>;
}

export default function UpcomingRowDetails({ model }: { model: UpcomingRowModel }) {
  const status = getUpcomingStatus(model);
  const account = model.accountLabel || "the paying account";
  const coverage = model.coverage;
  const hasAccountWorking = !model.isSettling && !model.isCreditCard && model.assessment !== "future" && model.assessment !== "unverified" && coverage?.before !== undefined && coverage.after !== undefined;
  return <div className="space-y-5">
    <div>
      <p className="font-mono text-3xl font-bold tabular-nums text-slate-950 dark:text-slate-50">{upcomingMoney(model.type === "income" ? model.amount : -model.amount, true)}</p>
      {model.amountBasis === "balance_estimate" && <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">Estimated amount</p>}
    </div>
    <div className="space-y-2 text-sm leading-6">
      <h3 className="flex items-start gap-2 font-semibold text-slate-900 dark:text-slate-100">
        {status.tone !== "neutral" ? <span aria-hidden="true" className={`mt-2 size-1.5 shrink-0 rounded-full ${status.tone === "risk" ? "bg-red-600 dark:bg-red-400" : "bg-amber-600 dark:bg-amber-400"}`} /> : status.kind === "covered" ? <Check aria-hidden="true" size={16} className="mt-1 shrink-0" /> : null}
        <span>{status.shortfall !== undefined && <><span className="font-mono tabular-nums">{upcomingMoney(status.shortfall)}</span> </>}{status.label}{status.shortfall !== undefined && model.accountLabel ? ` in ${model.accountLabel}` : ""}</span>
      </h3>
      {model.isSettling ? <p className="text-slate-600 dark:text-slate-300">The bank has already included this payment in your balance. It is still settling, so it is not deducted again.</p>
        : model.type === "income" ? <p className="text-slate-600 dark:text-slate-300">This is expected income{model.accountLabel ? ` into ${model.accountLabel}` : ""}, not money already received.</p>
        : model.assessment === "future" ? <p className="text-slate-600 dark:text-slate-300">This is in the next pay period, outside the current account-coverage check.</p>
        : model.isCreditCard ? <p className="text-slate-600 dark:text-slate-300">This is a charge on your card, not cash leaving a bank account. Your card repayment is assessed separately.</p>
        : hasAccountWorking ? <p className="text-slate-600 dark:text-slate-300">The forecast includes earlier payments and money expected into {account}. It is a projection, not a live balance.</p>
        : <p className="text-slate-600 dark:text-slate-300">Coverage in the paying account cannot be verified from the available information. The overall cash forecast alone does not confirm this payment is covered.</p>}
      {!model.isSettling && (model.pending || (model.daysPastDue ?? 0) > 0) && <p className="text-slate-600 dark:text-slate-300">{model.isMovement ? "Planned" : "Expected"} for {upcomingDate(model.originalDate ?? model.expectedDate)}, but {model.type === "income" ? "we have not seen it arrive" : "we have not seen it leave"}.{!model.isMovement && model.type === "bill" ? " Check with the provider if it is overdue." : ""}</p>}
      {!model.isSettling && model.isMovement && <p className="text-slate-600 dark:text-slate-300">An unfunded move to your own account may stay put. There is no fee, and moving money does not reduce what you own.</p>}
      {model.why?.culprit && !model.isSettling && <p className="text-slate-600 dark:text-slate-300">This forecast includes a <span className="font-mono tabular-nums">{upcomingMoney(model.why.culprit.amount)}</span> move on {upcomingDate(model.why.culprit.expectedDate)} before this payment.</p>}
    </div>
    {hasAccountWorking && <dl className="space-y-3 text-sm">
      <LedgerLine label={`Before, in ${account}`} amount={coverage!.before!} />
      <LedgerLine label={model.isMovement ? "Planned move" : "This payment"} amount={-model.amount} />
      <div className="border-t border-slate-200 pt-3 dark:border-slate-700"><LedgerLine label={`After, in ${account}`} amount={coverage!.after!} /></div>
    </dl>}
    {model.after.kind === "balance" && <dl className="text-sm"><LedgerLine label="Projected cash overall after this" amount={model.after.value} /></dl>}
    {model.after.kind === "pooled-transfer" && <p className="text-xs leading-5 text-slate-600 dark:text-slate-400">This transfer stays within your spendable accounts, so it does not reduce your overall cash forecast.</p>}
    {model.createdViaPenny && <p className="text-xs text-slate-600 dark:text-slate-400">Set up with Penny.</p>}
  </div>;
}
