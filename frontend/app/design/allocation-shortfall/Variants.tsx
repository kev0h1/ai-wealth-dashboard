"use client";

// G217 allocation-shortfall card treatments (skill: impeccable; first drafts by
// openai/gpt-6-astra, rewritten to DESIGN.md). The payment card above each is
// the PRODUCTION MoveCard. The allocation card has no production component
// yet, so these are hand-authored on the SHIPPED tokens exported from
// components/HomeBrief.tsx (BRIEF_CARD, SECONDARY_ACTION, BriefIcon, KindLabel,
// DismissChip, MoveAccountIcon). The "account plan" context in C is a stand-in.

import { useState, type ReactNode } from "react";
import { PiggyBank } from "lucide-react";
import { BRIEF_CARD, BriefIcon, DismissChip, KindLabel, MoveAccountIcon, SECONDARY_ACTION } from "@/components/HomeBrief";
import { SheetFrame } from "@/components/SheetFrame";
import { gbp, gbpWhole, type AllocationShortfall } from "./fixtures";

const Money = ({ children }: { children: ReactNode }) => <span className="money">{children}</span>;

function accountLine(s: AllocationShortfall): string {
  return s.estimated ? `Paid from ${s.payingAccount.name}, based on recent transfers.` : `Paid from ${s.payingAccount.name}.`;
}

function Caption({ s }: { s: AllocationShortfall }) {
  return (
    <>
      <p className="text-[12px] leading-5 text-slate-600 dark:text-slate-400">
        <Money>{gbpWhole(s.allocation.amount_per_period)}</Money> set aside this period. {accountLine(s)}
      </p>
      {!s.source && (
        <p className="mt-1 text-[12px] leading-5 text-slate-600 dark:text-slate-400">
          No other account can safely spare <Money>{gbp(s.shortfall)}</Money> right now.
        </p>
      )}
    </>
  );
}

const noop = () => {};

// A: same anatomy as the payment card, lower weight.
export function VariantA({ s }: { s: AllocationShortfall }) {
  const name = s.allocation.name;
  return (
    <div data-allocation-card="a" className={`${BRIEF_CARD} !shadow-none p-4`}>
      <div className="flex items-start gap-3 pr-9">
        <BriefIcon><PiggyBank size={16} /></BriefIcon>
        <div className="min-w-0 flex-1">
          <KindLabel>Set-aside</KindLabel>
          <p className="mt-1 text-pretty text-[15px] font-bold leading-6 text-slate-900 dark:text-slate-100">Your {name} set-aside is short</p>
        </div>
      </div>
      <div className="mt-3">
        <p className="money text-[18px] font-semibold leading-6 text-slate-900 dark:text-white">{gbp(s.shortfall)}</p>
        <p className="text-[12px] text-slate-500 dark:text-slate-400">short this period</p>
      </div>
      <div className="mt-2"><Caption s={s} /></div>
      <div className={`mt-4 grid gap-2 ${s.source ? "grid-cols-2" : "grid-cols-1"}`}>
        {s.source && <button type="button" onClick={noop} className={`${SECONDARY_ACTION} text-center leading-tight`}>Move from {s.source.name}</button>}
        <button type="button" onClick={noop} className={`${SECONDARY_ACTION} text-center leading-tight`}>Reduce set-aside</button>
      </div>
      <DismissChip label={`Dismiss ${name} set-aside note`} onClick={noop} className="absolute top-2 right-2 z-10" />
    </div>
  );
}

const TEXT_ACTION = "inline-flex min-h-11 touch-manipulation items-center justify-center rounded-xl px-3 text-[13px] font-semibold text-slate-700 underline decoration-slate-300 underline-offset-4 [-webkit-tap-highlight-color:transparent] active:scale-95 transition-[transform,background-color] duration-150 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 [@media(hover:hover)]:hover:bg-slate-100 dark:text-slate-200 dark:decoration-slate-500 dark:[@media(hover:hover)]:hover:bg-slate-700";

// B: plan note. Name leads, figure second, equal text actions, softer surface.
export function VariantB({ s }: { s: AllocationShortfall }) {
  const name = s.allocation.name;
  return (
    <div data-allocation-card="b" className="relative rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
      <KindLabel>Set-aside</KindLabel>
      <p className="mt-1 pr-11 text-[15px] font-bold leading-6 text-slate-900 dark:text-slate-100">{name}</p>
      <p className="mt-0.5 text-[13px] leading-5 text-slate-700 dark:text-slate-300">
        <span className="money font-semibold text-slate-900 dark:text-white">{gbp(s.shortfall)}</span> short this period
      </p>
      <div className="mt-1"><Caption s={s} /></div>
      <div className="-mx-3 mt-2 flex flex-wrap items-center gap-x-1">
        {s.source && <button type="button" onClick={noop} className={TEXT_ACTION}>Move from {s.source.name}</button>}
        <button type="button" onClick={noop} className={TEXT_ACTION}>Reduce set-aside</button>
      </div>
      <DismissChip label={`Dismiss ${name} set-aside note`} onClick={noop} className="absolute top-2 right-2 z-10" />
    </div>
  );
}

// C: inline ledger line in an account's plan context, one Fix, two-option sheet.
export function VariantC({ s, sheetOpen: initialOpen = false }: { s: AllocationShortfall; sheetOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const name = s.allocation.name;
  const planned = s.allocation.amount_per_period;
  const option = "flex min-h-11 w-full touch-manipulation flex-col items-start justify-center gap-0.5 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-sm font-semibold text-slate-700 [-webkit-tap-highlight-color:transparent] active:scale-[0.98] transition-[transform,background-color] duration-150 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 [@media(hover:hover)]:hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:[@media(hover:hover)]:hover:bg-slate-700";
  return (
    <div data-allocation-card="c" className={`${BRIEF_CARD} !shadow-none p-4`}>
      <div className="flex items-center gap-2.5">
        <MoveAccountIcon account={s.payingAccount} size={28} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-slate-800 dark:text-slate-100">{s.payingAccount.name}</p>
          <p className="text-[12px] text-slate-500 dark:text-slate-400">Plans this period</p>
        </div>
      </div>
      <div className="mt-2 divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-700/70 dark:border-slate-700/70">
        <div className="flex items-center justify-between gap-3 py-2.5 text-[13px] text-slate-700 dark:text-slate-300">
          <span>British Gas, 9 Oct</span><Money>£100</Money>
        </div>
        <div className="flex items-center justify-between gap-3 py-2.5 text-[13px] text-slate-700 dark:text-slate-300">
          <span>{name} set-aside</span><Money>{gbpWhole(planned)}</Money>
        </div>
        <div data-ledger-short className="flex items-start gap-1 py-1.5">
          <div className="min-w-0 flex-1 py-1.5">
            <p className="text-[13px] leading-5 text-slate-900 dark:text-slate-100"><span className="money font-semibold">{gbp(s.shortfall)}</span> short for {name}</p>
            <Caption s={s} />
          </div>
          <button type="button" onClick={() => setOpen(true)} aria-label={`Fix ${name} set-aside shortfall`} className={TEXT_ACTION}>Fix</button>
          <DismissChip label={`Dismiss ${name} set-aside note`} onClick={noop} className="shrink-0" />
        </div>
      </div>
      {open && (
        <SheetFrame variant="compact" title={`Adjust this period's ${name} set-aside`} description="Choose either option. Neither changes your future set-asides." onClose={() => setOpen(false)}>
          <div className="space-y-2">
            {s.source && (
              <button type="button" onClick={() => setOpen(false)} className={option}>
                Move from {s.source.name}
                <span className="text-[12px] font-normal leading-5 text-slate-600 dark:text-slate-400">Move <Money>{gbp(s.shortfall)}</Money>. {s.source.name} can safely spare it.</span>
              </button>
            )}
            <button type="button" onClick={() => setOpen(false)} className={option}>
              Reduce set-aside
              <span className="text-[12px] font-normal leading-5 text-slate-600 dark:text-slate-400">Set aside <Money>{gbp(planned - s.shortfall)}</Money> instead of <Money>{gbpWhole(planned)}</Money> this period.</span>
            </button>
            {!s.source && <p className="px-1 pt-1 text-[12px] leading-5 text-slate-600 dark:text-slate-400">No other account can safely spare <Money>{gbp(s.shortfall)}</Money> right now.</p>}
          </div>
        </SheetFrame>
      )}
    </div>
  );
}
