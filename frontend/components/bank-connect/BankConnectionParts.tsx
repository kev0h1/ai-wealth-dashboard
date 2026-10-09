"use client";

import { ArrowRight, ChevronDown, ChevronRight, Landmark, LoaderCircle, Search, X } from "lucide-react";
import { useState, type RefObject } from "react";
import type { Bank } from "@/components/BankPickerSheet";
import { resolveApiAsset } from "@/lib/api";
import { AGENT_DISCLOSURE } from "@/lib/regulatoryCopy";

export const primary = "flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus-visible:ring-offset-slate-900";
export const quiet = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 dark:text-indigo-300 dark:hover:bg-slate-800";

export function BankMark({ bank }: { bank: Bank }) {
  const source = bank.logo ? resolveApiAsset(bank.logo) : null;
  const [failedSource, setFailedSource] = useState<string | null>(null);

  return <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-600">
    {/* The adjacent bank name remains the accessible label. */}
    {/* Provider logos are resolved through the API's same-origin asset proxy. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {source && source !== failedSource ? <img src={source} alt="" width={30} height={30} onError={() => setFailedSource(source)} className="size-[30px] object-contain" />
      : <Landmark size={22} aria-hidden="true" className="text-slate-500" />}
  </span>;
}

export function ChosenBank({ bank, onChange, disabled = false }: { bank: Bank; onChange(): void; disabled?: boolean }) {
  return <div className="flex items-center gap-3 border-b border-slate-200 pb-5 dark:border-slate-700" data-selected-bank>
    <BankMark bank={bank} />
    <div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold text-slate-900 dark:text-slate-100">{bank.name}</p><p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">Your selected bank</p></div>
    <button type="button" onClick={onChange} disabled={disabled} className={quiet} aria-label="Change bank">Change</button>
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

export function ContinueAction({ onContinue, pending = false }: { onContinue(): void; pending?: boolean }) {
  return <div>
    <p className="mb-3 text-xs leading-5 text-slate-600 dark:text-slate-300">Review permissions with Finexer next. Your bank then asks you to approve.</p>
    <button type="button" className={primary} onClick={onContinue} disabled={pending} aria-busy={pending}>
      {pending ? <><LoaderCircle size={16} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />Opening Finexer…<span className="sr-only"> Please wait</span></> : <>Continue to Finexer <ArrowRight size={16} aria-hidden="true" /></>}
    </button>
  </div>;
}

export function BankSearch({ query, setQuery, searchRef }: {
  query: string; setQuery(query: string): void; searchRef: RefObject<HTMLInputElement | null>;
}) {
  return <div data-journey-search className="w-full border-b border-slate-200 bg-white px-5 py-3 dark:border-slate-700 dark:bg-slate-900">
    <div className="relative h-11 rounded-xl bg-slate-100 focus-within:ring-2 focus-within:ring-indigo-500 dark:bg-slate-800">
      <Search size={17} aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 text-slate-600 dark:text-slate-300" />
      <input ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} name="bank-search" aria-label="Search banks" placeholder="Search banks…" type="search" autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} enterKeyHint="search" className="block h-11 w-full appearance-none rounded-xl bg-transparent pl-10 pr-11 text-base text-slate-900 caret-indigo-600 outline-none placeholder:text-slate-600 dark:text-slate-100 dark:caret-indigo-300 dark:placeholder:text-slate-300 [&::-webkit-search-cancel-button]:hidden" />
      {query && <button type="button" data-compact aria-label="Clear search" onClick={() => { setQuery(""); searchRef.current?.focus(); }} className="absolute right-0 top-0 flex size-11 items-center justify-center rounded-xl text-slate-600 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-300"><X size={17} aria-hidden="true" /></button>}
    </div>
  </div>;
}

export function BankResults({ banks, query, setQuery, searchRef, onChoose, selected, disabled = false, loading = false, error = null, onRetry }: {
  banks: Bank[]; query: string; setQuery(query: string): void; searchRef: RefObject<HTMLInputElement | null>;
  onChoose(bank: Bank): void; selected: Bank | null; disabled?: boolean; loading?: boolean; error?: string | null; onRetry?: () => void;
}) {
  const filtered = banks.filter(bank => bank.name.toLowerCase().includes(query.trim().toLowerCase()));
  const hasQuery = query.trim().length > 0;

  if (loading) return <div className="py-9 text-center" role="status" aria-live="polite"><LoaderCircle size={20} aria-hidden="true" className="mx-auto animate-spin text-slate-500 motion-reduce:animate-none dark:text-slate-300" /><p className="mt-3 text-sm text-slate-600 dark:text-slate-300">Loading banks…</p></div>;
  if (error) return <div className="py-9 text-center" role="alert"><h3 className="text-sm font-semibold">We could not load banks</h3><p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{error}</p>{onRetry && <button type="button" className={`${quiet} mt-2`} onClick={onRetry}>Try again</button>}</div>;

  return <div data-bank-results>
    <p role="status" aria-live="polite" className="sr-only">{filtered.length} {filtered.length === 1 ? "bank" : "banks"} found</p>
    {filtered.length ? <ul className="-mx-2 divide-y divide-slate-100 dark:divide-slate-800">{filtered.map(bank => <li key={bank.id}>
      <button type="button" aria-label={`Choose ${bank.name}`} data-flow-focus={`bank-${bank.id}`} onClick={() => onChoose(bank)} disabled={disabled} className="flex min-h-[68px] w-full items-center gap-3 rounded-lg px-2 py-3 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-slate-800">
        <BankMark bank={bank} /><span className="min-w-0 flex-1 break-words text-sm font-medium text-slate-900 dark:text-slate-100">{bank.name}{selected?.id === bank.id && <span className="mt-0.5 block text-xs font-normal text-slate-600 dark:text-slate-300">Selected</span>}</span><ChevronRight size={16} aria-hidden="true" className="shrink-0 text-slate-500 dark:text-slate-300" />
      </button>
    </li>)}</ul> : banks.length === 0 && !hasQuery
      ? <div className="py-9 text-center"><h3 className="text-sm font-semibold">No banks are available right now</h3><p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Please try again later.</p></div>
      : <div className="py-9 text-center"><h3 className="text-sm font-semibold">No banks found</h3><p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Try a different name or clear your search.</p><button type="button" className={`${quiet} mt-2`} onClick={() => { setQuery(""); searchRef.current?.focus(); }}>Show all banks</button></div>}
  </div>;
}

/** A159: how the review step merges into the bank list. Undefined keeps the
 *  approved G flow (choose, then review, then Continue to Finexer).
 *  "footer": the summary and the full sentence stay pinned under the list.
 *  "pinned-line": one pinned line that opens in place to the full sentence.
 *  "header": the summary and the full sentence sit above the search field. */
export type MergedStep = "footer" | "pinned-line" | "header";

export const MERGED_SUMMARY = "Read-only access, no payments. Tap a bank to review permissions and terms with Finexer, then approve with your bank.";
const SENTENCE_INK = "text-sm leading-[22px] text-slate-700 dark:text-slate-200";

export function MergedStatus({ pending, error }: { pending: boolean; error: string | null }) {
  if (error) return <p role="alert" className="mb-2 text-sm leading-5 text-slate-700 dark:text-slate-200">{error}</p>;
  if (pending) return <p role="status" className="mb-2 flex items-center gap-2 text-sm font-semibold leading-5 text-slate-900 dark:text-slate-100"><LoaderCircle size={16} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />Opening Finexer…</p>;
  return null;
}

/** The merged step's notice. The sentence is rendered from AGENT_DISCLOSURE, never retyped. */
export function MergedNotice({ mode, pending = false, error = null, defaultOpen = false }: {
  mode: MergedStep; pending?: boolean; error?: string | null; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (mode === "header") return <div data-merged-notice="header" className="border-b border-slate-200 px-5 py-3 dark:border-slate-700">
    <p className="text-sm font-semibold leading-5 text-slate-900 dark:text-slate-100">{MERGED_SUMMARY}</p>
    <p data-agent-disclosure className={`mt-2 ${SENTENCE_INK}`}>{AGENT_DISCLOSURE}</p>
  </div>;
  return <div data-merged-notice={mode}>
    <MergedStatus pending={pending} error={error} />
    <p className="text-xs leading-5 text-slate-600 dark:text-slate-300">{MERGED_SUMMARY}</p>
    {mode === "footer" ? <p data-agent-disclosure className={`mt-2 border-t border-slate-200 pt-2 dark:border-slate-700 ${SENTENCE_INK}`}>{AGENT_DISCLOSURE}</p> : <>
      <button type="button" aria-expanded={open} aria-controls="merged-notice-region" onClick={() => setOpen(o => !o)}
        className="mt-1 flex min-h-11 w-full items-center justify-between gap-3 rounded-lg text-left text-sm font-semibold text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300">
        <span>Regulated by the FCA through Finexer LTD</span>
        <ChevronDown size={16} aria-hidden="true" className={`shrink-0 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
      </button>
      <div id="merged-notice-region" hidden={!open}><p data-agent-disclosure className={`pb-1 ${SENTENCE_INK}`}>{AGENT_DISCLOSURE}</p></div>
    </>}
  </div>;
}
