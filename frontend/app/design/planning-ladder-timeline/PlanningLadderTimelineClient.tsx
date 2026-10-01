"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { GrowHero } from "@/app/planning/GrowPanel";
import SectionJumpStrip from "@/app/planning/SectionJumpStrip";
import MoneyText from "@/components/MoneyText";
import { maskMoney, money } from "@/app/planning/GrowPanel";
import Timeline, { type TimelineExpand, type TimelineVariant } from "./Timeline";
import { fixtureFor, SCENARIOS, scenarioLabel, type Scenario, TODAY } from "./fixtures";
import { planningCheckpointFigures } from "@/lib/planningCheckpointFigures";

const VARIANTS: TimelineVariant[] = ["a", "b"];

function href(variant: TimelineVariant, scenario: Scenario, mode: "light" | "dark", expand: TimelineExpand) { return `?variant=${variant}&scenario=${scenario}&mode=${mode}${expand ? `&expand=${expand}` : ""}`; }

function Controls({ variant, scenario, mode, expand }: { variant: TimelineVariant; scenario: Scenario; mode: "light" | "dark"; expand: TimelineExpand }) {
  return <nav aria-label="G187 preview controls" className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm dark:border-slate-700 dark:bg-slate-800">
    {VARIANTS.map((item) => <a key={item} aria-current={item === variant ? "page" : undefined} href={href(item, scenario, mode, expand)} className={`flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold active:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${item === variant ? "bg-indigo-600 text-white" : "text-slate-600 dark:text-slate-300"}`}>{item === "a" ? "A · Individual cards" : "B · Shared group card"}</a>)}
    <a href={href(variant, scenario, mode === "dark" ? "light" : "dark", expand)} className="ml-auto flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-slate-600 active:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-300">{mode === "dark" ? "Light" : "Dark"}</a>
  </nav>;
}

function ScenarioPicker({ variant, scenario, mode, expand }: { variant: TimelineVariant; scenario: Scenario; mode: "light" | "dark"; expand: TimelineExpand }) {
  return <div className="flex flex-wrap gap-1.5" aria-label="Preview scenarios">{SCENARIOS.map((item) => <a key={item} aria-current={item === scenario ? "page" : undefined} href={href(variant, item, mode, expand)} className={`flex min-h-11 items-center rounded-full px-3 text-xs font-semibold active:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${item === scenario ? "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-200" : "text-slate-600 dark:text-slate-300"}`}>{scenarioLabel[item]}</a>)}</div>;
}

function Inner() {
  const params = useSearchParams();
  const variant: TimelineVariant = params.get("variant") === "a" ? "a" : "b";
  const requestedScenario = params.get("scenario") ?? params.get("state");
  const scenario: Scenario = SCENARIOS.includes(requestedScenario as Scenario) ? requestedScenario as Scenario : "buffer";
  const mode = params.get("mode") === "dark" ? "dark" : "light";
  const requestedExpand = params.get("expand");
  const expand: TimelineExpand = requestedExpand === "done" || requestedExpand === "later" || requestedExpand === "all" ? requestedExpand : null;
  const fixture = fixtureFor(scenario);
  const [dueOpen, setDueOpen] = useState(false);
  useEffect(() => {
    const wasDark = document.documentElement.classList.contains("dark");
    const oldScheme = document.documentElement.style.colorScheme;
    document.documentElement.classList.toggle("dark", mode === "dark");
    document.documentElement.style.colorScheme = mode;
    return () => {
      document.documentElement.classList.toggle("dark", wasDark);
      document.documentElement.style.colorScheme = oldScheme;
    };
  }, [mode]);
  return <main className="min-h-dvh bg-[#f0f2f7] pb-12 dark:bg-[#0f172a]"><div className="mx-auto max-w-[740px] space-y-5 px-4 py-6"><header><h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950 dark:text-white">Planning checkpoints</h1><p className="mt-2 max-w-prose text-sm leading-5 text-slate-600 dark:text-slate-300">The approved shared-card timeline below renders the production component. It keeps completed and later checkpoints folded until needed, with deliberate breathing room on both sides of each separator.</p></header><Controls variant={variant} scenario={scenario} mode={mode} expand={expand} /><ScenarioPicker variant={variant} scenario={scenario} mode={mode} expand={expand} />
    <section aria-label="Shared Planning context" className="space-y-3"><GrowHero view={fixture.view} hideValues={fixture.hideValues} onSeeDue={() => setDueOpen(true)} />{dueOpen && fixture.view.period_gate.short && <section id="period-explanation" className="rounded-2xl border border-red-200 bg-white p-4 text-sm leading-5 text-slate-700 shadow-sm dark:border-red-500/30 dark:bg-slate-800 dark:text-slate-200"><h2 className="font-bold text-slate-950 dark:text-white">Before payday</h2><p className="mt-1"><MoneyText text={maskMoney("This fixture has a £180 gap before 25 October. Review the upcoming payments before funding longer-term plans.", fixture.hideValues)} /></p></section>}<SectionJumpStrip view={fixture.view} debt={fixture.debt} goals={fixture.goals} today={TODAY} hideValues={fixture.hideValues} /></section>
    <section aria-labelledby="proposal-title" className="space-y-3"><div><h2 id="proposal-title" className="text-lg font-bold text-slate-950 dark:text-white">{variant === "a" ? "A · Individual cards, not selected" : "B · Approved shared group card"}</h2><p className="mt-1 text-sm leading-5 text-slate-600 dark:text-slate-300">{variant === "a" ? "The unselected comparison keeps each revealed checkpoint in a separate card." : "One shared card holds each opened completed or later group. The external rail and one active card remain distinct."}</p></div><Timeline key={`${variant}-${scenario}-${expand ?? "none"}`} steps={fixture.view.ladder} metadata={fixture.metadata} hideValues={fixture.hideValues} variant={variant} initialExpand={expand} figures={planningCheckpointFigures(fixture.view)} /></section>
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
