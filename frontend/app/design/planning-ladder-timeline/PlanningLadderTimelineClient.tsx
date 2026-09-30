"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { GrowHero, CollapsedLadder } from "@/app/planning/GrowPanel";
import SectionJumpStrip from "@/app/planning/SectionJumpStrip";
import MoneyText from "@/components/MoneyText";
import { maskMoney, money } from "@/app/planning/GrowPanel";
import Timeline, { type TimelineVariant } from "./Timeline";
import { fixtureFor, SCENARIOS, scenarioLabel, type Scenario, TODAY } from "./fixtures";

const VARIANTS: TimelineVariant[] = ["a", "b"];

function href(variant: TimelineVariant, scenario: Scenario, mode: "light" | "dark") { return `?variant=${variant}&scenario=${scenario}&mode=${mode}`; }

function Controls({ variant, scenario, mode }: { variant: TimelineVariant; scenario: Scenario; mode: "light" | "dark" }) {
  return <nav aria-label="G187 preview controls" className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm dark:border-slate-700 dark:bg-slate-800">
    {VARIANTS.map((item) => <a key={item} aria-current={item === variant ? "page" : undefined} href={href(item, scenario, mode)} className={`flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold active:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${item === variant ? "bg-indigo-600 text-white" : "text-slate-600 dark:text-slate-300"}`}>{item === "a" ? "A · Focused" : "B · Figure-led"}</a>)}
    <a href={href(variant, scenario, mode === "dark" ? "light" : "dark")} className="ml-auto flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-slate-600 active:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-300">{mode === "dark" ? "Light" : "Dark"}</a>
  </nav>;
}

function ScenarioPicker({ variant, scenario, mode }: { variant: TimelineVariant; scenario: Scenario; mode: "light" | "dark" }) {
  return <div className="flex flex-wrap gap-1.5" aria-label="Preview scenarios">{SCENARIOS.map((item) => <a key={item} aria-current={item === scenario ? "page" : undefined} href={href(variant, item, mode)} className={`flex min-h-11 items-center rounded-full px-3 text-xs font-semibold active:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${item === scenario ? "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-200" : "text-slate-600 dark:text-slate-300"}`}>{scenarioLabel[item]}</a>)}</div>;
}

function CurrentComparison({ view, hideValues }: ReturnType<typeof fixtureFor>) {
  return <details className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800"><summary className="min-h-11 cursor-pointer text-sm font-semibold text-slate-900 active:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-white">Current production ladder</summary><div className="mt-3"><CollapsedLadder steps={view.ladder} hideValues={hideValues} /></div></details>;
}

function Inner() {
  const params = useSearchParams();
  const variant: TimelineVariant = params.get("variant") === "b" ? "b" : "a";
  const requestedScenario = params.get("scenario") ?? params.get("state");
  const scenario: Scenario = SCENARIOS.includes(requestedScenario as Scenario) ? requestedScenario as Scenario : "buffer";
  const mode = params.get("mode") === "dark" ? "dark" : "light";
  const fixture = fixtureFor(scenario);
  const [dueOpen, setDueOpen] = useState(false);
  useEffect(() => { document.documentElement.classList.toggle("dark", mode === "dark"); document.documentElement.style.colorScheme = mode; }, [mode]);
  return <main className="min-h-dvh bg-[#f0f2f7] pb-12 dark:bg-[#0f172a]"><div className="mx-auto max-w-[740px] space-y-5 px-4 py-6"><header><h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950 dark:text-white">Planning ladder as a checkpoint timeline</h1><p className="mt-2 max-w-prose text-sm leading-5 text-slate-600 dark:text-slate-300">The hero keeps the current period verdict. These preview-only options change how long-term priority checkpoints are read.</p></header><Controls variant={variant} scenario={scenario} mode={mode} /><ScenarioPicker variant={variant} scenario={scenario} mode={mode} />
    <section aria-label="Shared Planning context" className="space-y-3"><GrowHero view={fixture.view} hideValues={fixture.hideValues} onSeeDue={() => setDueOpen(true)} />{dueOpen && fixture.view.period_gate.short && <section id="period-explanation" className="rounded-2xl border border-red-200 bg-white p-4 text-sm leading-5 text-slate-700 shadow-sm dark:border-red-500/30 dark:bg-slate-800 dark:text-slate-200"><h2 className="font-bold text-slate-950 dark:text-white">Before payday</h2><p className="mt-1"><MoneyText text={maskMoney("This fixture has a £180 gap before 25 October. Review the upcoming payments before funding longer-term plans.", fixture.hideValues)} /></p></section>}<SectionJumpStrip view={fixture.view} debt={fixture.debt} goals={fixture.goals} today={TODAY} hideValues={fixture.hideValues} /></section>
    <section aria-labelledby="proposal-title" className="space-y-3"><div><p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">{variant === "a" ? "A · Focused checkpoints" : "B · Figure-led checkpoints"}</p><h2 id="proposal-title" className="mt-1 text-lg font-bold text-slate-950 dark:text-white">{variant === "a" ? "One live step, everything else quiet" : "Checkpoint figures, easy to scan"}</h2><p className="mt-1 text-sm leading-5 text-slate-600 dark:text-slate-300">{variant === "a" ? "A single full checkpoint gives the current priority room to breathe." : "The same sequence, with relevant figures held in a clean right column."}</p></div><Timeline steps={fixture.view.ladder} metadata={fixture.metadata} hideValues={fixture.hideValues} variant={variant} /></section>
    <CurrentComparison {...fixture} />
    <section aria-label="Fixture destination context" className="space-y-3">
      <section id="buffer" tabIndex={-1} className="scroll-mt-4 border-t border-slate-200 pt-4 dark:border-slate-700">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Buffer</h2>
        <p className="mt-1 text-sm text-slate-700 dark:text-slate-200"><MoneyText text={maskMoney(money(fixture.view.buffer.current) + " saved towards a " + money(fixture.view.buffer.target) + " emergency-fund target.", fixture.hideValues)} /></p>
      </section>
      <section id="debt" tabIndex={-1} className="scroll-mt-4 border-t border-slate-200 pt-4 dark:border-slate-700">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Debt</h2>
        <p className="mt-1 text-sm text-slate-700 dark:text-slate-200"><MoneyText text={maskMoney(fixture.view.debt.has_debt ? money(fixture.view.debt.total) + " interest-bearing balance, with " + money(fixture.debt.totals.monthly_payment ?? 0) + " a month planned." : "No interest-bearing debt in this example.", fixture.hideValues)} /></p>
      </section>
      <section id="commitments" tabIndex={-1} className="scroll-mt-4 border-t border-slate-200 pt-4 dark:border-slate-700">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Goals</h2>
        <p className="mt-1 text-sm text-slate-700 dark:text-slate-200"><MoneyText text={maskMoney(fixture.goals.length ? "Home deposit: " + money(fixture.goals[0].remaining ?? 0) + " remaining over 12 months." : "No goals still to fund in this example.", fixture.hideValues)} /></p>
      </section>
    </section>
  </div></main>;
}

export default function PlanningLadderTimelineClient() { return <Inner />; }
