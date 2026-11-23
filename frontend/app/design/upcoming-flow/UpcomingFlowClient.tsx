"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Eye, EyeOff, Moon, Sun } from "lucide-react";
import BottomNavRail from "@/components/navigation/BottomNavRail";
import PhosphorNavIcon from "@/components/navigation/PhosphorNavIcon";
import PennyAppearanceIcon from "@/components/PennyAppearanceIcon";
import { BalancesHiddenContext } from "@/lib/balancesHidden";
import { BOTTOM_NAV_TABS } from "@/lib/navigation/bottomNav";
import AccountsOverview from "./AccountsOverview";
import PaymentContext from "./PaymentContext";
import PlansPanel from "./PlansPanel";
import PreviewDetails, { type PreviewDetail } from "./PreviewDetails";
import { planFixtures, planCaseOptions } from "./plan-fixtures";
import type { PlanCaseId, PlanPreviewItem, PlanVariant } from "./PlanPreview.types";
import { focusClass, quietClass } from "./ui";

function PreviewControls({ variant, state, dark, hidden }: { variant: PlanVariant; state: PlanCaseId; dark: boolean; hidden: boolean }) {
  const href = (changes: Record<string, string>) => `?${new URLSearchParams({ variant, state, mode: dark ? "dark" : "light", hidden: hidden ? "1" : "0", ...changes })}`;
  const control = "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl px-2 text-xs font-semibold hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white active:opacity-70";
  return <nav aria-label="Design preview" className="border-b border-slate-700 bg-slate-950 px-4 py-2 text-white">
    <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2">
      <div className="grid w-full grid-cols-[1fr_1fr_44px_44px] items-center gap-1 sm:w-auto">
        {(["e", "f"] as const).map(option => <Link key={option} href={href({ variant: option })} aria-current={option === variant ? "page" : undefined} className={`${control} ${option === variant ? "bg-slate-700" : ""}`}>{option === "e" ? "E · Together" : "F · Separate"}</Link>)}
        <Link className={control} href={href({ mode: dark ? "light" : "dark" })} aria-label={dark ? "Use light theme" : "Use dark theme"}>{dark ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}</Link>
        <Link className={control} href={href({ hidden: hidden ? "0" : "1" })} aria-label={hidden ? "Show balances" : "Hide balances"}>{hidden ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}</Link>
      </div>
      <Link href="/design" className={`${control} text-slate-300`}>G489</Link>
      <label className="min-w-0 flex-1 sm:flex-none"><span className="sr-only">Example scenario</span><select name="scenario" aria-label="Example scenario" value={state} onChange={event => window.location.assign(href({ state: event.target.value }))} className="min-h-11 w-full rounded-xl border border-slate-600 bg-slate-900 px-2 text-base text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:w-60">{planCaseOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
      <p className="w-full text-[11px] leading-4 text-slate-400">Fictional examples · Account formatting and plans only</p>
    </div>
  </nav>;
}

function DesktopNav() {
  return <aside className="sticky top-5 hidden h-[calc(100dvh-40px)] w-44 shrink-0 flex-col lg:flex">
    <Link href="/home" className={`flex min-h-12 items-center px-3 text-xl font-bold tracking-tight ${focusClass}`}>Sorted</Link>
    <nav aria-label="Primary" className="mt-5 space-y-1">{BOTTOM_NAV_TABS.map(tab => <Link key={tab.id} href={tab.href} aria-current={tab.id === "upcoming" ? "page" : undefined} className={`flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-semibold active:opacity-70 ${focusClass} ${tab.id === "upcoming" ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-400/10 dark:text-indigo-300" : `${quietClass} hover:bg-slate-200/60 dark:hover:bg-slate-800`}`}><PhosphorNavIcon tab={tab.id} selected={tab.id === "upcoming"} appearance="ink" />{tab.label}</Link>)}<Link href="/settings" className={`flex min-h-12 items-center rounded-xl px-3 text-sm ${quietClass} ${focusClass}`}>Settings</Link></nav>
    <Link href="/penny" className={`mb-4 mt-auto flex min-h-12 items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-semibold dark:border-slate-700 dark:bg-slate-800 ${focusClass}`}><PennyAppearanceIcon appearance="ink" size={24} />Ask Penny</Link>
  </aside>;
}

function Preview({ variant, state, dark, hidden }: { variant: PlanVariant; state: PlanCaseId; dark: boolean; hidden: boolean }) {
  const fixture = planFixtures[state];
  const [status, setStatus] = useState(fixture.status);
  const [drafts, setDrafts] = useState<PlanPreviewItem[]>([]);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [view, setView] = useState<PreviewDetail | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const plans = [...fixture.plans, ...drafts];
  const open = (next: PreviewDetail) => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setView(next); };
  const close = () => { setView(null); requestAnimationFrame(() => opener.current?.focus({ preventScroll: true })); };
  const atRiskCount = fixture.scenario.payments.filter(payment => payment.firstGapPence !== undefined).length;
  return <BalancesHiddenContext.Provider value={hidden}>
    <div inert={view !== null} aria-hidden={view ? true : undefined}>
      <a href="#upcoming-preview" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-xl focus:bg-white focus:p-4 focus:text-slate-950">Skip to Upcoming preview</a>
      <PreviewControls variant={variant} state={state} dark={dark} hidden={hidden} />
      <div className="mx-auto flex max-w-5xl gap-8 px-4 pt-6 lg:px-6 lg:pt-8">
        <DesktopNav />
        <main id="upcoming-preview" tabIndex={-1} className="mx-auto w-full min-w-0 max-w-xl pb-36 outline-none lg:pb-8">
          <header className="mb-5 flex items-start justify-between gap-4">
            <div><h1 className="text-[28px] font-bold leading-tight tracking-[-0.035em] text-slate-950 dark:text-white">Before payday</h1><p className={`mt-1 max-w-sm text-sm leading-6 ${quietClass}`}>What will enter or leave, and whether every payment is covered.</p></div>
            <Link href="/upcoming/dismissed" aria-label="Review hidden predictions" className={`flex size-11 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-800 ${focusClass}`}><EyeOff size={20} strokeWidth={1.75} aria-hidden="true" /></Link>
          </header>
          <div className="space-y-5">
            <AccountsOverview scenario={fixture.scenario} planWorking={fixture.planWorking} />
            <p className={`px-1 text-xs leading-5 ${quietClass}`}>Payments can take a day or two to appear, so a very recent one may not be counted yet.</p>
            <PlansPanel variant={variant} items={plans} accounts={fixture.scenario.accounts} status={status} onAdd={() => open({ kind: "add" })} onOpen={id => { const item = plans.find(plan => plan.id === id); if (item) open({ kind: "plan", item }); }} onRetry={() => setStatus("ready")} />
            <PaymentContext scenario={fixture.scenario} onOpen={item => open({ kind: "payment", item })} onDismiss={item => open({ kind: "payment", item })} />
          </div>
        </main>
      </div>
      <div className="lg:hidden"><BottomNavRail appearance="ink" resolved activeTab="upcoming" pennyActive={false} pennyOpen={false} pennyCurrent={false} paydayActive={false} atRiskCount={atRiskCount} onPennyClick={() => window.location.assign("/penny")} /></div>
    </div>
    {view && <PreviewDetails view={view} accounts={fixture.scenario.accounts} dark={dark} choices={choices} onChoice={(planId, accountId) => setChoices(current => ({ ...current, [planId]: accountId }))} onAdd={item => setDrafts(current => [...current, item])} onClose={close} />}
  </BalancesHiddenContext.Provider>;
}

export default function UpcomingFlowClient() {
  const params = useSearchParams();
  const requested = params.get("state");
  const state: PlanCaseId = requested && requested in planFixtures ? requested as PlanCaseId : "current";
  const variant: PlanVariant = params.get("variant") === "f" ? "f" : "e";
  const dark = params.get("mode") === "dark";
  const hidden = params.get("hidden") === "1";
  useEffect(() => { const root = document.documentElement; const wasDark = root.classList.contains("dark"); const priorScheme = root.style.colorScheme; root.classList.toggle("dark", dark); root.style.colorScheme = dark ? "dark" : "light"; return () => { root.classList.toggle("dark", wasDark); root.style.colorScheme = priorScheme; }; }, [dark]);
  return <div className={dark ? "dark" : ""} style={{ colorScheme: dark ? "dark" : "light" }}><div className="min-h-dvh bg-[#f0f2f7] text-slate-900 selection:bg-indigo-200 selection:text-slate-950 dark:bg-slate-900 dark:text-slate-100 dark:selection:bg-indigo-800 dark:selection:text-white"><Preview key={state} variant={variant} state={state} dark={dark} hidden={hidden} /></div></div>;
}
