"use client";

// G242 round 2: the transactions hub with an aim, for Kevin's refinement (1).
//
// WHAT IS PRODUCTION HERE and what is not. The hub page itself
// (app/transactions/TransactionsPage.tsx) fetches its own data (the search
// endpoint, the accounts cache, the savings insights) and reads its filters from
// the URL, so it cannot take fixture transactions through props without a
// refactor that is out of scope for a design round. This file therefore
// hand-authors only the page shell (sticky header, search field, scope line),
// copied from that page, and renders everything that carries the design through
// the REAL parts: FilterChips and FilterTrigger, groupByDay, TransactionRow,
// TipsLine (and the InsightCard inside it) and AimRing. The aim block is new and
// lives here until Kevin agrees it.
import { ArrowLeft, ChevronRight, Search, Target } from "lucide-react";
import { FilterChips, FilterTrigger as Trigger } from "@/components/TransactionFilterChips";
import TransactionRow from "@/components/TransactionRow";
import { TipsLine } from "@/components/TipsLine";
import MoneyText from "@/components/MoneyText";
import { AimRing } from "@/components/AimProgress";
import { aimPace } from "@/lib/aimPace";
import { fmtWhole } from "@/lib/aimFormat";
import { groupByDay } from "@/lib/transactionGrouping";
import type { Checkpoint, SavingsInsight, Transaction } from "@/lib/api";
import type { SearchFilters } from "@/lib/transactionFilters";


export interface HubMockProps {
  category: string;
  transactions: Transaction[];
  from: string;
  to: string;
  aim: Checkpoint | null;
  suggestedAim: number | null;
  periodDays: number;
  tips: SavingsInsight[];
  onBack: () => void;
  /** Opens the aim editor (set when there is no aim, edit or remove when there is). */
  onOpenEditor: () => void;
}

/** The aim block: a row, not a card, in the same grammar as the tips line beneath it. */
export function HubAim({ category, aim, suggestedAim, periodDays, onOpenEditor }: Pick<HubMockProps, "category" | "aim" | "suggestedAim" | "periodDays" | "onOpenEditor">) {
  if (!aim) {
    return (
      <button
        type="button"
        onClick={onOpenEditor}
        className="flex min-h-[44px] w-full items-start gap-2.5 py-2.5 text-left transition-opacity active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <Target size={14} className="mt-0.5 flex-shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
        <span className="min-w-0 flex-1 text-[13px] leading-snug text-slate-600 dark:text-slate-400">
          {suggestedAim != null
            ? <MoneyText text={`A pace to check ${category} against? Your usual would put it near ${fmtWhole(suggestedAim, "£")} a period.`} />
            : `A pace to check ${category} against?`}
          {" "}
          <span className="font-semibold text-indigo-700 dark:text-indigo-300">Set an aim</span>
        </span>
        <ChevronRight size={14} className="mt-0.5 flex-shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
      </button>
    );
  }
  const p = aimPace(aim, periodDays);
  return (
    <div className="flex items-start gap-3 py-2.5">
      <div className="mt-0.5 flex-shrink-0 [&>svg]:h-8 [&>svg]:w-8"><AimRing aim={aim} periodDays={periodDays} /></div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">
          <MoneyText text={`${fmtWhole(aim.spent_so_far, "£")} of a ${fmtWhole(aim.aim_amount, "£")} aim`} />
          <span className="font-normal text-slate-600 dark:text-slate-400"> · {p.phrase}</span>
        </p>
        <p className="mt-0.5 text-[12px] leading-snug text-slate-600 dark:text-slate-400">
          <MoneyText text={`An even pace would be about ${fmtWhole(p.paceToday, "£")} by today.`} /> A pace check, not a limit.
        </p>
        <button
          type="button"
          onClick={onOpenEditor}
          className="inline-flex min-h-[44px] items-center text-[13px] font-semibold text-indigo-700 transition-opacity active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300"
        >
          Edit or remove this aim
        </button>
      </div>
    </div>
  );
}

function periodChipFrom(from: string, to: string): SearchFilters {
  return { category: null, categories: null, merchants: null, from, to, txnType: null };
}

export default function HubMock({ category, transactions, from, to, aim, suggestedAim, periodDays, tips, onBack, onOpenEditor }: HubMockProps) {
  const filters: SearchFilters = { ...periodChipFrom(from, to), category };
  const noop = () => {};
  return (
    <div className="-mx-4 -mt-5">
      <div className="sticky top-0 z-10 border-b border-slate-200/60 bg-[#f0f2f7]/90 backdrop-blur-sm dark:border-slate-700/60 dark:bg-[#0f172a]/90">
        <div className="flex items-center gap-3 px-4 pb-3 pt-6">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="glass-tile flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full transition-transform active:scale-95"
          >
            <ArrowLeft size={18} className="text-slate-500 dark:text-slate-400" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400">Every payment</p>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Search</h1>
          </div>
          <Trigger active onOpen={noop} />
        </div>
      </div>

      <div className="px-4 pb-2 pt-4">
        <div className="relative">
          <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
          <input
            type="search"
            readOnly
            aria-label="Search transactions"
            placeholder="Search transactions…"
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-9 text-sm text-slate-900 shadow-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
          />
        </div>
        <div className="mt-2 flex min-h-[28px] flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-slate-600 dark:text-slate-400">Searching all accounts</p>
        </div>
        <FilterChips
          filters={filters}
          categoryLabel={null}
          onClearCategory={noop}
          onClearDirection={noop}
          onClearMerchants={noop}
          onClearPeriod={noop}
          onClearAll={noop}
          treatment="tint"
          className="mt-2"
        />

        {/* Round 2: the aim sits directly under the chips, above the tips line, only
            when a single category is filtered (the same condition the tips line has). */}
        <div className="mt-1 divide-y divide-slate-200/70 dark:divide-slate-700/70">
          <HubAim category={category} aim={aim} suggestedAim={suggestedAim} periodDays={periodDays} onOpenEditor={onOpenEditor} />
          {tips.length > 0 && (
            <div>
              <TipsLine key={category} category={category} tips={tips} />
            </div>
          )}
        </div>
      </div>

      <div className="space-y-4 px-4 pt-2">
        {groupByDay(transactions).map((g) => (
          <section key={g.key} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <h2 className="px-4 pb-1 pt-4 text-sm font-bold text-slate-950 dark:text-slate-50">{g.heading}</h2>
            <div className="divide-y divide-slate-100 dark:divide-slate-700">
              {g.rows.map((tx) => (
                <TransactionRow key={tx.id} transaction={tx} onClick={noop} iconVariant="category" showDate={false} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
