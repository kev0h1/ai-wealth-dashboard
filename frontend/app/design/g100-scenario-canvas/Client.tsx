"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ChevronRight, Info, MoveRight } from "lucide-react";

type Variant = "a" | "b" | "c";
type State = "safe" | "tight" | "empty";

const variants: Variant[] = ["a", "b", "c"];
const states: State[] = ["safe", "tight", "empty"];
const model = {
  safe: { opening: "£742", result: "£562", reading: "The forecast leaves £562 at month end. Your live balance remains unchanged until you decide." },
  tight: { opening: "£142", result: "−£38", reading: "The forecast leaves a £38 shortfall at month end. Keep the live balance separate from this possible outcome." },
} as const;

function Controls({ variant, state, dark }: { variant: Variant; state: State; dark: boolean }) {
  const link = (v = variant, s = state, m = dark) => `?variant=${v}&state=${s}&mode=${m ? "dark" : "light"}`;
  const base = "inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl px-3 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white";
  return <nav aria-label="Preview controls" className="fixed inset-x-2 bottom-3 z-50 flex gap-1 overflow-x-auto rounded-2xl bg-slate-900 p-1.5 text-white shadow-xl">{variants.map((value) => <a key={value} href={link(value)} className={`${base} ${value === variant ? "bg-indigo-600" : "text-slate-300 hover:bg-slate-800"}`}>{value.toUpperCase()}</a>)}{states.map((value) => <a key={value} href={link(variant, value)} className={`${base} ${value === state ? "bg-slate-700" : "text-slate-300 hover:bg-slate-800"}`}>{value}</a>)}<a href={link(variant, state, !dark)} className={`${base} text-slate-300 hover:bg-slate-800`}>{dark ? "Light" : "Dark"}</a></nav>;
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:shadow-none"><h2 className="text-base font-bold">{title}</h2>{children}</section>;
}

function EmptyScenario({ variant }: { variant: Variant }) {
  const calculationPath = variant === "c";
  return <main className="min-h-dvh bg-[#f0f2f7] pb-32 text-slate-900 dark:bg-[#0f172a] dark:text-slate-100"><div className="mx-auto max-w-5xl px-4 py-8"><a href="/design" className="inline-flex min-h-11 items-center gap-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"><ArrowLeft size={16} />Back to design</a>{calculationPath ? <div className="mx-auto mt-12 max-w-2xl"><h1 className="text-balance text-3xl font-bold">Start with one possible change</h1><p className="mt-3 max-w-[65ch] text-sm leading-6 text-slate-600 dark:text-slate-300">A calculation path needs an amount and a date before it can show a forecast. It will stay separate from your live position.</p><ol className="mt-8 grid gap-3 sm:grid-cols-3" aria-label="Scenario setup steps">{["Add a payment", "Choose its date", "Compare the forecast"].map((step, index) => <li key={step} className="border-t border-slate-300 pt-3 text-sm dark:border-slate-700"><span className="font-mono text-xs text-slate-500 dark:text-slate-400">0{index + 1}</span><p className="mt-2 font-semibold">{step}</p></li>)}</ol></div> : <div className="mt-12 max-w-[65ch]"><h1 className="text-balance text-3xl font-bold">Choose something to explore</h1><p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">There is no scenario yet. Add a possible payment or date in the app to see a forecast alongside your live position.</p></div>}</div></main>;
}

function ScenarioInputs() {
  return <Card title="Scenario inputs"><p className="mt-1 text-xs text-slate-600 dark:text-slate-400">Static fixture values for this preview.</p><dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2"><div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900"><dt>New monthly payment</dt><dd className="mt-1 font-mono font-bold tabular-nums">£180</dd></div><div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900"><dt>Starts</dt><dd className="mt-1 font-bold">1 October 2026</dd></div></dl></Card>;
}

function Calculation({ opening, result, tight }: { opening: string; result: string; tight: boolean }) {
  return <Card title="Forecast calculation"><div className="mt-3 space-y-2 border-t border-slate-200 pt-3 font-mono text-sm tabular-nums dark:border-slate-700"><p>{opening} forecast cash at month end</p><p>− £180 new payment</p><p className={`border-t border-slate-200 pt-2 font-bold dark:border-slate-700 ${tight ? "text-red-700 dark:text-red-300" : ""}`}>= {result} forecast cash</p></div><p className="mt-3 text-xs text-slate-600 dark:text-slate-400">Forecast only. It does not change your live balance or move money.</p></Card>;
}

function CalculationPath({ opening, result, tight }: { opening: string; result: string; tight: boolean }) {
  const steps = [["Live cash today", "£742", "A live balance, unchanged by this preview."], ["Forecast cash at month end", opening, "Before the possible new payment."], ["Possible new payment", "−£180", "Starting 1 October 2026."], ["Forecast after the change", result, "A comparison, not money moved."]];
  return <section id="calculation" aria-labelledby="calculation-title" className="border-y border-slate-300 py-1 dark:border-slate-700"><h2 id="calculation-title" className="sr-only">Calculation path</h2>{steps.map(([label, figure, detail], index) => <div key={label} className="grid gap-2 border-b border-slate-200 py-5 last:border-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center dark:border-slate-700"><div><p className="font-semibold">{label}</p><p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{detail}</p></div><p className={`font-mono text-xl font-bold tabular-nums ${index === 3 && tight ? "text-red-700 dark:text-red-300" : ""}`}>{figure}</p></div>)}</section>;
}

export default function Client() {
  const params = useSearchParams();
  const rawVariant = params.get("variant");
  const variant: Variant = rawVariant === "b" || rawVariant === "c" ? rawVariant : "a";
  const rawState = params.get("state");
  const state: State = rawState === "tight" || rawState === "empty" ? rawState : "safe";
  const dark = params.get("mode") === "dark";
  useEffect(() => { document.documentElement.classList.toggle("dark", dark); }, [dark]);
  if (state === "empty") return <><EmptyScenario variant={variant} /><Controls variant={variant} state={state} dark={dark} /></>;
  const current = model[state];
  const tight = state === "tight";
  const canvas = <section className="max-w-[65ch]"><h1 className="text-balance text-3xl font-bold">What if you add £180 a month?</h1><p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">{current.reading}</p><p className="mt-4 border-y border-slate-300 py-3 font-mono text-[15px] font-semibold tabular-nums dark:border-slate-700">Live cash £742 <span className="mx-2 text-slate-400">→</span> <span className={tight ? "text-red-700 dark:text-red-300" : ""}>Forecast {current.result}</span></p></section>;
  const comparisonRail = <section className="max-w-[65ch]"><h1 className="text-balance text-3xl font-bold">What changes if you add £180 a month?</h1><p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">Compare today&apos;s live cash with a possible month-end outcome before deciding.</p><dl className="mt-5 grid gap-3 sm:grid-cols-2"><div className="border-t border-slate-300 pt-3 dark:border-slate-700"><dt className="text-xs text-slate-600 dark:text-slate-400">Live cash today</dt><dd className="mt-1 font-mono text-xl font-bold tabular-nums">£742</dd></div><div className="border-t border-slate-300 pt-3 dark:border-slate-700"><dt className="text-xs text-slate-600 dark:text-slate-400">Possible month end</dt><dd className={`mt-1 font-mono text-xl font-bold tabular-nums ${tight ? "text-red-700 dark:text-red-300" : ""}`}>{current.result}</dd></div></dl></section>;
  const evidence = <div className="space-y-5"><ScenarioInputs /><Calculation opening={current.opening} result={current.result} tight={tight} /><Card title="Compare before you decide"><p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Live cash remains £742. This scenario is only a comparison.</p><a href="#calculation" className="mt-3 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300">See the calculation <ChevronRight size={15} /></a></Card></div>;
  return <main className="min-h-dvh bg-[#f0f2f7] pb-32 text-slate-900 dark:bg-[#0f172a] dark:text-slate-100"><div className="mx-auto max-w-6xl px-4 py-8"><a href="/design" className="inline-flex min-h-11 items-center gap-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"><ArrowLeft size={16} />Back to design</a><header className="mt-5 border-b border-slate-300 pb-6 dark:border-slate-700"><p className="text-sm font-semibold text-slate-600 dark:text-slate-300">G100 Scenario preview</p><p className="mt-2 max-w-[65ch] text-sm text-slate-600 dark:text-slate-300">Static forecast preview. No balance or plan changes here.</p></header>{variant === "c" ? <div className="mx-auto mt-8 max-w-3xl space-y-9">{canvas}<div className="flex items-center gap-2 text-sm font-semibold text-slate-600 dark:text-slate-300"><MoveRight size={17} aria-hidden="true" />Trace the possible change, then compare it with today.</div><CalculationPath opening={current.opening} result={current.result} tight={tight} /><div className="grid gap-5 sm:grid-cols-2"><ScenarioInputs /><Card title="Before you decide"><p className="mt-2 text-sm text-slate-600 dark:text-slate-400">The live balance remains £742. This path only makes the possible outcome visible.</p></Card></div></div> : variant === "b" ? <div className="mt-8 grid gap-8 lg:grid-cols-[.75fr_1.25fr]">{comparisonRail}<div id="calculation">{evidence}</div></div> : <div className="mx-auto mt-8 max-w-2xl space-y-8">{canvas}<div id="calculation">{evidence}</div></div>}<p className="mt-10 flex gap-2 text-xs text-slate-600 dark:text-slate-400"><Info size={15} aria-hidden="true" />The forecast is not your live balance.</p></div><Controls variant={variant} state={state} dark={dark} /></main>;
}
