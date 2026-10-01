"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertCircle, RefreshCw } from "lucide-react";
import { SpendJourneySummary } from "@/components/SpendHeader";
import SpendPaceHero from "@/components/SpendPaceHero";
import SpendJourneyNav, { type SpendJourneyDestination } from "@/components/SpendJourneyNav";
import type { SpendVerdict, Transaction } from "@/lib/api";
import { fixture, incomeFor, STATES, type PreviewState } from "./fixtures";

type Variant = "a" | "b" | "c";
type Mode = "light" | "dark";
const variants: { id: Variant; label: string }[] = [{ id: "a", label: "A · Pace instrument" }, { id: "b", label: "B · Existing summary" }, { id: "c", label: "C · Canvas control" }];
const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 0, maximumFractionDigits: 2 });
const money = (n: number) => `${n < 0 ? "−" : ""}${gbp.format(Math.abs(n))}`;
const signed = (n: number) => n === 0 ? money(n) : `${n > 0 ? "+" : ""}${money(n)}`;

function latestUsual(verdict: SpendVerdict): number | null {
  const point = verdict.pace_series?.at(-1);
  return point?.usual ?? null;
}

function jump(id: string) {
  const target = document.getElementById(id);
  if (!target) return;
  target.focus({ preventScroll: true });
  target.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

function periodLabel(verdict: SpendVerdict) {
  return `${new Date(verdict.period.start).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} to ${new Date(verdict.period.end).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
}

function previewHref(variant: Variant, state: PreviewState, mode: Mode) {
  return `?variant=${variant}&state=${state}&mode=${mode}`;
}

function Summary({ verdict, onTransactionClick, className = "" }: { verdict: SpendVerdict; onTransactionClick: (transaction: Transaction) => void; className?: string }) {
  const props = { verdict, periodLabel: periodLabel(verdict), isCurrentPeriod: !verdict.period.closed, canGoPrev: true, onPrev() {}, onNext() {}, onOpenSettings() {}, onOpenRules() {}, incomeTxns: incomeFor(verdict), onTransactionClick, onOutTap: () => jump("g186-spending"), onMovedTap: () => jump("g186-moved") };
  const largeFigures = Math.max(verdict.pills.income, verdict.pills.spent) >= 100000;
  return <div data-production-summary="true" className={`${className} ${largeFigures ? "[&>div>dl.grid]:grid-cols-1 [&>div>dl.grid>div]:flex [&>div>dl.grid>div]:items-center [&>div>dl.grid>div]:justify-between [&>div>dl.grid>div]:gap-3" : ""}`}><SpendJourneySummary {...props} /></div>;
}

function ApprovedHero({ verdict, onTransactionClick }: { verdict: SpendVerdict; onTransactionClick: (transaction: Transaction) => void }) {
  return <SpendPaceHero verdict={verdict} incomeTxns={incomeFor(verdict)} onTransactionClick={onTransactionClick} onOutTap={() => jump("g186-spending")} onMovedTap={() => jump("g186-moved")} />;
}

function Evidence({ verdict }: { verdict: SpendVerdict }) {
  const usual = latestUsual(verdict);
  const difference = usual == null ? null : verdict.pills.spent - usual;
  const namedExcess = verdict.notables.reduce((sum, item) => sum + item.excess, 0);
  const namedSpend = verdict.notables.reduce((sum, item) => sum + item.spent, 0);
  const remaining = verdict.pills.spent - namedSpend - verdict.unresolved.total;
  const rows = [...verdict.notables.map((item) => ({ name: item.category, amount: item.spent, detail: `${item.payments_count} payments` })), ...(remaining > 0 ? [{ name: "Other categorised spending", amount: remaining, detail: "Remaining categorised payments" }] : []), ...(verdict.unresolved.total > 0 ? [{ name: "To categorise", amount: verdict.unresolved.total, detail: `${verdict.unresolved.payments_count} payments still need a category` }] : [])];
  const [expanded, setExpanded] = useState<string | null>(null);
  return <>
    <section id="g186-changes" tabIndex={-1} className="scroll-mt-24 border-t border-slate-200 pt-7 outline-none dark:border-slate-700"><h2 className="text-lg font-bold text-slate-950 dark:text-white">How this compares with usual</h2>{difference == null ? <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">There is not enough comparable history for a pace comparison yet.</p> : <><p className="mt-2 max-w-2xl text-sm leading-5 text-slate-600 dark:text-slate-300">Usual pace is based on the median of up to three 30-day spending totals for each category before this pay period, adjusted for how far through the period you are.</p><div className="mt-5 divide-y divide-slate-200 border-y border-slate-200 dark:divide-slate-700 dark:border-slate-700">{verdict.notables.length > 0 && <div className="grid grid-cols-[1fr_auto] gap-4 py-3"><div><p className="font-semibold text-slate-900 dark:text-white">{verdict.notables.map((item) => item.category).join(" and ") || "Named categories"}</p><p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">Named categories running above usual</p></div><p className="font-mono font-bold tabular-nums text-slate-950 dark:text-white">{signed(namedExcess)}</p></div>}<div className="grid grid-cols-[1fr_auto] gap-4 py-3"><div><p className="font-semibold text-slate-900 dark:text-white">Other differences</p><p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">Balancing amount: total difference minus named category excess. It may include payments still to categorise.</p></div><p className="font-mono font-bold tabular-nums text-slate-950 dark:text-white">{signed(difference - namedExcess)}</p></div><div className="grid grid-cols-[1fr_auto] gap-4 py-3"><p className="font-semibold text-slate-900 dark:text-white">Difference from usual pace</p><p className="font-mono font-bold tabular-nums text-slate-950 dark:text-white">{signed(difference)}</p></div></div></>}</section>
    {verdict.unresolved.total > 0 && <section id="g186-unplaced" tabIndex={-1} className="scroll-mt-24 pt-8 outline-none"><h2 className="text-lg font-bold text-slate-950 dark:text-white">To categorise</h2><p className="mt-1 text-sm text-slate-600 dark:text-slate-300"><span className="font-mono font-semibold tabular-nums">{money(verdict.unresolved.total)}</span> across {verdict.unresolved.payments_count} payments is included in Out, but not yet assigned to a category.</p></section>}
    <section id="g186-spending" tabIndex={-1} className="scroll-mt-24 pt-8 outline-none"><h2 className="text-lg font-bold text-slate-950 dark:text-white">Spending</h2><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Out includes spending, including payments still to categorise. Transfers are shown separately.</p><div className="mt-4 divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800">{rows.map((row) => <div key={row.name}><button type="button" aria-expanded={expanded === row.name} onClick={() => setExpanded(expanded === row.name ? null : row.name)} className="flex min-h-14 w-full items-center justify-between gap-4 px-4 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:hover:bg-slate-700"><span><span className="block font-semibold text-slate-900 dark:text-white">{row.name}</span><span className="block text-xs text-slate-600 dark:text-slate-300">{row.detail}</span></span><span className="font-mono font-bold tabular-nums text-slate-950 dark:text-white">{money(row.amount)}</span></button>{expanded === row.name && <p className="border-t border-slate-100 px-4 py-3 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">Fixture evidence for {row.name}. This row is included in Out.</p>}</div>)}<div className="flex justify-between gap-4 border-t border-slate-300 px-4 py-3 font-semibold dark:border-slate-600"><span>Total Out</span><span className="font-mono tabular-nums">{money(verdict.pills.spent)}</span></div></div></section>
    {verdict.moved.length > 0 && <section id="g186-moved" tabIndex={-1} className="scroll-mt-24 pt-8 outline-none"><h2 className="text-lg font-bold">Moved separately</h2><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Transfers are not included in Out.</p><dl className="mt-3 space-y-3">{verdict.moved.map(row => <div key={row.kind} className="flex justify-between gap-4 text-sm"><dt>{row.label}</dt><dd className="font-mono tabular-nums">{money(row.amount)}</dd></div>)}</dl></section>}
    <section id="g186-charts" tabIndex={-1} className="scroll-mt-24 pt-8 outline-none"><h2 className="text-lg font-bold text-slate-950 dark:text-white">Charts</h2><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Category totals for this pay period.</p><div role="img" aria-label={`Bar chart showing ${rows.map((row) => `${row.name} ${money(row.amount)}`).join(", ")}`} className="mt-4 space-y-3">{rows.map((row) => <div key={row.name}><div className="mb-1 flex justify-between gap-3 text-xs"><span className="truncate">{row.name}</span><span className="font-mono tabular-nums">{money(row.amount)}</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"><div className="h-full rounded-full bg-indigo-600" style={{ width: `${verdict.pills.spent > 0 ? Math.min(100, (row.amount / verdict.pills.spent) * 100) : 0}%` }} /></div></div>)}</div></section>
  </>;
}

export default function SpendHeroClient() {
  const params = useSearchParams();
  const rawVariant = params.get("variant");
  const variant: Variant = rawVariant === "b" || rawVariant === "c" ? rawVariant : "a";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";
  const raw = params.get("state") as PreviewState;
  const state: PreviewState = STATES.some((item) => item.id === raw) ? raw : "normal";
  const [retry, setRetry] = useState(false);
  const [selectedIncome, setSelectedIncome] = useState<Transaction | null>(null);
  const verdict = retry ? fixture("normal") : fixture(state);
  useEffect(() => {
    const shell = document.getElementById("app-shell");
    const overflow = shell?.style.overflowX ?? "";
    const previousScheme = document.documentElement.style.colorScheme;
    document.documentElement.classList.toggle("dark", mode === "dark");
    document.documentElement.style.colorScheme = mode;
    // Preview-scoped counterpart to the live Spend shell override.
    if (shell) shell.style.overflowX = "clip";
    return () => {
      document.documentElement.classList.remove("dark");
      document.documentElement.style.colorScheme = previousScheme;
      if (shell) shell.style.overflowX = overflow;
    };
  }, [mode]);
  const href = (nextVariant = variant, nextState = state, nextMode = mode) => previewHref(nextVariant, nextState, nextMode);
  const destinations: SpendJourneyDestination[] = [{ id: "g186-changes", label: "Changes", value: "Why it differs", needsLook: !!verdict?.notables.length }, ...(verdict?.unresolved.total ? [{ id: "g186-unplaced", label: "To categorise", value: money(verdict.unresolved.total), needsLook: true }] : []), { id: "g186-spending", label: "Spending", value: verdict ? money(verdict.pills.spent) : "Waiting" }, { id: "g186-charts", label: "Charts", value: "Categories" }];
  return <div className="min-h-dvh bg-[#f0f2f7] pb-28 text-slate-900 dark:bg-[#0f172a] dark:text-slate-100"><main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8"><header><h1 className="text-2xl font-bold tracking-[-0.03em]">Spend hero consistency</h1><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Invented fixture data from the original hero round. A renders the latest production SpendPaceHero, including the approved typography B refinement. B and C retain the previous summary for comparison. Evidence sections here are illustrative; G140 owns the production pace ledger.</p><nav aria-label="Design variants" className="mt-4 flex flex-wrap gap-2">{variants.map((item) => <a key={item.id} href={href(item.id)} aria-current={item.id === variant ? "page" : undefined} className={`flex min-h-11 items-center rounded-xl px-3 py-2 text-sm font-semibold active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${item.id === variant ? "bg-indigo-600 text-white" : "border border-slate-300 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"}`}>{item.label}</a>)}<a href={href(variant, state, mode === "dark" ? "light" : "dark")} className="flex min-h-11 items-center rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold dark:border-slate-700 dark:bg-slate-800">{mode === "dark" ? "Light" : "Dark"}</a></nav></header>
    {!verdict ? <section aria-live="polite" className="mt-7 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">{state === "loading" ? <><p className="text-lg font-bold">Loading this pay period</p><div className="mt-4 h-10 rounded bg-slate-200 motion-safe:animate-pulse dark:bg-slate-700" /></> : <><AlertCircle className="text-amber-600 dark:text-amber-400" aria-hidden="true" /><p className="mt-3 text-lg font-bold">We could not load your spending summary</p><button type="button" onClick={() => setRetry(true)} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-indigo-600 px-4 font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"><RefreshCw size={16} />Try again</button></>}</section> : <div className="mt-7 grid gap-8 lg:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)]"><div className="min-w-0 lg:sticky lg:top-6 lg:self-start">{variant === "a" ? <><ApprovedHero verdict={verdict} onTransactionClick={setSelectedIncome} /><details className="mt-5"><summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-slate-700 dark:text-slate-200">Compare with the previous canvas summary</summary><div className="mt-4 border-t border-slate-200 pt-5 dark:border-slate-700"><Summary verdict={verdict} onTransactionClick={setSelectedIncome} /></div></details></> : variant === "b" ? <section data-g186-hero="b" className="glass-hero rounded-3xl border border-white/70 bg-white/75 p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800/80 sm:p-6"><Summary verdict={verdict} onTransactionClick={setSelectedIncome} /></section> : <section data-g186-hero="c" className="px-1 pt-2 [&&_h2]:text-[32px] [&&_h2]:leading-[1.05] [&&_p]:mt-3"><Summary verdict={verdict} onTransactionClick={setSelectedIncome} /><p className="mt-5 text-xs text-slate-500 dark:text-slate-400">C retains the production component with scoped typography and spacing refinements only.</p></section>}{selectedIncome && <p role="status" className="mt-4 rounded-xl bg-slate-100 p-3 text-sm dark:bg-slate-800">Fixture transaction selected: {selectedIncome.description} <span className="font-mono font-semibold tabular-nums">{money(selectedIncome.amount)}</span></p>}<div className="mt-5 hidden lg:block"><SpendJourneyNav destinations={destinations} desktop /></div></div><div className="min-w-0"><div className="sticky top-0 z-10 -mx-4 border-y border-slate-200 bg-[#f0f2f7]/95 px-4 py-2 backdrop-blur lg:hidden dark:border-slate-700 dark:bg-[#0f172a]/95"><SpendJourneyNav destinations={destinations} /></div><Evidence verdict={verdict} /></div></div>}
  </main><nav aria-label="Preview states" className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 px-3 py-2 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95"><div className="mx-auto flex max-w-6xl gap-2 overflow-x-auto">{STATES.map((item) => <a key={item.id} href={href(variant, item.id)} aria-current={item.id === state ? "page" : undefined} className={`flex min-h-11 shrink-0 items-center rounded-full px-3 py-2 text-xs font-semibold active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${item.id === state ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"}`}>{item.label}</a>)}</div></nav></div>;
}
