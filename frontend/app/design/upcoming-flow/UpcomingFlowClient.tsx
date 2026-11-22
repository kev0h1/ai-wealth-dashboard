"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, Check, ChevronDown, Landmark, X } from "lucide-react";
import BottomNavRail from "@/components/navigation/BottomNavRail";
import PhosphorNavIcon from "@/components/navigation/PhosphorNavIcon";
import PennyAppearanceIcon from "@/components/PennyAppearanceIcon";
import UpcomingCategoryIcon from "@/components/upcoming/UpcomingCategoryIcon";
import MoneyText from "@/components/MoneyText";
import { displayAccountName } from "@/lib/accountName";
import { BOTTOM_NAV_TABS } from "@/lib/navigation/bottomNav";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { getCategoryColour } from "@/lib/categories";

type Variant = "a" | "b";
type State = "short" | "covered";
// Fictional, preloaded snapshots. These fields represent G486 stored
// availability and the separate upcomingAccountWalk, not a new calculation.
// Short walk: 100 - 238.29 - 77.91 - 1.48 = -217.68.
// Covered walk: 330 - 238.29 - 77.91 - 1.48 = 12.32.
// Covered loads another fixture; it never records a suggested move.
const fixtures = {
  short: { availability: "−£212.68", opening: "£100", low: "−£217.68", after: ["−£138.29", "−£216.20", "−£217.68"] },
  covered: { availability: "£17.32", opening: "£330", low: "£12.32", after: ["£91.71", "£13.80", "£12.32"] },
};
const account = displayAccountName("BARCLAYS");
const source = displayAccountName("EASY ACCESS SAVER");
const payments = [
  { name: "Council Tax", category: "Bills", amount: "−£238.29", date: "22 Nov", first: true },
  { name: "Barclaycard repayment", category: "Debt", amount: "−£77.91", date: "22 Nov", first: false },
  { name: "Broadband adjustment", category: "Bills", amount: "−£1.48", date: "23 Nov", first: false },
];
const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900";
const mono = "font-mono tabular-nums";
const panel = "rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:shadow-none";
const muted = "text-slate-600 dark:text-slate-300";

function Money({ children }: { children: string }) { return <MoneyText text={children} unmasked />; }
function Category({ name }: { name: string }) {
  return <UpcomingCategoryIcon Icon={getCategoryIcon(name, {})} colour={getCategoryColour(name, {})} />;
}
function Fold({ name, children, id }: { name: ReactNode; children: ReactNode; id: string }) {
  return <details className="group">
    <summary data-balanced-row={id} className={`flex min-h-12 cursor-pointer list-none items-center border-t border-slate-200 px-4 py-3 text-sm font-semibold hover:bg-slate-50 active:opacity-70 dark:border-slate-700 dark:hover:bg-slate-700 ${focus} [&::-webkit-details-marker]:hidden`}>
      <span data-row-content className="flex w-full items-center justify-between gap-3"><span>{name}</span><ChevronDown aria-hidden="true" size={16} className="shrink-0 group-open:rotate-180" /></span>
    </summary>
    <div className={`border-t border-slate-100 p-4 text-sm leading-6 dark:border-slate-700 ${muted}`}>{children}</div>
  </details>;
}
function Controls({ variant, state, dark }: { variant: Variant; state: State; dark: boolean }) {
  const href = (v = variant, s = state, d = dark) => `?variant=${v}&state=${s}&mode=${d ? "dark" : "light"}`;
  const control = "inline-flex min-h-11 items-center rounded-xl px-3 text-xs font-semibold hover:bg-white/10 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white";
  return <nav aria-label="Design preview" className="border-b border-slate-700 bg-slate-950 px-4 py-2 text-white">
    <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-1 lg:justify-start">
      <span className="w-full text-center text-[11px] text-slate-300 lg:mr-3 lg:w-auto">G489 · Fictional data</span>
      {(["a", "b"] as const).map(v => <Link key={v} href={href(v)} aria-current={v === variant ? "page" : undefined} className={`${control} ${v === variant ? "bg-slate-700" : ""}`}>{v === "a" ? "A · Account first" : "B · Dated flow"}</Link>)}
      <Link className={control} href={href(variant, state === "short" ? "covered" : "short")}>{state === "short" ? "Covered example" : "Short example"}</Link>
      <Link className={control} href={href(variant, state, !dark)}>{dark ? "Light" : "Dark"}</Link>
    </div>
  </nav>;
}
function DesktopNav() {
  return <aside className="sticky top-5 hidden h-[calc(100dvh-40px)] w-60 shrink-0 flex-col lg:flex">
    <p className="px-3 py-3 text-xl font-bold tracking-tight">Sorted</p>
    <nav aria-label="Primary" className="mt-5 space-y-1">
      {BOTTOM_NAV_TABS.map(tab => <Link key={tab.id} href={tab.href} aria-current={tab.id === "upcoming" ? "page" : undefined} className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold hover:bg-slate-200/60 active:opacity-70 dark:hover:bg-slate-800 ${focus} ${tab.id === "upcoming" ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-400/10 dark:text-indigo-300" : muted}`}><PhosphorNavIcon tab={tab.id} selected={tab.id === "upcoming"} appearance="ink" />{tab.label}</Link>)}
      <Link href="/settings" className={`flex min-h-11 items-center rounded-xl px-3 text-sm hover:bg-slate-200/60 dark:hover:bg-slate-800 ${focus}`}>Settings</Link>
    </nav>
    <Link href="/penny" className={`mt-auto flex min-h-12 items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 dark:border-slate-700 dark:bg-slate-800 ${focus}`}><PennyAppearanceIcon appearance="ink" size={24} />Ask Penny</Link>
  </aside>;
}
function Status({ state }: { state: State }) {
  const short = state === "short";
  return <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold dark:bg-slate-700 ${short ? "text-rose-700 dark:text-rose-300" : "text-emerald-800 dark:text-emerald-300"}`}>
    {short ? <AlertTriangle size={13} aria-hidden="true" /> : <Check size={13} aria-hidden="true" />}{short ? "Short" : "Covered"}
  </span>;
}
function Cover({ state, compact = false }: { state: State; compact?: boolean }) {
  if (state === "covered") return <p className={`text-sm leading-6 ${muted}`}>Every payment shown is covered by this account.</p>;
  return <div>
    <p className="text-sm font-semibold"><Money>£230</Money> suggested from {source}</p>
    <p className={`mt-1 text-sm leading-6 ${muted}`}>Move it to {account} by 22 Nov to cover the payments shown.</p>
    <details className={`group ${compact ? "mt-2" : "mt-3"}`}>
      <summary data-balanced-row="cover-review" className={`inline-flex min-h-11 cursor-pointer list-none items-center rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700 active:opacity-70 ${focus} [&::-webkit-details-marker]:hidden`}><span data-row-content className="flex items-center gap-2">Review cover plan<ChevronDown size={16} aria-hidden="true" className="group-open:rotate-180" /></span></summary>
      <div className="mt-3 border-t border-slate-200 pt-3 text-sm leading-6 dark:border-slate-700">
        <p><Money>£230</Money> from {source} to {account}, by 22 Nov.</p>
        <p className={`mt-2 ${muted}`}>This account looks able to spare it. Suggested moves are for you to make. Nothing has been moved.</p>
      </div>
    </details>
  </div>;
}
function AccountEvidence({ state }: { state: State }) {
  const data = fixtures[state];
  return <Fold id="account-working" name="Account working">
    <dl className="space-y-3">
      <div className="flex justify-between gap-4"><dt>Available to spend</dt><dd className={mono}>{data.availability}</dd></div>
      <div className="flex justify-between gap-4"><dt>Lowest payment balance</dt><dd className={mono}>{data.low}</dd></div>
    </dl>
    <p className="mt-3 text-xs leading-5">Available to spend is the stored account reading. The payment forecast is a separate dated balance. Neither includes a suggested move as money already received.</p>
  </Fold>;
}
function AccountCard({ state, variant }: { state: State; variant: Variant }) {
  const short = state === "short";
  return <section className={panel} aria-labelledby="account-heading">
    <div className="p-4" data-balanced-row="account-identity"><div data-row-content className="flex items-center gap-3">
      <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300"><Landmark size={17} /></span>
      <div className="min-w-0 flex-1"><h2 id="account-heading" className="text-base font-bold">{account}</h2><p className={`mt-0.5 text-xs ${muted}`}>Current account</p></div><Status state={state} />
    </div></div>
    {variant === "a" ? <>
      <div className="border-t border-slate-200 p-4 dark:border-slate-700">
        <p className={`text-[11px] font-semibold uppercase tracking-[.05em] ${muted}`}>{short ? "Account shortfall" : "Available to spend"}</p>
        <p className={`${mono} mt-2 text-[30px] font-bold leading-tight`}>{fixtures[state].availability}</p>
        <p className={`mt-2 text-sm leading-6 ${muted}`}>{short ? "Needs money before the Council Tax payment on 22 Nov." : "Payments and linked plans are covered."}</p>
      </div>
      <div className="border-t border-slate-200 p-4 dark:border-slate-700"><Cover state={state} /></div>
    </> : <div className="border-t border-slate-200 p-4 dark:border-slate-700">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"><p className="text-sm font-semibold">{short ? "Account shortfall" : "Available to spend"}</p><p className={`${mono} text-[24px] font-bold`}>{fixtures[state].availability}</p></div>
      <p className={`mt-1 text-xs leading-5 ${muted}`}>{short ? "From 22 Nov, when Council Tax leaves." : "Payments and linked plans are covered."}</p>
      <div className="mt-4"><Cover state={state} compact /></div>
    </div>}
    <AccountEvidence state={state} />
  </section>;
}
function PaymentRow({ payment, state, timeline }: { payment: typeof payments[number]; state: State; timeline: boolean }) {
  return <div className={`${timeline ? "border-t border-slate-200 dark:border-slate-700" : "border-t border-slate-100 first:border-t-0 dark:border-slate-700"} px-4 py-4`} data-balanced-row="payment">
    <div data-row-content><div className="flex items-center gap-3"><Category name={payment.category} /><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-pretty">{payment.name}</p><p className={`mt-0.5 text-xs ${muted}`}>{account}{timeline ? ` · ${payment.date}` : ""}</p></div><p className={`${mono} shrink-0 text-sm font-semibold`}>{payment.amount}</p></div>
    {payment.first && state === "short" && <div className="mt-3 flex items-start gap-2 text-xs leading-5"><AlertTriangle size={14} className="mt-0.5 shrink-0 text-rose-700 dark:text-rose-300" aria-hidden="true" /><p><strong>Shortfall starts here.</strong> <Money>£138.29</Money> short after this payment.</p></div>}</div>
  </div>;
}
function Payments({ state, variant }: { state: State; variant: Variant }) {
  return <section aria-labelledby="payments-heading">
    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2"><h2 id="payments-heading" className="text-base font-bold">Payments before payday</h2><p className={`text-xs ${muted}`}>22 to 27 Nov</p></div>
    {variant === "a" ? <div className="space-y-3">
      {["22 Nov", "23 Nov"].map(date => <div key={date} className={panel}><h3 className="px-4 py-3 text-sm font-semibold">{date}</h3><div className="border-t border-slate-200 dark:border-slate-700">{payments.filter(p => p.date === date).map(p => <PaymentRow key={p.name} payment={p} state={state} timeline={false} />)}</div></div>)}
    </div> : <div className={panel}><div className={`px-4 py-3 text-xs ${muted}`}>In the order payments are expected to leave</div>{payments.map(p => <PaymentRow key={p.name} payment={p} state={state} timeline />)}</div>}
    <div className={`${panel} mt-3 overflow-hidden`}>
      <Fold id="payment-balances" name="Payment balances"><p className="mb-3">Opening balance <Money>{fixtures[state].opening}</Money></p><dl className="space-y-3">{payments.map((p, i) => <div key={p.name} className="flex justify-between gap-4"><dt className="min-w-0">After {p.name}</dt><dd className={`${mono} shrink-0`}>{fixtures[state].after[i]}</dd></div>)}</dl></Fold>
      <Fold id="covered-payments" name="Other accounts · 2 covered payments"><div className="space-y-3"><p className="flex justify-between gap-3"><span>Phone contract · 24 Nov<br /><span className="text-xs">Monzo</span></span><span className={`${mono} shrink-0`}>−£18</span></p><p className="flex justify-between gap-3"><span>Spotify · 25 Nov<br /><span className="text-xs">Monzo</span></span><span className={`${mono} shrink-0`}>−£11.99</span></p></div></Fold>
    </div>
  </section>;
}
function LaterInputs() {
  const [payer, setPayer] = useState("");
  return <div className="space-y-5">
    <section aria-labelledby="set-aside-heading"><h2 id="set-aside-heading" className="mb-2 text-base font-bold">Set aside this period</h2><div className={panel}><div data-balanced-row="set-aside" className="p-4"><div data-row-content className="flex items-center gap-3"><Category name="Savings" /><div className="min-w-0 flex-1"><p className="text-sm font-semibold">Annual insurance</p><p className={`mt-0.5 text-xs ${muted}`}>Paid from Monzo</p></div><p className={`${mono} shrink-0 text-[19px] font-bold`}>£50</p></div></div></div></section>
    <section aria-labelledby="needs-input-heading"><h2 id="needs-input-heading" className="mb-2 text-base font-bold">Needs your input</h2><div className={`${panel} overflow-hidden`}>
      <div className="p-4"><p className="text-sm font-semibold">Holiday fund</p><p className={`mt-1 text-sm leading-6 ${muted}`}>{payer ? `Paid from ${payer} in this example.` : "Choose which account this goal is paid from."}</p></div>
      <Fold id="payer-picker" name={payer ? "Change paying account" : "Choose paying account"}><fieldset><legend className="mb-2 text-sm font-semibold">Paying account</legend><div className="space-y-2">{[account, "Monzo"].map(name => <label key={name} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-slate-200 px-3 py-3 hover:bg-slate-50 focus-within:ring-2 focus-within:ring-indigo-500 dark:border-slate-600 dark:hover:bg-slate-700"><input type="radio" name="fictional-payer" value={name} checked={payer === name} onChange={() => setPayer(name)} className="size-4 accent-indigo-600" />{name}</label>)}</div></fieldset><p role="status" className="mt-3 text-xs">{payer ? `${payer} selected for this preview only.` : "Your choice stays in this preview."}</p></Fold>
    </div></section>
  </div>;
}
export default function UpcomingFlowClient() {
  const params = useSearchParams();
  const variant: Variant = params.get("variant") === "b" ? "b" : "a";
  const state: State = params.get("state") === "covered" ? "covered" : "short";
  const dark = params.get("mode") === "dark";
  const penny = useRef<HTMLDialogElement>(null);
  const bodyOverflow = useRef("");
  useEffect(() => {
    const wasDark = document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", dark);
    return () => { document.documentElement.classList.toggle("dark", wasDark); };
  }, [dark]);
  return <div className={dark ? "dark" : ""} style={{ colorScheme: dark ? "dark" : "light" }}>
    <div className="min-h-dvh bg-[#f0f2f7] text-slate-950 dark:bg-slate-900 dark:text-slate-100">
      <a href="#upcoming-preview" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-xl focus:bg-white focus:p-4 focus:text-slate-950">Skip to Upcoming preview</a>
      <Controls variant={variant} state={state} dark={dark} />
      <div className="mx-auto flex max-w-6xl gap-8 px-4 py-5 lg:px-6"><DesktopNav />
        <main id="upcoming-preview" className="min-w-0 flex-1 pb-28 lg:pb-5">
          <header><h1 className="text-[28px] font-bold leading-tight tracking-[-.025em]">Before payday</h1><p className={`mt-1 text-sm leading-6 ${muted}`}>What will enter or leave, and whether every payment is covered.</p><p className={`mt-1 text-xs ${muted}`}>22 to 27 November</p></header>
          <div className={`mt-5 grid gap-5 ${variant === "a" ? "xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" : "xl:grid-cols-[minmax(0,1fr)_280px]"}`}>
            <div className="min-w-0 space-y-5"><div><h2 className="mb-2 text-base font-bold">By account</h2><AccountCard state={state} variant={variant} /><p className={`mt-3 text-xs leading-5 ${muted}`}>Payments can take a day or two to appear, so a very recent one may not be counted yet.</p></div><Payments state={state} variant={variant} /></div>
            <LaterInputs />
          </div>
        </main>
      </div>
      <div className="lg:hidden"><BottomNavRail appearance="ink" resolved activeTab="upcoming" pennyActive={false} pennyOpen={false} pennyCurrent={false} paydayActive={false} atRiskCount={state === "short" ? 1 : 0} onPennyClick={() => { bodyOverflow.current = document.body.style.overflow; document.body.style.overflow = "hidden"; penny.current?.showModal(); }} /></div>
      <dialog ref={penny} onKeyDown={event => { if (event.key === "Tab") { event.preventDefault(); penny.current?.querySelector<HTMLButtonElement>("button")?.focus(); } }} onClose={() => { document.body.style.overflow = bodyOverflow.current; }} aria-labelledby="fixture-penny-title" onClick={e => { if(e.target === e.currentTarget) penny.current?.close(); }} className="fixed inset-0 m-auto max-h-[80dvh] w-[calc(100%-32px)] max-w-md overscroll-contain rounded-3xl border border-slate-200 bg-white p-5 text-slate-950 backdrop:bg-slate-950/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
        <div className="flex items-center justify-between gap-3"><h2 id="fixture-penny-title" className="text-lg font-bold">Ask Penny</h2><button type="button" aria-label="Close Penny preview" onClick={() => penny.current?.close()} className={`grid size-11 place-items-center rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 ${focus}`}><X aria-hidden="true" size={18} /></button></div><p className={`mt-3 text-sm leading-6 ${muted}`}>{state === "short" ? <>{account} needs money before Council Tax leaves. The cover plan suggests <Money>£230</Money> from {source}.</> : "Every payment shown is covered in this example."}</p><p className={`mt-3 text-xs leading-5 ${muted}`}>Fictional preview. No messages are sent.</p>
      </dialog>
    </div>
  </div>;
}
