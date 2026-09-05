"use client";

// TEMPORARY PREVIEW — proposed information architecture, not live navigation.
// /design/upcoming-plan?view=upcoming|plan&mode=light|dark

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertCircle,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  CreditCard,
  Home,
  Lightbulb,
  PieChart,
  Receipt,
  ShieldCheck,
  Target,
  Wallet,
} from "lucide-react";

type View = "upcoming" | "plan";
type Mode = "light" | "dark";

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

function ReviewSwitch({ view, mode }: { view: View; mode: Mode }) {
  const href = (nextView: View, nextMode: Mode) => `?view=${nextView}&mode=${nextMode}`;
  return (
    <nav aria-label="Architecture preview" className="glass-card flex items-center gap-1 rounded-2xl p-1.5">
      {(["upcoming", "plan"] as const).map((item) => (
        <Link
          key={item}
          href={href(item, mode)}
          scroll={false}
          className={`flex min-h-11 flex-1 items-center justify-center rounded-xl px-3 text-sm font-semibold capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
            view === item
              ? "bg-indigo-600 text-white"
              : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/[0.06]"
          }`}
        >
          {item}
        </Link>
      ))}
      <Link
        href={href(view, mode === "dark" ? "light" : "dark")}
        scroll={false}
        className="flex min-h-11 items-center rounded-xl px-3 text-xs font-semibold text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-400 dark:hover:bg-white/[0.06]"
      >
        {mode === "dark" ? "Light" : "Dark"}
      </Link>
    </nav>
  );
}

function PageTitle({ eyebrow, title, sub }: { eyebrow: string; title: string; sub: string }) {
  return (
    <header>
      <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">{eyebrow}</p>
      <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">{title}</h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{sub}</p>
    </header>
  );
}

function ForecastCard() {
  return (
    <section className="rounded-3xl border border-rose-200 bg-rose-50 px-4 py-4 dark:border-rose-800 dark:bg-rose-900/20" aria-labelledby="upcoming-forecast-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p id="upcoming-forecast-title" className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Projected at payday</p>
          <div className="flex items-baseline gap-2">
            <p className="font-mono text-3xl font-bold tracking-tight text-rose-600 tabular-nums dark:text-rose-400">−£119</p>
            <span className="text-sm font-semibold text-rose-600 dark:text-rose-400">short</span>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Tue 8 Sept · 5 days</p>
        </div>
        <span className="inline-flex min-h-7 items-center gap-1 rounded-lg bg-rose-100 px-2 text-xs font-semibold text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
          <AlertCircle size={13} aria-hidden="true" /> 1 account short
        </span>
      </div>
      <details className="group mt-3 border-t border-rose-200/80 dark:border-rose-800/60">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-[13px] font-semibold text-indigo-600 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-400 [&::-webkit-details-marker]:hidden">
          Full calculation
          <ChevronDown size={16} className="transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <dl className="border-t border-rose-200/80 pb-1 pt-1 text-[13px] text-slate-600 dark:border-rose-800/60 dark:text-slate-300">
          <MoneyRow label="Available now" value="£754" />
          <MoneyRow label="Bills before payday" value="−£691" />
          <MoneyRow label="Set aside this period" value="−£182" />
          <MoneyRow label="Projected balance" value="−£119" total />
        </dl>
      </details>
      <p className="mt-2 text-xs leading-snug text-rose-900 dark:text-rose-100">
        Barclays needs <span className="font-mono font-semibold tabular-nums">£231.30</span> before two payments leave.
      </p>
    </section>
  );
}

function MoneyRow({ label, value, total = false }: { label: string; value: string; total?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-4 py-1.5 ${total ? "mt-1 border-t border-rose-200/80 pt-2 font-semibold dark:border-rose-800/60" : ""}`}>
      <dt>{label}</dt>
      <dd className={`font-mono tabular-nums ${total ? "text-rose-600 dark:text-rose-400" : "text-slate-900 dark:text-slate-100"}`}>{value}</dd>
    </div>
  );
}

function SectionHeading({ id, title, side }: { id: string; title: string; side?: ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 px-1">
      <h2 id={id} className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h2>
      {side}
    </div>
  );
}

function SetAsideThisPeriod({ mode }: { mode: Mode }) {
  return (
    <section aria-labelledby="set-aside-period-title">
      <SectionHeading
        id="set-aside-period-title"
        title="Set aside this period"
        side={<Link href={`?view=plan&mode=${mode}`} className="flex min-h-11 items-center gap-0.5 px-2 text-xs font-semibold text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-400">Manage in Plan <ChevronRight size={13} aria-hidden="true" /></Link>}
      />
      <div className="glass-card divide-y divide-slate-200/70 overflow-hidden rounded-2xl dark:divide-white/10">
        <CompactSetAside icon={Target} title="Summer holiday" detail="Goal · £62 reserved" amount="−£62" />
        <CompactSetAside icon={Wallet} title="Food" detail="Envelope · £120 remaining" amount="−£120" />
      </div>
      <p className="mt-2 px-1 text-xs text-slate-500 dark:text-slate-400">
        Only this pay period&apos;s reserved portions affect the forecast above.
      </p>
    </section>
  );
}

function CompactSetAside({ icon: Icon, title, detail, amount }: { icon: typeof Target; title: string; detail: string; amount: string }) {
  return (
    <div className="flex min-h-[58px] items-center gap-3 px-3.5 py-2.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-500 dark:bg-indigo-400/10 dark:text-indigo-300"><Icon size={15} aria-hidden="true" /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</span>
        <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{detail}</span>
      </span>
      <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">{amount}</span>
    </div>
  );
}

const UPCOMING_ROWS = [
  { title: "Council Tax", meta: "Today · Barclays", amount: "−£142.00", after: "£612 after", icon: CalendarClock, planned: false },
  { title: "Car service", meta: "Fri 5 Sept · Barclays", amount: "−£420.00", after: "£192 after", icon: Receipt, planned: true },
  { title: "Salary", meta: "Tue 8 Sept · Barclays", amount: "+£2,450.00", after: "£2,642 after", icon: Wallet, planned: false },
];

function UpcomingLedger() {
  return (
    <section aria-labelledby="upcoming-ledger-title">
      <SectionHeading id="upcoming-ledger-title" title="Upcoming" side={<span className="text-xs text-slate-500 dark:text-slate-400">“After” is projected cash</span>} />
      <div className="space-y-2">
        {UPCOMING_ROWS.map((row) => {
          const Icon = row.icon;
          const incoming = row.amount.startsWith("+");
          return (
            <button key={row.title} type="button" className="glass-card flex min-h-[66px] w-full items-center gap-3 rounded-2xl px-3.5 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-slate-400"><Icon size={15} aria-hidden="true" /></span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{row.title}</span>
                  {row.planned && <span className="rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600 dark:bg-indigo-400/10 dark:text-indigo-300">planned</span>}
                </span>
                <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{row.meta}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className={`block font-mono text-sm font-semibold tabular-nums ${incoming ? "text-emerald-600 dark:text-emerald-400" : "text-slate-900 dark:text-slate-100"}`}>{row.amount}</span>
                <span className="block text-[11px] text-slate-400">{row.after}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function UpcomingView({ mode }: { mode: Mode }) {
  return (
    <>
      <PageTitle eyebrow="Upcoming" title="Before payday" sub="What will enter or leave, and whether every payment is covered." />
      <ForecastCard />
      <SetAsideThisPeriod mode={mode} />
      <UpcomingLedger />
    </>
  );
}

type LadderStepProps = {
  label: string;
  title: string;
  body: ReactNode;
  state: "active" | "next" | "later";
  last?: boolean;
  action?: ReactNode;
};

function LadderStep({ label, title, body, state, last = false, action }: LadderStepProps) {
  const active = state === "active";
  return (
    <div className="relative flex gap-3 pb-4 last:pb-0">
      {!last && <span className="absolute left-[11px] top-6 h-[calc(100%-12px)] w-px bg-slate-200 dark:bg-slate-700" aria-hidden="true" />}
      <span className={`relative z-10 mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border-2 ${active ? "border-rose-500 bg-rose-50 dark:bg-rose-950" : "border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-800"}`}>
        <span className={`size-1.5 rounded-full ${active ? "bg-rose-500" : "bg-slate-300 dark:bg-slate-500"}`} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</p>
        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</p>
        <div className="mt-0.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{body}</div>
        {action}
      </div>
    </div>
  );
}

function PriorityPlan({ mode }: { mode: Mode }) {
  return (
    <section className="glass-card rounded-3xl p-4" aria-labelledby="priority-plan-title">
      <p id="priority-plan-title" className="mb-4 text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">Your order</p>
      <LadderStep
        label="Now"
        title="Cover this pay period"
        state="active"
        body={<>Move <span className="font-mono font-semibold tabular-nums text-slate-800 dark:text-slate-200">£119</span> before payday so the next two payments are covered.</>}
        action={<Link href={`?view=upcoming&mode=${mode}`} className="mt-1 inline-flex min-h-9 items-center text-xs font-semibold text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-400">Open Upcoming <ChevronRight size={13} aria-hidden="true" /></Link>}
      />
      <LadderStep
        label="Next"
        title="Clear the costly card balance"
        state="next"
        body={<><span className="font-mono tabular-nums">£624</span> is charging interest. The remaining <span className="font-mono tabular-nums">£1,480</span> is at 0% until Sep 2026.</>}
        action={<button type="button" className="mt-1 inline-flex min-h-9 items-center text-xs font-semibold text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-400">Review debt plan <ChevronRight size={13} aria-hidden="true" /></button>}
      />
      <LadderStep
        label="Then"
        title="Finish the safety buffer"
        state="later"
        body={<>You have <span className="font-mono tabular-nums">£1,107</span> of the <span className="font-mono tabular-nums">£3,000</span> target. Keep the <span className="font-mono tabular-nums">£80</span> pay-period allocation.</>}
      />
      <LadderStep
        label="Later"
        title="Invest the surplus"
        state="later"
        last
        body="Once expensive debt is clear and the buffer is funded, direct genuinely spare money to long-term investing."
      />
    </section>
  );
}

function DebtPosition() {
  return (
    <section aria-labelledby="debt-position-title">
      <SectionHeading id="debt-position-title" title="Debt" side={<button type="button" className="flex min-h-11 items-center px-2 text-xs font-semibold text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-400">Details <ChevronRight size={13} aria-hidden="true" /></button>} />
      <div className="glass-card rounded-2xl p-4">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-500 dark:bg-rose-400/10 dark:text-rose-300"><CreditCard size={17} aria-hidden="true" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-slate-500 dark:text-slate-400">Across your credit cards</p>
            <p className="font-mono text-xl font-bold tabular-nums text-slate-900 dark:text-slate-100">£2,104 owed</p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-200/70 pt-3 dark:border-white/10">
          <div>
            <p className="font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">£624</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">charging interest</p>
          </div>
          <div>
            <p className="font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">£1,480</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">currently at 0%</p>
          </div>
        </div>
      </div>
      <p className="mt-2 px-1 text-xs text-slate-500 dark:text-slate-400">Balances remain in Accounts; repayment strategy lives here.</p>
    </section>
  );
}

function GoalRows() {
  return (
    <section aria-labelledby="goals-title">
      <SectionHeading id="goals-title" title="Goals and allocations" side={<button type="button" className="flex min-h-11 items-center px-2 text-xs font-semibold text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-400">+ Set aside</button>} />
      <div className="glass-card divide-y divide-slate-200/70 overflow-hidden rounded-2xl dark:divide-white/10">
        <GoalRow icon={ShieldCheck} title="Rainy-day buffer" amount="£1,107 of £3,000" detail="£80 each pay period" progress={37} />
        <GoalRow icon={Target} title="Summer holiday" amount="£0 of £500" detail="£62 each pay period · 8 left" progress={0} />
        <GoalRow icon={Wallet} title="Food" amount="£180 of £300" detail="Envelope · this pay period" progress={60} />
      </div>
    </section>
  );
}

function GoalRow({ icon: Icon, title, amount, detail, progress }: { icon: typeof Target; title: string; amount: string; detail: string; progress: number }) {
  return (
    <button type="button" className="flex min-h-[70px] w-full items-center gap-3 px-3.5 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-slate-400"><Icon size={15} aria-hidden="true" /></span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-3">
          <span className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</span>
          <span className="shrink-0 font-mono text-xs font-semibold tabular-nums text-slate-800 dark:text-slate-200">{amount}</span>
        </span>
        <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400">{detail}</span>
        <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" aria-hidden="true"><span className="block h-full rounded-full bg-indigo-500" style={{ width: `${progress}%` }} /></span>
      </span>
      <ChevronRight size={15} className="shrink-0 text-slate-400" aria-hidden="true" />
    </button>
  );
}

function PlanView({ mode }: { mode: Mode }) {
  return (
    <>
      <PageTitle eyebrow="Plan" title="Your next move" sub="One ordered path through debt, safety and long-term growth." />
      <PriorityPlan mode={mode} />
      <DebtPosition />
      <GoalRows />
      <p className="px-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        “Grow” is now the outcome of following this order, not a separate area to interpret.
      </p>
    </>
  );
}

const NAV_ITEMS = [
  { id: "home", label: "Home", icon: Home },
  { id: "spend", label: "Spend", icon: PieChart },
  { id: "penny", label: "Penny", icon: Lightbulb },
  { id: "upcoming", label: "Upcoming", icon: CalendarClock },
  { id: "plan", label: "Plan", icon: Target },
] as const;

function ProposedBottomNav({ view, mode }: { view: View; mode: Mode }) {
  return (
    <nav aria-label="Proposed primary navigation" className="fixed inset-x-0 bottom-0 z-50 flex justify-center border-t border-slate-200/80 bg-white/95 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/95">
      <div className="grid h-[72px] w-full max-w-[430px] grid-cols-5 px-2">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = item.id === view;
          const content = (
            <>
              <Icon size={item.id === "penny" ? 20 : 19} aria-hidden="true" />
              <span className="text-[10px] font-semibold">{item.label}</span>
            </>
          );
          const className = `flex min-h-11 flex-col items-center justify-center gap-1 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
            active ? "text-indigo-600 dark:text-indigo-400" : item.id === "penny" ? "text-violet-600 dark:text-violet-400" : "text-slate-400 dark:text-slate-500"
          }`;
          return item.id === "upcoming" || item.id === "plan" ? (
            <Link key={item.id} href={`?view=${item.id}&mode=${mode}`} scroll={false} className={className}>{content}</Link>
          ) : (
            <span key={item.id} className={className}>{content}</span>
          );
        })}
      </div>
    </nav>
  );
}

export default function UpcomingPlanClient() {
  const params = useSearchParams();
  const view: View = params.get("view") === "plan" ? "plan" : "upcoming";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";

  return (
    <div className={mode === "dark" ? "dark" : ""}>
      <ThemeEffect mode={mode} />
      <main className="min-h-dvh bg-[#f0f2f7] pb-28 dark:bg-[#0f172a]">
        <div className="mx-auto w-full max-w-[430px] space-y-4 px-4 pt-5">
          <ReviewSwitch view={view} mode={mode} />
          {view === "upcoming" ? <UpcomingView mode={mode} /> : <PlanView mode={mode} />}
        </div>
      </main>
      <ProposedBottomNav view={view} mode={mode} />
    </div>
  );
}
