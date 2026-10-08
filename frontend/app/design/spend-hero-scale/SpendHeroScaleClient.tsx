"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { RefreshCw } from "lucide-react";
import SpendPaceEvidence from "@/components/SpendPaceEvidence";
import SpendJourneyNav, { type SpendJourneyDestination } from "@/components/SpendJourneyNav";
import type { Transaction } from "@/lib/api";
import { spendHeroModel, spendHeroMoney } from "@/lib/spendHero";
import { STATES } from "../spend-hero/fixtures";
import SpendHeroScale from "./SpendHeroScale";
import { scaleFixture, scaleIncomeFor, type ScaleState } from "./fixtures";

type Variant = "a" | "b";
const variants: { id: Variant; label: string }[] = [
  { id: "a", label: "A · Compact heading" },
  { id: "b", label: "B · Approved" },
];
const states: { id: ScaleState; label: string }[] = [{ id: "phone", label: "Phone example" }, ...STATES];
const focus = "active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

function jump(id: string) {
  const target = document.getElementById(id);
  target?.focus({ preventScroll: true });
  target?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

export default function SpendHeroScaleClient() {
  const params = useSearchParams();
  const raw = params.get("variant");
  const variant: Variant = raw === "a" ? "a" : "b";
  const state: ScaleState = states.some(item => item.id === params.get("state")) ? params.get("state") as ScaleState : "phone";
  const mode = params.get("mode") === "dark" ? "dark" : "light";
  const [retried, setRetried] = useState(false);
  const [selected, setSelected] = useState<Transaction | null>(null);
  const verdict = scaleFixture(retried ? "phone" : state);
  const model = verdict ? spendHeroModel(verdict) : null;
  useEffect(() => {
    const shell = document.getElementById("app-shell");
    const oldOverflow = shell?.style.overflowX ?? "";
    const oldScheme = document.documentElement.style.colorScheme;
    const wasDark = document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", mode === "dark");
    document.documentElement.style.colorScheme = mode;
    if (shell) shell.style.overflowX = "clip";
    return () => {
      document.documentElement.classList.toggle("dark", wasDark);
      document.documentElement.style.colorScheme = oldScheme;
      if (shell) shell.style.overflowX = oldOverflow;
    };
  }, [mode]);
  const href = (v = variant, s = state, theme = mode) => `?variant=${v}&state=${s}&mode=${theme}`;
  const destinations: SpendJourneyDestination[] = [
    ...(model?.difference != null ? [{ id: "scale-changes", label: "Changes", value: spendHeroMoney(Math.abs(model.difference)), needsLook: model.direction === "above" }] : []),
    { id: "scale-spending", label: "Spending", value: verdict ? spendHeroMoney(verdict.pills.spent) : "Waiting" },
    ...(model?.hasMoved ? [{ id: "scale-moved", label: "Moved", value: "Separate" }] : []),
  ];
  const props = { verdict, incomeTxns: verdict ? scaleIncomeFor(verdict) : [], onTransactionClick: setSelected, onOutTap: () => jump("scale-spending"), onMovedTap: () => jump("scale-moved") };

  return <main className="min-h-dvh bg-[#f0f2f7] px-4 pb-28 pt-5 text-slate-900 dark:bg-[#0f172a] dark:text-slate-100 sm:px-6">
    <div className="mx-auto max-w-6xl">
      <header className="mb-6 border-b border-slate-200 pb-4 dark:border-slate-700">
        <h1 className="text-base font-bold">Spend hero · type refinement</h1>
        <p className="mt-1 max-w-prose text-xs leading-5 text-slate-600 dark:text-slate-300">B is approved and renders the production SpendPaceHero, with Usual on its own quiet line. A remains the unselected comparison. Figures and calculations are unchanged.</p>
        <nav aria-label="Typography variants" className="mt-3 flex flex-wrap gap-2">
          {variants.map(item => <a key={item.id} href={href(item.id)} aria-current={item.id === variant ? "page" : undefined} className={`${focus} inline-flex min-h-11 items-center rounded-xl px-3 text-xs font-semibold ${item.id === variant ? "bg-indigo-600 text-white" : "border border-slate-300 bg-white text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"}`}>{item.label}</a>)}
          <a href={href(variant, state, mode === "dark" ? "light" : "dark")} className={`${focus} inline-flex min-h-11 items-center rounded-xl px-3 text-xs font-semibold`}>{mode === "dark" ? "Light" : "Dark"}</a>
        </nav>
      </header>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><h2 className="text-[28px] font-bold leading-tight tracking-[-0.025em]">Spend</h2><p className="text-xs text-slate-600 dark:text-slate-300">Selected pay period{verdict ? ` · ${new Date(verdict.period.start).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })} to ${new Date(verdict.period.end).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}` : ""}</p></div>
      {!verdict ? <section className="glass-hero rounded-3xl p-5" aria-live="polite">{state === "loading" ? <><h2 className="text-base font-bold">Loading this pay period</h2><div className="mt-4 h-10 rounded-lg bg-slate-200 motion-safe:animate-pulse dark:bg-slate-700" aria-hidden="true" /></> : <><h2 className="text-base font-bold">We could not load your spending summary</h2><button type="button" onClick={() => setRetried(true)} className={`${focus} mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white`}><RefreshCw size={16} aria-hidden="true" />Try again</button></>}</section>
        : <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)]">
          <div className="min-w-0 lg:sticky lg:top-6">
            <SpendHeroScale {...props} variant={variant} />
            {selected && <p role="status" className="mt-3 text-sm text-slate-600 dark:text-slate-300">Fixture transaction selected: {selected.description} <span className="font-mono tabular-nums">{spendHeroMoney(selected.amount)}</span></p>}
            <p className="mt-3 text-xs leading-5 text-slate-500 dark:text-slate-400">{variant === "a" ? "A: the unselected heading-led comparison." : "B: the approved production component, with a quieter Usual reference below the verdict."} Fixture data sized to the phone example.</p>
            <div className="mt-4 hidden lg:block"><SpendJourneyNav destinations={destinations} desktop /></div>
          </div>
          <div className="min-w-0 space-y-5">
            <div className="sticky top-0 z-10 -mx-4 border-y border-slate-200 bg-[#f0f2f7]/95 px-4 py-2 backdrop-blur dark:border-slate-700 dark:bg-[#0f172a]/95 lg:hidden"><SpendJourneyNav destinations={destinations} /></div>
            {model?.difference != null && <section id="scale-changes" tabIndex={-1} className="scroll-mt-24 outline-none"><SpendPaceEvidence daysElapsed={verdict.period.days_elapsed} spent={verdict.pills.spent} paceSeries={verdict.pace_series} notables={verdict.notables} unresolvedTotal={verdict.unresolved.total} state={verdict.state} /></section>}
            <section id="scale-spending" tabIndex={-1} className="scroll-mt-24 outline-none"><h2 className="text-base font-bold">Spending</h2><p className="mt-1 text-[13px] leading-5 text-slate-600 dark:text-slate-300">Category totals for this preview. Moved money is not included.</p><dl className="mt-3 space-y-3 text-sm">{[...verdict.notables.map(item => ({ label: item.category, amount: item.spent })), { label: "Other categorised spending", amount: model!.other }, ...(model!.unresolved ? [{ label: "To categorise", amount: model!.unresolved }] : [])].map(row => <div key={row.label} className="flex items-start justify-between gap-3"><dt className="min-w-0">{row.label}</dt><dd className="shrink-0 font-mono tabular-nums">{spendHeroMoney(row.amount)}</dd></div>)}</dl></section>
            {model?.hasMoved && <section id="scale-moved" tabIndex={-1} className="scroll-mt-24 border-t border-slate-200 pt-4 outline-none dark:border-slate-700"><h2 className="text-base font-bold">Moved separately</h2><dl className="mt-3 space-y-3 text-sm">{verdict.moved.map(row => <div key={row.kind} className="flex items-start justify-between gap-3"><dt>{row.label}</dt><dd className="shrink-0 font-mono tabular-nums">{spendHeroMoney(row.amount)}</dd></div>)}</dl></section>}
          </div>
        </div>}
    </div>
    <nav aria-label="Preview states" className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] dark:border-slate-700 dark:bg-slate-900"><div className="mx-auto flex max-w-6xl gap-2 overflow-x-auto">{states.map(item => <a key={item.id} href={href(variant, item.id)} aria-current={item.id === state ? "page" : undefined} className={`${focus} flex min-h-11 shrink-0 items-center rounded-full px-3 text-xs font-semibold ${item.id === state ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"}`}>{item.label}</a>)}</div></nav>
  </main>;
}
