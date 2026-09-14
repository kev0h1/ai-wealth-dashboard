"use client";

// G78/G82 design round. The top-area compositions are exploratory, while
// the figures and journey body come from the same typed fixture and real
// production components used by /design/spend-live.

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Search,
  SlidersHorizontal,
  WalletCards,
} from "lucide-react";
import SpendJourneyNav, { type SpendJourneyDestination } from "@/components/SpendJourneyNav";
import { SpendJourneySummary, type SpendHeaderProps } from "@/components/SpendHeader";
import { DEFAULT_WIDGETS } from "@/components/SpendTrends";
import SpendVerdictView from "@/components/SpendVerdictView";
import { DEFAULT_PAY_PERIOD_CONFIG } from "@/lib/payPeriod";
import type { SpendVerdict, SpendVerdictState } from "@/lib/api";
import {
  PREVIEW_ACCOUNTS,
  PREVIEW_CHART_PERIOD_TXNS,
  PREVIEW_CHART_TRANSACTIONS,
  PREVIEW_INCOME_TXNS,
  PREVIEW_SIGNALS,
  SPEND_VERDICT_FIXTURES,
} from "../spend-live/fixtures";

// The production chart collection uses dnd-kit's generated description ids.
// Rendering it during this preview's SSR pass produces a different id from
// hydration when another global DndContext has already mounted, which makes
// Next's dev overlay cover the design being reviewed. Production already
// lazy-loads this end-of-journey evidence; this preview follows that boundary.
const SpendTrends = dynamic(() => import("@/components/SpendTrends"), { ssr: false });

type Variant = "a" | "b" | "c";
type Mode = "light" | "dark";

const STATES: SpendVerdictState[] = ["normal", "nothing", "everything", "nobaseline", "early"];

const NOTES: Record<Variant, { title: string; thesis: string; rule: string; risk: string }> = {
  a: {
    title: "A · Cockpit card · recommended",
    thesis: "The whole verdict becomes one calm hero instrument, matching Home, Upcoming and Planning while keeping the existing desktop split.",
    rule: "Root tabs lead with a contained verdict. Drill-in pages may use an editorial canvas.",
    risk: "The card adds height on a phone, so the jump map follows it immediately with no extra section heading.",
  },
  b: {
    title: "B · Unified top deck",
    thesis: "Title, period controls, reading and reconciled figures share one full-width surface before the journey begins.",
    rule: "A root tab may use one top deck when its controls directly change every fact inside that deck.",
    risk: "The boundary is unmistakable, but the first journey evidence starts lower and the desktop loses its sticky summary rail.",
  },
  c: {
    title: "C · Editorial ledger",
    thesis: "The narrative stays on the canvas because it opens a chronological story, while the reconciled figures become the required instrument card.",
    rule: "Editorial tab roots are allowed only for continuous journeys, and their decision figures must still be contained.",
    risk: "This preserves G57 most closely, but the exception is subtler and easier for a future screen to misapply.",
  },
};

function periodLabel(verdict: SpendVerdict): string {
  const format = (value: string) => new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return `${format(verdict.period.start)} to ${format(verdict.period.end)}`;
}

function money(value: number): string {
  const sign = value < 0 ? "−" : "";
  return `${sign}£${Math.abs(Math.round(value)).toLocaleString("en-GB")}`;
}

function TitleBlock({ verdict }: { verdict: SpendVerdict }) {
  return (
    <div className="min-w-0">
      <h1 className="text-[28px] font-bold leading-none tracking-[-0.03em] text-slate-950 dark:text-white">Spend</h1>
      <p className="mt-1 text-[13px] text-slate-600 dark:text-slate-400">
        Day {verdict.period.days_elapsed}{verdict.period.days_left != null ? ` of ${verdict.period.days_elapsed + verdict.period.days_left}` : ""}
      </p>
    </div>
  );
}

function IconButton({ label, icon, className = "" }: { label: string; icon: "filter" | "search"; className?: string }) {
  const Icon = icon === "filter" ? SlidersHorizontal : Search;
  return (
    <button
      type="button"
      aria-label={label}
      className={`flex size-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 motion-reduce:transition-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 ${className}`}
    >
      <Icon size={17} aria-hidden="true" />
    </button>
  );
}

function PeriodControl({ label, className = "", docked = false }: { label: string; className?: string; docked?: boolean }) {
  return (
    <nav
      aria-label="Pay period"
      className={`flex min-h-11 min-w-0 items-center overflow-hidden border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800 ${docked ? "rounded-l-xl" : "rounded-xl"} ${className}`}
    >
      <button type="button" aria-label="Previous pay period" className="flex min-h-11 min-w-11 shrink-0 items-center justify-center text-slate-600 transition-colors hover:bg-slate-50 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:text-slate-300 dark:hover:bg-slate-700">
        <ChevronLeft size={17} aria-hidden="true" />
      </button>
      <button type="button" className="min-h-11 min-w-0 flex-1 truncate border-x border-slate-200 px-2 text-[12px] font-semibold text-slate-800 transition-colors hover:bg-slate-50 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-700 sm:px-3 sm:text-[13px]">
        {label}
      </button>
      <button type="button" aria-label="Next pay period" disabled className="flex min-h-11 min-w-11 shrink-0 items-center justify-center text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:text-slate-600">
        <ChevronRight size={17} aria-hidden="true" />
      </button>
    </nav>
  );
}

function PreviewHeader({ variant, verdict, insideDeck = false }: { variant: Variant; verdict: SpendVerdict; insideDeck?: boolean }) {
  const label = periodLabel(verdict);

  if (variant === "a") {
    return (
      <header className={`${insideDeck ? "" : "pb-4"} grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 sm:flex`}>
        <TitleBlock verdict={verdict} />
        <IconButton label="Spend settings" icon="filter" className="sm:order-3" />
        <PeriodControl label={label} className="col-span-2 w-full sm:order-2 sm:ml-auto sm:w-auto sm:min-w-[260px]" />
        <IconButton label="Search transactions" icon="search" className="hidden sm:order-4 sm:flex" />
      </header>
    );
  }

  if (variant === "b") {
    const compactLabel = label.replace(" to ", " · ");
    return (
      <header className={`${insideDeck ? "" : "pb-4"} grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[auto_minmax(260px,1fr)_auto_auto] sm:gap-3`}>
        <TitleBlock verdict={verdict} />
        <PeriodControl label={compactLabel} className="ml-auto w-full max-w-[360px]" />
        <IconButton label="Spend settings" icon="filter" />
        <IconButton label="Search transactions" icon="search" className="hidden sm:flex" />
      </header>
    );
  }

  return (
    <header className={`${insideDeck ? "" : "pb-4"} flex flex-col gap-3 sm:flex-row sm:items-center`}>
      <TitleBlock verdict={verdict} />
      <div className="flex min-w-0 sm:ml-auto sm:w-auto">
        <PeriodControl label={label} docked className="min-w-0 flex-1 rounded-r-none sm:w-[290px]" />
        <button type="button" aria-label="Spend settings" className="flex size-11 shrink-0 items-center justify-center rounded-r-xl border-y border-r border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 active:scale-95 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 sm:rounded-none">
          <SlidersHorizontal size={17} aria-hidden="true" />
        </button>
        <button type="button" aria-label="Search transactions" className="hidden size-11 shrink-0 items-center justify-center rounded-r-xl border-y border-r border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 active:scale-95 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 sm:flex">
          <Search size={17} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}

function summaryProps(verdict: SpendVerdict): SpendHeaderProps {
  return {
    verdict,
    periodLabel: periodLabel(verdict),
    isCurrentPeriod: true,
    canGoPrev: true,
    onPrev: () => {},
    onNext: () => {},
    onOpenSettings: () => {},
    onOpenRules: () => {},
    incomeTxns: PREVIEW_INCOME_TXNS,
    onTransactionClick: () => {},
    onOutTap: () => {},
    onMovedTap: () => {},
    onUnresolvedTap: () => {},
  };
}

function destinationsFor(verdict: SpendVerdict): SpendJourneyDestination[] {
  const latestPace = [...(verdict.pace_series ?? [])].reverse().find((point) => point.usual != null);
  const paceDifference = latestPace?.usual == null ? null : verdict.pills.spent - latestPace.usual;
  return [
    ...(verdict.notables.length > 0 ? [{
      id: "spend-journey-changes",
      label: "Changes",
      value: paceDifference == null ? `${verdict.notables.length} to review` : money(paceDifference),
      needsLook: paceDifference != null && paceDifference > 0,
    }] : []),
    ...(verdict.unresolved.total > 0 ? [{
      id: "spend-unresolved",
      label: "Place",
      value: `${verdict.unresolved.payments_count} · ${money(verdict.unresolved.total)}`,
    }] : []),
    {
      id: "spend-majority-section",
      label: "Spending",
      value: money(verdict.majority.reduce((sum, row) => sum + Math.max(0, row.spent), 0)),
    },
    { id: "spend-journey-charts", label: "Charts", value: `${DEFAULT_WIDGETS.length} shown` },
  ];
}

function Journey({ verdict }: { verdict: SpendVerdict }) {
  return (
    <main className="relative pl-8 before:absolute before:bottom-3 before:left-[11px] before:top-3 before:w-px before:bg-slate-300 dark:before:bg-slate-600 sm:pl-10">
      <section className="relative pb-10">
        <span className="absolute -left-8 top-1 flex size-6 items-center justify-center rounded-full bg-indigo-600 text-white ring-4 ring-[#f0f2f7] dark:ring-[#0f172a] sm:-left-10" aria-hidden="true">
          <WalletCards size={12} />
        </span>
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-600 dark:text-slate-400">Pay arrived · 31 Jul</p>
        <h2 className="mt-2 text-xl font-bold text-slate-950 dark:text-white"><span className="font-mono tabular-nums">{money(verdict.pills.income)}</span> recorded coming in</h2>
        <p className="mt-1 max-w-2xl text-pretty text-[13px] leading-5 text-slate-600 dark:text-slate-400">Income is evidence for this period, not a claim that every pound of spending came from this pay packet.</p>
      </section>

      <SpendVerdictView
        verdict={verdict}
        colours={{}}
        onOpenCategory={() => {}}
        onIntent={async () => {}}
        signals={PREVIEW_SIGNALS}
        sym="£"
        onAimChanged={() => {}}
        onAskCorrect={() => {}}
        hideReading
        journey
        unresolvedAccountName={PREVIEW_ACCOUNTS.find((account) => account.id === verdict.unresolved.largest?.account_id)?.name}
        onOpenMoved={() => {}}
      />

      <section id="spend-journey-charts" tabIndex={-1} className="relative scroll-mt-24 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
        <span className="absolute -left-8 top-1 flex size-6 items-center justify-center rounded-full border border-indigo-300 bg-indigo-50 text-indigo-700 ring-4 ring-[#f0f2f7] dark:border-indigo-400/30 dark:bg-indigo-400/10 dark:text-indigo-300 dark:ring-[#0f172a] sm:-left-10" aria-hidden="true"><BarChart3 size={12} /></span>
        <h2 className="text-xl font-bold text-slate-950 dark:text-white">Your charts</h2>
        <p className="mt-1 max-w-2xl text-pretty text-[13px] leading-5 text-slate-600 dark:text-slate-400">Choose what appears here, drag the handle to reorder, or pin one chart to Home.</p>
        <SpendTrends
          embedded
          preview={{ widgets: DEFAULT_WIDGETS, pinnedWidget: "period_compare" }}
          periodTxns={PREVIEW_CHART_PERIOD_TXNS}
          allTxns={PREVIEW_CHART_TRANSACTIONS}
          periodStart={new Date(verdict.period.start)}
          periodEnd={new Date(verdict.period.end)}
          payPeriodConfig={DEFAULT_PAY_PERIOD_CONFIG}
          colours={{}}
          paceSeries={verdict.pace_series}
        />
      </section>
    </main>
  );
}

function DesignNote({ variant }: { variant: Variant }) {
  const note = NOTES[variant];
  return (
    <section className="mt-10 rounded-2xl border border-dashed border-slate-300 p-4 dark:border-slate-700" aria-label="Design notes">
      <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-indigo-600 dark:text-indigo-400">{note.title}</p>
      <p className="mt-2 text-[13px] leading-5 text-slate-700 dark:text-slate-300">{note.thesis}</p>
      <p className="mt-2 text-[12px] leading-5 text-slate-600 dark:text-slate-400"><span className="font-semibold text-slate-800 dark:text-slate-200">Rule:</span> {note.rule}</p>
      <p className="mt-1 text-[12px] leading-5 text-slate-500 dark:text-slate-400"><span className="font-semibold text-slate-700 dark:text-slate-300">Risk:</span> {note.risk}</p>
    </section>
  );
}

function PreviewControls({ variant, mode, state }: { variant: Variant; mode: Mode; state: SpendVerdictState }) {
  const href = (nextVariant: Variant, nextMode = mode) => `?variant=${nextVariant}&mode=${nextMode}&state=${state}`;
  return (
    <nav aria-label="G78 design variants" className="fixed inset-x-0 bottom-0 z-[80] border-t border-white/10 bg-slate-950/95 px-3 py-2 text-white shadow-xl" style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom, 0px))" }}>
      <div className="mx-auto flex w-full max-w-5xl items-center gap-1 overflow-x-auto">
        {(["a", "b", "c"] as Variant[]).map((item) => (
          <a key={item} href={href(item)} aria-current={variant === item ? "page" : undefined} className={`flex min-h-11 shrink-0 items-center rounded-xl px-3 text-[12px] font-semibold transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${variant === item ? "bg-white text-slate-950" : "text-slate-300 hover:bg-white/10"}`}>
            {item.toUpperCase()} · {item === "a" ? "Card" : item === "b" ? "Deck" : "Ledger"}
          </a>
        ))}
        <a href={href(variant, mode === "dark" ? "light" : "dark")} className="ml-auto flex min-h-11 shrink-0 items-center rounded-xl px-3 text-[12px] font-semibold text-slate-300 transition-colors hover:bg-white/10 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">
          {mode === "dark" ? "Light" : "Dark"}
        </a>
      </div>
    </nav>
  );
}

export default function SpendContainmentClient() {
  const params = useSearchParams();
  const variant: Variant = params.get("variant") === "b" || params.get("variant") === "c" ? params.get("variant") as Variant : "a";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";
  const requestedState = params.get("state") as SpendVerdictState | null;
  const state = requestedState && STATES.includes(requestedState) ? requestedState : "normal";
  const verdict = SPEND_VERDICT_FIXTURES[state];
  const destinations = destinationsFor(verdict);
  const hideControls = params.get("controls") === "0";

  useEffect(() => {
    document.documentElement.classList.toggle("dark", mode === "dark");
    document.documentElement.style.colorScheme = mode;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", mode === "dark" ? "#0f172a" : "#f0f2f7");
  }, [mode]);

  return (
    <div className={mode === "dark" ? "dark" : ""} style={{ colorScheme: mode }}>
      <style jsx global>{`
        .g78-ledger [data-tutorial-id="tutorial-spend-verdict"] > dl {
          border: 1px solid rgb(226 232 240);
          border-radius: 16px;
          background: white;
          padding: 12px;
          box-shadow: 0 1px 2px rgb(0 0 0 / 0.05);
        }
        .dark .g78-ledger [data-tutorial-id="tutorial-spend-verdict"] > dl {
          border-color: rgb(51 65 85);
          background: rgb(30 41 59);
          box-shadow: none;
        }
        @media (min-width: 1024px) {
          .g78-deck [data-tutorial-id="tutorial-spend-verdict"] > dl {
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 12px;
            padding-block: 16px;
          }
          .g78-deck [data-tutorial-id="tutorial-spend-verdict"] > dl > div {
            display: block;
            padding-block: 0;
            border-top-width: 0;
          }
        }
      `}</style>
      <div className="min-h-dvh bg-[#f0f2f7] pb-28 text-slate-950 dark:bg-[#0f172a] dark:text-slate-100">
        <p className="sr-only">Illustrative figures, not real balances. G78 Spend containment variant {variant.toUpperCase()}.</p>

        {variant === "b" ? (
          <div className="mx-auto w-full max-w-6xl px-4 pt-5 sm:px-6 lg:px-8">
            <section className="g78-deck glass-hero rounded-3xl p-4 sm:p-5">
              <PreviewHeader variant="b" verdict={verdict} insideDeck />
              <div className="mt-5 border-t border-slate-200/70 pt-5 dark:border-white/10">
                <SpendJourneySummary {...summaryProps(verdict)} />
              </div>
            </section>
            <div className="mt-3"><SpendJourneyNav destinations={destinations} /></div>
            <div className="mx-auto mt-9 max-w-3xl"><Journey verdict={verdict} /></div>
            <DesignNote variant={variant} />
          </div>
        ) : (
          <div className="mx-auto w-full max-w-6xl px-4 pt-5 sm:px-6 lg:px-8">
            <PreviewHeader variant={variant} verdict={verdict} />
            <div className="mt-3 grid items-start gap-9 lg:grid-cols-[minmax(280px,0.78fr)_minmax(0,1.45fr)] lg:gap-14">
              <aside className="lg:sticky lg:top-6">
                <div className={variant === "a" ? "glass-hero rounded-3xl p-4 sm:p-5" : "g78-ledger"}>
                  <SpendJourneySummary {...summaryProps(verdict)} />
                </div>
                <div className="mt-4"><SpendJourneyNav destinations={destinations} desktop /></div>
              </aside>
              <Journey verdict={verdict} />
            </div>
            <DesignNote variant={variant} />
          </div>
        )}

        {!hideControls && <PreviewControls variant={variant} mode={mode} state={state} />}
      </div>
    </div>
  );
}
