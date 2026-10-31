"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Building2, Check, CircleAlert, Clock3, CreditCard, Home, Landmark, LoaderCircle, ReceiptText, WalletCards } from "lucide-react";

type Variant = "a" | "b";
type Surface = "home" | "transactions" | "account";
type State = "mixed" | "pending-only" | "no-pending" | "empty" | "loading" | "error" | "handover" | "long";
type Payment = { id: string; merchant: string; detail: string; amount: string; pending?: boolean; posts?: string; icon: "shop" | "travel" | "food" | "bank"; };

const STATES: Array<{ id: State; label: string }> = [
  { id: "mixed", label: "Mixed" }, { id: "pending-only", label: "Pending only" },
  { id: "no-pending", label: "No pending" }, { id: "empty", label: "Empty" },
  { id: "loading", label: "Loading" }, { id: "error", label: "Retry" },
  { id: "handover", label: "Handover" }, { id: "long", label: "Long + FX" },
];
const SURFACES: Array<{ id: Surface; label: string; icon: typeof Home }> = [
  { id: "home", label: "Home", icon: Home }, { id: "transactions", label: "Transactions", icon: ReceiptText }, { id: "account", label: "Account", icon: Building2 },
];

const PENDING: Payment[] = [
  { id: "pending-coffee", merchant: "WatchHouse Coffee", detail: "Today · Eating out", amount: "−£4.80", pending: true, icon: "food" },
  { id: "pending-rail", merchant: "Transport for London", detail: "Today · Transport", amount: "−£2.80", pending: true, icon: "travel" },
];
const BOOKED_TODAY: Payment[] = [
  { id: "booked-groceries", merchant: "M&S Foodhall", detail: "Today · Groceries", amount: "−£23.45", icon: "shop" },
  { id: "booked-credit", merchant: "Salary", detail: "Today · Income", amount: "+£2,840.00", icon: "bank" },
];
const BOOKED_NOV_2: Payment[] = [
  { id: "booked-tesco", merchant: "Tesco", detail: "Groceries", amount: "−£46.20", posts: "Posts Mon 2 Nov", icon: "shop" },
];
const LONG_FX: Payment[] = [
  { id: "pending-long", merchant: "THE INTERNATIONAL HOUSE OF PANCAKES TERMINAL 4", detail: "Today · Travel · USD 38.60", amount: "−USD 38.60", pending: true, icon: "food" },
  { id: "pending-fx", merchant: "Metro de Madrid", detail: "Today · Transport · EUR 2.20", amount: "−EUR 2.20", pending: true, icon: "travel" },
];

function PaymentIcon({ kind }: { kind: Payment["icon"] }) {
  const cls = "h-4 w-4";
  const Icon = kind === "food" ? CreditCard : kind === "travel" ? WalletCards : kind === "bank" ? Landmark : ReceiptText;
  const tint = kind === "food" ? "bg-orange-100 text-orange-600 dark:bg-orange-400/15 dark:text-orange-300" : kind === "travel" ? "bg-blue-100 text-blue-600 dark:bg-blue-400/15 dark:text-blue-300" : kind === "bank" ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-300" : "bg-emerald-100 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-300";
  return <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${tint}`}><Icon className={cls} aria-hidden="true" /></span>;
}

function Amount({ value, masked }: { value: string; masked: boolean }) {
  return <span role={masked ? "img" : undefined} aria-label={masked ? "Amount hidden" : undefined} className="money shrink-0 text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">{masked ? value.replace(/\d[\d,.]*/g, "••••") : value}</span>;
}

function PaymentRow({ payment, masked }: { payment: Payment; masked: boolean }) {
  const privateText = (value: string) => masked ? value.replace(/\b(?:USD|EUR)\s+\d[\d.,]*/g, "amount hidden").replace(/\d[\d.,]*/g, "••••") : value;
  return <div data-transaction-id={payment.id} data-pending={payment.pending ? "true" : "false"} className="flex min-h-16 w-full items-center gap-3 px-4 py-2 text-left">
    <PaymentIcon kind={payment.icon} />
    <span className="min-w-0 flex-1">
      <span className="block break-words text-sm font-medium text-slate-800 dark:text-slate-100">{payment.merchant}</span>
      <span className="mt-0.5 block text-xs text-slate-600 dark:text-slate-400">{payment.pending ? "Pending" : privateText(payment.detail)}</span>
      {payment.posts && <span className="mt-0.5 block text-xs text-slate-600 dark:text-slate-400">{payment.posts}</span>}
    </span>
    <Amount value={payment.amount} masked={masked} />
  </div>;
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return <section aria-label={title}>
    <h2 className="mb-2 px-1 text-[11px] font-bold uppercase tracking-[0.09em] text-slate-500 dark:text-slate-400">{title}</h2>
    {children}
  </section>;
}

export default function PendingPaymentsClient() {
  const params = useSearchParams();
  const variant: Variant = params.get("variant") === "b" ? "b" : "a";
  const surface = (SURFACES.find(({ id }) => id === params.get("surface"))?.id ?? "home") as Surface;
  const state = (STATES.find(({ id }) => id === params.get("state"))?.id ?? "mixed") as State;
  const dark = params.get("mode") === "dark";
  const [masked, setMasked] = useState(false);
  const [posted, setPosted] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => { document.documentElement.classList.toggle("dark", dark); document.documentElement.style.colorScheme = dark ? "dark" : "light"; }, [dark]);
  useEffect(() => { setPosted(false); }, [state]);
  useEffect(() => { setReady(true); }, []);

  const href = (next: Partial<{ variant: Variant; surface: Surface; state: State; mode: "light" | "dark" }>) => `?${new URLSearchParams({ variant, surface, state, mode: dark ? "dark" : "light", ...next }).toString()}`;
  const isPendingState = state === "mixed" || state === "pending-only" || state === "handover" || state === "long";
  const pending = state === "long" ? LONG_FX : PENDING;
  const shownPending = !isPendingState ? [] : state === "handover" && posted ? PENDING.slice(1) : pending;
  const bookedToday = state === "empty" || state === "loading" || state === "error" || state === "pending-only" ? [] : BOOKED_TODAY;
  const bookedNov2 = state === "empty" || state === "loading" || state === "error" || state === "pending-only" ? [] : BOOKED_NOV_2;
  const postDateRows = state === "handover" && posted
    ? [{ ...PENDING[0], id: "booked-handover", pending: false, detail: "Eating out", posts: "Posts Mon 2 Nov" }, ...bookedNov2]
    : bookedNov2;
  const nothing = !shownPending.length && !bookedToday.length && !bookedNov2.length;
  const title = surface === "home" ? "Recent activity" : surface === "transactions" ? "Transactions" : "Everyday account";

  return <div className="min-h-dvh bg-[#f0f2f7] text-slate-900 dark:bg-slate-900 dark:text-slate-100">
    <nav aria-label="Preview controls" className="border-b border-slate-800 bg-slate-950 px-2 py-1.5 text-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-1">
        <a href={href({ variant: "a" })} className={`inline-flex min-h-11 items-center rounded-xl px-3 text-xs font-bold touch-manipulation active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${variant === "a" ? "bg-white text-slate-950" : "text-slate-300 hover:bg-white/10"}`}>A · In the list</a>
        <a href={href({ variant: "b" })} className={`inline-flex min-h-11 items-center rounded-xl px-3 text-xs font-bold touch-manipulation active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${variant === "b" ? "bg-white text-slate-950" : "text-slate-300 hover:bg-white/10"}`}>B · Separate group</a>
        <span className="mx-1 hidden h-5 w-px bg-white/20 sm:block" />
        {SURFACES.map(({ id, label }) => <a key={id} href={href({ surface: id })} className={`inline-flex min-h-11 items-center rounded-xl px-3 text-xs font-bold touch-manipulation active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${surface === id ? "bg-indigo-500 text-white" : "text-slate-300 hover:bg-white/10"}`}>{label}</a>)}
        <span className="mx-1 hidden h-5 w-px bg-white/20 sm:block" />
        <a href={href({ mode: dark ? "light" : "dark" })} className="inline-flex min-h-11 items-center rounded-xl px-3 text-xs font-bold text-slate-300 hover:bg-white/10 touch-manipulation active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">{dark ? "Light" : "Dark"}</a>
      </div>
    </nav>

    <main data-g373-ready={ready ? "true" : "false"} data-g373-surface={surface} className="mx-auto max-w-6xl px-4 pb-10 pt-5 sm:px-6 lg:grid lg:grid-cols-[1fr_380px] lg:gap-10 lg:px-10">
      <div className="min-w-0">
        <header className="mb-5 flex items-center justify-between gap-3">
          <div className="min-w-0"><p className="text-[11px] font-bold uppercase tracking-[0.09em] text-slate-500 dark:text-slate-400">{surface === "home" ? "Your money" : surface === "transactions" ? "Activity" : "Monzo · Current"}</p><h1 className="text-xl font-bold tracking-tight">{title}</h1></div>
          <button type="button" data-mask-toggle onClick={() => setMasked((value) => !value)} className="min-h-11 shrink-0 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 shadow-sm touch-manipulation active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">{masked ? "Show amounts" : "Mask amounts"}</button>
        </header>

        {state === "loading" ? <div role="status" className="flex min-h-64 items-center justify-center rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800"><div className="text-center"><LoaderCircle aria-hidden="true" className="mx-auto h-6 w-6 animate-spin motion-reduce:animate-none text-indigo-500" /><p className="mt-3 text-sm font-medium text-slate-600 dark:text-slate-300">Updating your activity…</p></div></div> : state === "error" ? <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800"><CircleAlert aria-hidden="true" className="h-5 w-5 text-slate-500" /><h2 className="mt-3 text-base font-bold">Your activity is not available yet</h2><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Please try loading your payments again.</p><a href={href({ state: "mixed" })} className="mt-3 inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 touch-manipulation active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 active:opacity-70 dark:text-indigo-300 dark:hover:bg-slate-700">Try again</a></div> : nothing ? <div className="rounded-2xl border border-slate-200 bg-white px-5 py-10 text-center shadow-sm dark:border-slate-700 dark:bg-slate-800"><ReceiptText aria-hidden="true" className="mx-auto h-7 w-7 text-slate-400" /><h2 className="mt-3 text-base font-bold">Nothing to show yet</h2><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">New payments will appear here after your bank shares them.</p></div> : <div className="space-y-6">
          {variant === "a" ? <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
            {shownPending.length > 0 && <><h2 className="px-4 pb-2 pt-4 text-[11px] font-bold uppercase tracking-[0.09em] text-slate-500 dark:text-slate-400">Pending payments</h2>{shownPending.map((payment) => <PaymentRow key={payment.id} payment={payment} masked={masked} />)}<div className="mx-4 border-t border-slate-100 dark:border-slate-700" /></>}
            {(bookedToday.length > 0 || postDateRows.length > 0) && <><h2 className="px-4 pb-2 pt-4 text-[11px] font-bold uppercase tracking-[0.09em] text-slate-500 dark:text-slate-400">Today · Saturday 31 October</h2>{bookedToday.map((payment) => <PaymentRow key={payment.id} payment={payment} masked={masked} />)}{postDateRows.map((payment) => <PaymentRow key={payment.id} payment={payment} masked={masked} />)}</>}
          </section> : <>
            {shownPending.length > 0 && <section className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/80 shadow-sm dark:border-slate-700 dark:bg-slate-800"><div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700"><div className="flex items-center gap-2"><Clock3 aria-hidden="true" size={16} className="text-slate-500 dark:text-slate-400" /><h2 className="text-sm font-bold">Pending payments</h2></div><span className="rounded-full bg-slate-200 px-2 py-1 text-[10px] font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-300">{shownPending.length}</span></div><div className="bg-white dark:bg-slate-800">{shownPending.map((payment) => <PaymentRow key={payment.id} payment={payment} masked={masked} />)}</div></section>}
            {(bookedToday.length > 0 || postDateRows.length > 0) && <Group title="Today · Saturday 31 October"><div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">{bookedToday.map((payment) => <PaymentRow key={payment.id} payment={payment} masked={masked} />)}{postDateRows.map((payment) => <PaymentRow key={payment.id} payment={payment} masked={masked} />)}</div></Group>}
          </>}
          {state === "handover" && !posted && <button type="button" data-handover onClick={() => setPosted(true)} className="-mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-xs font-bold text-indigo-700 touch-manipulation active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300"><Check aria-hidden="true" size={15} />Show this payment posted once</button>}
          {state === "handover" && posted && <p role="status" className="-mt-3 flex items-center gap-2 px-1 text-xs text-slate-500 dark:text-slate-400"><Check aria-hidden="true" size={15} className="text-emerald-500" />WatchHouse is now booked. It appears once, under Today.</p>}
        </div>}
      </div>
      <section aria-label="Preview examples" className="mt-7 lg:mt-0"><div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800"><h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Examples and display</h2><div className="mt-3 flex flex-wrap gap-2">{STATES.map(({ id, label }) => <a key={id} href={href({ state: id })} className={`inline-flex min-h-11 items-center rounded-xl px-3 text-xs font-bold touch-manipulation active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${state === id ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600"}`}>{label}</a>)}</div><p className="mt-4 text-xs leading-5 text-slate-500 dark:text-slate-400">Synthetic examples for Saturday 31 October. A keeps Pending within the existing list. B gives it a compact, counted separation. Neither changes totals or lets a payment be edited here.</p></div></section>
    </main>
    <nav aria-label="Preview surface navigation" className="sticky bottom-0 border-t border-slate-200 bg-white/95 px-3 py-2 backdrop-blur dark:border-slate-700 dark:bg-slate-800/95 lg:hidden"><div className="mx-auto flex max-w-md justify-around">{SURFACES.map(({ id, label, icon: Icon }) => <a key={id} href={href({ surface: id })} className={`flex min-h-11 min-w-16 flex-col items-center justify-center rounded-xl px-3 text-[10px] font-bold touch-manipulation active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${surface === id ? "text-indigo-600 dark:text-indigo-300" : "text-slate-500 dark:text-slate-400"}`}><Icon aria-hidden="true" size={17} /><span className="mt-0.5">{label}</span></a>)}</div></nav>
  </div>;
}
