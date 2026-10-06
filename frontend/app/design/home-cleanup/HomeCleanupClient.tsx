"use client";

// G221 Home clean-up, approved C and folded in (Kevin 2026-10-06). Design skill:
// impeccable. Renders the PRODUCTION components through props (SafeToSpendCard,
// the HomeBrief cards, HomeInsightSpotlight, UpcomingBillsStrip, PinnedWidgetCard,
// FirstAccountCard, HomeEstateSection, TransactionRow) stacked with the shipped
// rhythm. The wrappers between sections are inline in HomePage.tsx, so this file
// mirrors only those wrapper classes (RHYTHM below), pinned against HomePage.tsx
// by `check:g221-home-cleanup`.
//
// Stand-ins, said plainly: the greeting row is a placeholder (HomeBrief needs
// the signed-in user), UpcomingBillsStrip self-fetches so a fetch stand-in
// answers only GET /cashflow with dated fixtures, and the Recent transactions
// header and card chrome is inline in HomePage so it is recreated here around
// the real TransactionRow.

import { useEffect, useLayoutEffect, useMemo, type CSSProperties } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ChevronRight } from "lucide-react";
import SafeToSpendCard from "@/components/SafeToSpendCard";
import FirstAccountCard from "@/components/FirstAccountCard";
import HomeInsightSpotlight from "@/components/HomeInsightSpotlight";
import UpcomingBillsStrip from "@/components/UpcomingBillsStrip";
import TransactionRow from "@/components/TransactionRow";
import { MoveCard, CelebrationCard, HomeBriefClearedRow } from "@/components/HomeBrief";
import { PinnedWidgetCard, DEFAULT_HOME_PINNED_WIDGET } from "@/components/SpendTrends";
import { useColours } from "@/components/ColourProvider";
import { getPayPeriodWithConfig, DEFAULT_PAY_PERIOD_CONFIG } from "@/lib/payPeriod";
import { FIGURE_DATA } from "../safe-to-spend-figure/fixtures";
import { SPEND_FROM_RAIL } from "../sts-accounts-route/fixtures";
import { REAL_MOVE_ITEM, REAL_CELEBRATION_ITEM } from "../g88-home-real/realFixtures";
import { CLEARED_ADVICE } from "../g134-home-inventory/fixtures";
import FixtureBottomNav from "../_components/FixtureBottomNav";
import { CASES, TIP, RECENT_TRANSACTIONS, cashflowFixture, pinnedTransactions, estateFor, type AccountsCase } from "./fixtures";
import HomeEstateSection from "@/components/HomeEstateSection";
import { topPicks } from "./fixtures";

type Mode = "light" | "dark";
const noop = () => {};
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
const router = { push: noop, back: noop, forward: noop, refresh: noop, replace: noop, prefetch: noop };

/**
 * The shipped rhythm: 12 inside a group of cards (space-y-3), 20 between section
 * groups (mt-5, page top pt-5), 8 under a section label (mb-2). Pinned cards
 * sit inside Your money.
 */
export const RHYTHM = { top: "pt-5", brief: "space-y-3", section: "mt-5", label: "mb-2", group: "space-y-3", tail: "pb-5" } as const;

const SUMMARY = "Approved C, folded in. One rhythm down the whole stack (12 between cards in a group, 20 between sections, 8 under a section label), pinned cards inside Your money, and the estate block keeps its rows with one footer row, All N accounts, instead of a Manage link and a +N more row. The Your accounts link under the hero stays.";

const ROUTE_NOTE: Record<AccountsCase, string> = {
  "1": "The hero link and See your account: two routes.",
  "4": "The hero link and All 4 accounts: two routes.",
  "20": "The hero link and All 20 accounts: two routes.",
  fresh: "Other ways to add accounts, on the connect card: one route.",
};

function Label({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <p className={`text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 ${className}`}>{children}</p>;
}

function Controls({ cases, mode, q }: { cases: AccountsCase; mode: Mode; q: (n: Partial<{ accounts: AccountsCase; mode: Mode }>) => string }) {
  const chip = (on: boolean) => `inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl px-3 text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 active:scale-95 ${on ? "bg-white text-slate-950" : "text-slate-300 hover:bg-white/10"}`;
  return (
    <nav aria-label="G221 preview controls" className="border-b border-white/10 bg-slate-950 px-2 py-1 text-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-1">
        {CASES.map((c) => (
          <a key={c.id} href={q({ accounts: c.id })} aria-label={c.label} aria-current={c.id === cases ? "page" : undefined} className={chip(c.id === cases)}>{c.id === "fresh" ? "Fresh" : c.id}</a>
        ))}
        <span className="mx-1 h-5 w-px bg-white/15" aria-hidden="true" />
        <a href={q({ mode: mode === "dark" ? "light" : "dark" })} className={chip(false)}>{mode === "dark" ? "Light" : "Dark"}</a>
      </div>
    </nav>
  );
}

export default function HomeCleanupClient() {
  const params = useSearchParams();
  const rawC = params.get("accounts");
  const cases: AccountsCase = rawC === "1" || rawC === "4" || rawC === "fresh" ? rawC : "20";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";
  const R = RHYTHM;
  const estate = estateFor(cases);
  const picks = topPicks(estate.accounts, estate.pinnedIds, estate.investment);
  const fresh = cases === "fresh";
  const { colours } = useColours();
  const pinnedTxns = useMemo(() => pinnedTransactions(), []);
  const [ps, pe] = getPayPeriodWithConfig(new Date(), DEFAULT_PAY_PERIOD_CONFIG);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", mode === "dark");
  }, [mode]);

  // Answers GET /cashflow for the self-fetching Coming up strip with dated
  // fixtures. Installed in a layout effect so it is live before the strip's own
  // passive fetch effect, scoped to this component's lifetime.
  useIsoLayoutEffect(() => {
    const native = window.fetch.bind(window);
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (/\/cashflow(?:[/?]|$)/.test(url)) {
        return new Response(JSON.stringify(cashflowFixture()), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return native(input, init);
    }) as typeof window.fetch;
    return () => { window.fetch = native; };
  }, []);

  const q = (n: Partial<{ accounts: AccountsCase; mode: Mode }>) => `?accounts=${n.accounts ?? cases}&mode=${n.mode ?? mode}`;
  const cardCommon = { maskAmounts: (t: string) => t, dismissible: true, onHomeDismiss: noop };
  const stsData = FIGURE_DATA["on-track"];
  const estateStyle = { "--rise-index": 3 } as CSSProperties;

  const pinned = (
    <PinnedWidgetCard
      id={DEFAULT_HOME_PINNED_WIDGET}
      transactions={pinnedTxns}
      periodStart={ps}
      periodEnd={pe}
      payPeriodConfig={DEFAULT_PAY_PERIOD_CONFIG}
      colours={colours}
      onOpen={noop}
    />
  );

  return (
    <div className={`${mode === "dark" ? "dark" : ""} min-h-dvh bg-[#f0f2f7] text-slate-900 dark:bg-[#0f172a] dark:text-slate-100`} style={{ colorScheme: mode }}>
      <style>{`html.nav-exempt aside[aria-label="Card balance activity"] { display: block !important; }`}</style>
      <Controls cases={cases} mode={mode} q={q} />

      <main id="content" className="mx-auto max-w-md pb-40">
        <header className="px-4 pt-5">
          <a href="/design" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-400">
            <ArrowLeft size={16} aria-hidden="true" />
            Design rounds
          </a>
          <h1 className="mt-2 text-balance text-[22px] font-bold tracking-[-.02em] text-slate-950 dark:text-white">Home clean-up: approved C</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">{SUMMARY}</p>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400" data-route-note>
            <strong className="font-semibold text-slate-800 dark:text-slate-200">Route to all accounts, {CASES.find((c) => c.id === cases)!.label.toLowerCase()}:</strong> {ROUTE_NOTE[cases]}
          </p>
          <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
            Stand-ins: the greeting row, and Coming up reads dated fixture bills.
          </p>
        </header>

        <div className={R.top} data-g221-stack>
          {/* Greeting and brief */}
          <div className={`px-4 ${R.brief}`}>
            <div className="flex min-h-11 items-center" data-stand-in="greeting">
              <p className="text-lg font-bold text-slate-900 dark:text-white">Good morning, Kevin</p>
            </div>
            {!fresh && <MoveCard item={REAL_MOVE_ITEM} hideNetWorth={false} previewMode {...cardCommon} />}
            {!fresh && <CelebrationCard item={REAL_CELEBRATION_ITEM} router={router as never} {...cardCommon} />}
          </div>

          {fresh ? (
            <div className={`px-4 ${R.section}`}>
              <FirstAccountCard canConnect onConnect={noop} onUploadStatement={noop} onOtherWays={noop} />
            </div>
          ) : (
            <>
              {/* Safe to Spend hero with its extras */}
              <div className={`px-4 ${R.section}`}>
                <SafeToSpendCard data={stsData} loading={false} onRetry={noop} spendFrom={SPEND_FROM_RAIL} previewBalancesVisible />
                <HomeBriefClearedRow cleared={CLEARED_ADVICE} router={router as never} />
              </div>

              {/* Your money */}
              <div className={R.section}>
                <div className="px-4"><Label className={R.label}>Your money</Label></div>
                <div className={R.group}>
                  <UpcomingBillsStrip />
                  <HomeInsightSpotlight previewInsight={TIP} />
                  <div className="space-y-3 px-4">{pinned}</div>
                </div>
              </div>


              {/* Estate */}
              <HomeEstateSection
                className={`px-4 ${R.section}`}
                style={estateStyle}
                loading={false}
                accountCount={estate.accounts.length}
                topPickAccounts={picks.top}
                topPickInvestment={estate.investment}
                totalAccountCount={estate.total}
                pinnedIds={estate.pinnedIds}
                onOpenAccount={noop}
                onOpenInvestments={noop}
                onViewAll={noop}
                emptyState={null}
              />
            </>
          )}

          {/* Recent transactions */}
          <div className={`px-4 ${R.section} ${R.tail}`}>
            <div className={`flex items-center justify-between ${R.label}`}>
              <Label>Recent Transactions</Label>
              <span className="flex items-center gap-1 text-xs font-semibold text-indigo-500 dark:text-indigo-400">See all <ChevronRight size={13} aria-hidden="true" /></span>
            </div>
            <div className="glass-card rounded-2xl overflow-hidden">
              <div className="divide-y divide-slate-50 dark:divide-slate-700">
                {RECENT_TRANSACTIONS.slice(0, 3).map((tx) => (
                  <TransactionRow key={tx.id} transaction={tx} onClick={noop} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
      <FixtureBottomNav active="Home" />
    </div>
  );
}
