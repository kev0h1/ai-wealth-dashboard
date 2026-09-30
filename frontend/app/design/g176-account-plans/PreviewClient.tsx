"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, Check, ChevronDown, ChevronRight, Moon, Pencil, Sun } from "lucide-react";
import { BANK_META, BankBadge, bankLogoSrc } from "@/components/AccountMiniCard";
import UpcomingAccountsCard from "@/components/upcoming/UpcomingAccountsCard";
import UpcomingHeroCard from "@/components/upcoming/UpcomingHeroCard";
import AccountContent, { CardPaymentIcon, focus, PlanContent, PlanIcon, primaryButton, secondaryButton } from "./AccountContent";
import PreviewFlowSheet, { type PreviewFlowNavigation, type PreviewFlowView } from "./PreviewFlowSheet";
import { ACCOUNTS, dateLabel, forecastFor, heroFor, money, PAYMENT, PERIOD, plansFor, SCENARIOS, type Payment, type Plan, type Scenario, type Variant } from "./fixtures";

const muted = "text-slate-600 dark:text-slate-400";
const field = `mt-2 min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-50 ${focus}`;

function PaymentContent({ payment, saved }: { payment: Payment; saved: boolean }) {
  return <div className="space-y-6 text-slate-950 dark:text-slate-50">
    {saved && <p role="status" className={`flex items-center gap-2 text-xs ${muted}`}><Check size={14} aria-hidden="true" />Example updated</p>}
    <div><p className={`text-xs ${muted}`}>Expected card charge</p><p className="mt-1 font-mono text-4xl font-bold tracking-tight tabular-nums">{money(-payment.pence)}</p></div>
    <section className="space-y-2" aria-labelledby="payment-state"><h3 id="payment-state" className="flex items-center gap-2 text-sm font-semibold"><span className="size-1.5 rounded-full bg-amber-500" aria-hidden="true" />Not seen yet</h3><p className={`text-sm leading-6 ${muted}`}>This is a charge on your card. Your bank account only pays when the card repayment leaves.</p></section>
    <dl className="grid grid-cols-2 gap-x-5 gap-y-5 border-t border-slate-200 pt-5 text-sm dark:border-slate-700">
      <div><dt className={`text-xs ${muted}`}>Charged to</dt><dd className="mt-1 font-semibold">Amex</dd></div>
      <div><dt className={`text-xs ${muted}`}>Expected</dt><dd className="mt-1 font-semibold">{dateLabel(payment.date)}</dd></div>
      <div><dt className={`text-xs ${muted}`}>Repeats</dt><dd className="mt-1 font-semibold">Monthly</dd></div>
      <div><dt className={`text-xs ${muted}`}>Account calculation</dt><dd className="mt-1">Repayment counted separately</dd></div>
    </dl>
    <details className="group border-t border-slate-200 dark:border-slate-700"><summary className={`flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg text-sm font-medium [&::-webkit-details-marker]:hidden ${focus}`}>Why is this still here?<ChevronDown size={16} className="group-open:rotate-180" aria-hidden="true" /></summary><p className={`pb-3 text-sm leading-6 ${muted}`}>We have not matched this prediction to a transaction yet. Payments can take a day or two to appear. Check with the provider if it is overdue.</p></details>
  </div>;
}

function PaymentEditor({ payment, onSave }: { payment: Payment; onSave: (next: Payment) => void }) {
  const [amount, setAmount] = useState((payment.pence / 100).toFixed(2));
  const [date, setDate] = useState(payment.date);
  const [scope, setScope] = useState(payment.scope);
  const [error, setError] = useState("");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const pence = Math.round(Number(amount) * 100);
    if (!Number.isFinite(pence) || pence < 1 || pence > 100000000 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { setError("Enter a date and an amount between £0.01 and £1,000,000."); return; }
    try { onSave({ ...payment, pence, date, scope }); } catch { setError("The example could not be saved. Your changes are still here. Try again."); }
  }
  return <form id="preview-payment-form" onSubmit={submit} className="space-y-6">
    <div><h3 className="text-sm font-semibold">Payment details</h3><p className={`mt-1 text-xs leading-5 ${muted}`}>Adjust the prediction. This does not change a bank payment.</p></div>
    <div className="grid gap-4 min-[380px]:grid-cols-2">
      <label className="min-w-0 text-sm font-medium" htmlFor="payment-date">Expected date<input id="payment-date" type="date" name="payment-date" value={date} min="2026-01-01" max="2030-12-31" onChange={(event) => setDate(event.target.value)} required className={field} /></label>
      <label className="min-w-0 text-sm font-medium" htmlFor="payment-amount">Amount (£)<input id="payment-amount" name="payment-amount" type="number" min="0.01" max="1000000" step="0.01" inputMode="decimal" autoComplete="off" value={amount} onChange={(event) => setAmount(event.target.value)} required className={field} /></label>
    </div>
    <fieldset className="border-t border-slate-200 pt-4 dark:border-slate-700"><legend className="pr-3 text-sm font-semibold">Apply changes to</legend><div className="mt-1 space-y-1">
      {([['once', 'Just this payment', 'Keep the usual monthly prediction.'], ['future', 'This and future payments', 'Use the new date and amount going forward.']] as const).map(([value, label, hint]) => <label key={value} className="flex min-h-14 cursor-pointer items-center gap-3 rounded-lg py-2"><input type="radio" name="payment-scope" value={value} checked={scope === value} onChange={() => setScope(value)} className={`size-4 shrink-0 accent-indigo-600 ${focus}`} /><span><span className="block text-sm font-medium">{label}</span><span className={`block text-xs leading-5 ${muted}`}>{hint}</span></span></label>)}
    </div></fieldset>
    {error && <p role="alert" className="rounded-xl border border-slate-300 p-3 text-sm leading-6 dark:border-slate-600">{error}</p>}
    <p className={`text-xs leading-5 ${muted}`}>Preview only. Save returns to these details in the same sheet. Your real predictions are untouched.</p>
  </form>;
}

function PlanEditor({ plan, onSave }: { plan: Plan; onSave: (next: Plan) => void }) {
  const [name, setName] = useState(plan.name);
  const [amount, setAmount] = useState((plan.periodPence / 100).toFixed(2));
  const [source, setSource] = useState(plan.sourceId ?? "");
  const [error, setError] = useState("");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const pence = Math.round(Number(amount) * 100);
    if (!name.trim() || !Number.isFinite(pence) || pence < 1 || pence > 100000000) { setError("Enter a name and an amount between £0.01 and £1,000,000."); return; }
    try { onSave({ ...plan, name: name.trim(), periodPence: pence, sourceId: source || null, evidence: source ? "chosen" : "unknown" }); } catch { setError("The example could not be saved. Your changes are still here. Try again."); }
  }
  return <form id="preview-plan-form" onSubmit={submit} className="space-y-5">
    {plan.kind === "allocation" ? <>
      <label className="block text-sm font-medium" htmlFor="plan-name">Name<input id="plan-name" name="plan-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required autoComplete="off" className={field} /></label>
      <label className="block text-sm font-medium" htmlFor="plan-amount">Amount each pay period (£)<input id="plan-amount" name="plan-amount" type="number" min="0.01" max="1000000" step="0.01" inputMode="decimal" autoComplete="off" value={amount} onChange={(event) => setAmount(event.target.value)} required className={field} /></label>
    </> : <div><p className={`text-xs ${muted}`}>This period’s goal contribution</p><p className="mt-1 font-mono text-2xl font-semibold tabular-nums">{money(plan.periodPence)}</p><p className={`mt-2 text-xs leading-5 ${muted}`}>Set by your goal plan. Here you are only changing which account will fund it.</p></div>}
    <div className="border-t border-slate-200 pt-5 dark:border-slate-700"><label className="block text-sm font-medium" htmlFor="plan-source">Pay from<select id="plan-source" name="plan-source" value={source} onChange={(event) => setSource(event.target.value)} className={field} aria-describedby="source-help"><option value="">Not linked yet</option>{ACCOUNTS.map((account) => <option key={account.id} value={account.id}>{account.bank} · {account.name}</option>)}</select></label><p id="source-help" className={`mt-2 text-xs leading-5 ${muted}`}>The remaining amount is included in this account’s working. Choosing an account does not move money.</p></div>
    <div><p className={`text-xs ${muted}`}>Receiving pot</p><p className="mt-1 text-sm font-semibold">{plan.destination}</p><p className={`mt-1 text-xs leading-5 ${muted}`}>Unchanged in this example.</p></div>
    {error && <p role="alert" className="rounded-xl border border-slate-300 p-3 text-sm leading-6 dark:border-slate-600">{error}</p>}
    <p className={`text-xs leading-5 ${muted}`}>Pay from is a proposed account link. Saves only update these invented examples.</p>
  </form>;
}

function Preview({ variant, scenario, mode, initial }: { variant: Variant; scenario: Scenario; mode: "light" | "dark"; initial: "account" | "payment" | null }) {
  const [plans, setPlans] = useState(() => plansFor(scenario));
  const [payment, setPayment] = useState(PAYMENT);
  const [rootView, setRootView] = useState<PreviewFlowView | null>(() => initial === "account" ? { kind: "account", id: "monzo" } : initial === "payment" ? { kind: "payment" } : null);
  const [saved, setSaved] = useState(false);
  const [failNextSave, setFailNextSave] = useState(false);
  const close = useCallback(() => setRootView(null), []);
  const walk = forecastFor(scenario);
  const hero = heroFor(scenario, plans);
  const query = (change: { variant?: Variant; state?: Scenario; mode?: "light" | "dark" }) => `?variant=${change.variant ?? variant}&state=${change.state ?? scenario}&mode=${change.mode ?? mode}`;

  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    const previousScheme = root.style.colorScheme;
    root.classList.toggle("dark", mode === "dark");
    root.style.colorScheme = mode;
    return () => { root.classList.toggle("dark", wasDark); root.style.colorScheme = previousScheme; };
  }, [mode]);

  function guardSave() {
    if (failNextSave) { setFailNextSave(false); throw new Error("Preview save failure"); }
    setSaved(true);
  }
  function renderView(view: PreviewFlowView, navigation: PreviewFlowNavigation) {
    if (view.kind === "account") {
      const account = walk.accounts.find((item) => item.id === view.id)!;
      const meta = BANK_META[account.bank.toUpperCase()];
      return {
        title: account.bank, subtitle: `${account.name} · ${PERIOD}`,
        leading: <BankBadge logoSrc={bankLogoSrc(meta)} initials={meta.initials} altText="" size={36} />,
        body: <AccountContent account={account} plans={plans} variant={variant} onPlan={(id) => navigation.goTo({ kind: "plan", id })} />,
        footer: <button type="button" className={primaryButton} onClick={navigation.close}>Done</button>,
      };
    }
    if (view.kind === "payment") return {
      title: payment.name, subtitle: "Amex · Card charge", leading: <CardPaymentIcon />,
      body: <PaymentContent payment={payment} saved={saved} />,
      footer: <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-3"><button type="button" data-flow-focus="edit-payment" className={secondaryButton} onClick={() => navigation.goTo({ kind: "edit-payment" })}><Pencil size={16} aria-hidden="true" />Edit prediction</button><button type="button" className={primaryButton} onClick={navigation.close}>Done</button></div>,
    };
    if (view.kind === "edit-payment") return {
      title: "Edit prediction", subtitle: payment.name,
      body: <PaymentEditor payment={payment} onSave={(next) => { guardSave(); setPayment(next); navigation.back(); }} />,
      footer: <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3"><button type="button" className={secondaryButton} onClick={navigation.back}>Cancel</button><button type="submit" form="preview-payment-form" className={primaryButton}>Save changes</button></div>,
    };
    const plan = plans.find((item) => item.id === view.id)!;
    if (view.kind === "plan") {
      const source = ACCOUNTS.find((account) => account.id === plan.sourceId);
      return {
        title: plan.name, subtitle: plan.kind === "allocation" ? "Allocation · This pay period" : "Goal · This pay period", leading: <PlanIcon kind={plan.kind} />,
        body: <PlanContent plan={plan} accountName={source && plan.evidence !== "unknown" ? `${source.bank} · ${source.name}` : null} />,
        footer: <button type="button" data-flow-focus={`edit-${plan.id}`} className={secondaryButton} onClick={() => navigation.goTo({ kind: "edit-plan", id: plan.id })}><Pencil size={16} aria-hidden="true" />{plan.kind === "allocation" ? "Edit allocation" : "Change paying account"}</button>,
      };
    }
    return {
      title: plan.kind === "allocation" ? "Edit allocation" : "Link goal to an account", subtitle: plan.name,
      body: <PlanEditor plan={plan} onSave={(next) => { guardSave(); setPlans((current) => current.map((item) => item.id === next.id ? next : item)); navigation.back(); }} />,
      footer: <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3"><button type="button" className={secondaryButton} onClick={navigation.back}>Cancel</button><button type="submit" form="preview-plan-form" className={primaryButton}>Save changes</button></div>,
    };
  }

  return <>
    <div inert={rootView !== null} aria-hidden={rootView ? true : undefined} className="min-h-dvh bg-[#f0f2f7] text-slate-950 dark:bg-slate-950 dark:text-slate-50">
      <a href="#account-preview" className="sr-only fixed left-4 top-3 z-[90] rounded-xl bg-slate-950 px-4 py-3 text-sm text-white focus:not-sr-only">Skip to preview</a>
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto max-w-5xl px-4 py-3 sm:px-6">
          <div className="flex items-center justify-between gap-4"><Link href="/design" className={`flex min-h-11 items-center gap-2 rounded-lg text-sm ${muted} ${focus}`}><ArrowLeft size={16} aria-hidden="true" />Design rounds</Link><Link href={query({ mode: mode === "dark" ? "light" : "dark" })} aria-label={`Use ${mode === "dark" ? "light" : "dark"} theme`} className={`flex size-11 items-center justify-center rounded-xl ${focus}`}>{mode === "dark" ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}</Link></div>
          <nav aria-label="Detail variants" className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">{([['a', 'Balance first'], ['b', 'Working first']] as const).map(([value, label]) => <Link key={value} href={query({ variant: value })} aria-current={variant === value ? "page" : undefined} className={`flex min-h-11 items-center justify-center gap-2 rounded-lg px-2 text-center text-sm font-semibold ${focus} ${variant === value ? "bg-white shadow-sm dark:bg-slate-700" : muted}`}><span>{value.toUpperCase()}</span>{label}</Link>)}</nav>
          <details className="group mt-1"><summary className={`flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg text-xs [&::-webkit-details-marker]:hidden ${focus}`}><span>Example: <span className="font-semibold">{SCENARIOS.find((item) => item.id === scenario)?.label}</span></span><ChevronDown size={16} className="group-open:rotate-180" aria-hidden="true" /></summary><nav aria-label="Example scenarios" className="grid grid-cols-2 gap-2 pb-3 sm:grid-cols-3">{SCENARIOS.map((item) => <Link key={item.id} href={query({ state: item.id })} aria-current={scenario === item.id ? "page" : undefined} className={`flex min-h-11 items-center justify-center rounded-lg border px-2 py-2 text-center text-xs ${focus} ${scenario === item.id ? "border-indigo-500 text-indigo-700 dark:text-indigo-300" : "border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300"}`}>{item.label}</Link>)}</nav></details>
        </div>
      </header>
      <main id="account-preview" className="mx-auto max-w-5xl px-4 py-7 pb-28 sm:px-6">
        <div className="mb-7 max-w-2xl"><p className={`text-xs font-semibold ${muted}`}>G176 · Account working &amp; a continuous edit flow</p><h1 className="mt-2 text-2xl font-bold tracking-tight">The whole plan, in the account.</h1><p className={`mt-3 text-sm leading-6 ${muted}`}>{variant === "a" ? "A leads with what remains, keeps the calculation one tap away and gives the plans their own clear rows." : "B puts the payment balance and plan balance side by side, with the full calculation always visible."} Both keep editing in the same sheet.</p><p className={`mt-2 text-xs leading-5 ${muted}`}>Invented figures. Preview only. The hero and By account card below are unchanged production components; this round changes their detail views.</p></div>
        <div className="grid items-start gap-7 lg:grid-cols-2">
          <section aria-label="Upcoming page context" className="space-y-5">
            {hero ? <UpcomingHeroCard isCalendarMonth={false} daysToPayday={30} paydayLabel="Fri 30 Oct" spendableNow={hero.cash / 100} runwayIncomeTotal={0} runwayBillsTotal={hero.bills / 100} allocationsRemainingTotal={hero.allocations / 100} savingsNow={1250} runway={hero.runway / 100} runwayStatus={hero.runway < 0 ? "short" : hero.runway === 0 ? "even" : "left"} /> : <p className="rounded-2xl bg-white p-5 text-sm dark:bg-slate-800">Balance unavailable in this example. No overall figure is invented.</p>}
            <UpcomingAccountsCard accounts={walk.accounts} periodLabel={`Payments ${PERIOD.toLowerCase()}`} onOpen={(account) => { setSaved(false); setRootView({ kind: "account", id: account.id }); }} />
          </section>
          <section aria-labelledby="try-flow-heading" className="space-y-5">
            <div><h2 id="try-flow-heading" className="text-base font-semibold">Try the details</h2><p className={`mt-1 text-sm leading-6 ${muted}`}>Open Monzo, then an allocation or goal. Open the card charge to try Details → Edit → Save.</p></div>
            <button type="button" onClick={() => { setSaved(false); setRootView({ kind: "account", id: "monzo" }); }} className={primaryButton}>Open Monzo’s account plan<ChevronRight size={16} aria-hidden="true" /></button>
            <button type="button" onClick={() => { setSaved(false); setRootView({ kind: "payment" }); }} className={`grid min-h-20 w-full grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left dark:border-slate-700 dark:bg-slate-800 ${focus}`}><CardPaymentIcon /><span className="min-w-0"><span className="block break-words text-sm font-semibold">{payment.name}</span><span className={`mt-1 block text-xs ${muted}`}>Amex · {dateLabel(payment.date)}</span></span><span className="font-mono text-sm font-semibold tabular-nums">{money(-payment.pence)}</span></button>
            <details className="group border-t border-slate-200 pt-2 dark:border-slate-700"><summary className={`flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg text-xs font-medium [&::-webkit-details-marker]:hidden ${focus}`}>What stays unchanged<ChevronDown size={16} className="group-open:rotate-180" aria-hidden="true" /></summary><p className={`py-2 text-xs leading-5 ${muted}`}>The hero still deducts remaining allocations, not new goal contributions. The new account view separately shows what would remain if its linked goals and allocations are completed. These examples have no forecast transfer already representing a set-aside; proving that overlap is a requirement before implementing the live link.</p></details>
            <label className={`flex min-h-11 cursor-pointer items-center gap-3 text-xs ${muted}`}><input type="checkbox" checked={failNextSave} onChange={(event) => setFailNextSave(event.target.checked)} className={`size-4 accent-indigo-600 ${focus}`} />Simulate one failed save</label>
          </section>
        </div>
      </main>
    </div>
    {rootView && <PreviewFlowSheet initialView={rootView} onClose={close} renderView={renderView} />}
  </>;
}

export default function PreviewClient() {
  const params = useSearchParams();
  const variant: Variant = params.get("variant") === "b" ? "b" : "a";
  const scenario = SCENARIOS.find((item) => item.id === params.get("state"))?.id ?? "gap";
  const mode = params.get("mode") === "dark" ? "dark" : "light";
  const initial = params.get("view") === "account" ? "account" : params.get("view") === "payment" ? "payment" : null;
  return <Preview key={`${variant}-${scenario}-${mode}-${initial}`} variant={variant} scenario={scenario} mode={mode} initial={initial} />;
}
