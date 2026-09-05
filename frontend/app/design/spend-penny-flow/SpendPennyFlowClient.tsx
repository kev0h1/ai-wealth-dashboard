"use client";

// TEMPORARY PREVIEW — Spend (This period / Patterns) -> Penny interaction prototype.
// Fictional figures only. No API calls and no production navigation changes.
// /design/spend-penny-flow?view=period|patterns|penny&mode=light|dark

import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import {
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Home,
  PieChart,
  Search,
  Send,
  ShoppingBag,
  ShoppingCart,
  Target,
  Train,
  Utensils,
  X,
} from "lucide-react";
import PennyMark from "@/components/PennyMark";

type View = "period" | "patterns" | "penny";
type Mode = "light" | "dark";

const MONEY_SHAPE = [
  { id: "fixed", label: "Fixed", detail: "Bills, debt and rent", amount: "£2,074", share: "61%", width: 61, colour: "bg-slate-600 dark:bg-slate-400" },
  { id: "saved", label: "Moved to savings", detail: "Goals and reserves", amount: "£340", share: "10%", width: 10, colour: "bg-emerald-500" },
  { id: "free", label: "Free spending", detail: "Everyday choices", amount: "£816", share: "24%", width: 24, colour: "bg-sky-500" },
  { id: "left", label: "Left over", detail: "At period end", amount: "£170", share: "5%", width: 5, colour: "bg-slate-200 dark:bg-slate-700" },
] as const;

const CATEGORIES = [
  { id: "eating-out", label: "Eating out", amount: "£182", meta: "8 payments", pace: "5.7× usual", icon: Utensils, tone: "amber" },
  { id: "groceries", label: "Groceries", amount: "£236", meta: "14 payments", pace: "On pace", icon: ShoppingCart, tone: "quiet" },
  { id: "transport", label: "Transport", amount: "£148", meta: "11 payments", pace: "£19 below usual", icon: Train, tone: "quiet" },
  { id: "shopping", label: "Shopping", amount: "£96", meta: "5 payments", pace: "About usual", icon: ShoppingBag, tone: "quiet" },
] as const;

const EATING_OUT_PAYMENTS = [
  { merchant: "Pizza Express", date: "2 Sep", amount: "£42.60" },
  { merchant: "Nando’s", date: "1 Sep", amount: "£36.20" },
  { merchant: "Wagamama", date: "31 Aug", amount: "£30.00" },
  { merchant: "Deliveroo", date: "30 Aug", amount: "£27.50" },
  { merchant: "The Deli", date: "29 Aug", amount: "£18.50" },
  { merchant: "Pret", date: "29 Aug", amount: "£12.40" },
  { merchant: "Greggs", date: "28 Aug", amount: "£8.00" },
  { merchant: "Caffè Nero", date: "28 Aug", amount: "£6.80" },
] as const;

function ThemeEffect({ mode }: { mode: Mode }) {
  useEffect(() => {
    const root = document.documentElement;
    const hadDark = root.classList.contains("dark");
    const scheme = document.querySelector('meta[name="color-scheme"]');
    const oldScheme = scheme?.getAttribute("content") ?? null;
    root.classList.toggle("dark", mode === "dark");
    scheme?.setAttribute("content", mode === "dark" ? "dark" : "only light");
    return () => {
      root.classList.toggle("dark", hadDark);
      if (oldScheme === null) scheme?.removeAttribute("content");
      else scheme?.setAttribute("content", oldScheme);
    };
  }, [mode]);
  return null;
}

function PreviewBar({ mode, onMode }: { mode: Mode; onMode: () => void }) {
  return (
    <div className="mb-5 flex min-h-10 items-center justify-between gap-3 px-1">
      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Temporary preview · Spend structure</p>
      <button type="button" onClick={onMode} className="min-h-10 rounded-xl px-3 text-[11px] font-semibold text-slate-500 hover:bg-white dark:text-slate-400 dark:hover:bg-white/[0.06]">
        {mode === "dark" ? "Light mode" : "Dark mode"}
      </button>
    </div>
  );
}

function SpendTabs({ active, onChange }: { active: "period" | "patterns"; onChange: (next: "period" | "patterns") => void }) {
  return (
    <div role="tablist" aria-label="Spend views" className="grid grid-cols-2 rounded-2xl bg-slate-200/70 p-1 dark:bg-slate-800">
      {(["period", "patterns"] as const).map((tab) => {
        const selected = tab === active;
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab)}
            className={`min-h-11 rounded-xl px-3 text-sm font-semibold transition-colors ${selected ? "bg-white text-slate-950 shadow-sm dark:bg-slate-700 dark:text-white" : "text-slate-500 dark:text-slate-400"}`}
          >
            {tab === "period" ? "This period" : "Patterns"}
          </button>
        );
      })}
    </div>
  );
}

function PageHeading({ title, subtitle, action }: { title: string; subtitle: string; action?: ReactNode }) {
  return (
    <header className="flex items-start justify-between gap-3 px-1">
      <div>
        <h1 className="text-[22px] font-bold tracking-tight text-slate-950 dark:text-white">{title}</h1>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>
      </div>
      {action}
    </header>
  );
}

function MoneyShapeCard({ onSpend }: { onSpend: () => void }) {
  return (
    <section className="glass-hero rounded-3xl p-4" aria-labelledby="money-shape-title">
      <button type="button" className="flex min-h-10 w-full items-center justify-center gap-1 text-[13px] font-semibold text-slate-700 dark:text-slate-300">
        Last pay period · 28 Jul–27 Aug <ChevronDown size={14} className="text-slate-400" aria-hidden="true" />
      </button>
      <p className="text-[11px] text-slate-500 dark:text-slate-400">From your transactions</p>
      <h2 id="money-shape-title" className="sr-only">How your take-home was used</h2>

      <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" aria-hidden="true">
        {MONEY_SHAPE.map((job) => <span key={job.id} className={job.colour} style={{ width: `${job.width}%` }} />)}
      </div>

      <div className="mt-3 space-y-0.5">
        {MONEY_SHAPE.map((job) => (
          <button
            key={job.id}
            type="button"
            onClick={job.id === "free" ? onSpend : undefined}
            className="flex min-h-12 w-full items-center gap-2.5 rounded-xl px-1 text-left transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.04]"
          >
            <span className={`size-2.5 shrink-0 rounded-full ${job.colour}`} aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-slate-700 dark:text-slate-200">{job.label}</span>
              <span className="block truncate text-[11px] text-slate-400 dark:text-slate-500">{job.detail}</span>
            </span>
            <span className="money shrink-0 text-sm font-semibold text-slate-950 dark:text-white">{job.amount}</span>
            <span className="w-8 shrink-0 text-right text-xs text-slate-500 dark:text-slate-400">{job.share}</span>
            <ChevronRight size={14} className="shrink-0 text-slate-400" aria-hidden="true" />
          </button>
        ))}
      </div>

      <p className="mt-3 text-[15px] leading-relaxed text-slate-700 dark:text-slate-300">
        Of every <span className="money">£100</span> you took home, <span className="money">£61</span> was fixed and <span className="money">£24</span> was yours to spend freely.
      </p>
    </section>
  );
}

function PatternsView({ onPeriod }: { onPeriod: () => void }) {
  return (
    <div className="space-y-4">
      <MoneyShapeCard onSpend={onPeriod} />

      <section className="glass-card rounded-2xl p-4" aria-labelledby="change-title">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">What changed this period</p>
        <h2 id="change-title" className="mt-1.5 text-base font-bold leading-snug text-slate-950 dark:text-white">Fixed spending rose from 57% to 61% of take-home.</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">Mostly annual bill increases—not new subscriptions. Free spending was broadly unchanged.</p>
      </section>

      <section className="glass-card rounded-2xl p-4" aria-labelledby="works-title">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">What works for you · last 6 pay periods</p>
        <h2 id="works-title" className="mt-1.5 text-base font-bold leading-snug text-slate-950 dark:text-white">Moving savings in the first week usually leaves you with more breathing room.</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">You finished with cash left over in 4 of the 5 periods where you saved early.</p>
      </section>

      <button type="button" onClick={onPeriod} className="flex min-h-12 w-full items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 text-left dark:border-white/10 dark:bg-slate-900">
        <span>
          <span className="block text-sm font-semibold text-slate-900 dark:text-white">Explore free spending</span>
          <span className="block text-xs text-slate-500 dark:text-slate-400">Categories, merchants and payments</span>
        </span>
        <ChevronRight size={17} className="text-slate-400" aria-hidden="true" />
      </button>
    </div>
  );
}

function SpendInstrument() {
  return (
    <section className="glass-hero rounded-3xl p-4" aria-labelledby="spent-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p id="spent-title" className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Out this pay period</p>
          <p className="money mt-1 text-[30px] font-bold tracking-[-0.025em] text-slate-950 dark:text-white">£2,104</p>
        </div>
        <button type="button" className="flex min-h-11 items-center gap-1 rounded-xl px-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
          28 Aug–27 Sep <ChevronDown size={13} aria-hidden="true" />
        </button>
      </div>
      <p className="mt-2 border-t border-slate-100 pt-3 text-sm leading-relaxed text-slate-600 dark:border-white/[0.07] dark:text-slate-300">Eating out is the only category meaningfully ahead of your usual pace.</p>
    </section>
  );
}

function EatingOutEvidence({ paymentsOpen, onAsk, onTogglePayments }: { paymentsOpen: boolean; onAsk: () => void; onTogglePayments: () => void }) {
  return (
    <div className="grid transition-[grid-template-rows] duration-200" style={{ gridTemplateRows: "1fr" }}>
      <div className="min-h-0 overflow-hidden">
        <div className="mx-3 mb-3 rounded-2xl border border-indigo-200/80 bg-indigo-50/60 p-3.5 dark:border-indigo-400/20 dark:bg-indigo-400/[0.07]">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-white text-indigo-600 shadow-sm dark:bg-slate-800 dark:text-indigo-300">
              <PennyMark size={17} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-300">A pattern worth explaining</p>
              <p className="mt-1 text-sm font-semibold leading-snug text-slate-900 dark:text-white"><span className="money">£182</span> so far; about <span className="money">£32</span> is usual by now.</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">That puts the category <span className="money">£150</span> above its usual pace. Penny can show which payments created the gap.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onAsk}
            className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm transition-transform active:scale-[0.98]"
          >
            <PennyMark size={15} /> Ask Penny about this
          </button>
          <button
            type="button"
            onClick={onTogglePayments}
            aria-expanded={paymentsOpen}
            className="mt-1 flex min-h-11 w-full items-center justify-center gap-1 text-xs font-semibold text-indigo-600 dark:text-indigo-300"
          >
            {paymentsOpen ? "Hide payments" : "See the 8 payments"}
            <ChevronDown size={14} className={`transition-transform ${paymentsOpen ? "rotate-180" : ""}`} aria-hidden="true" />
          </button>
          {paymentsOpen && (
            <div className="mt-1 overflow-hidden rounded-xl border border-indigo-100 bg-white/80 dark:border-indigo-400/10 dark:bg-slate-900/70">
              <div className="flex items-center justify-between border-b border-indigo-100 px-3 py-2 text-[11px] font-semibold text-slate-500 dark:border-indigo-400/10 dark:text-slate-400">
                <span>8 payments</span>
                <span className="money text-slate-900 dark:text-white">£182.00 total</span>
              </div>
              {EATING_OUT_PAYMENTS.map((payment) => (
                <div key={`${payment.date}-${payment.merchant}`} className="flex min-h-10 items-center gap-2 border-b border-slate-100 px-3 last:border-0 dark:border-white/[0.06]">
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-700 dark:text-slate-200">{payment.merchant}</span>
                  <span className="text-[11px] text-slate-400">{payment.date}</span>
                  <span className="money w-14 text-right text-xs font-semibold text-slate-900 dark:text-white">{payment.amount}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SpendView({ expanded, paymentsOpen, onToggle, onTogglePayments, onAsk }: { expanded: boolean; paymentsOpen: boolean; onToggle: () => void; onTogglePayments: () => void; onAsk: () => void }) {
  return (
    <div className="space-y-4">
      <SpendInstrument />

      <section aria-labelledby="categories-title">
        <div className="flex min-h-11 items-center justify-between px-1">
          <h2 id="categories-title" className="text-sm font-semibold text-slate-800 dark:text-slate-100">Categories</h2>
          <span className="text-xs text-slate-500 dark:text-slate-400">Tap one to understand it</span>
        </div>
        <div className="glass-card divide-y divide-slate-100 overflow-hidden rounded-2xl dark:divide-white/[0.07]">
          {CATEGORIES.map((category) => {
            const Icon = category.icon;
            const isEatingOut = category.id === "eating-out";
            return (
              <div key={category.id}>
                <button
                  type="button"
                  onClick={isEatingOut ? onToggle : undefined}
                  aria-expanded={isEatingOut ? expanded : undefined}
                  className="flex min-h-[68px] w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.035]"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-slate-400"><Icon size={17} aria-hidden="true" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-900 dark:text-white">{category.label}</span>
                    <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{category.meta}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="money block text-sm font-semibold text-slate-950 dark:text-white">{category.amount}</span>
                    <span className={`block text-[11px] font-semibold ${category.tone === "amber" ? "text-amber-600 dark:text-amber-400" : "text-slate-400 dark:text-slate-500"}`}>{category.pace}</span>
                  </span>
                  <ChevronRight size={15} className={`shrink-0 text-slate-400 transition-transform ${isEatingOut && expanded ? "rotate-90" : ""}`} aria-hidden="true" />
                </button>
                {isEatingOut && expanded && <EatingOutEvidence paymentsOpen={paymentsOpen} onAsk={onAsk} onTogglePayments={onTogglePayments} />}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function PennyWindow({ contextual, onClose, onViewPayments }: { contextual: boolean; onClose: () => void; onViewPayments: () => void }) {
  return (
    <>
      <button type="button" aria-label="Close Penny" onClick={onClose} className="fixed inset-0 z-[56] cursor-default" />
      <div className="fixed inset-x-0 bottom-[110px] z-[58] px-3 lg:inset-x-auto lg:left-auto lg:right-6 lg:bottom-6 lg:px-0">
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="penny-window-title"
          className="mx-auto flex max-h-[65dvh] w-full max-w-[420px] origin-bottom flex-col overflow-hidden rounded-3xl border border-indigo-200/70 bg-white shadow-[0_18px_60px_rgba(15,23,42,0.24)] dark:border-indigo-400/20 dark:bg-slate-900 dark:shadow-black/50 lg:origin-bottom-right"
          style={{ animation: "pennyEvidenceIn 180ms cubic-bezier(0.23,1,0.32,1) backwards" }}
        >
        <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 dark:border-white/[0.07]">
          <span className="flex size-9 items-center justify-center rounded-xl text-white shadow-sm" style={{ background: "linear-gradient(135deg,#4f46e5,#7c3aed)" }}>
            <PennyMark size={19} />
          </span>
          <span className="min-w-0 flex-1">
            <h2 id="penny-window-title" className="text-sm font-bold text-slate-950 dark:text-white">Penny</h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">{contextual ? "Looking at Eating out" : "Ask about your money"}</p>
          </span>
          <button type="button" onClick={onClose} aria-label="Close Penny" className="flex size-11 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/[0.06]"><X size={18} /></button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3.5 py-3.5">
          {contextual ? (
            <>
              <div className="rounded-2xl border border-indigo-200/80 bg-indigo-50/70 p-3 dark:border-indigo-400/20 dark:bg-indigo-400/[0.07]">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-300">From Spend · Eating out</span>
                  <span className="rounded-lg bg-amber-100 px-2 py-1 text-[10px] font-semibold text-amber-700 dark:bg-amber-400/10 dark:text-amber-300">5.7× usual</span>
                </div>
                <div className="mt-2 flex items-end justify-between gap-3">
                  <div>
                    <p className="money text-xl font-bold text-slate-950 dark:text-white">£182</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">8 payments this period</p>
                  </div>
                  <p className="money text-sm font-semibold text-amber-700 dark:text-amber-300">£150 above pace</p>
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <span className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-lg text-indigo-600 dark:text-indigo-300"><PennyMark size={16} /></span>
                <div className="rounded-2xl rounded-tl-md bg-slate-100 px-3.5 py-3 text-[13px] leading-relaxed text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  <p>At this point in a usual pay period, Eating out is about <span className="money font-semibold">£32</span>. You have spent <span className="money font-semibold">£182</span>, so the difference is <span className="money font-semibold">£150</span>.</p>
                  <p className="mt-2">Six additional payments account for <span className="money font-semibold">£118</span>. Two higher-value meals account for the remaining <span className="money font-semibold">£32</span>.</p>
                </div>
              </div>

              <button type="button" onClick={onViewPayments} className="flex min-h-11 w-full items-center justify-between rounded-xl border border-slate-200 px-3 text-left text-xs font-semibold text-slate-700 dark:border-white/10 dark:text-slate-200">
                View the 8 payments in Spend <ChevronRight size={15} className="text-slate-400" aria-hidden="true" />
              </button>
            </>
          ) : (
            <div className="flex items-start gap-2.5 py-2">
              <span className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-lg text-indigo-600 dark:text-indigo-300"><PennyMark size={16} /></span>
              <div className="rounded-2xl rounded-tl-md bg-slate-100 px-3.5 py-3 text-[13px] leading-relaxed text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                What would you like to understand? Open a category in Spend when you want me to bring its payments into the conversation.
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2" aria-label="Suggested follow-up questions">
            {(contextual
              ? ["Is this likely a one-off?", "What can I spend next week?", "Help me set a gentle limit"]
              : ["Am I spending more than usual?", "What is coming up?", "Can I afford something?"]
            ).map((prompt) => (
              <button key={prompt} type="button" className="min-h-10 rounded-full border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 dark:border-white/10 dark:bg-slate-900 dark:text-slate-300">{prompt}</button>
            ))}
          </div>
        </div>

        <div className="border-t border-slate-100 p-3 dark:border-white/[0.07]">
          <div className="flex min-h-12 items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 dark:border-white/10 dark:bg-slate-800">
            <span className="min-w-0 flex-1 text-sm text-slate-400">Ask a follow-up…</span>
            <button type="button" aria-label="Send" className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white"><Send size={15} /></button>
          </div>
        </div>
        </section>
      </div>
    </>
  );
}

function MockBottomNav({ pennyOpen, onSpend, onPenny }: { pennyOpen: boolean; onSpend: () => void; onPenny: () => void }) {
  const items = [
    { label: "Home", icon: Home, action: undefined, active: false },
    { label: "Spend", icon: PieChart, action: onSpend, active: true },
    { label: "Upcoming", icon: CalendarClock, action: undefined, active: false },
    { label: "Plan", icon: Target, action: undefined, active: false },
  ] as const;
  return (
    <nav aria-label="Prototype navigation" className="fixed inset-x-0 bottom-3 z-50 mx-auto h-16 w-[calc(100%-28px)] max-w-[402px] rounded-[22px] border border-white/60 bg-white/95 shadow-[0_10px_30px_rgba(15,23,42,0.16)] dark:border-white/10 dark:bg-slate-900/95 lg:hidden">
      <button
        type="button"
        onClick={onPenny}
        aria-label="Penny"
        aria-pressed={pennyOpen}
        className="absolute -top-7 left-1/2 z-10 flex size-14 -translate-x-1/2 items-center justify-center rounded-2xl text-white transition-transform active:scale-95"
        style={{ background: "linear-gradient(135deg,#4f46e5,#7c3aed)", boxShadow: pennyOpen ? "0 4px 14px rgba(79,70,229,.35),0 0 0 6px rgba(79,70,229,.16)" : "0 4px 14px rgba(79,70,229,.35)" }}
      >
        <PennyMark size={22} />
      </button>
      <div className="grid h-full grid-cols-5 px-1.5">
        {items.map((item, index) => {
          const Icon = item.icon;
          const column = index < 2 ? index + 1 : index + 2;
          return (
            <button key={item.label} type="button" onClick={item.action} style={{ gridColumnStart: column }} className="flex min-h-11 flex-col items-center justify-center gap-0.5">
              <Icon size={20} strokeWidth={item.active ? 2.5 : 1.8} className={item.active ? "text-indigo-600 dark:text-indigo-400" : "text-slate-500 dark:text-slate-400"} />
              <span className={`text-[10px] font-semibold ${item.active ? "text-indigo-600 dark:text-indigo-400" : "text-slate-500 dark:text-slate-400"}`}>{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function MockDesktopSidebar({ onSpend, onPenny }: { onSpend: () => void; onPenny: () => void }) {
  const items = [
    { label: "Home", icon: Home, action: undefined, active: false },
    { label: "Spend", icon: PieChart, action: onSpend, active: true },
    { label: "Upcoming", icon: CalendarClock, action: undefined, active: false },
    { label: "Plan", icon: Target, action: undefined, active: false },
  ] as const;

  return (
    <aside className="fixed inset-y-0 left-0 z-50 hidden w-64 flex-col border-r border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-slate-900 lg:flex">
      <div className="flex h-[86px] items-center gap-3 border-b border-slate-200 px-8 dark:border-white/10">
        <span className="flex size-5 items-center justify-center rounded-md text-indigo-600 dark:text-indigo-400"><PennyMark size={19} /></span>
        <span className="text-sm font-bold text-slate-950 dark:text-white">Sorted</span>
      </div>
      <nav aria-label="Prototype desktop navigation" className="flex-1 space-y-1 px-4 py-5">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.label} type="button" onClick={item.action} className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-sm font-medium ${item.active ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-400/10 dark:text-indigo-300" : "text-slate-500 dark:text-slate-400"}`}>
              <Icon size={18} strokeWidth={item.active ? 2.4 : 1.8} aria-hidden="true" /> {item.label}
            </button>
          );
        })}
      </nav>
      <div className="border-t border-slate-200 p-4 dark:border-white/10">
        <button type="button" onClick={onPenny} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-sm font-semibold text-slate-700 hover:bg-white dark:text-slate-200 dark:hover:bg-white/[0.05]">
          <span className="flex size-7 items-center justify-center rounded-lg text-white" style={{ background: "linear-gradient(135deg,#4f46e5,#7c3aed)" }}><PennyMark size={14} /></span>
          Ask Penny
        </button>
      </div>
    </aside>
  );
}

export default function SpendPennyFlowClient() {
  const params = useSearchParams();
  const rawView = params.get("view");
  const initialView: View = rawView === "patterns" || rawView === "insights" ? "patterns" : rawView === "penny" ? "penny" : "period";
  const [surface, setSurface] = useState<"period" | "patterns">(initialView === "patterns" ? "patterns" : "period");
  const [pennyOpen, setPennyOpen] = useState(initialView === "penny");
  const [pennyContext, setPennyContext] = useState<"category" | "none">(initialView === "penny" ? "category" : "none");
  const [expanded, setExpanded] = useState(initialView === "penny" || params.get("category") === "eating-out");
  const [paymentsOpen, setPaymentsOpen] = useState(params.get("payments") === "open");
  const [mode, setMode] = useState<Mode>(params.get("mode") === "dark" ? "dark" : "light");

  function showSurface(next: "period" | "patterns") {
    setSurface(next);
    setPennyOpen(false);
  }

  return (
    <div className={mode === "dark" ? "dark" : ""} style={{ colorScheme: mode }}>
      <ThemeEffect mode={mode} />
      <style>{`@keyframes pennyEvidenceIn { from { transform: translateY(8px) scale(.94); opacity:0 } to { transform:translateY(0) scale(1); opacity:1 } }`}</style>
      <main className="min-h-dvh bg-[#f0f2f7] pb-28 pt-5 dark:bg-slate-950">
        <div className="mx-auto w-full max-w-md px-4">
          <PreviewBar mode={mode} onMode={() => setMode((current) => current === "dark" ? "light" : "dark")} />
          <div className="space-y-4">
            <PageHeading
              title="Spend"
              subtitle={surface === "period" ? "Where your money went this pay period." : "How your spending behaves across pay periods."}
              action={<button type="button" aria-label="Search spending" className="flex size-11 items-center justify-center rounded-xl text-slate-500 hover:bg-white dark:text-slate-400 dark:hover:bg-white/[0.06]"><Search size={19} /></button>}
            />
            <SpendTabs active={surface} onChange={showSurface} />
            {surface === "patterns" ? (
              <PatternsView onPeriod={() => showSurface("period")} />
            ) : (
              <SpendView
                expanded={expanded}
                paymentsOpen={paymentsOpen}
                onToggle={() => {
                  if (expanded) setPaymentsOpen(false);
                  setExpanded((current) => !current);
                }}
                onTogglePayments={() => setPaymentsOpen((current) => !current)}
                onAsk={() => {
                  setPennyContext("category");
                  setPennyOpen(true);
                }}
              />
            )}
          </div>
        </div>
      </main>

      <MockBottomNav
        pennyOpen={pennyOpen}
        onSpend={() => showSurface("period")}
        onPenny={() => {
          if (pennyOpen) setPennyOpen(false);
          else {
            setPennyContext("none");
            setPennyOpen(true);
          }
        }}
      />
      <MockDesktopSidebar
        onSpend={() => showSurface("period")}
        onPenny={() => {
          setPennyContext("none");
          setPennyOpen(true);
        }}
      />

      {pennyOpen && (
        <PennyWindow
          contextual={pennyContext === "category"}
          onClose={() => setPennyOpen(false)}
          onViewPayments={() => {
            setPennyOpen(false);
            setSurface("period");
            setExpanded(true);
            setPaymentsOpen(true);
          }}
        />
      )}
    </div>
  );
}
