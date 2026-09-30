"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronDown, Moon, Sun } from "lucide-react";
import UpcomingAccountsCard from "@/components/upcoming/UpcomingAccountsCard";
import UpcomingAccountDetails from "@/components/upcoming/UpcomingAccountDetails";
import UpcomingPlanDetails from "@/components/upcoming/UpcomingPlanDetails";
import UpcomingFlowSheet from "@/components/UpcomingFlowSheet";
import SetAsideList from "@/components/upcoming/SetAsideList";
import { BANK_META, BankBadge, bankKey, bankLogoSrc } from "@/components/AccountMiniCard";
import { PlanIcon } from "@/components/upcoming/detailPrimitives";
import AccountStatusCard, { type Variant } from "./AccountStatusCard";
import { fixtureFor, PERIOD, SCENARIOS, type Scenario } from "./fixtures";

const focus = "touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900";
const muted = "text-slate-600 dark:text-slate-400";
const VARIANTS = [{ id: "a", name: "Aligned dots" }, { id: "b", name: "Warning & info" }] as const;
type View = { kind: "account" | "plan"; id: string };

function Preview({ variant, scenario, mode }: { variant: Variant; scenario: Scenario; mode: "light" | "dark" }) {
  const fixture = useMemo(() => fixtureFor(scenario), [scenario]);
  const [plansStatus, setPlansStatus] = useState(fixture.plansStatus);
  const [view, setView] = useState<View | null>(null);
  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    const prior = root.style.colorScheme;
    root.classList.toggle("dark", mode === "dark");
    root.style.colorScheme = mode;
    return () => { root.classList.toggle("dark", wasDark); root.style.colorScheme = prior; };
  }, [mode]);
  const query = (change: { variant?: Variant; state?: Scenario; mode?: "light" | "dark" }) => `?variant=${change.variant ?? variant}&state=${change.state ?? scenario}&mode=${change.mode ?? mode}`;
  const props = { ...fixture, plansStatus, periodLabel: PERIOD, onOpen: (account: { id: string }) => setView({ kind: "account", id: account.id }), onRetry: () => setPlansStatus("ready") };
  return <>
    <div inert={view !== null} aria-hidden={view ? true : undefined} className="min-h-dvh bg-[#f0f2f7] text-slate-950 dark:bg-slate-900 dark:text-slate-50">
      <a href="#preview" className="sr-only fixed left-4 top-3 z-[90] rounded-xl bg-slate-950 px-4 py-3 text-sm text-white focus:not-sr-only">Skip to preview</a>
      <header className="border-b border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
        <div className="mx-auto max-w-5xl px-3 py-3 min-[360px]:px-4 sm:px-6">
          <div className="flex items-center justify-between gap-4">
            <Link href="/design" className={`flex min-h-11 items-center gap-2 rounded-lg text-sm hover:text-slate-950 active:opacity-70 dark:hover:text-slate-50 ${muted} ${focus}`}><ArrowLeft size={16} aria-hidden="true" />Design rounds</Link>
            <Link href={query({ mode: mode === "dark" ? "light" : "dark" })} aria-label={`Use ${mode === "dark" ? "light" : "dark"} theme`} className={`flex size-11 items-center justify-center rounded-xl hover:bg-slate-100 active:opacity-70 dark:hover:bg-slate-700 ${focus}`}>{mode === "dark" ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}</Link>
          </div>
          <h1 className="mt-2 text-balance text-xl font-bold">G176 · Account formatting</h1>
          <nav aria-label="Formatting options" className="mt-4 grid grid-cols-2 gap-2 sm:max-w-md">
            {VARIANTS.map((item) => <Link key={item.id} href={query({ variant: item.id })} aria-current={variant === item.id ? "page" : undefined} className={`flex min-h-11 items-center justify-center rounded-xl border px-2 py-2 text-center text-sm font-semibold active:opacity-70 ${focus} ${variant === item.id ? "border-indigo-600 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-400/10 dark:text-indigo-300" : "border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"}`}>{item.id.toUpperCase()} · {item.name}</Link>)}
          </nav>
          <details className="group mt-1">
            <summary className={`flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg text-xs hover:bg-slate-50 active:opacity-70 dark:hover:bg-slate-700 [&::-webkit-details-marker]:hidden ${focus}`}><span>Example: <span className="font-semibold">{SCENARIOS.find((item) => item.id === scenario)?.label}</span></span><ChevronDown size={16} className="group-open:rotate-180" aria-hidden="true" /></summary>
            <nav aria-label="Example scenarios" className="grid grid-cols-2 gap-2 pb-3 sm:grid-cols-3">{SCENARIOS.map((item) => <Link key={item.id} href={query({ state: item.id })} aria-current={scenario === item.id ? "page" : undefined} className={`flex min-h-11 items-center justify-center rounded-lg border px-2 py-2 text-center text-xs hover:bg-slate-50 active:opacity-70 dark:hover:bg-slate-700 ${focus} ${scenario === item.id ? "border-indigo-500 text-indigo-700 dark:text-indigo-300" : "border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300"}`}>{item.label}</Link>)}</nav>
          </details>
        </div>
      </header>
      <main id="preview" className="mx-auto grid max-w-5xl items-start gap-8 px-3 py-6 pb-28 min-[360px]:px-4 sm:px-6 lg:grid-cols-2 lg:gap-12">
        <section aria-label="Proposed account formatting" className="min-w-0 space-y-6">
          <AccountStatusCard variant={variant} {...props} />
          {fixture.plans.length > 0 && <section aria-labelledby="set-aside-heading">
            <h2 id="set-aside-heading" className="mb-3 text-sm font-semibold">Set aside this period</h2>
            <SetAsideList items={fixture.plans.map((plan) => ({ id: plan.id, name: plan.name, feedLabel: plan.destination, amountPerPeriod: plan.periodPence / 100, filledThisPeriod: plan.filledPence / 100, remaining: (plan.remainingPence ?? 0) / 100, recurrence: "every_period", pending: false, completed: false }))} onEdit={(id) => setView({ kind: "plan", id })} />
          </section>}
        </section>
        <section aria-label="About this refinement" className="min-w-0 space-y-5">
          <div>
            <h2 className="text-balance text-base font-bold">{variant === "a" ? "A · Quiet, aligned dots" : "B · Different shapes, clearer signals"}</h2>
            <p className={`mt-2 text-sm leading-6 ${muted}`}>{variant === "a" ? "Keeps the familiar dots, each aligned with the amount. Healthy accounts stay unmarked." : "A warning triangle marks a payment shortfall. An information symbol marks plans or optional transfers that need more cash. Healthy accounts stay unmarked."}</p>
          </div>
          <ul className={`list-disc space-y-2 pl-4 text-sm leading-6 ${muted}`}>
            <li>Amounts share one right edge and always show pounds and pence.</li>
            <li>“Left after…” is a balance. “Short for…” is the extra cash needed.</li>
            <li>Estimates stay labelled beside the result they qualify.</li>
          </ul>
          <p className={`text-sm leading-6 ${muted}`}>Invented examples only. Tap an account to see its production working. This round changes presentation only; calculations and the payday hero are unchanged.</p>
          <details className="group border-t border-slate-200 pt-2 dark:border-slate-700">
            <summary className={`flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg text-sm font-semibold hover:bg-slate-100 active:opacity-70 dark:hover:bg-slate-800 [&::-webkit-details-marker]:hidden ${focus}`}><span>Compare with the current card</span><ChevronDown size={16} className="group-open:rotate-180" aria-hidden="true" /></summary>
            <div className="mt-3"><UpcomingAccountsCard {...props} /></div>
          </details>
          <p className={`text-xs leading-5 ${muted}`}>Proposal only. The selected treatment will be moved into the production card and this preview will render it directly.</p>
        </section>
      </main>
    </div>
    {view && <UpcomingFlowSheet<View> initialView={view} onClose={() => setView(null)} renderView={(current, navigation) => {
      const action = (text: string, onClick: () => void) => <button type="button" onClick={onClick} className={`flex min-h-11 w-full items-center justify-center rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700 active:opacity-70 ${focus}`}>{text}</button>;
      if (current.kind === "account") {
        const account = fixture.accounts.find((item) => item.id === current.id)!;
        const meta = BANK_META[bankKey({ provider: account.bank })];
        return { title: account.bank, subtitle: `${account.name} · ${PERIOD}`, leading: <BankBadge logoSrc={bankLogoSrc(meta)} initials={meta?.initials ?? account.bank.slice(0, 2)} altText="" size={36} />, body: <UpcomingAccountDetails account={account} plans={fixture.plans} plansStatus={plansStatus} periodLabel={PERIOD} onPlan={(id) => navigation.goTo({ kind: "plan", id })} />, footer: action("Done", navigation.close) };
      }
      const plan = fixture.plans.find((item) => item.id === current.id)!;
      const account = fixture.accounts.find((item) => item.id === plan.sourceId);
      return { title: plan.name, subtitle: "Allocation · This pay period", leading: <PlanIcon kind={plan.kind} />, body: <UpcomingPlanDetails plan={plan} accountName={account ? `${account.bank} · ${account.name}` : null} />, footer: action(view.kind === "account" ? "Back to account" : "Done", view.kind === "account" ? navigation.back : navigation.close) };
    }} />}
  </>;
}

export default function PreviewClient() {
  const params = useSearchParams();
  const variant = params.get("variant") === "b" ? "b" : "a";
  const scenario = SCENARIOS.find((item) => item.id === params.get("state"))?.id ?? "mixed";
  const mode = params.get("mode") === "dark" ? "dark" : "light";
  return <Preview key={`${variant}-${scenario}-${mode}`} variant={variant} scenario={scenario} mode={mode} />;
}
