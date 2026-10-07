"use client";

import { useId, useState } from "react";
import { ChevronDown, CircleAlert, Info } from "lucide-react";
import TransactionRow from "@/components/TransactionRow";
import SpendPaceHero, { type SpendPaceHeroProps } from "@/components/SpendPaceHero";
import { spendHeroModel, spendHeroMoney } from "@/lib/spendHero";

/** B renders the approved production component; A is the unselected proposal. */
export default function SpendHeroScale({ variant, ...props }: SpendPaceHeroProps & { variant: "a" | "b" }) {
  return variant === "b" ? <SpendPaceHero {...props} /> : <HeadingLedProposal {...props} />;
}

function HeadingLedProposal({ verdict, incomeTxns, incomeLoading = false, onIncomeOpen, onTransactionClick, onOutTap, onMovedTap }: SpendPaceHeroProps) {
  const [incomeOpen, setIncomeOpen] = useState(false);
  const incomeId = useId();
  if (!verdict) return null;
  const model = spendHeroModel(verdict);
  const out = spendHeroMoney(verdict.pills.spent);
  const amountSize = out.length > 15 ? "text-xl" : out.length > 13 ? "text-2xl" : "text-[30px]";
  const label = "text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500 dark:text-slate-400";
  const action = "min-h-11 max-w-full rounded-md active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";
  const flow = `${action} inline-flex items-center gap-1 text-left font-mono text-base font-semibold tabular-nums text-slate-900 hover:text-indigo-700 dark:text-slate-100 dark:hover:text-indigo-300`;
  const period = verdict.period.closed ? "Completed pay period" : "This pay period";

  return <section data-g186-scale="a" className="glass-hero min-w-0 rounded-3xl p-5 shadow-sm sm:p-6" aria-label={`${period} spending summary`}>
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <h2 className="text-base font-bold text-slate-950 dark:text-white">{period}</h2>
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200 ${model.direction === "above" ? "bg-amber-50 dark:bg-amber-400/10" : "bg-slate-100 dark:bg-slate-700"}`}>
        {model.direction === "above" ? <CircleAlert size={13} className="text-amber-600 dark:text-amber-400" aria-hidden="true" /> : <Info size={13} className="text-slate-500 dark:text-slate-300" aria-hidden="true" />}
        {model.status}
      </span>
    </div>
    <div className="mt-4">
      <p className={label}>Out</p>
      <button data-out-amount type="button" onClick={onOutTap} aria-label={`Show spending behind ${out} out`} className={`${action} ${amountSize} whitespace-nowrap text-left font-mono font-bold leading-tight tracking-[-0.025em] tabular-nums text-slate-950 dark:text-white`}>{out}</button>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Day {verdict.period.days_elapsed}{model.totalDays != null ? ` of ${model.totalDays}` : ""}</p>
    </div>
    <p className="mt-3 text-pretty text-[13px] leading-5 text-slate-600 dark:text-slate-300">
      {model.difference == null || model.usual == null
        ? verdict.state === "early" ? "A reliable pace comparison appears later in the pay period."
          : verdict.pills.spent === 0 ? "There is no spending to compare yet." : "We need more spending history before showing your usual pace."
        : <>{model.direction === "level" ? "In line with" : <><span className="font-mono font-semibold tabular-nums">{spendHeroMoney(Math.abs(model.difference))}</span> {model.direction}</>} usual pace by day {verdict.period.days_elapsed}. Usual: <span className="font-mono font-semibold tabular-nums">{spendHeroMoney(model.usual)}</span>.</>}
    </p>
    <dl className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))] gap-x-4 gap-y-1 border-t border-slate-200 pt-3 dark:border-slate-700">
      <div className="min-w-0"><dt className={label}>In</dt><dd><button type="button" className={flow} aria-label="Show income payments" aria-expanded={incomeOpen} aria-controls={incomeId} onClick={() => { setIncomeOpen(!incomeOpen); if (!incomeOpen) onIncomeOpen?.(); }}><span className="whitespace-nowrap">{spendHeroMoney(verdict.pills.income)}</span><ChevronDown size={13} aria-hidden="true" className={`shrink-0 transition-transform motion-reduce:transition-none ${incomeOpen ? "rotate-180" : ""}`} /></button></dd></div>
      {model.hasMoved && <div className="min-w-0"><dt className={label}>Moved separately</dt><dd><button type="button" className={flow} aria-label="Show money moved separately" onClick={onMovedTap}><span className="whitespace-nowrap">{spendHeroMoney(model.moved)}</span></button></dd></div>}
    </dl>
    <div id={incomeId} hidden={!incomeOpen} className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-700">
      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Income this period</h3>
      {incomeLoading && incomeTxns.length === 0 ? <p role="status" className="mt-2 text-[13px] text-slate-600 dark:text-slate-300">Loading income payments…</p>
        : incomeTxns.length === 0 ? <p className="mt-2 text-[13px] text-slate-600 dark:text-slate-300">No income payments to show.</p>
          : <div className="mt-2 max-h-64 overflow-y-auto overscroll-contain">{incomeTxns.map(transaction => <TransactionRow key={transaction.id} transaction={transaction} onClick={() => onTransactionClick(transaction)} />)}</div>}
    </div>
    <details className="group mt-3 border-t border-slate-200 dark:border-slate-700">
      <summary className={`${action} flex cursor-pointer list-none items-center justify-between gap-3 text-[13px] font-semibold text-slate-700 dark:text-slate-200 [&::-webkit-details-marker]:hidden`}>How Out adds up <ChevronDown size={16} aria-hidden="true" className="shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none" /></summary>
      <dl className="space-y-2 pb-2 text-[13px] text-slate-700 dark:text-slate-200">
        {[{ label: "Named categories", amount: model.named }, { label: "Other categorised spending", amount: model.other }, ...(model.unresolved > 0 ? [{ label: "To categorise", amount: model.unresolved }] : [])].map(row => <div key={row.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3"><dt>{row.label}</dt><dd className="font-mono font-semibold tabular-nums">{spendHeroMoney(row.amount)}</dd></div>)}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-t border-slate-200 pt-2 font-semibold dark:border-slate-700"><dt>Total Out</dt><dd className="font-mono tabular-nums">{out}</dd></div>
      </dl>
      <p className="pb-2 text-xs text-slate-600 dark:text-slate-300">Moved separately is not included in Out.</p>
    </details>
  </section>;
}
