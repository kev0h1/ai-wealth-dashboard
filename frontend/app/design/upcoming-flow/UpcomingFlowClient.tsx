"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Eye, EyeOff, Moon, Sun } from "lucide-react";
import BottomNavRail from "@/components/navigation/BottomNavRail";
import PhosphorNavIcon from "@/components/navigation/PhosphorNavIcon";
import PennyAppearanceIcon from "@/components/PennyAppearanceIcon";
import { BalancesHiddenContext } from "@/lib/balancesHidden";
import { BOTTOM_NAV_TABS } from "@/lib/navigation/bottomNav";
import AccountLanes from "./AccountLanes";
import PaymentAgenda from "./PaymentAgenda";
import { scenarios, scenarioOptions } from "./fixtures";
import { focusClass, quietClass } from "./ui";
import type { ScenarioId, Variant } from "./types";

function PreviewControls({ variant, state, dark, hidden }: { variant: Variant; state: ScenarioId; dark: boolean; hidden: boolean }) {
  const href = (changes: Record<string, string>) => {
    const params = new URLSearchParams({ variant, state, mode: dark ? "dark" : "light", hidden: hidden ? "1" : "0", ...changes });
    return `?${params.toString()}`;
  };
  const control = "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl px-3 text-xs font-semibold hover:bg-slate-800 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white";
  return <nav aria-label="Design preview" className="border-b border-slate-700 bg-slate-950 px-4 py-2 text-white">
    <div className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-x-1 gap-y-2">
      <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:flex-1">
      <Link href="/design" className={`${control} mr-auto text-slate-300`}>G489 · Upcoming</Link>
      <div className="flex shrink-0 rounded-xl border border-slate-700 p-0.5">
        {(["c", "d"] as const).map(option => <Link key={option} href={href({ variant: option })} aria-current={option === variant ? "page" : undefined} className={`${control} ${option === variant ? "bg-slate-700" : ""}`}>{option === "c" ? "C · Accounts" : "D · By date"}</Link>)}
      </div>
      </div>
      <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-xs sm:ml-2 sm:flex-none">
        <span className="sr-only">Example scenario</span>
        <select aria-label="Example scenario" name="scenario" autoComplete="off" value={state} onChange={event => window.location.assign(href({ state: event.target.value }))} className="min-h-11 w-full min-w-0 rounded-xl border border-slate-600 bg-slate-900 px-3 text-base text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:w-48">
          {scenarioOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </label>
      <Link className={control} href={href({ mode: dark ? "light" : "dark" })} aria-label={dark ? "Use light theme" : "Use dark theme"}>{dark ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}<span className="sr-only sm:not-sr-only">{dark ? "Light" : "Dark"}</span></Link>
      <Link className={control} href={href({ hidden: hidden ? "0" : "1" })} aria-label={hidden ? "Show balances" : "Hide balances"}>{hidden ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}<span className="sr-only sm:not-sr-only">{hidden ? "Show" : "Hide"}</span></Link>
      <p className="w-full pb-0.5 text-[11px] leading-4 text-slate-400">Fictional examples · No money is moved</p>
    </div>
  </nav>;
}

function DesktopNav() {
  return <aside className="sticky top-5 hidden h-[calc(100dvh-40px)] w-44 shrink-0 flex-col lg:flex xl:w-48">
    <Link href="/home" className={`flex min-h-12 items-center px-3 text-xl font-bold tracking-tight ${focusClass}`}>Sorted</Link>
    <nav aria-label="Primary" className="mt-5 space-y-1">
      {BOTTOM_NAV_TABS.map(tab => <Link key={tab.id} href={tab.href} aria-current={tab.id === "upcoming" ? "page" : undefined} className={`flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-semibold active:opacity-70 ${focusClass} ${tab.id === "upcoming" ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-400/10 dark:text-indigo-300" : `${quietClass} hover:bg-slate-200/60 dark:hover:bg-slate-800`}`}><PhosphorNavIcon tab={tab.id} selected={tab.id === "upcoming"} appearance="ink" />{tab.label}</Link>)}
      <Link href="/settings" className={`flex min-h-12 items-center rounded-xl px-3 text-sm ${quietClass} ${focusClass}`}>Settings</Link>
    </nav>
    <Link href="/penny" className={`mb-4 mt-auto flex min-h-12 items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-semibold dark:border-slate-700 dark:bg-slate-800 ${focusClass}`}><PennyAppearanceIcon appearance="ink" size={24} />Ask Penny</Link>
  </aside>;
}

export default function UpcomingFlowClient() {
  const params = useSearchParams();
  const variant: Variant = params.get("variant") === "d" ? "d" : "c";
  const requestedState = params.get("state");
  const state: ScenarioId = requestedState && requestedState in scenarios ? requestedState as ScenarioId : "several";
  const dark = params.get("mode") === "dark";
  const hidden = params.get("hidden") === "1";
  const scenario = scenarios[state];
  useEffect(() => {
    const wasDark = document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", dark);
    return () => { document.documentElement.classList.toggle("dark", wasDark); };
  }, [dark]);
  const atRiskCount = scenario.payments.filter(payment => payment.firstGapPence !== undefined).length;
  return <BalancesHiddenContext.Provider value={hidden}><div className={dark ? "dark" : ""} style={{ colorScheme: dark ? "dark" : "light" }}>
    <div className="min-h-dvh bg-[#f0f2f7] text-slate-900 selection:bg-indigo-200 selection:text-slate-950 dark:bg-slate-900 dark:text-slate-100 dark:selection:bg-indigo-800 dark:selection:text-white">
      <a href="#upcoming-preview" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-xl focus:bg-white focus:p-4 focus:text-slate-950">Skip to Upcoming preview</a>
      <PreviewControls variant={variant} state={state} dark={dark} hidden={hidden} />
      <div className="mx-auto flex max-w-[1280px] gap-8 px-4 pb-4 pt-6 lg:px-6 lg:pt-8">
        <DesktopNav />
        <main id="upcoming-preview" tabIndex={-1} className="min-w-0 flex-1 pb-28 outline-none lg:pb-8" aria-label="Upcoming payments before payday">
          {variant === "c" ? <AccountLanes key={state} scenario={scenario} hidden={hidden} /> : <PaymentAgenda key={state} scenario={scenario} hidden={hidden} />}
        </main>
      </div>
      <div className="lg:hidden"><BottomNavRail appearance="ink" resolved activeTab="upcoming" pennyActive={false} pennyOpen={false} pennyCurrent={false} paydayActive={false} atRiskCount={atRiskCount} onPennyClick={() => window.location.assign("/penny")} /></div>
    </div>
  </div></BalancesHiddenContext.Provider>;
}
