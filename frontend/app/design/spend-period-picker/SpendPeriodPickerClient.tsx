"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronLeft, ChevronRight, Search } from "lucide-react";
import SpendPaceHero from "@/components/SpendPaceHero";
import { SheetFrame } from "@/components/SheetFrame";
import { fullRange, periodDays, SCENARIOS, shortRange, VARIANTS, verdictFor, yearContext, type PreviewState, type Scenario, type Variant } from "./fixtures";
import styles from "./preview.module.css";

const focus = "touch-manipulation active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900";
const square = `${focus} flex size-11 shrink-0 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400 dark:text-slate-300 dark:hover:bg-slate-700 dark:disabled:text-slate-500`;
const surface = "border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800";
const samples = [
  { description: "Coffee with friends", amount: "−£8.50" },
  { description: "Groceries", amount: "−£42.18" },
  { description: "Salary", amount: "+£4,800.36" },
];

export default function SpendPeriodPickerClient() {
  const params = useSearchParams();
  const router = useRouter();
  const variant: Variant = params.get("variant") === "b" ? "b" : params.get("variant") === "c" ? "c" : "a";
  const scenario: Scenario = params.get("scenario") === "year" ? "year" : params.get("scenario") === "weekly" ? "weekly" : "monthly";
  const state: PreviewState = params.get("state") === "loading" ? "loading" : params.get("state") === "error" ? "error" : params.get("state") === "empty" ? "empty" : "ready";
  const mode = params.get("mode") === "dark" ? "dark" : "light";
  const periods = SCENARIOS[scenario].periods;
  const index = Math.min(periods.length - 1, Math.max(0, Math.trunc(Number(params.get("period"))) || 0));
  const period = periods[index];
  const ready = state === "ready";
  const [sheet, setSheet] = useState<"periods" | "search" | null>(null);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const heading = VARIANTS.find(item => item.id === variant)!;
  const href = (changes: Record<string, string> = {}) => {
    const next = new URLSearchParams({ variant, scenario, state, mode, period: String(index), ...changes });
    return `/design/spend-period-picker?${next}`;
  };
  const selectPeriod = (next: number) => { setNotice(""); router.replace(href({ period: String(next) }), { scroll: false }); };
  const reset = () => router.replace(href({ state: "ready", period: "0" }), { scroll: false });
  useEffect(() => {
    const wasDark = document.documentElement.classList.contains("dark");
    const scheme = document.documentElement.style.colorScheme;
    document.documentElement.classList.toggle("dark", mode === "dark");
    document.documentElement.style.colorScheme = mode;
    document.querySelector<HTMLElement>("[data-spend-header]")?.setAttribute("data-preview-ready", "true");
    return () => { document.documentElement.classList.toggle("dark", wasDark); document.documentElement.style.colorScheme = scheme; };
  }, [mode]);

  const range = ready ? shortRange(period) : state === "loading" ? "Loading period…" : state === "error" ? "Period unavailable" : "Choose a period";
  const day = ready ? `Day ${period.elapsed} of ${periodDays(period)}` : "Pay period";
  const year = ready ? yearContext(period) : null;
  const periodDoor = (relocated = false) => <button
    type="button" data-period-door aria-label={ready ? `Choose pay period, ${fullRange(period)}` : range}
    aria-haspopup="dialog" aria-expanded={sheet === "periods"} disabled={state === "loading"}
    onClick={() => setSheet("periods")}
    className={`${styles.dateButton} ${relocated ? styles.relocatedDate : ""} ${variant === "a" ? "border-x border-slate-200 dark:border-slate-700" : ""} ${focus} rounded-lg text-slate-800 hover:bg-slate-100 disabled:cursor-wait dark:text-slate-100 dark:hover:bg-slate-700`}
  >
    <span className="flex items-center gap-1"><span data-period-label className={styles.range}>{range}</span>{variant !== "a" && <ChevronDown size={12} aria-hidden="true" className="shrink-0" />}</span>
    {year && <span className="mt-0.5 whitespace-nowrap text-[11px] leading-4 text-slate-600 dark:text-slate-400">{year}</span>}
  </button>;
  const prev = <button type="button" data-prev aria-label="Previous pay period" disabled={!ready || index === periods.length - 1} onClick={() => selectPeriod(index + 1)} className={square}><ChevronLeft size={17} aria-hidden="true" /></button>;
  const next = <button type="button" data-next aria-label="Next pay period" disabled={!ready || index === 0} onClick={() => selectPeriod(index - 1)} className={square}><ChevronRight size={17} aria-hidden="true" /></button>;

  return <main className="min-h-dvh bg-[#f0f2f7] px-4 pb-12 pt-5 text-slate-900 selection:bg-indigo-100 selection:text-indigo-950 dark:bg-[#0f172a] dark:text-slate-100 dark:selection:bg-indigo-900 dark:selection:text-white sm:px-6">
    <a href="#spend-preview" className={`${focus} sr-only rounded-lg bg-white p-3 focus:not-sr-only dark:bg-slate-800`}>Skip to Spend preview</a>
    <div className="mx-auto max-w-5xl">
      <section aria-label="Design review controls" className="mb-5 border-b border-slate-200 pb-4 dark:border-slate-700">
        <h1 className="text-base font-bold">Spend period picker · G285</h1>
        <p className="mt-1 max-w-prose text-[13px] leading-5 text-slate-600 dark:text-slate-300">Three header proposals. Full dates, 44px controls and Search on phones. Synthetic data only; no account changes.</p>
        <nav aria-label="Header variants" className="mt-3 flex flex-wrap gap-2">
          {VARIANTS.map(item => <Link key={item.id} href={href({ variant: item.id })} scroll={false} aria-current={item.id === variant ? "page" : undefined} className={`${focus} inline-flex min-h-11 items-center rounded-xl px-3 text-[13px] font-semibold ${item.id === variant ? "bg-indigo-600 text-white hover:bg-indigo-700" : `${surface} text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700`}`}>{item.name}</Link>)}
          <Link href={href({ mode: mode === "light" ? "dark" : "light" })} scroll={false} className={`${focus} inline-flex min-h-11 items-center rounded-xl px-3 text-[13px] font-semibold hover:bg-slate-200 dark:hover:bg-slate-800`}>{mode === "light" ? "Dark theme" : "Light theme"}</Link>
        </nav>
        <details className="mt-2">
          <summary className={`${focus} inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg text-[13px] font-semibold text-slate-600 dark:text-slate-300`}>Test fixtures <ChevronDown size={14} aria-hidden="true" /></summary>
          <nav aria-label="Period fixtures" className="mt-2 flex flex-wrap gap-2">{Object.entries(SCENARIOS).map(([id, item]) => <Link key={id} href={href({ scenario: id, period: "0" })} scroll={false} aria-current={id === scenario ? "page" : undefined} className={`${focus} inline-flex min-h-11 items-center rounded-xl border px-3 text-xs ${id === scenario ? "border-indigo-500 text-indigo-700 dark:text-indigo-300" : "border-slate-300 dark:border-slate-600"}`}>{item.label}</Link>)}</nav>
          <nav aria-label="Data states" className="mt-2 flex flex-wrap gap-2">{(["ready", "loading", "error", "empty"] as const).map(item => <Link key={item} href={href({ state: item })} scroll={false} aria-current={item === state ? "page" : undefined} className={`${focus} inline-flex min-h-11 items-center rounded-xl border px-3 text-xs ${item === state ? "border-indigo-500 text-indigo-700 dark:text-indigo-300" : "border-slate-300 dark:border-slate-600"}`}>{item === "ready" ? "Ready" : item === "loading" ? "Loading" : item === "error" ? "Load problem" : "No periods"}</Link>)}</nav>
        </details>
      </section>

      <section id="spend-preview" tabIndex={-1} className="scroll-mt-5 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500" aria-label={heading.name}>
        <header data-spend-header data-variant={variant} data-scenario={scenario} data-state={state} className={`${styles.header} ${variant === "a" ? styles.inline : ""}`}>
          <div data-title-block className={styles.title}>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1"><h2 className="text-[28px] font-bold leading-none tracking-[-0.03em] text-slate-950 dark:text-white">Spend</h2>{variant === "b" && <p className="text-[11px] text-slate-600 dark:text-slate-400">{day}</p>}</div>
            {variant === "b" ? periodDoor(true) : <p className="mt-1 text-[13px] text-slate-600 dark:text-slate-400">{day}</p>}
          </div>
          {variant === "a" ? <nav aria-label="Pay period" className={`${styles.periodNav} ${surface} flex items-center rounded-xl`}>{prev}{periodDoor()}{next}</nav>
            : variant === "b" ? <nav aria-label="Pay period" className={`${surface} flex items-center rounded-xl`}>{prev}{next}</nav>
              : <div className={`${surface} rounded-xl`}>{periodDoor()}</div>}
          <button type="button" data-search aria-label="Search transactions" aria-haspopup="dialog" aria-expanded={sheet === "search"} onClick={() => setSheet("search")} className={`${square} ${surface}`}><Search size={17} aria-hidden="true" /></button>
        </header>
        <p role="status" className="sr-only">{ready ? `${fullRange(period)}. ${day}.` : range}</p>
        {ready ? <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          <SpendPaceHero verdict={verdictFor(period, index)} incomeTxns={[]} onTransactionClick={() => undefined} onOutTap={() => setNotice("The unchanged Out figure opens the spending evidence in production. This preview tests the header.")} onMovedTap={() => setNotice("Moved money stays separate from Out. The production destination is unchanged.")} />
          <div className="min-w-0"><h3 className="text-base font-bold">{heading.name}</h3><p className="mt-2 max-w-prose text-[13px] leading-5 text-slate-600 dark:text-slate-300">{heading.description}</p><p className="mt-3 text-xs leading-5 text-slate-600 dark:text-slate-400">Try previous and next, tap the dates, then open Search. The hero is the existing production component with invented figures. No spending calculation is changed.</p>{index > 0 && <button type="button" onClick={() => selectPeriod(0)} className={`${focus} mt-3 inline-flex min-h-11 items-center rounded-xl bg-indigo-50 px-3 text-[13px] font-semibold text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-400/10 dark:text-indigo-300 dark:hover:bg-indigo-400/20`}>Back to this period</button>}<p role="status" className="mt-3 text-[13px] leading-5 text-slate-600 dark:text-slate-300">{notice}</p></div>
        </div> : <section aria-live="polite" className="glass-hero rounded-3xl p-5"><h3 className="text-base font-bold">{state === "loading" ? "Loading your pay periods…" : state === "error" ? "We could not load your pay periods" : "No pay periods to show yet"}</h3><p className="mt-2 text-[13px] leading-5 text-slate-600 dark:text-slate-300">{state === "loading" ? "The header stays in place while the period loads." : state === "error" ? "Try again to bring the dates back. No balance is shown while they are unavailable." : "The dates will appear once a pay period is available."}</p>{state !== "loading" && <button type="button" onClick={reset} className={`${focus} mt-3 min-h-11 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700`}>{state === "error" ? "Try again" : "Use sample periods"}</button>}</section>}
      </section>
    </div>

    {sheet === "periods" && <SheetFrame title="Pay periods" onClose={() => setSheet(null)} bodyClassName="px-4 py-3">
      {({ closeThen }) => <>
        {variant === "c" && <nav aria-label="Step between pay periods" className="mb-3 grid grid-cols-2 gap-3"><button type="button" data-sheet-prev disabled={!ready || index === periods.length - 1} onClick={() => closeThen(() => selectPeriod(index + 1))} className={`${focus} flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 text-[13px] font-semibold disabled:opacity-40 dark:border-slate-600`}><ChevronLeft size={16} aria-hidden="true" />Previous</button><button type="button" data-sheet-next disabled={!ready || index === 0} onClick={() => closeThen(() => selectPeriod(index - 1))} className={`${focus} flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 text-[13px] font-semibold disabled:opacity-40 dark:border-slate-600`}>Next<ChevronRight size={16} aria-hidden="true" /></button></nav>}
        {state === "error" || state === "empty" ? <div className="py-3"><p className="text-sm text-slate-600 dark:text-slate-300">{state === "error" ? "The period list is unavailable. Try again." : "There are no periods in this fixture."}</p><button type="button" onClick={() => closeThen(reset)} className={`${focus} mt-3 min-h-11 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700`}>{state === "error" ? "Try again" : "Use sample periods"}</button></div> : <ul className="divide-y divide-slate-100 dark:divide-slate-700">{periods.map((item, itemIndex) => <li key={item.start}><button type="button" data-period-option={itemIndex} aria-current={itemIndex === index ? "date" : undefined} onClick={() => closeThen(() => selectPeriod(itemIndex))} className={`${focus} flex min-h-16 w-full items-center justify-between gap-3 rounded-lg px-2 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800`}><span><span className="block text-sm font-semibold">{shortRange(item)}</span><span className="mt-1 block text-xs text-slate-600 dark:text-slate-400">{yearContext(item) ?? item.start.slice(0, 4)}</span></span><span className="text-xs text-slate-600 dark:text-slate-300">{itemIndex === 0 ? "Current" : itemIndex === index ? "Selected" : "Completed"}</span></button></li>)}</ul>}
        <p className="mt-4 text-xs leading-5 text-slate-600 dark:text-slate-400">Preview periods only. Production pay-period settings and categorisation links stay unchanged.</p>
      </>}
    </SheetFrame>}
    {sheet === "search" && <SheetFrame title="Search transactions" onClose={() => setSheet(null)} bodyClassName="px-4 py-3">
      <label htmlFor="sample-search" className="text-sm font-semibold">Search sample payments</label>
      <input id="sample-search" name="sample-search" type="search" autoComplete="off" spellCheck={false} value={query} onChange={event => setQuery(event.target.value)} placeholder="Search sample payments…" className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 text-base text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
      <p className="mt-3 text-xs leading-5 text-slate-600 dark:text-slate-400">Local fixtures only. The production Search link still opens your transactions.</p>
      <ul aria-live="polite" className="mt-3 divide-y divide-slate-100 dark:divide-slate-700">{samples.filter(item => item.description.toLowerCase().includes(query.toLowerCase())).map(item => <li key={item.description} className="flex items-center justify-between gap-3 py-4 text-sm"><span>{item.description}</span><span className="shrink-0 font-mono tabular-nums">{item.amount}</span></li>)}</ul>
      {!samples.some(item => item.description.toLowerCase().includes(query.toLowerCase())) && <p role="status" className="mt-4 text-sm text-slate-600 dark:text-slate-300">No sample payments match. Try “coffee” or “salary”.</p>}
    </SheetFrame>}
  </main>;
}
