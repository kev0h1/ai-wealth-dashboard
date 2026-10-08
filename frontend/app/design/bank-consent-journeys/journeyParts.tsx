"use client";

import { ArrowRight, ChevronRight, Landmark, Search, X } from "lucide-react";
import type { RefObject } from "react";
import type { Bank } from "@/components/BankPickerSheet";
import { AGENT_DISCLOSURE } from "@/lib/regulatoryCopy";

export type Journey = "g" | "h" | "i";
export const DIRECTIONS = [
  { id: "g", title: "Bank first", route: "Choose → Review → Finexer", description: "A focused reading step, once you know which bank you are connecting.", tradeoff: "Clearest separation. One extra step in Sorted." },
  { id: "h", title: "One continuous page", route: "Choose and review → Finexer", description: "Choose a bank and the list folds into a summary. The explanation stays on the same page.", tradeoff: "Less back and forth. More content in one place." },
  { id: "i", title: "Notice at consent", route: "Choose → Review with Finexer", description: "Bring the wording into the existing Finexer consent step, without another Sorted screen.", tradeoff: "Needs Finexer approval before it could be used." },
] as const;

export const primary = "flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900";
export const quiet = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300 dark:hover:bg-slate-800";

export function BankMark({ bank }: { bank: Bank }) {
  return <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-600">
    {/* Local fixture assets only. The adjacent name is the accessible label. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {bank.logo ? <img src={bank.logo} alt="" width={30} height={30} className="size-[30px] object-contain" /> : <Landmark size={22} aria-hidden="true" className="text-slate-500" />}
  </span>;
}

export function ChosenBank({ bank, onChange }: { bank: Bank; onChange(): void }) {
  return <div className="flex items-center gap-3 border-b border-slate-200 pb-5 dark:border-slate-700" data-selected-bank>
    <BankMark bank={bank} />
    <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{bank.name}</p><p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">Your selected bank</p></div>
    <button type="button" onClick={onChange} className={quiet} aria-label="Change bank">Change</button>
  </div>;
}

export function ConnectionNotice() {
  return <div data-connection-notice>
    <section className="py-5" aria-labelledby="connection-scope">
      <h3 id="connection-scope" className="text-sm font-semibold text-slate-900 dark:text-slate-100">See your money in one place</h3>
      <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">Read-only access to account details, balances and transactions. This connection does not authorise a payment.</p>
    </section>
    <section aria-labelledby="connection-provider" className="border-t border-slate-200 pt-5 dark:border-slate-700">
      <h3 id="connection-provider" className="text-sm font-semibold text-slate-900 dark:text-slate-100">Who provides the connection</h3>
      <p data-agent-disclosure className="mt-2 text-[13px] leading-[22px] text-slate-600 dark:text-slate-300">{AGENT_DISCLOSURE}</p>
    </section>
  </div>;
}

export function ContinueAction({ onContinue }: { onContinue(): void }) {
  return <div>
    <p className="mb-3 text-xs leading-5 text-slate-600 dark:text-slate-300">Review permissions with Finexer next. Your bank then asks you to approve.</p>
    <button type="button" className={primary} onClick={onContinue}>Continue to Finexer <ArrowRight size={16} aria-hidden="true" /></button>
  </div>;
}

export function BankChooser({ banks, query, setQuery, searchRef, onChoose, selected }: {
  banks: Bank[]; query: string; setQuery(query: string): void;
  searchRef: RefObject<HTMLInputElement | null>; onChoose(bank: Bank): void; selected: Bank | null;
}) {
  const filtered = banks.filter(bank => bank.name.toLowerCase().includes(query.trim().toLowerCase()));
  return <div data-bank-chooser>
    <div data-journey-search className="sticky top-0 z-10 -mx-5 border-b border-slate-200 bg-white px-5 pb-3 pt-2 dark:border-slate-700 dark:bg-slate-900">
      <div className="relative h-11 rounded-xl bg-slate-100 focus-within:ring-2 focus-within:ring-indigo-500 dark:bg-slate-800">
        <Search size={17} aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 text-slate-600 dark:text-slate-300" />
        <input ref={searchRef} value={query} onChange={e => setQuery(e.target.value)} name="bank-search" aria-label="Search banks" placeholder="Search banks…" type="search" autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} enterKeyHint="search" className="block h-11 w-full appearance-none rounded-xl bg-transparent pl-10 pr-11 text-base text-slate-900 caret-indigo-600 outline-none placeholder:text-slate-600 dark:text-slate-100 dark:caret-indigo-300 dark:placeholder:text-slate-300 [&::-webkit-search-cancel-button]:hidden" />
        {query && <button type="button" data-compact aria-label="Clear search" onClick={() => { setQuery(""); searchRef.current?.focus(); }} className="absolute right-0 top-0 flex size-11 items-center justify-center rounded-xl text-slate-600 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-300"><X size={17} aria-hidden="true" /></button>}
      </div>
    </div>
    <p role="status" aria-live="polite" className="sr-only">{filtered.length} {filtered.length === 1 ? "bank" : "banks"} found</p>
    {filtered.length ? <ul className="-mx-2 divide-y divide-slate-100 dark:divide-slate-800">{filtered.map(bank => <li key={bank.id}>
      <button type="button" aria-label={`Choose ${bank.name}`} data-flow-focus={`bank-${bank.id}`} onClick={() => onChoose(bank)} className="flex min-h-[68px] w-full items-center gap-3 rounded-lg px-2 py-3 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:hover:bg-slate-800">
        <BankMark bank={bank} /><span className="min-w-0 flex-1 text-sm font-medium text-slate-900 dark:text-slate-100">{bank.name}{selected?.id === bank.id && <span className="mt-0.5 block text-xs font-normal text-slate-600 dark:text-slate-300">Selected</span>}</span><ChevronRight size={16} aria-hidden="true" className="shrink-0 text-slate-500 dark:text-slate-300" />
      </button>
    </li>)}</ul> : <div className="py-9 text-center"><h3 className="text-sm font-semibold">No banks found</h3><p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Try a different name or clear your search.</p><button type="button" className={`${quiet} mt-2`} onClick={() => { setQuery(""); searchRef.current?.focus(); }}>Show all banks</button></div>}
  </div>;
}
