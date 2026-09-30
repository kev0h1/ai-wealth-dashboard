"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronRight, CreditCard, Moon, Sun } from "lucide-react";
import type { Account, Allocation } from "@/lib/api";
import { assessPlanOverlap, type Plan } from "@/lib/upcomingPlans";
import type { PaymentDetail, UpcomingDetailServices, UpcomingDetailView } from "@/components/upcoming/UpcomingDetailFlow";
import UpcomingDetailFlow from "@/components/upcoming/UpcomingDetailFlow";
import UpcomingAccountsCard from "@/components/upcoming/UpcomingAccountsCard";
import UpcomingHeroCard from "@/components/upcoming/UpcomingHeroCard";
import type { UpcomingRowModel } from "@/components/upcoming/UpcomingRow";
import { ACCOUNTS, PERIOD, SCENARIOS, cashflowFor, forecastFor, heroFor, plansFor, type Scenario } from "./fixtures";

const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900";
const muted = "text-slate-600 dark:text-slate-400";
const baseAccounts: Account[] = ACCOUNTS.map((account) => ({ ...account, status: "active" }));
const initialAllocation = { id: "allocation-round-ups", name: "Savings challenge", amount_per_period: 360, fill_account_id: "challenge", source_account_id: "monzo", match_type: "description_contains", match_value: "SAVINGS CHALLENGE", fill_display_name: "Savings challenge", effective_from: "2026-10-01", recurrence: "every_period", completed: false, pending: false, active: true, filled_this_period: 60, remaining: 300, period_start: "2026-10-01", period_end: "2026-10-29" } as Allocation;

function cardPayment(): PaymentDetail {
  const model: UpcomingRowModel = { rowKey: "orchard", identity: "orchard", type: "bill", name: "Orchard digital services", amount: 18.99, expectedDate: "2026-10-01", originalDate: "2026-10-01", category: "Subscriptions", accountLabel: "Amex", isCreditCard: true, pending: true, daysPastDue: 2, after: { kind: "credit-card" }, categoryColour: "#22d3ee", CategoryIcon: CreditCard };
  return { id: "orchard", model, editor: { name: model.name, amount: model.amount, expected_date: model.expectedDate, original_date: model.originalDate, type: "bill", edited: false, rule_label: "Monthly" } };
}

function Preview({ scenario, mode, initial, plansStatus }: { scenario: Scenario; mode: "light" | "dark"; initial: UpcomingDetailView | null; plansStatus: "loading" | "error" | "ready" }) {
  const [plans, setPlans] = useState<Plan[]>(() => plansFor(scenario));
  const [allocation, setAllocation] = useState(() => ({ ...initialAllocation, source_account_id: scenario === "unassigned" || scenario === "suggested" ? null : "monzo" }));
  const [planned, setPlanned] = useState({ id: "planned-example", name: "Birthday meal", amount: 40, date: "2026-10-18", account_id: "monzo" as string | null });
  const [plannedPresent, setPlannedPresent] = useState(true);
  const [paymentPresent, setPaymentPresent] = useState(true);
  const [payment, setPayment] = useState(cardPayment);
  const [flowView, setFlowView] = useState<UpcomingDetailView | null>(initial);
  const [failNextSave, setFailNextSave] = useState(false);
  const [failNextRefresh, setFailNextRefresh] = useState(false);
  const [slowSave, setSlowSave] = useState(false);
  const [writeCount, setWriteCount] = useState(0);
  const failures = useRef({ save: false, refresh: false, slow: false });
  const cashflow = useMemo(() => cashflowFor(scenario), [scenario]);
  const walk = useMemo(() => forecastFor(scenario), [scenario]);
  const accounts = useMemo(() => baseAccounts.map((account) => ({ ...account, balance: walk.accounts.find((item) => item.id === account.id)?.opening ?? account.balance })), [walk]);
  const plannedPayment: PaymentDetail = {
    id: planned.id, planned,
    model: { ...cardPayment().model, rowKey: planned.id, identity: planned.id, name: planned.name, amount: planned.amount, expectedDate: planned.date, originalDate: planned.date, isCreditCard: false, isPlanned: true, pending: false, daysPastDue: 0, accountLabel: accounts.find((account) => account.id === planned.account_id)?.provider ?? "Not confirmed", assessment: "unverified", after: { kind: "balance", value: 296 } },
    editor: { name: planned.name, amount: planned.amount, expected_date: planned.date, type: "bill" },
  };
  const previewPlans = useMemo(() => assessPlanOverlap(plans, cashflow, Date.parse("2026-10-29T23:59:59Z")), [plans, cashflow]);
  const hero = useMemo(() => scenario === "missing" ? null : heroFor(scenario, previewPlans), [previewPlans, scenario]);
  useEffect(() => { const root = document.documentElement; const wasDark = root.classList.contains("dark"); const prior = root.style.colorScheme; root.classList.toggle("dark", mode === "dark"); root.style.colorScheme = mode; return () => { root.classList.toggle("dark", wasDark); root.style.colorScheme = prior; }; }, [mode]);
  const guard = useCallback(async () => {
    if (failures.current.slow) await new Promise((resolve) => setTimeout(resolve, 1200));
    if (failures.current.save) { failures.current.save = false; setFailNextSave(false); throw new Error("Preview save failure"); }
    setWriteCount((count) => count + 1);
  }, []);
  const refresh = useCallback(async () => {
    if (failures.current.refresh) { failures.current.refresh = false; setFailNextRefresh(false); throw new Error("Preview refresh failure"); }
  }, []);
  const services = useMemo<UpcomingDetailServices>(() => ({
    upcoming: {
      editUpcoming: async (change) => { await guard(); setPayment((current) => ({ ...current, model: { ...current.model, expectedDate: change.new_date ?? current.model.expectedDate, amount: change.new_amount ?? current.model.amount }, editor: { ...current.editor, expected_date: change.new_date ?? current.editor.expected_date, amount: change.new_amount ?? current.editor.amount, edited: true } })); return { ok: true }; },
      clearUpcomingOverride: async () => { await guard(); setPayment(cardPayment()); return { ok: true }; },
      skipUpcomingOccurrence: async () => { await guard(); setPaymentPresent(false); return { ok: true }; },
      previewUpcomingRule: async ({ text }) => ({ ok: Boolean(text.trim()), schedule: { text }, label: "Monthly", next_dates: ["2026-11-01", "2026-12-01"] }),
      applyUpcomingRule: async () => { await guard(); setPayment((current) => ({ ...current, editor: { ...current.editor, rule_label: "Monthly" } })); return { ok: true }; },
      clearUpcomingRule: async () => { await guard(); setPayment((current) => ({ ...current, editor: { ...current.editor, rule_label: null } })); return { ok: true }; },
    },
    planned: { updatePlanned: async (id, patch) => { await guard(); const updated = { ...planned, ...patch, id }; setPlanned(updated); return updated; } },
    allocation: {
      updateAllocation: async (_id, patch) => {
        await guard();
        const updated = { ...allocation, ...patch, source_account_id: patch.source_account_id === undefined ? allocation.source_account_id : patch.source_account_id };
        updated.remaining = Math.max(0, updated.amount_per_period - updated.filled_this_period);
        setAllocation(updated);
        setPlans((current) => current.map((plan) => plan.recordId === "allocation-round-ups" ? {
          ...plan, name: updated.name, periodPence: Math.round(updated.amount_per_period * 100),
          remainingPence: Math.round(updated.remaining * 100), active: updated.active,
          destination: accounts.find((account) => account.id === updated.fill_account_id)?.name ?? "Receiving pot",
          destinationIds: [updated.fill_account_id], sourceId: patch.source_account_id === undefined ? plan.sourceId : updated.source_account_id,
          evidence: patch.source_account_id === undefined ? plan.evidence : patch.source_account_id ? "chosen" : "unknown",
        } : plan));
        return updated;
      },
      deleteAllocation: async () => { await guard(); setPlans((current) => current.filter((plan) => plan.recordId !== "allocation-round-ups")); return { ok: true }; },
      allocationFillCandidates: async () => [{ series_key: "salary", display_name: "Monthly transfer", last_amount: 300, last_date: "2026-09-28", occurrences_90d: 3 }],
    },
    changeGoalSource: async (id, source) => { await guard(); setPlans((current) => current.map((plan) => plan.recordId === id ? { ...plan, sourceId: source, evidence: source ? "chosen" : "unknown" } : plan)); },
  }), [accounts, allocation, guard, planned]);
  const query = (change: { state?: Scenario; mode?: "light" | "dark" }) => `?variant=a&state=${change.state ?? scenario}&mode=${change.mode ?? mode}`;
  return <><div inert={flowView !== null} aria-hidden={flowView ? true : undefined} className="min-h-dvh bg-[#f0f2f7] text-slate-950 dark:bg-slate-950 dark:text-slate-50"><a href="#account-preview" className="sr-only fixed left-4 top-3 z-[90] rounded-xl bg-slate-950 px-4 py-3 text-sm text-white focus:not-sr-only">Skip to preview</a><header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"><div className="mx-auto max-w-5xl px-4 py-3 sm:px-6"><div className="flex items-center justify-between gap-4"><Link href="/design" className={`flex min-h-11 items-center gap-2 rounded-lg text-sm ${muted} ${focus}`}><ArrowLeft size={16} aria-hidden="true" />Design rounds</Link><Link href={query({ mode: mode === "dark" ? "light" : "dark" })} aria-label={`Use ${mode === "dark" ? "light" : "dark"} theme`} className={`flex size-11 items-center justify-center rounded-xl ${focus}`}>{mode === "dark" ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}</Link></div><p className="mt-3 rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold dark:bg-slate-800">A approved · Balance first</p><details className="group mt-1"><summary className={`flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg text-xs [&::-webkit-details-marker]:hidden ${focus}`}><span>Example: <span className="font-semibold">{SCENARIOS.find((item) => item.id === scenario)?.label}</span></span><ChevronDown size={16} className="group-open:rotate-180" aria-hidden="true" /></summary><nav aria-label="Example scenarios" className="grid grid-cols-2 gap-2 pb-3 sm:grid-cols-3">{SCENARIOS.map((item) => <Link key={item.id} href={query({ state: item.id })} aria-current={scenario === item.id ? "page" : undefined} className={`flex min-h-11 items-center justify-center rounded-lg border px-2 py-2 text-center text-xs ${focus} ${scenario === item.id ? "border-indigo-500 text-indigo-700 dark:text-indigo-300" : "border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300"}`}>{item.label}</Link>)}</nav></details></div></header><main id="account-preview" className="mx-auto max-w-5xl px-4 py-7 pb-28 sm:px-6"><div className="mb-7 max-w-2xl"><p className={`text-xs font-semibold ${muted}`}>G176 · Approved production flow</p><h1 className="mt-2 text-2xl font-bold tracking-tight">The whole plan, in the account.</h1><p className={`mt-3 text-sm leading-6 ${muted}`}>This preview mounts the same production detail flow and editors as Upcoming, with invented data only.</p></div><div className="grid items-start gap-7 lg:grid-cols-2"><section aria-label="Upcoming page context" className="space-y-5">{hero ? <UpcomingHeroCard isCalendarMonth={false} daysToPayday={30} paydayLabel="Fri 30 Oct" spendableNow={hero.cash / 100} runwayIncomeTotal={0} runwayBillsTotal={hero.bills / 100} allocationsRemainingTotal={hero.allocations / 100} savingsNow={1250} runway={hero.runway / 100} runwayStatus={hero.runway < 0 ? "short" : hero.runway === 0 ? "even" : "left"} /> : <p className="rounded-2xl bg-white p-5 text-sm dark:bg-slate-800">Balance unavailable in this example. No overall figure is invented.</p>}<UpcomingAccountsCard plansStatus={plansStatus} plans={previewPlans} onPlan={(id) => setFlowView({ kind: "plan", id })} accounts={walk.accounts} periodLabel={`Payments ${PERIOD.toLowerCase()}`} onOpen={(account) => setFlowView({ kind: "account", id: account.id })} /></section><section aria-labelledby="try-flow-heading" className="space-y-5"><div><h2 id="try-flow-heading" className="text-base font-semibold">Try the production details</h2><p className={`mt-1 text-sm leading-6 ${muted}`}>Open Monzo, then a plan. Open the card charge to try its real editor.</p></div><button type="button" onClick={() => setFlowView({ kind: "account", id: "monzo" })} className={`flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white ${focus}`}>Open Monzo’s account plan<ChevronRight size={16} aria-hidden="true" /></button><button type="button" onClick={() => setFlowView({ kind: "payment", id: payment.id })} className={`grid min-h-20 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left dark:border-slate-700 dark:bg-slate-800 ${focus}`}><span className="min-w-0"><span className="block break-words text-sm font-semibold">{payment.model.name}</span><span className={`mt-1 block text-xs ${muted}`}>Amex · {payment.model.expectedDate}</span></span><span className="font-mono text-sm font-semibold tabular-nums">−£{payment.model.amount.toFixed(2)}</span></button><button type="button" onClick={() => setFlowView({ kind: "payment", id: planned.id })} className={"min-h-11 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm dark:border-slate-600 " + focus}>Try a planned payment</button><label className={`flex min-h-11 cursor-pointer items-center gap-3 text-xs ${muted}`}><input type="checkbox" checked={failNextSave} onChange={(event) => { failures.current.save = event.target.checked; setFailNextSave(event.target.checked); }} className={`size-4 accent-indigo-600 ${focus}`} />Simulate one failed save</label>
<label className={"flex min-h-11 cursor-pointer items-center gap-3 text-xs " + muted}><input type="checkbox" checked={failNextRefresh} onChange={(event) => { failures.current.refresh = event.target.checked; setFailNextRefresh(event.target.checked); }} className={"size-4 accent-indigo-600 " + focus} />Simulate one failed refresh</label>
<label className={"flex min-h-11 cursor-pointer items-center gap-3 text-xs " + muted}><input type="checkbox" checked={slowSave} onChange={(event) => { failures.current.slow = event.target.checked; setSlowSave(event.target.checked); }} className={"size-4 accent-indigo-600 " + focus} />Simulate a slow save</label>
<p className={"text-xs " + muted} data-preview-write-count={writeCount}>{writeCount} example changes saved</p></section></div></main></div>{flowView && <UpcomingDetailFlow initialView={flowView} onClose={() => setFlowView(null)} accounts={accounts} summaries={walk.accounts} periodLabel={PERIOD} periodStart={new Date("2026-10-01T12:00:00Z")} plans={previewPlans} plansStatus={plansStatus} allocations={[allocation]} payments={[...(paymentPresent ? [payment] : []), ...(plannedPresent ? [plannedPayment] : [])]} onRefresh={refresh} onDismiss={() => setPaymentPresent(false)} onDeletePlanned={() => setPlannedPresent(false)} services={services} />}</>;
}

export default function PreviewClient() { const params = useSearchParams(); const scenario = SCENARIOS.find((item) => item.id === params.get("state"))?.id ?? "gap"; const mode = params.get("mode") === "dark" ? "dark" : "light"; const initial = params.get("view") === "account" ? { kind: "account", id: "monzo" } as const : params.get("view") === "payment" ? { kind: "payment", id: "orchard" } as const : null; return <Preview key={`${scenario}-${mode}-${params.get("view")}`} scenario={scenario} mode={mode} initial={initial} plansStatus={params.get("plans-status") === "error" ? "error" : params.get("plans-status") === "loading" ? "loading" : "ready"} />; }
