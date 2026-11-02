"use client";

// G407: temporary account-detail alternatives with invented, local-only data.
import { useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronDown, ChevronLeft, CircleAlert, Pin, Trash2 } from "lucide-react";
import { BankIcon } from "@/components/AccountMiniCard";
import AccountRefreshRow from "@/components/AccountRefreshRow";
import { AccountTransactionsToolbar } from "@/components/AccountDetailParts";
import { SheetFrame } from "@/components/SheetFrame";
import SegmentedControl from "@/components/SegmentedControl";
import { TransactionRowContent } from "@/components/TransactionRow";
import MoneyText from "@/components/MoneyText";
import { BalancesHiddenContext } from "@/lib/balancesHidden";
import { getCategoryColour } from "@/lib/categories";
import { getCategoryIcon } from "@/lib/categoryIcons";
import type { Transaction } from "@/lib/api";
import { SCENARIOS, SCENARIO_IDS, type Scenario, type ScenarioId, type Variant, formatMoney } from "./fixtures";

type Tab = "Transactions" | "Categories";
const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";
const quiet = `inline-flex min-h-11 touch-manipulation items-center justify-center gap-1 rounded-lg px-2 text-[13px] font-semibold text-slate-700 hover:text-slate-950 dark:text-slate-200 dark:hover:text-white ${focus}`;
const fixtureNow = Date.parse("2026-11-02T20:00:00Z");

function IncludeInEstimate({ scenario, included, onChange }: { scenario: Scenario; included: boolean; onChange: (next: boolean) => void }) {
  const helperId = useId();
  const locked = included && !!scenario.shortfall;
  const helper = locked
    ? `Included while this account is short ${scenario.shortfall?.kind === "payments" ? "for payments" : "after plans"}.`
    : included ? "Turn off for an account you do not spend from." : "Excluded from this estimate.";
  return <div data-g407-inclusion className="flex items-start justify-between gap-3">
    <div className="min-w-0 flex-1 py-1"><p className="text-[13px] font-medium">Include in estimated left to spend</p><p id={helperId} className="mt-1 text-[12px] leading-5 text-slate-600 dark:text-slate-300">{helper}</p></div>
    <button type="button" role="switch" aria-label="Include in estimated left to spend" aria-describedby={helperId} aria-checked={included} disabled={locked} onClick={() => onChange(!included)} className={`grid h-11 min-w-12 shrink-0 touch-manipulation place-items-center rounded-lg disabled:cursor-not-allowed ${focus}`}>
      <span aria-hidden="true" className={`relative h-6 w-12 rounded-full transition-colors ${included ? "bg-[#4f46e5]" : "bg-slate-300 dark:bg-slate-600"} ${locked ? "opacity-60" : ""}`}><span className={`absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow-sm transition-transform motion-reduce:transition-none ${included ? "translate-x-6" : ""}`} /></span>
    </button>
  </div>;
}

function StatusMark({ scenario }: { scenario: Scenario }) {
  return <CircleAlert aria-hidden="true" size={14} className={`shrink-0 ${scenario.shortfall?.kind === "payments" ? "text-rose-700 dark:text-rose-300" : "text-amber-800 dark:text-amber-200"}`} />;
}

function Forecast({ scenario, variant, hidden, counted, openDetails }: {
  scenario: Scenario; variant: Variant; hidden: boolean; counted: boolean; openDetails: () => void;
}) {
  const m = (value: number | null | undefined) => typeof value === "number" ? formatMoney(value, hidden) : "Unavailable";
  if (!counted) return <button onClick={openDetails} className={`${quiet} mt-2 -ml-2`}>Excluded from estimated left to spend</button>;
  if (scenario.reading.kind !== "ready") return <div data-g407-forecast className="mt-3 flex min-h-11 items-center justify-between gap-3 text-[13px] text-slate-600 dark:text-slate-300">
    <span>{scenario.reading.kind === "checking" ? "Checking availability…" : "Availability unavailable"}</span>
  </div>;
  const short = scenario.shortfall;
  const verdict = short
    ? `${m(short.amount)} short ${short.kind === "payments" ? "for payments" : "after plans"}`
    : `${m(scenario.reading.value)} available to spend`;
  return <details data-g407-forecast className="group mt-3">
    <summary className={`grid min-h-11 cursor-pointer list-none grid-cols-[minmax(0,1fr)_16px] touch-manipulation items-start gap-3 rounded-lg py-2 text-[13px] leading-5 text-slate-800 hover:text-slate-950 dark:text-slate-100 dark:hover:text-white [&::-webkit-details-marker]:hidden ${focus}`}>
      <span className="min-w-0 flex-1">
        {variant === "a" && <span className="flex items-baseline justify-between gap-3"><span>Available to spend</span><MoneyText text={m(scenario.reading.value)} className="shrink-0 font-semibold" /></span>}
        {(variant === "b" || short) && <span className={`flex items-center gap-2 ${variant === "a" ? "mt-1" : ""}`}>
          <MoneyText text={verdict} />{short && <StatusMark scenario={scenario} />}
        </span>}
      </span>
      <ChevronDown size={16} aria-hidden="true" className="mt-0.5 shrink-0 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" />
    </summary>
    <div className="pb-2 pt-3 text-[13px] leading-5 text-slate-600 dark:text-slate-300">
      {variant === "b" && <p className="mb-3">Available to spend <MoneyText text={m(scenario.reading.value)} className="font-semibold" /></p>}
      {short && <p className="mb-3">{short.kind === "payments" ? "Scheduled payments" : "Plans"} take the forecast below zero. Your bank balance is separate.</p>}
      <dl className="space-y-2">
        <div className="flex justify-between gap-3"><dt>After scheduled payments</dt><dd className="shrink-0"><MoneyText text={m(scenario.position?.after_payments)} /></dd></div>
        <div className="flex justify-between gap-3"><dt>Plans held back</dt><dd className="shrink-0"><MoneyText text={m(scenario.position?.plans_reserved)} /></dd></div>
        <div className="flex justify-between gap-3 border-t border-slate-200 pt-2 font-semibold dark:border-slate-700"><dt>After payments and plans</dt><dd className="shrink-0"><MoneyText text={m(scenario.position?.after_payments_and_plans)} /></dd></div>
      </dl>
      <p className="mt-3">Estimated for this pay period. Available protects earlier low points and money held for moves, and cannot exceed your shared Left to spend. Separate account limits cannot be added together.</p>
    </div>
  </details>;
}

function Activity({ scenario, hidden, onOpen }: { scenario: Scenario; hidden: boolean; onOpen: (tx: Transaction) => void }) {
  const [tab, setTab] = useState<Tab>("Transactions");
  const [query, setQuery] = useState("");
  const filtered = scenario.transactions.filter(tx => `${tx.merchant_name ?? ""} ${tx.description} ${tx.category ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  const categories = useMemo(() => Object.entries(scenario.transactions.reduce<Record<string, { total: number; count: number }>>((all, tx) => {
    const name = tx.category ?? "Other";
    const prior = all[name] ?? { total: 0, count: 0 };
    all[name] = { total: prior.total + tx.amount, count: prior.count + 1 };
    return all;
  }, {})), [scenario.transactions]);
  return <section aria-label="Account activity" className="mt-5">
    <SegmentedControl options={["Transactions", "Categories"]} value={tab} onChange={value => setTab(value as Tab)} ariaLabel="Account activity view" />
    {tab === "Transactions" ? <div className="mt-3 [&_[data-account-toolbar]]:mb-3">
      <AccountTransactionsToolbar searchQuery={query} onSearchChange={setQuery} onClearSearch={() => setQuery("")} />
      {filtered.length ? <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white dark:border-slate-700 dark:bg-slate-800">
        {filtered.map(tx => <TransactionRowContent key={tx.id} transaction={tx} hidden={hidden} onClick={() => onOpen(tx)} />)}
      </div> : <p className="py-8 text-center text-sm text-slate-600 dark:text-slate-300">{scenario.transactions.length ? "No transactions match your search." : "No transactions yet."}</p>}
    </div> : <div className="mt-3 overflow-hidden rounded-2xl bg-white dark:bg-slate-800">
      {categories.length ? categories.map(([name, value]) => {
        const Icon = getCategoryIcon(name, {});
        const colour = getCategoryColour(name, {});
        return <button key={name} type="button" onClick={() => { setTab("Transactions"); setQuery(name); }} className={`flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-700 ${focus}`}>
          <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-lg" style={{ color: colour, backgroundColor: `${colour}26` }}><Icon size={15} /></span>
          <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{name}</span><span className="text-xs text-slate-600 dark:text-slate-300">{value.count} {value.count === 1 ? "payment" : "payments"}</span></span>
          <MoneyText text={formatMoney(value.total, hidden)} className="shrink-0 text-sm font-semibold" />
        </button>;
      }) : <p className="py-8 text-center text-sm text-slate-600 dark:text-slate-300">No categorised activity yet.</p>}
    </div>}
  </section>;
}

function AccountSurface({ variant, scenario, hidden, dark }: { variant: Variant; scenario: Scenario; hidden: boolean; dark: boolean }) {
  const [details, setDetails] = useState(false);
  const [counted, setCounted] = useState(scenario.account.include_in_safe_to_spend !== false);
  const [pinned, setPinned] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [notice, setNotice] = useState("");
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const detailButton = <button type="button" aria-label="Account details" className={`${quiet} -mr-2`} onClick={() => { setNotice(""); setDetails(true); }}>Details</button>;
  return <BalancesHiddenContext.Provider value={hidden}>
    <section data-g407-surface className="mx-auto max-w-2xl">
      {variant === "a" ? <>
        <div className="flex items-center gap-3">
          <BankIcon identity={scenario.account} size={36} altText="" />
          <div className="min-w-0 flex-1"><h2 className="break-words text-base font-semibold">Monzo</h2><p className="mt-0.5 break-words text-[13px] text-slate-600 dark:text-slate-300">{scenario.account.name}</p></div>
          {detailButton}
        </div>
        <div className="mt-4"><p className="text-[12px] text-slate-600 dark:text-slate-300">Bank balance</p><p className="mt-1 text-[30px] font-bold leading-tight"><MoneyText text={formatMoney(scenario.account.balance, hidden)} /></p></div>
      </> : <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-2.5"><BankIcon identity={scenario.account} size={32} altText="" /><div className="min-w-0"><h2 className="text-base font-semibold">Monzo</h2><p className="mt-0.5 break-words text-[12px] leading-4 text-slate-600 dark:text-slate-300">{scenario.account.name}</p></div></div>
        <div className="shrink-0 text-right"><p className="text-[11px] text-slate-600 dark:text-slate-300">Bank balance</p><p className="text-[20px] font-semibold leading-6"><MoneyText text={formatMoney(scenario.account.balance, hidden)} /></p>{detailButton}</div>
      </div>}
      <Forecast scenario={scenario} variant={variant} hidden={hidden} counted={counted} openDetails={() => setDetails(true)} />
      <Activity scenario={scenario} hidden={hidden} onOpen={setTransaction} />
      {notice && <p role="status" className="mt-3 text-[13px] text-slate-600 dark:text-slate-300">{notice}</p>}
    </section>
    {details && <SheetFrame title="Account details" onClose={() => { setDetails(false); setConfirmRemove(false); }} themeClass={dark ? "dark" : undefined}>
      <div className="space-y-4">
        <div><p className="font-semibold">Monzo · Current account</p><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Connected until 21 November 2026</p></div>
        <IncludeInEstimate scenario={scenario} included={counted} onChange={setCounted} />
        <div className="[&_[data-a179-refresh-button]]:pr-0">
        <AccountRefreshRow account={scenario.account} now={fixtureNow} compact onRefresh={async () => {
          return { refreshed: false, message: "Preview only. No bank refresh was requested." };
        }} />
        </div>
        <div className="border-t border-slate-200 pt-3 dark:border-slate-700">
          <button type="button" className={`flex min-h-11 w-full touch-manipulation items-center justify-between gap-2 rounded-lg text-left text-[13px] font-medium text-slate-700 hover:text-slate-950 dark:text-slate-200 dark:hover:text-white ${focus}`} onClick={() => setPinned(!pinned)}><span>{pinned ? "Unpin account" : "Pin account"}</span><span className="grid size-6 shrink-0 place-items-center"><Pin size={15} aria-hidden="true" /></span></button>
          <button type="button" className={`flex min-h-11 w-full touch-manipulation items-center justify-between gap-2 rounded-lg text-left text-[13px] font-medium text-rose-700 dark:text-rose-300 ${focus}`} onClick={() => setConfirmRemove(true)}><span>Remove account</span><span className="grid size-6 shrink-0 place-items-center"><Trash2 size={15} aria-hidden="true" /></span></button>
          {confirmRemove && <div className="mt-3 rounded-xl border border-slate-200 p-3 dark:border-slate-600"><p className="text-sm">Remove this account?</p><div className="mt-2 flex gap-3"><button className={`min-h-11 rounded-lg bg-rose-700 px-3 text-sm font-semibold text-white ${focus}`} onClick={() => { setDetails(false); setConfirmRemove(false); setNotice("Preview only: no account was removed."); }}>Remove account</button><button className={quiet} onClick={() => setConfirmRemove(false)}>Cancel</button></div></div>}
        </div>
      </div>
    </SheetFrame>}
    {transaction && <SheetFrame title={transaction.merchant_name ?? transaction.description} variant="compact" themeClass={dark ? "dark" : undefined} onClose={() => setTransaction(null)}>
      <p className="text-[30px] font-bold"><MoneyText text={`−${formatMoney(transaction.amount, hidden)}`} /></p>
      <dl className="mt-4 space-y-3 text-sm"><div className="flex justify-between gap-3"><dt className="text-slate-600 dark:text-slate-300">Date</dt><dd>{new Date(`${transaction.date}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</dd></div><div className="flex justify-between gap-3"><dt className="text-slate-600 dark:text-slate-300">Category</dt><dd>{transaction.category}</dd></div></dl>
    </SheetFrame>}
  </BalancesHiddenContext.Provider>;
}

export default function Preview() {
  const params = useSearchParams();
  const variant: Variant = params.get("variant") === "b" ? "b" : "a";
  const state: ScenarioId = SCENARIO_IDS.includes(params.get("state") as ScenarioId) ? params.get("state") as ScenarioId : "plans";
  const dark = params.get("mode") === "dark";
  const hidden = params.get("hidden") === "1";
  const clean = params.get("clean") === "1";
  useEffect(() => {
    const prior = document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.dataset.g407Ready = "1";
    return () => {
      document.documentElement.classList.toggle("dark", prior);
      delete document.documentElement.dataset.g407Ready;
    };
  }, [dark]);
  function href(patch: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    Object.entries(patch).forEach(([key, value]) => next.set(key, value));
    return `/design/account-detail-calm?${next.toString()}`;
  }
  const control = `inline-flex min-h-11 items-center justify-center rounded-xl border px-3 text-[13px] font-medium ${focus}`;
  return <div className={dark ? "dark" : ""}><main className="min-h-dvh bg-[#f0f2f7] px-4 pb-12 pt-5 text-slate-900 dark:bg-[#0f172a] dark:text-slate-100 sm:px-6">
    {!clean && <header className="mx-auto mb-5 max-w-2xl">
      <div className="flex items-center justify-between gap-3"><h1 className="text-xl font-bold">A simpler account page</h1><Link href="/design" className={quiet}><ChevronLeft size={15} aria-hidden="true" />Designs</Link></div>
      <p className="mt-1 text-[13px] text-slate-600 dark:text-slate-300">G407 · Invented examples. Compare the layout and try its controls.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {(["a", "b"] as const).map(id => <Link key={id} aria-current={variant === id ? "page" : undefined} href={href({ variant: id })} className={`${control} ${variant === id ? "border-[#4f46e5] bg-[#4f46e5] text-white" : "border-slate-300 dark:border-slate-600"}`}>{id === "a" ? "A · Account first" : "B · Activity first"}</Link>)}
        <Link href={href({ clean: "1" })} className={quiet}>Open full screen</Link>
      </div>
      <details className="mt-2"><summary className={`min-h-11 cursor-pointer rounded-lg py-3 text-[13px] font-medium ${focus}`}>Examples and display</summary><div className="flex flex-wrap gap-2 pb-3">
        {SCENARIO_IDS.map(id => <Link key={id} href={href({ state: id })} aria-current={id === state ? "page" : undefined} className={`${control} ${id === state ? "border-slate-600 bg-slate-200 dark:bg-slate-700" : "border-slate-300 dark:border-slate-600"}`}>{SCENARIOS[id].label}</Link>)}
        <Link href={href({ mode: dark ? "light" : "dark" })} className={control}>{dark ? "Light theme" : "Dark theme"}</Link>
        <Link href={href({ hidden: hidden ? "0" : "1" })} className={control}>{hidden ? "Show amounts" : "Hide amounts"}</Link>
      </div></details>
    </header>}
    <AccountSurface key={`${variant}-${state}-${hidden}-${dark}`} variant={variant} scenario={SCENARIOS[state]} hidden={hidden} dark={dark} />
  </main></div>;
}
