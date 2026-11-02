"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Building2, Check, ChevronRight, Minus, Search, X } from "lucide-react";
import { AGENT_DISCLOSURE, TRADING_NAME_DISCLOSURE } from "@/lib/regulatoryCopy";
import { providerHealthNotice } from "@/lib/providerHealth";

type Coverage = "CSK" | "CS" | "C" | "K" | "unknown";
type Bank = { id: string; name: string; logo?: string; coverage: Coverage };

// Preview-only fixture based on the dated A186 board note. This is deliberately
// not a provider response or a proposed production API contract.
const banks: Bank[] = [
  { id: "barclays_personal", name: "Barclays", logo: "/banks/barclays.png", coverage: "CSK" },
  { id: "chase_uk", name: "Chase", logo: "/banks/chase.png", coverage: "CSK" },
  { id: "hsbc_personal", name: "HSBC", logo: "/banks/hsbc.png", coverage: "CSK" },
  { id: "monzo", name: "Monzo", logo: "/banks/monzo.png", coverage: "C" },
  { id: "nationwide", name: "Nationwide", logo: "/banks/nationwide.png", coverage: "CSK" },
  { id: "natwest", name: "NatWest", logo: "/banks/natwest.png", coverage: "CSK" },
  { id: "revolut", name: "Revolut", logo: "/banks/revolut.png", coverage: "C" },
  { id: "starling", name: "Starling Bank", logo: "/banks/starling.png", coverage: "C" },
  { id: "amex", name: "American Express", logo: "/banks/amex.png", coverage: "K" },
  { id: "mbna", name: "MBNA", coverage: "K" },
  { id: "barclaycard_uk", name: "Barclaycard", coverage: "K" },
  { id: "boi", name: "Bank of Ireland", coverage: "CS" },
  { id: "tide", name: "Tide", coverage: "C" },
  { id: "zempler", name: "Zempler", coverage: "CS" },
  { id: "example_unknown", name: "Example Bank", coverage: "unknown" },
];

const coverageWords: Record<Exclude<Coverage, "unknown">, string> = {
  CSK: "Current accounts, savings and credit cards",
  CS: "Current accounts and savings",
  C: "Current accounts only",
  K: "Credit cards only",
};

function BankLogo({ bank }: { bank: Bank }) {
  return <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-600 dark:bg-slate-800">
    {bank.logo ? <img src={bank.logo} alt="" width={30} height={30} className="size-7 object-contain" /> : <Building2 size={20} aria-hidden="true" className="text-slate-500 dark:text-slate-300" />}
  </span>;
}

function Coverage({ coverage, variant, legend = false }: { coverage: Coverage; variant: "a" | "b"; legend?: boolean }) {
  if (coverage === "CSK") return null;
  if (coverage === "unknown") return <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">Coverage unavailable for this bank</p>;
  if (variant === "a") return <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">{coverageWords[coverage]}</p>;
  const has = (mark: string) => coverage.includes(mark);
  return <><div className="mt-2 flex flex-wrap gap-1.5" aria-label={`Coverage: ${coverageWords[coverage]}`}>
    {[["C", "Current"], ["S", "Savings"], ["K", "Cards"]].map(([mark, label]) => <span key={mark} className={`inline-flex min-h-6 items-center rounded-md border px-1.5 text-[11px] font-semibold ${has(mark) ? "border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200" : "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"}`}>
      {has(mark) ? <Check size={12} aria-hidden="true" className="mr-1" /> : <Minus size={12} aria-hidden="true" className="mr-1" />}{label}<span className="sr-only"> {has(mark) ? "included" : "not listed"}</span>
    </span>)}
  </div>{legend && <p className="mt-2 text-[11px] leading-4 text-slate-500 dark:text-slate-400"><Check size={11} aria-hidden="true" className="mr-1 inline" />Tick: listed <span aria-hidden="true">·</span> <Minus size={11} aria-hidden="true" className="mx-1 inline" />Dash: not listed</p>}</>;
}

function HealthNotice({ bank }: { bank: Bank }) {
  return <p role="status" className="border-b border-slate-200 py-4 text-sm leading-6 text-slate-700 dark:border-slate-700 dark:text-slate-200"><span aria-hidden="true" className="mr-2 inline-block size-2 rounded-full bg-amber-500" />{providerHealthNotice(bank.name, "degraded")}</p>;
}

export default function BankCoverageClient() {
  const params = useSearchParams();
  const variant = params.get("variant") === "b" ? "b" : "a";
  const state = params.get("state") ?? "normal";
  const dark = params.get("mode") === "dark";
  const clean = params.get("clean") === "1";
  const first = state === "unknown" ? banks.find(bank => bank.coverage === "unknown")! : state === "health" ? banks.find(bank => bank.id === "monzo")! : null;
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Bank | null>(first);
  const [review, setReview] = useState(Boolean(first));
  const [handoff, setHandoff] = useState(false);
  const [retriedEmpty, setRetriedEmpty] = useState(false);
  const reviewHeadingRef = useRef<HTMLHeadingElement>(null);
  const handoffHeadingRef = useRef<HTMLHeadingElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  const selectedRowRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const ready = useCallback((node: HTMLElement | null) => { if (node) node.setAttribute("data-g395-ready", "true"); }, []);
  const shown = state === "empty" && !retriedEmpty ? [] : banks.filter(bank => bank.name.toLowerCase().includes(query.trim().toLowerCase()));

  function choose(bank: Bank) { setSelected(bank); setReview(true); setHandoff(false); }
  function returnToList() { setReview(false); requestAnimationFrame(() => selectedRowRef.current?.focus()); }
  function returnToReview() { setHandoff(false); requestAnimationFrame(() => continueRef.current?.focus()); }
  function clearSearch() { setQuery(""); requestAnimationFrame(() => searchRef.current?.focus()); }
  useEffect(() => { if (review) requestAnimationFrame(() => reviewHeadingRef.current?.focus()); }, [review]);
  useEffect(() => { if (handoff) requestAnimationFrame(() => handoffHeadingRef.current?.focus()); }, [handoff]);
  const href = (next: Record<string, string>) => {
    const values = new URLSearchParams({ variant, mode: dark ? "dark" : "light", state, ...(clean ? { clean: "1" } : {}) });
    Object.entries(next).forEach(([key, value]) => values.set(key, value));
    return `?${values.toString()}`;
  };
  return <main ref={ready} onKeyDown={event => { if (event.key !== "Escape") return; if (handoff) { event.preventDefault(); returnToReview(); } else if (review) { event.preventDefault(); returnToList(); } }} className={dark ? "dark min-h-dvh bg-[#0f172a] text-slate-100" : "min-h-dvh bg-[#f0f2f7] text-slate-900"}>
    <div className="mx-auto max-w-5xl px-3 py-4 sm:px-5 sm:py-8">
      {!clean && <header className="mb-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600 dark:text-slate-300"><div><p className="font-semibold text-slate-900 dark:text-slate-100">G395 · Bank coverage</p><p className="mt-0.5 text-xs">Preview only. No connection starts.</p></div><div className="flex gap-2"><a className="inline-flex min-h-11 items-center rounded-lg px-3 font-semibold text-indigo-700 hover:bg-white focus-visible:outline-2 focus-visible:outline-indigo-500 dark:text-indigo-300 dark:hover:bg-[#1e293b]" href={href({ variant: variant === "a" ? "b" : "a" })}>Variant {variant === "a" ? "B" : "A"}</a><a className="inline-flex min-h-11 items-center rounded-lg px-3 font-semibold text-indigo-700 hover:bg-white focus-visible:outline-2 focus-visible:outline-indigo-500 dark:text-indigo-300 dark:hover:bg-[#1e293b]" href={href({ mode: dark ? "light" : "dark" })}>{dark ? "Light" : "Dark"}</a></div></header>}
      <section className="mx-auto flex max-h-[calc(100dvh-2rem)] max-w-xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-[#1e293b] dark:shadow-none" aria-label="Bank connection preview">
        {handoff ? <div className="p-6"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Preview hand-off</p><h1 ref={handoffHeadingRef} tabIndex={-1} className="mt-2 text-xl font-bold outline-none">Finexer would open next</h1><p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">Your bank would then ask you to approve read-only access. No connection or navigation has started in this preview.</p><button type="button" onClick={returnToReview} className="mt-6 inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-indigo-500 dark:text-indigo-300 dark:hover:bg-slate-800">Back to review</button></div> : review && selected ? <>
          <header className="border-b border-slate-200 px-5 py-5 dark:border-slate-700"><button type="button" onClick={returnToList} className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-indigo-500 dark:text-indigo-300 dark:hover:bg-slate-800"><ArrowLeft size={16} aria-hidden="true" />Back</button><h1 ref={reviewHeadingRef} tabIndex={-1} className="mt-2 text-xl font-bold outline-none">Review your connection</h1><p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">Understand what you are connecting before you continue.</p></header>
          <div className="min-h-0 overflow-y-auto px-5"><div className="flex items-center gap-3 border-b border-slate-200 py-5 dark:border-slate-700"><BankLogo bank={selected} /><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{selected.name}</p><p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">Your selected bank</p><Coverage coverage={selected.coverage} variant={variant} legend={variant === "b"} /></div><button type="button" onClick={returnToList} className="min-h-11 rounded-lg px-3 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-indigo-500 dark:text-indigo-300 dark:hover:bg-slate-800">Change</button></div>
            {state === "health" && selected.id === "monzo" && <HealthNotice bank={selected} />}
            <section className="py-5"><h2 className="text-sm font-semibold">See your money in one place</h2><p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{selected.coverage === "unknown" ? "We cannot show the data available for this bank yet. Review the requested access with Finexer before you approve. Access is read-only and does not authorise a payment." : "Read-only access can include account details, balances and transactions within the listed coverage. Review the requested access with Finexer. This connection does not authorise a payment."}</p><p className="mt-3 text-xs leading-5 text-slate-600 dark:text-slate-300">Unlisted pots and account types may show only a balance without transactions. Coverage is Finexer’s published listing, not a guarantee.</p></section>
            <section className="border-t border-slate-200 py-5 dark:border-slate-700"><h2 className="text-sm font-semibold">Who provides the connection</h2><p className="mt-2 text-[13px] leading-[22px] text-slate-600 dark:text-slate-300">{TRADING_NAME_DISCLOSURE} {AGENT_DISCLOSURE}</p></section></div>
          <footer className="border-t border-slate-200 px-5 py-4 dark:border-slate-700"><p className="mb-3 text-xs leading-5 text-slate-600 dark:text-slate-300">Review permissions with Finexer next. Your bank then asks you to approve.</p><button ref={continueRef} type="button" onClick={() => setHandoff(true)} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900">Continue to Finexer <ArrowRight size={16} aria-hidden="true" /></button></footer>
        </> : <div className="flex min-h-0 flex-1 flex-col">
          <header className="px-5 pb-4 pt-5"><h1 className="text-xl font-bold">Choose your bank</h1><p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">Start with the bank you want to add to Sorted.</p></header>
          <div className="border-y border-slate-200 px-5 py-3 dark:border-slate-700"><label className="relative block"><Search size={17} aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 text-slate-600 dark:text-slate-300" /><span className="sr-only">Search banks</span><input ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} placeholder="Search banks…" type="search" name="bank-search" autoComplete="off" spellCheck={false} className="block h-11 w-full rounded-xl bg-slate-100 pl-10 pr-11 text-base outline-none placeholder:text-slate-600 focus:ring-2 focus:ring-indigo-500 dark:bg-slate-800 dark:placeholder:text-slate-300" />{query && <button type="button" aria-label="Clear search" onClick={clearSearch} className="absolute right-0 top-0 flex size-11 items-center justify-center rounded-xl text-slate-600 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-300"><X size={17} aria-hidden="true" /></button>}</label>{variant === "b" && <p className="mt-2 text-[11px] leading-4 text-slate-500 dark:text-slate-400"><Check size={11} aria-hidden="true" className="mr-1 inline" />Tick: listed <span aria-hidden="true">·</span> <Minus size={11} aria-hidden="true" className="mx-1 inline" />Dash: not listed</p>}</div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-1">{shown.length ? <ul className="divide-y divide-slate-100 dark:divide-slate-800">{shown.map(bank => <li key={bank.id}><button ref={bank.id === selected?.id ? selectedRowRef : undefined} type="button" onClick={() => choose(bank)} className="flex min-h-[68px] w-full items-center gap-3 py-3 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:hover:bg-slate-800"><BankLogo bank={bank} /><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{bank.name}</span><Coverage coverage={bank.coverage} variant={variant} /></span><ChevronRight size={16} aria-hidden="true" className="shrink-0 text-slate-500 dark:text-slate-300" /></button></li>)}</ul> : <div className="py-10 text-center"><h2 className="text-sm font-semibold">{state === "empty" ? "No banks are available right now" : "No banks found"}</h2><p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{state === "empty" ? "This preview fixture has no banks to show." : "Try a different name or clear your search."}</p>{state === "empty" ? <button type="button" onClick={() => setRetriedEmpty(true)} className="mt-3 min-h-11 rounded-lg px-3 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-indigo-500 dark:text-indigo-300 dark:hover:bg-slate-800">Retry with preview banks</button> : query && <button type="button" onClick={clearSearch} className="mt-3 min-h-11 rounded-lg px-3 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-indigo-500 dark:text-indigo-300 dark:hover:bg-slate-800">Show all banks</button>}</div>}</div>
          <footer className="border-t border-slate-200 px-5 py-4 text-xs leading-5 text-slate-600 dark:border-slate-700 dark:text-slate-300">Next: review how this connection works.</footer>
        </div>}
      </section>
    </div>
  </main>;
}
