"use client";

// G90 fixture-only design round. Upcoming owns authenticated fetching and
// editing, so this preview keeps the owner's real shortfall-shaped fixture
// without calling the API. The selected treatment will be folded into the
// production page before this becomes a regression gate.
import Link from "next/link";
import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  EyeOff,
  MailOpen,
  ReceiptText,
} from "lucide-react";
import FixtureBottomNav from "../_components/FixtureBottomNav";
import { FIXTURES, fmtC, fmtC2, type PlanningFixture } from "../planning/fixtures";

type Variant = "a" | "b" | "c";
type State = "short" | "healthy" | "hidden";

const variants: Array<{ key: Variant; label: string }> = [
  { key: "a", label: "Five-day reading" },
  { key: "b", label: "Money path" },
  { key: "c", label: "Action first" },
];

function money(value: number) {
  return fmtC(value);
}

function PreviewToolbar({ variant, state, dark }: { variant: Variant; state: State; dark: boolean }) {
  const href = (nextVariant: Variant, nextState: State, nextDark: boolean) =>
    `?variant=${nextVariant}&state=${nextState}&mode=${nextDark ? "dark" : "light"}`;

  return (
    <nav aria-label="G90 design preview controls" className="border-b border-white/10 bg-slate-950 px-3 py-2 text-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-1 sm:justify-start">
        <span className="mr-2 shrink-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">Preview</span>
        {variants.map((item) => (
          <Link
            key={item.key}
            href={href(item.key, state, dark)}
            aria-current={item.key === variant ? "page" : undefined}
            aria-label={`Variant ${item.key.toUpperCase()}: ${item.label}`}
            className={`inline-flex min-h-11 shrink-0 items-center rounded-xl px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white active:scale-95 motion-reduce:transition-none ${
              item.key === variant ? "bg-white text-slate-950" : "text-slate-300 hover:bg-white/10 hover:text-white"
            }`}
          >
            {item.key.toUpperCase()}
          </Link>
        ))}
        <div className="flex basis-full items-center justify-center gap-1 sm:basis-auto sm:justify-start">
          <span className="mx-1 hidden h-6 w-px shrink-0 bg-white/15 sm:block" aria-hidden="true" />
          {(["short", "healthy", "hidden"] as State[]).map((item) => (
            <Link
              key={item}
              href={href(variant, item, dark)}
              aria-current={item === state ? "page" : undefined}
              className={`inline-flex min-h-11 shrink-0 items-center rounded-xl px-3 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
                item === state ? "bg-slate-700 text-white" : "text-slate-300 hover:bg-white/10 hover:text-white"
              }`}
            >
              {item === "short" ? "My figures" : item === "healthy" ? "Covered" : "Set aside"}
            </Link>
          ))}
          <Link
            href={href(variant, state, !dark)}
            className="inline-flex min-h-11 shrink-0 items-center rounded-xl px-3 text-xs font-semibold text-slate-300 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            {dark ? "Light" : "Dark"}
          </Link>
        </div>
      </div>
    </nav>
  );
}

function PageHeader({ data }: { data: PlanningFixture }) {
  return (
    <header className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[28px] font-bold leading-tight tracking-[-0.035em] text-slate-950 dark:text-white">Before payday</h1>
        <p className="mt-1.5 text-sm leading-5 text-slate-600 dark:text-slate-300">
          {data.paydayLabel} · {data.daysToPayday} days to go
        </p>
      </div>
      <Link
        href="/upcoming/dismissed"
        aria-label="Review set-aside predictions"
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 active:scale-95 dark:text-slate-400 dark:hover:bg-slate-800"
      >
        <EyeOff size={19} aria-hidden="true" />
      </Link>
    </header>
  );
}

function RunwayHero({ data, treatment }: { data: PlanningFixture; treatment: Variant }) {
  const short = data.runway < 0;
  const account = data.shortfalls[0];
  return (
    <section
      aria-labelledby="runway-heading"
      className={`rounded-3xl p-5 shadow-sm sm:p-6 ${short ? "border border-rose-200 bg-rose-50/80 dark:border-rose-800 dark:bg-rose-950/25" : "glass-hero"}`}
    >
      <div className={treatment === "b" ? "grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end" : ""}>
        <div>
          <h2 id="runway-heading" className="text-base font-bold text-slate-950 dark:text-white">Projected at payday</h2>
          <p className={`mt-3 font-mono text-[40px] font-bold leading-none tracking-[-0.04em] tabular-nums ${short ? "text-rose-600 dark:text-rose-400" : "text-slate-950 dark:text-white"}`}>
            {money(data.runway)}
          </p>
          <p className="mt-3 max-w-xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            {short
              ? `${money(data.spendableNow)} is available now, with ${money(data.billsTotal)} due before payday.`
              : `${money(data.spendableNow)} is available now and the bills due before payday are covered.`}
          </p>
        </div>
        {treatment === "b" && (
          <dl className="grid grid-cols-2 gap-x-5 gap-y-2 border-t border-slate-200 pt-4 text-sm dark:border-slate-700 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
            <dt className="text-slate-500 dark:text-slate-400">Available</dt>
            <dd className="text-right font-mono font-semibold tabular-nums text-slate-950 dark:text-white">{money(data.spendableNow)}</dd>
            <dt className="text-slate-500 dark:text-slate-400">Bills</dt>
            <dd className="text-right font-mono font-semibold tabular-nums text-slate-950 dark:text-white">−{money(data.billsTotal)}</dd>
            <dt className="font-semibold text-slate-800 dark:text-slate-200">At payday</dt>
            <dd className={`text-right font-mono font-bold tabular-nums ${short ? "text-rose-600 dark:text-rose-400" : "text-slate-950 dark:text-white"}`}>{money(data.runway)}</dd>
          </dl>
        )}
      </div>

      {short && account && (
        <div className="mt-5 border-t border-rose-200 pt-4 dark:border-rose-800/80">
          <div className="flex items-start gap-2.5">
            <AlertTriangle size={17} className="mt-0.5 shrink-0 text-rose-500" aria-hidden="true" />
            <p className="text-sm leading-5 text-slate-700 dark:text-slate-200">
              <span className="font-semibold">{account.bank}</span> could be short by{" "}
              <span className="font-mono font-semibold tabular-nums">{fmtC2(account.shortfall)}</span>. The payments marked below are the ones to review.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

function Calculation({ data }: { data: PlanningFixture }) {
  return (
    <details className="group mt-5 border-y border-slate-300/80 dark:border-slate-700">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-100 [&::-webkit-details-marker]:hidden">
        How the forecast works
        <ChevronDown size={17} className="transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
      </summary>
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-y-2 border-t border-slate-200 py-3 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">
        <dt>Available now</dt>
        <dd className="font-mono tabular-nums text-slate-950 dark:text-white">{money(data.spendableNow)}</dd>
        <dt>Bills before payday</dt>
        <dd className="font-mono tabular-nums text-slate-950 dark:text-white">−{money(data.billsTotal)}</dd>
        <dt>Still to put in envelopes</dt>
        <dd className="font-mono tabular-nums text-slate-950 dark:text-white">£0</dd>
        <dt className="mt-1 border-t border-slate-200 pt-2 font-semibold text-slate-950 dark:border-slate-700 dark:text-white">Projected at payday</dt>
        <dd className="mt-1 border-t border-slate-200 pt-2 font-mono font-bold tabular-nums text-slate-950 dark:border-slate-700 dark:text-white">{money(data.runway)}</dd>
      </dl>
    </details>
  );
}

function Envelope({ data, quiet = false }: { data: PlanningFixture; quiet?: boolean }) {
  const plan = data.goals[0];
  if (!plan) return null;
  return (
    <section className={quiet ? "" : "mt-8"} aria-labelledby="envelope-heading">
      <div className="flex items-end justify-between gap-3 px-1">
        <div>
          <h2 id="envelope-heading" className="text-base font-bold text-slate-950 dark:text-white">Your envelope</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Visible now, even though it starts with your next pay.</p>
        </div>
        <span className="shrink-0 text-xs font-semibold text-slate-500 dark:text-slate-400">Starts {data.paydayLabel}</span>
      </div>
      <div className="mt-3 flex min-h-[76px] w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-400/10 dark:text-indigo-300">
          <MailOpen size={19} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-slate-950 dark:text-white">{plan.name}</span>
          <span className="mt-0.5 block text-xs leading-5 text-slate-500 dark:text-slate-400">
            {money(plan.perPeriod)} each pay period · {money(plan.amount)} target · {plan.periodsLeft} periods
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block font-mono text-sm font-bold tabular-nums text-slate-950 dark:text-white">£0</span>
          <span className="block text-[10px] text-slate-500 dark:text-slate-400">this period</span>
        </span>
      </div>
    </section>
  );
}

function Bills({ data, limit }: { data: PlanningFixture; limit?: number }) {
  const rows = data.rows.filter((row) => !row.isMovement && !row.nextPeriod).slice(0, limit ?? 5);
  return (
    <section className="mt-8" aria-labelledby="payments-heading">
      <div className="flex items-end justify-between gap-3 px-1">
        <div>
          <h2 id="payments-heading" className="text-base font-bold text-slate-950 dark:text-white">Before payday</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">The payments behind the forecast, in date order.</p>
        </div>
        <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">{rows.length} shown</span>
      </div>
      <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
        {rows.map((row, index) => {
          const risk = row.risk === "genuine";
          return (
            <div
              key={row.id}
              className={`flex min-h-[68px] w-full items-center gap-3 px-4 py-3 text-left ${index ? "border-t border-slate-100 dark:border-slate-700" : ""}`}
            >
              <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${risk ? "bg-rose-100 text-rose-600 dark:bg-rose-400/10 dark:text-rose-300" : "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300"}`}>
                <ReceiptText size={16} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-slate-950 dark:text-white">{row.name}</span>
                <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">{row.dateLabel} · {row.bank}</span>
              </span>
              <span className={`shrink-0 font-mono text-sm font-semibold tabular-nums ${risk ? "text-rose-600 dark:text-rose-400" : "text-slate-950 dark:text-white"}`}>−{money(row.amount)}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ActionPanel({ data }: { data: PlanningFixture }) {
  const account = data.shortfalls[0];
  if (!account) {
    return (
      <section className="mt-6 border-y border-slate-300/80 py-5 dark:border-slate-700">
        <h2 className="text-base font-bold text-slate-950 dark:text-white">Nothing needs changing</h2>
        <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">Your bills and envelope fit before payday.</p>
      </section>
    );
  }
  return (
    <section className="mt-6 border-y border-slate-300/80 py-5 dark:border-slate-700" aria-labelledby="action-heading">
      <h2 id="action-heading" className="text-base font-bold text-slate-950 dark:text-white">First, protect Barclays</h2>
      <p className="mt-1 max-w-xl text-sm leading-6 text-slate-600 dark:text-slate-300">
        It needs <span className="font-mono font-semibold tabular-nums text-slate-950 dark:text-white">{fmtC2(account.shortfall)}</span> before the marked payments leave. Your envelope starts next payday, so it is not causing this gap.
      </p>
      <a href="#payments-heading" className="mt-3 inline-flex min-h-11 items-center gap-1 rounded-xl px-3 text-sm font-semibold text-indigo-600 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 active:scale-95 dark:text-indigo-300 dark:hover:bg-indigo-500/10">
        Review those payments <ChevronRight size={16} aria-hidden="true" />
      </a>
    </section>
  );
}

function HiddenPredictions() {
  return (
    <main id="upcoming-main" className="mx-auto w-full max-w-2xl px-4 pb-[calc(8.5rem+env(safe-area-inset-bottom))] pt-8 sm:px-6 sm:pt-10 lg:pb-10">
      <header>
        <h1 className="text-[28px] font-bold tracking-[-0.035em] text-slate-950 dark:text-white">Set-aside predictions</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600 dark:text-slate-300">Two predictions are quiet, not deleted. Your runway and envelopes still use everything that remains active.</p>
      </header>
      <section className="mt-10 border-y border-slate-300/80 py-6 dark:border-slate-700">
        <EyeOff size={24} className="text-slate-400" aria-hidden="true" />
        <h2 className="mt-4 text-xl font-bold text-slate-950 dark:text-white">2 predictions set aside</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">Restore either prediction when it belongs in the forecast again.</p>
        <a href="/upcoming/dismissed" className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 active:scale-95">Review predictions</a>
      </section>
    </main>
  );
}

export default function UpcomingCanvasClient() {
  const params = useSearchParams();
  const rawVariant = params.get("variant");
  const variant: Variant = rawVariant === "b" || rawVariant === "c" ? rawVariant : "a";
  const rawState = params.get("state");
  const state: State = rawState === "healthy" || rawState === "hidden" ? rawState : "short";
  const dark = params.get("mode") === "dark";

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", dark ? "dark" : "light");
  }, [dark]);

  const data = state === "hidden" ? FIXTURES.short : FIXTURES[state];

  return (
    <div className={dark ? "dark" : ""} style={{ colorScheme: dark ? "dark" : "light" }}>
      <div className="min-h-dvh bg-[#f0f2f7] text-slate-900 selection:bg-indigo-200 selection:text-slate-950 dark:bg-[#0f172a] dark:text-slate-100 dark:selection:bg-indigo-500/40 dark:selection:text-white">
        <a href="#upcoming-main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-slate-950 focus:px-4 focus:py-3 focus:text-white">Skip to Upcoming preview</a>
        <PreviewToolbar variant={variant} state={state} dark={dark} />
        {state === "hidden" ? (
          <HiddenPredictions />
        ) : (
          <main id="upcoming-main" className="mx-auto w-full max-w-5xl px-4 pb-[calc(8.5rem+env(safe-area-inset-bottom))] pt-7 sm:px-6 sm:pt-10 lg:pb-16">
            <PageHeader data={data} />

            {variant === "a" && (
              <div className="mx-auto mt-6 max-w-2xl">
                <RunwayHero data={data} treatment={variant} />
                <Calculation data={data} />
                <Envelope data={data} />
                <Bills data={data} />
              </div>
            )}

            {variant === "b" && (
              <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,.9fr)] lg:items-start">
                <div>
                  <RunwayHero data={data} treatment={variant} />
                  <Calculation data={data} />
                  <Bills data={data} />
                </div>
                <aside className="space-y-8 lg:sticky lg:top-6 lg:border-l lg:border-slate-300/80 lg:pl-8 dark:lg:border-slate-700">
                  <Envelope data={data} quiet />
                  <section className="border-t border-slate-300/80 pt-6 dark:border-slate-700" aria-labelledby="dates-heading">
                    <div className="flex items-center gap-2">
                      <CalendarDays size={17} className="text-slate-500 dark:text-slate-400" aria-hidden="true" />
                      <h2 id="dates-heading" className="text-base font-bold text-slate-950 dark:text-white">What changes when</h2>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">Bills leave over the next five days. The envelope begins on {data.paydayLabel}.</p>
                  </section>
                </aside>
              </div>
            )}

            {variant === "c" && (
              <div className="mx-auto mt-6 max-w-2xl">
                <RunwayHero data={data} treatment={variant} />
                <ActionPanel data={data} />
                <Envelope data={data} />
                <Bills data={data} limit={4} />
                <Calculation data={data} />
              </div>
            )}

            <p className="mx-auto mt-10 max-w-2xl border-t border-slate-300/80 pt-5 text-xs leading-5 text-slate-500 dark:border-slate-700 dark:text-slate-400">
              Fixture-only design preview using the values from the reviewed phone state. No bank data, envelopes or predictions change here.
            </p>
          </main>
        )}
      </div>
      <FixtureBottomNav active="Upcoming" />
    </div>
  );
}
