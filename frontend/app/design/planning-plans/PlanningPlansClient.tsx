"use client";

// TEMPORARY PREVIEW — delete after the Planning plans-density review.
// /design/planning-plans?variant=a|b|c&mode=light|dark

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  EyeOff,
  Plus,
  Receipt,
  ShieldCheck,
  Target,
  Wallet,
} from "lucide-react";

const VARIANTS = ["a", "b", "c"] as const;
type Variant = (typeof VARIANTS)[number];
type Mode = "light" | "dark";

const VARIANT_LABELS: Record<Variant, string> = {
  a: "A · register",
  b: "B · priority",
  c: "C · dashboard",
};

type PlanItem = {
  id: string;
  kind: string;
  title: ReactNode;
  reading: ReactNode;
  note: string;
  progress?: number;
  attention?: boolean;
  icon: typeof Target;
};

const PLANS: PlanItem[] = [
  {
    id: "holiday",
    kind: "Goal",
    title: "Summer holiday",
    reading: <><span className="font-mono tabular-nums">£0</span> of <span className="font-mono tabular-nums">£500</span></>,
    note: "£62 each pay period · 8 left",
    progress: 0,
    attention: true,
    icon: Target,
  },
  {
    id: "food",
    kind: "Envelope",
    title: "Food",
    reading: <><span className="font-mono tabular-nums">£180</span> of <span className="font-mono tabular-nums">£300</span></>,
    note: "This pay period",
    progress: 60,
    icon: Wallet,
  },
  {
    id: "car-service",
    kind: "One-off",
    title: "Car service",
    reading: <span className="font-mono tabular-nums">£420</span>,
    note: "Due 17 Oct · Barclays",
    attention: true,
    icon: Receipt,
  },
  {
    id: "buffer",
    kind: "Goal",
    title: "Rainy-day buffer",
    reading: <><span className="font-mono tabular-nums">£1,107</span> of <span className="font-mono tabular-nums">£3,000</span></>,
    note: "£80 each pay period",
    progress: 37,
    icon: ShieldCheck,
  },
];

function ModeEffect({ mode }: { mode: Mode }) {
  useEffect(() => {
    const root = document.documentElement;
    const hadDark = root.classList.contains("dark");
    const colourScheme = document.querySelector('meta[name="color-scheme"]');
    const previousScheme = colourScheme?.getAttribute("content") ?? null;

    root.classList.toggle("dark", mode === "dark");
    colourScheme?.setAttribute("content", mode === "dark" ? "dark" : "only light");

    return () => {
      root.classList.toggle("dark", hadDark);
      if (previousScheme === null) colourScheme?.removeAttribute("content");
      else colourScheme?.setAttribute("content", previousScheme);
    };
  }, [mode]);

  return null;
}

function ReviewControls({ variant, mode }: { variant: Variant; mode: Mode }) {
  const hrefFor = (nextVariant: Variant, nextMode: Mode) =>
    `?variant=${nextVariant}&mode=${nextMode}`;

  return (
    <nav
      aria-label="Design variants"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[70] flex justify-center px-3 pb-[calc(12px+env(safe-area-inset-bottom,0px))]"
    >
      <div className="pointer-events-auto flex max-w-full flex-col items-center gap-1 rounded-2xl border border-white/15 bg-slate-950/90 p-1.5 shadow-2xl backdrop-blur-xl">
        <div className="flex items-center gap-1">
          {VARIANTS.map((item) => (
            <Link
              key={item}
              href={hrefFor(item, mode)}
              scroll={false}
              className={`flex min-h-11 shrink-0 items-center rounded-xl px-3 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                variant === item ? "bg-indigo-600 text-white" : "text-slate-300 hover:bg-white/10"
              }`}
            >
              {VARIANT_LABELS[item]}
            </Link>
          ))}
        </div>
        <Link
          href={hrefFor(variant, mode === "dark" ? "light" : "dark")}
          scroll={false}
          className="flex min-h-9 items-center rounded-xl px-3 text-[11px] font-semibold text-slate-300 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        >
          Preview {mode === "dark" ? "light" : "dark"}
        </Link>
      </div>
    </nav>
  );
}

function PageHeader() {
  return (
    <header className="flex items-center justify-between gap-3">
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">Planning</p>
        <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">What&apos;s coming</h1>
      </div>
      <button
        type="button"
        aria-label="Review hidden predictions"
        className="flex size-11 items-center justify-center rounded-xl text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-500"
      >
        <EyeOff size={20} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </header>
  );
}

function ForecastCard({ calculationOpen }: { calculationOpen: boolean }) {
  return (
    <section className="rounded-3xl border border-rose-200 bg-rose-50 px-4 py-4 dark:border-rose-800 dark:bg-rose-900/20" aria-labelledby="forecast-heading">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p id="forecast-heading" className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Projected at payday</p>
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

      <details open={calculationOpen || undefined} className="group mt-3 border-t border-rose-200/80 dark:border-rose-800/60">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-[13px] font-semibold text-indigo-600 outline-none hover:text-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300 [&::-webkit-details-marker]:hidden">
          Full calculation
          <ChevronDown size={16} className="shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <dl className="border-t border-rose-200/80 pb-1 pt-1 text-[13px] text-slate-600 dark:border-rose-800/60 dark:text-slate-300">
          <MoneyRow label="Available now" value="£612" />
          <MoneyRow label="Bills before payday" value="−£691" />
          <MoneyRow label="Still to set aside" value="−£40" />
          <MoneyRow label="Projected balance" value="−£119" total />
        </dl>
      </details>

      <p className="mt-2 text-xs leading-snug text-rose-900 dark:text-rose-100">
        Barclays is short by <span className="font-mono font-semibold tabular-nums">£231.30</span>, mostly the <span className="font-mono tabular-nums">£400.00</span> move on Tue 1 Sept.
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

function PlansHeading({ id, subtitle }: { id: string; subtitle: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-1">
      <div>
        <h2 id={id} className="text-sm font-semibold text-slate-800 dark:text-slate-100">Plans</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
      </div>
      <button
        type="button"
        className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-xl px-2 text-xs font-semibold text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-400"
      >
        <Plus size={13} aria-hidden="true" /> Set aside
      </button>
    </div>
  );
}

function RegisterVariant() {
  return (
    <section className="space-y-2" aria-labelledby="register-title">
      <PlansHeading id="register-title" subtitle="Everything in one compact register" />
      <div className="glass-card divide-y divide-slate-200/70 overflow-hidden rounded-2xl dark:divide-white/10">
        {PLANS.map((plan) => {
          const Icon = plan.icon;
          return (
            <button
              type="button"
              key={plan.id}
              className="relative flex min-h-[64px] w-full items-center gap-3 px-3.5 py-2.5 text-left focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-slate-400">
                <Icon size={15} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  {plan.attention && <span className="size-1.5 rounded-full bg-amber-500" aria-hidden="true" />}
                  {plan.kind}
                </span>
                <span className="block truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{plan.title}</span>
                <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{plan.reading} · {plan.note}</span>
                {plan.progress !== undefined && (
                  <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" aria-hidden="true">
                    <span className="block h-full rounded-full bg-indigo-500" style={{ width: `${plan.progress}%` }} />
                  </span>
                )}
              </span>
              <ChevronRight size={16} className="shrink-0 text-slate-400" aria-hidden="true" />
            </button>
          );
        })}
      </div>
      <DesignNote>Best balance: all four plan types stay visible, but shared chrome and 64px rows remove the empty space between separate cards.</DesignNote>
    </section>
  );
}

function PriorityVariant() {
  const secondary = PLANS.slice(1);
  return (
    <section className="space-y-2" aria-labelledby="priority-title">
      <PlansHeading id="priority-title" subtitle="Lead with the plan that needs attention" />
      <button
        type="button"
        className="glass-card w-full rounded-2xl px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <span className="flex items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
              <span className="size-1.5 rounded-full bg-amber-500" aria-hidden="true" /> Needs attention
            </span>
            <span className="mt-0.5 block truncate text-sm font-semibold text-slate-900 dark:text-slate-100">Summer holiday</span>
          </span>
          <span className="shrink-0 text-right">
            <span className="block font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">£0 / £500</span>
            <span className="block text-[11px] text-slate-400">Oct 2026</span>
          </span>
        </span>
        <span className="mt-2 block h-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" aria-hidden="true">
          <span className="block h-full w-0 rounded-full bg-amber-500" />
        </span>
        <span className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
          <span><span className="font-mono tabular-nums">£62</span> each pay period · 8 left</span>
          <span className="font-semibold text-indigo-600 dark:text-indigo-400">Review <ChevronRight size={13} className="inline" aria-hidden="true" /></span>
        </span>
      </button>
      <details className="group glass-card overflow-hidden rounded-2xl">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-semibold text-slate-800 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-100 [&::-webkit-details-marker]:hidden">
          <span>3 other plans <span className="ml-1 font-normal text-slate-400">Food, Car service, Buffer</span></span>
          <ChevronDown size={16} className="shrink-0 text-slate-400 transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="divide-y divide-slate-200/70 border-t border-slate-200/70 dark:divide-white/10 dark:border-white/10">
          {secondary.map((plan) => (
            <div key={plan.id} className="flex min-h-12 items-center justify-between gap-3 px-4 py-2">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-slate-800 dark:text-slate-100">{plan.title}</span>
                <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{plan.kind} · {plan.note}</span>
              </span>
              <ChevronRight size={15} className="shrink-0 text-slate-400" aria-hidden="true" />
            </div>
          ))}
        </div>
      </details>
      <DesignNote>Quietest resting state: it keeps the urgent goal visible and names the hidden plans, but requires one tap for their detail.</DesignNote>
    </section>
  );
}

function DashboardVariant() {
  return (
    <section className="space-y-2" aria-labelledby="dashboard-title">
      <PlansHeading id="dashboard-title" subtitle="Four glanceable plan tiles" />
      <div className="grid grid-cols-2 gap-2">
        {PLANS.map((plan) => {
          const Icon = plan.icon;
          return (
            <button
              type="button"
              key={plan.id}
              className="glass-card flex min-h-[112px] min-w-0 flex-col rounded-2xl p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <span className="flex w-full items-center justify-between gap-2">
                <span className="flex size-7 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-slate-400">
                  <Icon size={14} aria-hidden="true" />
                </span>
                {plan.attention && (
                  <span className="size-1.5 rounded-full bg-amber-500" title="Needs attention">
                    <span className="sr-only">Needs attention</span>
                  </span>
                )}
              </span>
              <span className="mt-2 block text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{plan.kind}</span>
              <span className="mt-0.5 block w-full truncate text-[13px] font-semibold text-slate-900 dark:text-slate-100">{plan.title}</span>
              <span className="mt-auto block w-full truncate pt-1 text-[11px] text-slate-500 dark:text-slate-400">{plan.reading}</span>
              {plan.progress !== undefined && (
                <span className="mt-1.5 block h-1 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" aria-hidden="true">
                  <span className="block h-full rounded-full bg-indigo-500" style={{ width: `${plan.progress}%` }} />
                </span>
              )}
            </button>
          );
        })}
      </div>
      <DesignNote>Most compact while keeping every plan visible. The trade-off is less room for explanatory copy, especially on narrow phones.</DesignNote>
    </section>
  );
}

function DesignNote({ children }: { children: ReactNode }) {
  return <p className="px-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{children}</p>;
}

function UpcomingHint() {
  return (
    <section className="border-t border-slate-200/70 pt-4 dark:border-white/10" aria-labelledby="upcoming-preview-heading">
      <div className="flex items-end justify-between gap-3 px-1">
        <h2 id="upcoming-preview-heading" className="text-sm font-semibold text-slate-800 dark:text-slate-100">Upcoming</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">“After” is your projected cash</p>
      </div>
      <div className="mt-3 space-y-2 opacity-70" aria-hidden="true">
        <div className="glass-card h-14 rounded-2xl" />
        <div className="glass-card h-14 rounded-2xl" />
      </div>
    </section>
  );
}

export default function PlanningPlansClient() {
  const params = useSearchParams();
  const rawVariant = params.get("variant");
  const variant: Variant = (VARIANTS as readonly string[]).includes(rawVariant ?? "")
    ? rawVariant as Variant
    : "a";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";
  const calculationOpen = params.get("calculation") === "open";

  return (
    <div className={mode === "dark" ? "dark" : ""}>
      <ModeEffect mode={mode} />
      <main className="min-h-dvh bg-[#f0f2f7] pb-28 dark:bg-[#0f172a]">
        <div className="mx-auto w-full max-w-[430px] space-y-4 px-4 pt-6">
          <PageHeader />
          <ForecastCard calculationOpen={calculationOpen} />
          {variant === "a" && <RegisterVariant />}
          {variant === "b" && <PriorityVariant />}
          {variant === "c" && <DashboardVariant />}
          <UpcomingHint />
        </div>
      </main>
      <ReviewControls variant={variant} mode={mode} />
    </div>
  );
}
