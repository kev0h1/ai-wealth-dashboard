"use client";

// TEMPORARY PREVIEW (G264), delete when Kevin's pick is folded in.
// Skills: impeccable (primary), design-taste-frontend (considered for a bolder rail, not
// needed), web-design-guidelines (final audit). Astra (openai/gpt-6-astra) drafted the three
// directions, rewritten to DESIGN.md.
//
// Renders the PRODUCTION SpendPeriodBar, SpendJourneySummary, SpendVerdictView, SpendTrends,
// SpendJourneyNav (the current strip) and SpendJourneyRail through their real props. The one
// thing it cannot import is SpendPage itself: that component fetches its own data and reads
// preferences, so it cannot render unauthenticated without mocking its fetches. The grid and
// timeline below therefore mirror SpendPage's (as spend-live already does); the navigation
// pieces under test are the shared production components.
//
//   /design/spend-rail?variant=current|a|b|c&mode=light|dark
//     &state=top|mid|bottom|nochanges|nothingtocategorise|zero  (scroll position or data state)
//     &rule=on|off   (the zero-value rule, default on)  &nav=1 (fixture bottom nav and Penny)
//     &chrome=0 (hide this preview's own controls)

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BarChart3, WalletCards } from "lucide-react";
import SpendVerdictView from "@/components/SpendVerdictView";
import { SpendJourneySummary, SpendPeriodBar, type RecentPeriodOption } from "@/components/SpendHeader";
import SpendJourneyNav, { type SpendJourneyDestination } from "@/components/SpendJourneyNav";
import SpendJourneyRail, { type SpendRailVariant } from "@/components/SpendJourneyRail";
import SpendTrends, { DEFAULT_HOME_PINNED_WIDGET, DEFAULT_WIDGETS } from "@/components/SpendTrends";
import FixtureBottomNav from "../_components/FixtureBottomNav";
import { PREVIEW_ACCOUNTS, PREVIEW_CHART_PERIOD_TXNS, PREVIEW_CHART_TRANSACTIONS, PREVIEW_INCOME_TXNS, PREVIEW_SIGNALS } from "../spend-live/fixtures";
import { OPEN_TIPS } from "../spend-tips/fixtures";
import { RAIL_VERDICTS, type RailFixtureKey } from "./fixtures";
import { DEFAULT_PAY_PERIOD_CONFIG, prevPeriodWithConfig } from "@/lib/payPeriod";
import { unresolvedWorthAsking } from "@/lib/spendUnresolved";

type Variant = "current" | SpendRailVariant;
const VARIANTS: { value: Variant; label: string }[] = [
  { value: "current", label: "Today" },
  { value: "a", label: "A Rail" },
  { value: "b", label: "B Mini-map" },
  { value: "c", label: "C Row" },
];
const SCROLL_STATES = ["top", "mid", "bottom"] as const;
const DATA_STATES = ["nochanges", "nothingtocategorise", "zero"] as const;

const money = (v: number) => `£${Math.abs(Math.round(v)).toLocaleString("en-GB")}`;
const periodLabel = (start: string, end: string) => {
  const f = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return `${f(start)} → ${f(end)}`;
};

export default function SpendRailClient() {
  const params = useSearchParams();
  const mode = params.get("mode") === "dark" ? "dark" : "light";
  const rawVariant = params.get("variant");
  const variant: Variant = rawVariant === "current" || rawVariant === "b" || rawVariant === "c" ? rawVariant : "a";
  const state = params.get("state") ?? "top";
  const ruleOn = params.get("rule") !== "off";
  const showNav = params.get("nav") === "1";
  const chrome = params.get("chrome") !== "0";
  const dataKey: RailFixtureKey = (DATA_STATES as readonly string[]).includes(state) ? (state as RailFixtureKey) : "base";
  const verdict = RAIL_VERDICTS[dataKey];

  useEffect(() => {
    const t = setTimeout(() => {
      document.documentElement.classList.toggle("dark", mode === "dark");
      document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", mode === "dark" ? "dark" : "only light");
    }, 0);
    return () => clearTimeout(t);
  }, [mode]);

  // Scroll states: the page really scrolls, this only parks it for a screenshot or a deep link.
  useEffect(() => {
    const target = (SCROLL_STATES as readonly string[]).includes(state) ? state : (DATA_STATES as readonly string[]).includes(state) ? "mid" : "top";
    if (target === "top") return;
    const t = window.setTimeout(() => {
      if (target === "bottom") window.scrollTo(0, document.documentElement.scrollHeight);
      else {
        const el = document.getElementById("spend-majority-section");
        if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 160);
      }
    }, 900);
    return () => window.clearTimeout(t);
  }, [state]);

  const [offset, setOffset] = useState(0);
  const recentPeriods: RecentPeriodOption[] = useMemo(() => {
    const list: RecentPeriodOption[] = [];
    let s = new Date(verdict.period.start);
    let e = new Date(verdict.period.end);
    for (let i = 0; i < 6; i++) {
      list.push({ offset: -i, label: periodLabel(s.toISOString(), e.toISOString()) });
      const [ps, pe] = prevPeriodWithConfig(s, DEFAULT_PAY_PERIOD_CONFIG);
      s = ps; e = pe;
    }
    return list;
  }, [verdict.period.start, verdict.period.end]);

  const latestPace = [...(verdict.pace_series ?? [])].reverse().find((p) => p.usual != null);
  const paceDifference = latestPace?.usual == null ? null : verdict.pills.spent - latestPace.usual;
  const showToCategorise = verdict.unresolved.total > 0 && (!ruleOn || unresolvedWorthAsking(verdict.unresolved.total));
  const spendingTotal = verdict.majority.reduce((s, r) => s + Math.max(0, r.spent), 0);
  const unresolvedCount = verdict.unresolved.payments_count;
  const destinations: SpendJourneyDestination[] = [
    ...(verdict.notables.length > 0 ? [{
      id: "spend-journey-changes", label: "Changes",
      value: paceDifference == null ? `${verdict.notables.length} to review` : <span className="font-mono tabular-nums">{money(paceDifference)}</span>,
      summary: paceDifference == null ? `${verdict.notables.length} to review` : `${money(paceDifference)} ${paceDifference > 0 ? "above" : "below"} usual`,
      needsLook: paceDifference != null && paceDifference > 0,
    }] : []),
    ...(showToCategorise ? [{
      id: "spend-unresolved", label: "To categorise",
      value: <>{unresolvedCount} payment{unresolvedCount === 1 ? "" : "s"} · <span className="font-mono tabular-nums">{money(verdict.unresolved.total)}</span></>,
      summary: `${unresolvedCount} payment${unresolvedCount === 1 ? "" : "s"}, ${money(verdict.unresolved.total)}`,
    }] : []),
    { id: "spend-majority-section", label: "Spending", value: <span className="font-mono tabular-nums">{money(spendingTotal)}</span>, summary: money(spendingTotal) },
    { id: "spend-journey-charts", label: "Charts", value: `${DEFAULT_WIDGETS.length} shown`, summary: `${DEFAULT_WIDGETS.length} shown` },
  ];

  const hdrProps = {
    verdict, periodLabel: periodLabel(verdict.period.start, verdict.period.end), isCurrentPeriod: offset === 0, canGoPrev: true,
    onPrev: () => setOffset((o) => o - 1), onNext: () => setOffset((o) => Math.min(0, o + 1)),
    onOpenSettings: () => {}, onOpenRules: () => {}, incomeTxns: PREVIEW_INCOME_TXNS, onTransactionClick: () => {},
    onOutTap: () => document.getElementById("spend-majority-section")?.scrollIntoView({ behavior: "smooth", block: "start" }),
    onMovedTap: () => document.getElementById("spend-money-moved")?.scrollIntoView({ behavior: "smooth", block: "center" }),
    onUnresolvedTap: () => document.getElementById("spend-unresolved")?.scrollIntoView({ behavior: "smooth", block: "center" }),
    recentPeriods, onSelectOffset: (o: number) => setOffset(o),
  };
  const href = (v: Variant) => `?variant=${v}&mode=${mode}&state=${state}${ruleOn ? "" : "&rule=off"}${showNav ? "&nav=1" : ""}`;

  return (
    <div className={mode === "dark" ? "dark" : ""}>
      <div className="min-h-dvh bg-[#f0f2f7] pb-40 dark:bg-[#0f172a]">
        <div className="mx-auto w-full max-w-6xl px-4 pt-5 sm:px-6 lg:px-8">
          {chrome && (
            <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-3 text-[12px] text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              <p className="font-semibold text-slate-900 dark:text-white">G264 · Spend navigation rail</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {VARIANTS.map((v) => (
                  <a key={v.value} href={href(v.value)} aria-current={v.value === variant ? "page" : undefined}
                    className={`inline-flex min-h-11 items-center rounded-full px-4 font-semibold ${v.value === variant ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200"}`}>{v.label}</a>
                ))}
                <a href={`?variant=${variant}&mode=${mode === "dark" ? "light" : "dark"}&state=${state}${showNav ? "&nav=1" : ""}`} className="inline-flex min-h-11 items-center rounded-full bg-slate-100 px-4 font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">{mode === "dark" ? "Light" : "Dark"}</a>
              </div>
              <p className="mt-2">Try the data states: <a className="font-semibold text-indigo-700 underline dark:text-indigo-300" href={`?variant=${variant}&mode=${mode}&state=nochanges`}>no changes</a>, <a className="font-semibold text-indigo-700 underline dark:text-indigo-300" href={`?variant=${variant}&mode=${mode}&state=nothingtocategorise`}>nothing to categorise</a>, <a className="font-semibold text-indigo-700 underline dark:text-indigo-300" href={`?variant=${variant}&mode=${mode}&state=zero`}>one 40p payment</a>.</p>
              <p className="mt-2">Preview note: the grid and timeline here are mirrored from SpendPage, and the rail is not yet wired into production. The rail sits 24px in from the screen edge to stay clear of the Android back gesture.</p>
              <p className="mt-2"><span className="font-semibold">Zero-value rule (all variants).</span> A payment that shows as £0 (under 50p) is not a to-do: the stop and its jump link are hidden, it stays inside Out. When a stop shows, one payment reads "1 payment still needs a category". Switch off with rule=off to see today.</p>
            </div>
          )}

          <SpendPeriodBar {...hdrProps} loading={false} />

          <div className="mt-7 grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(260px,0.72fr)_minmax(0,1.45fr)] lg:gap-14">
            <section aria-label="Pay period summary" className="min-w-0 lg:sticky lg:top-6">
              <SpendJourneySummary {...hdrProps} />
              <div className="mt-5 hidden lg:block"><SpendJourneyNav destinations={destinations} desktop /></div>
            </section>

            {variant === "current" ? (
              <div className="sticky top-0 z-30 -mx-4 min-w-0 bg-[#f0f2f7]/95 px-4 py-2 backdrop-blur-sm dark:bg-[#0f172a]/95 lg:hidden">
                <SpendJourneyNav destinations={destinations} />
              </div>
            ) : (
              <SpendJourneyRail variant={variant} destinations={destinations} />
            )}

            <main className="relative min-w-0 pl-8 before:absolute before:bottom-3 before:left-[11px] before:top-3 before:w-px before:bg-slate-300 dark:before:bg-slate-600 sm:pl-10 lg:col-start-2 lg:row-start-1">
              <section className="relative pb-10">
                <span className="absolute -left-8 top-1 flex size-6 items-center justify-center rounded-full bg-indigo-600 text-white ring-4 ring-[#f0f2f7] dark:ring-[#0f172a] sm:-left-10" aria-hidden="true"><WalletCards size={12} /></span>
                <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-600 dark:text-slate-400">Pay arrived · 25 Sept</p>
                <h2 className="mt-2 text-xl font-bold text-slate-950 dark:text-white"><span className="font-mono tabular-nums">{money(verdict.pills.income)}</span> recorded coming in</h2>
              </section>

              <SpendVerdictView
                verdict={verdict}
                colours={{}}
                onOpenCategory={() => {}}
                onIntent={() => Promise.resolve()}
                signals={PREVIEW_SIGNALS}
                sym="£"
                onAimChanged={() => {}}
                hideReading
                journey
                hideTrivialUnresolved={ruleOn}
                categoryInsights={OPEN_TIPS}
                unresolvedAccountName={PREVIEW_ACCOUNTS.find((a) => a.id === verdict.unresolved.largest?.account_id)?.name}
              />

              <section id="spend-journey-charts" tabIndex={-1} className="relative scroll-mt-24 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
                <span className="absolute -left-8 top-1 flex size-6 items-center justify-center rounded-full border border-indigo-300 bg-indigo-50 text-indigo-700 ring-4 ring-[#f0f2f7] dark:border-indigo-400/30 dark:bg-indigo-400/10 dark:text-indigo-300 dark:ring-[#0f172a] sm:-left-10" aria-hidden="true"><BarChart3 size={12} /></span>
                <h2 className="text-xl font-bold text-slate-950 dark:text-white">Your charts</h2>
                <p className="mt-1 max-w-2xl text-pretty text-[13px] leading-5 text-slate-600 dark:text-slate-400">Choose what appears here, drag the handle to reorder, or pin one chart to Home.</p>
                <SpendTrends
                  embedded
                  preview={{ widgets: DEFAULT_WIDGETS, pinnedWidget: DEFAULT_HOME_PINNED_WIDGET }}
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
          </div>
        </div>
        {showNav && <FixtureBottomNav active="Spend" />}
      </div>
    </div>
  );
}
