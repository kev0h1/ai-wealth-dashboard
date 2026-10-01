"use client";

import { useId, useState } from "react";
import { ChevronDown, CircleAlert, Info } from "lucide-react";
import TransactionRow from "@/components/TransactionRow";
import type { SpendVerdict, Transaction } from "@/lib/api";
import { spendHeroModel, spendHeroMoney } from "@/lib/spendHero";

export interface SpendPaceHeroProps {
  verdict: SpendVerdict | null;
  incomeTxns: Transaction[];
  incomeLoading?: boolean;
  onIncomeOpen?: () => void;
  onTransactionClick: (transaction: Transaction) => void;
  onOutTap: () => void;
  onMovedTap: () => void;
}

/** G186 A: one pace-led instrument, shared by the live page and its preview. */
export default function SpendPaceHero({
  verdict, incomeTxns, incomeLoading = false, onIncomeOpen,
  onTransactionClick, onOutTap, onMovedTap,
}: SpendPaceHeroProps) {
  const [incomeExpanded, setIncomeExpanded] = useState(false);
  const incomeId = useId();
  if (!verdict) return null;
  const model = spendHeroModel(verdict);
  const amber = model.direction === "above";
  const secondaryMoney = "mt-1 inline-flex min-h-11 max-w-full items-center break-all text-left font-mono text-lg font-bold tabular-nums text-slate-950 transition-colors hover:text-indigo-700 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 motion-reduce:transition-none dark:text-white dark:hover:text-indigo-300";

  return (
    <section data-g186-hero="a" data-tutorial-id="tutorial-spend-verdict" className="glass-hero min-w-0 rounded-3xl border border-white/70 bg-white/75 p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800/80 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-[-0.025em] text-slate-950 dark:text-white">{verdict.period.closed ? "Completed pay period" : "This pay period"}</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Day {verdict.period.days_elapsed}{model.totalDays != null ? ` of ${model.totalDays}` : ""}</p>
        </div>
        <span className={`inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${amber ? "bg-amber-50 text-slate-700 dark:bg-amber-400/10 dark:text-slate-200" : "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200"}`}>
          {amber ? <CircleAlert size={14} className="shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" /> : <Info size={14} className="shrink-0 text-slate-500 dark:text-slate-300" aria-hidden="true" />}
          {model.status}
        </span>
      </div>

      <div className="mt-7">
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-600 dark:text-slate-400">Out</p>
        <button type="button" onClick={onOutTap} aria-label={`Show spending behind ${spendHeroMoney(verdict.pills.spent)} out`} className="mt-1 min-h-11 max-w-full break-all text-left font-mono text-[clamp(2rem,10vw,2.5rem)] font-bold leading-tight tracking-[-0.035em] tabular-nums text-slate-950 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-white">
          {spendHeroMoney(verdict.pills.spent)}
        </button>
      </div>

      <p className="mt-3 text-pretty text-sm leading-5 text-slate-700 dark:text-slate-200">
        {model.difference == null || model.usual == null
          ? verdict.state === "early" ? "A reliable pace comparison appears later in the pay period."
            : verdict.pills.spent === 0 ? "There is no spending to compare yet."
              : "We need more spending history before showing your usual pace."
          : <>{model.direction === "level" ? "In line with" : <><span className="font-mono font-semibold tabular-nums">{spendHeroMoney(Math.abs(model.difference))}</span> {model.direction}</>} usual pace by day {verdict.period.days_elapsed}. Usual: <span className="font-mono font-semibold tabular-nums">{spendHeroMoney(model.usual)}</span>.</>}
      </p>

      <dl className="mt-6 grid grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] gap-x-4 border-t border-slate-200 pt-4 dark:border-slate-700">
        <div className="min-w-0">
          <dt className="text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-600 dark:text-slate-400">In</dt>
          <dd><button type="button" aria-label="Show income payments" aria-expanded={incomeExpanded} aria-controls={incomeId} className={secondaryMoney} onClick={() => {
            const next = !incomeExpanded;
            setIncomeExpanded(next);
            if (next) onIncomeOpen?.();
          }}>{spendHeroMoney(verdict.pills.income)}</button></dd>
        </div>
        {model.hasMoved && <div className="min-w-0">
          <dt className="text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-600 dark:text-slate-400">Moved separately</dt>
          <dd><button type="button" onClick={onMovedTap} aria-label="Show money moved separately" className={secondaryMoney}>{spendHeroMoney(model.moved)}</button></dd>
        </div>}
      </dl>

      <div id={incomeId} hidden={!incomeExpanded} className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-700">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Income this period</h3>
        {incomeLoading && incomeTxns.length === 0 ? <p role="status" className="mt-2 text-sm text-slate-600 dark:text-slate-300">Loading income payments…</p>
          : incomeTxns.length === 0 ? <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">No income payments to show.</p>
            : <div className="mt-2 max-h-64 overflow-y-auto overscroll-contain">{incomeTxns.map((transaction) => <TransactionRow key={transaction.id} transaction={transaction} onClick={() => onTransactionClick(transaction)} />)}</div>}
      </div>

      <details className="group mt-5 border-t border-slate-200 pt-1 dark:border-slate-700">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg text-sm font-semibold text-slate-700 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-200 [&::-webkit-details-marker]:hidden">
          How Out adds up <ChevronDown size={16} aria-hidden="true" className="shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
        </summary>
        <dl className="space-y-2 pb-2 text-sm text-slate-700 dark:text-slate-200">
          {[
            { label: "Named categories", amount: model.named },
            { label: "Other categorised spending", amount: model.other },
            ...(model.unresolved > 0 ? [{ label: "To categorise", amount: model.unresolved }] : []),
          ].map((row) => <div key={row.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4"><dt>{row.label}</dt><dd className="font-mono font-semibold tabular-nums">{spendHeroMoney(row.amount)}</dd></div>)}
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-t border-slate-200 pt-2 font-semibold dark:border-slate-700"><dt>Total Out</dt><dd className="font-mono tabular-nums">{spendHeroMoney(verdict.pills.spent)}</dd></div>
        </dl>
        <p className="pb-2 text-xs text-slate-600 dark:text-slate-300">Moved separately is not included in Out.</p>
      </details>
    </section>
  );
}
