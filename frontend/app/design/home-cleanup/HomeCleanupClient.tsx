"use client";

// G221 Home clean-up (Kevin 2026-10-06). Design skill: impeccable. Renders the
// PRODUCTION components through props (SafeToSpendCard, the HomeBrief cards,
// HomeInsightSpotlight, UpcomingBillsStrip, PinnedWidgetCard, FirstAccountCard,
// HomeEstateSection, AccountLedgerRow, TransactionRow), stacked with the gaps
// of one rhythm. The wrappers between sections are inline in HomePage.tsx, so
// this file recreates only those wrappers: "today" copies HomePage's current
// classes exactly, the other three use the proposed rhythm.
//
// Stand-ins, said plainly: the greeting row is a placeholder (HomeBrief needs
// the signed-in user), UpcomingBillsStrip self-fetches so a fetch stand-in
// answers only GET /cashflow with dated fixtures, and the Recent transactions
// header and card chrome is inline in HomePage so it is recreated here around
// the real TransactionRow.

import { useEffect, useLayoutEffect, type CSSProperties } from "react";
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
import { CASES, TIP, RECENT_TRANSACTIONS, cashflowFixture, estateFor, type AccountsCase } from "./fixtures";
import { EstateRegion, type Variant } from "./EstateVariants";

type Mode = "light" | "dark";
const noop = () => {};
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
const router = { push: noop, back: noop, forward: noop, refresh: noop, replace: noop, prefetch: noop };

/**
 * Every wrapper class between the Home sections. `today` is HomePage.tsx as it
 * stands (24 / 32 / 12 / 8 mixed). `proposed` is the one rhythm: 12 inside a
 * group of cards (md, space-y-3 / mt-3), 20 between section groups (xl, mt-5,
 * page top pt-5), 8 under a section label (sm, mb-2). Pinned cards join Your
 * money instead of starting a group of their own.
 */
const RHYTHM = {
  today: { top: "pt-6", brief: "space-y-2", hero: "mt-8", money: "mt-8", label: "mb-3", group: "space-y-3", pinnedOwnGroup: true, pinned: "mt-8 space-y-3", estate: "mt-8", recent: "mt-8", recentHead: "mb-3", tail: "mb-4" },
  proposed: { top: "pt-5", brief: "space-y-3", hero: "mt-5", money: "mt-5", label: "mb-2", group: "space-y-3", pinnedOwnGroup: false, pinned: "space-y-3", estate: "mt-5", recent: "mt-5", recentHead: "mb-2", tail: "pb-5" },
} as const;

const VARIANTS: { id: Variant; label: string; name: string; summary: string }[] = [
  { id: "today", label: "Today", name: "Today", summary: "Home as it stands on UAT: gaps of 8, 12, 24 and 32 pixels with no rule, a Manage link and a +N more row in the estate block, and the hero's Your accounts link on top." },
  { id: "a", label: "A", name: "A · Hero link only", summary: "The estate block is removed. The Your accounts link under the Safe to Spend hero is the one route to every account, and Recent transactions moves up." },
  { id: "b", label: "B", name: "B · Pinned accounts", summary: "The block slims to the accounts you pinned, four rows at most, with a plain label, no Manage and no more-accounts row. It hides when nothing is pinned. The hero link is the route to everything." },
  { id: "c", label: "C", name: "C · One footer row", summary: "The block stays, with one footer row, All N accounts, in place of both Manage and +N more. The hero link remains, so C keeps two doors to the same list." },
];

const ROUTE_NOTE: Record<Variant, Record<AccountsCase, string>> = {
  today: {
    "1": "Hero link and Manage: two routes.",
    "4": "Hero link and Manage: two routes.",
    "20": "Hero link, Manage and +16 more accounts: three routes.",
    fresh: "Other ways to add accounts, on the connect card: one route.",
  },
  a: {
    "1": "The hero link: one route.",
    "4": "The hero link: one route.",
    "20": "The hero link: one route.",
    fresh: "Other ways to add accounts, on the connect card: one route.",
  },
  b: {
    "1": "The hero link: one route (the account row opens that account only).",
    "4": "The hero link: one route (pinned rows open their own account).",
    "20": "The hero link: one route (pinned rows open their own account).",
    fresh: "Other ways to add accounts, on the connect card: one route.",
  },
  c: {
    "1": "The hero link and See your account: two routes.",
    "4": "The hero link and All 4 accounts: two routes.",
    "20": "The hero link and All 20 accounts: two routes.",
    fresh: "Other ways to add accounts, on the connect card: one route.",
  },
};

function Label({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <p className={`text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 ${className}`}>{children}</p>;
}

function Controls({ variant, cases, mode, q }: { variant: Variant; cases: AccountsCase; mode: Mode; q: (n: Partial<{ variant: Variant; accounts: AccountsCase; mode: Mode }>) => string }) {
  const chip = (on: boolean) => `inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl px-3 text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 active:scale-95 ${on ? "bg-white text-slate-950" : "text-slate-300 hover:bg-white/10"}`;
  return (
    <nav aria-label="G221 preview controls" className="border-b border-white/10 bg-slate-950 px-2 py-1 text-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-1">
        {VARIANTS.map((v) => (
          <a key={v.id} href={q({ variant: v.id })} aria-current={v.id === variant ? "page" : undefined} aria-label={v.name} className={chip(v.id === variant)}>{v.label}</a>
        ))}
        <span className="mx-1 h-5 w-px bg-white/15" aria-hidden="true" />
        <a href={q({ mode: mode === "dark" ? "light" : "dark" })} className={chip(false)}>{mode === "dark" ? "Light" : "Dark"}</a>
      </div>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-1">
        {CASES.map((c) => (
          <a key={c.id} href={q({ accounts: c.id })} aria-label={c.label} aria-current={c.id === cases ? "page" : undefined} className={chip(c.id === cases)}>{c.id === "fresh" ? "Fresh" : c.id}</a>
        ))}
      </div>
    </nav>
  );
}

export default function HomeCleanupClient() {
  const params = useSearchParams();
  const rawV = params.get("variant");
  const variant: Variant = rawV === "a" || rawV === "b" || rawV === "c" ? rawV : "today";
  const rawC = params.get("accounts");
  const cases: AccountsCase = rawC === "1" || rawC === "4" || rawC === "fresh" ? rawC : "20";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";
  const R = RHYTHM[variant === "today" ? "today" : "proposed"];
  const estate = estateFor(cases);
  const fresh = cases === "fresh";
  const { colours } = useColours();
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

  const q = (n: Partial<{ variant: Variant; accounts: AccountsCase; mode: Mode }>) =>
    `?variant=${n.variant ?? variant}&accounts=${n.accounts ?? cases}&mode=${n.mode ?? mode}`;
  const meta = VARIANTS.find((v) => v.id === variant)!;
  const cardCommon = { maskAmounts: (t: string) => t, dismissible: true, onHomeDismiss: noop };
  const stsData = FIGURE_DATA["on-track"];
  const estateStyle = { "--rise-index": 3 } as CSSProperties;

  const pinned = (
    <PinnedWidgetCard
      id={DEFAULT_HOME_PINNED_WIDGET}
      transactions={RECENT_TRANSACTIONS}
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
      <Controls variant={variant} cases={cases} mode={mode} q={q} />

      <main id="content" className="mx-auto max-w-md pb-40">
        <header className="px-4 pt-5">
          <a href="/design" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-400">
            <ArrowLeft size={16} aria-hidden="true" />
            Design rounds
          </a>
          <h1 className="mt-2 text-balance text-[22px] font-bold tracking-[-.02em] text-slate-950 dark:text-white">Home clean-up: {meta.name}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">{meta.summary}</p>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400" data-route-note>
            <strong className="font-semibold text-slate-800 dark:text-slate-200">Route to all accounts, {CASES.find((c) => c.id === cases)!.label.toLowerCase()}:</strong> {ROUTE_NOTE[variant][cases]}
          </p>
          <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
            {variant === "today"
              ? "Gaps here: 24 top, 8 brief cards, 32 between every section, 12 inside groups and under labels."
              : "One rhythm: 12 between cards in a group, 20 between sections, 8 under a section label. Pinned cards sit in Your money."}
            {" "}Stand-ins: the greeting row, and Coming up reads dated fixture bills.
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
            <div className={`px-4 ${R.hero}`}>
              <FirstAccountCard canConnect onConnect={noop} onUploadStatement={noop} onOtherWays={noop} />
            </div>
          ) : (
            <>
              {/* Safe to Spend hero with its extras */}
              <div className={`px-4 ${R.hero}`}>
                <SafeToSpendCard data={stsData} loading={false} onRetry={noop} spendFrom={SPEND_FROM_RAIL} previewBalancesVisible />
                <HomeBriefClearedRow cleared={CLEARED_ADVICE} router={router as never} />
              </div>

              {/* Your money */}
              <div className={R.money}>
                <div className="px-4"><Label className={R.label}>Your money</Label></div>
                <div className={R.group}>
                  <UpcomingBillsStrip />
                  <HomeInsightSpotlight previewInsight={TIP} />
                  {!R.pinnedOwnGroup && <div className={`px-4 ${R.pinned}`}>{pinned}</div>}
                </div>
              </div>

              {R.pinnedOwnGroup && <div className={`px-4 ${R.pinned}`}>{pinned}</div>}

              {/* Estate region */}
              <EstateRegion
                variant={variant}
                estate={estate}
                className={`px-4 ${R.estate}`}
                labelGap={R.label}
                style={estateStyle}
              />
            </>
          )}

          {/* Recent transactions */}
          <div className={`px-4 ${R.recent} ${R.tail}`}>
            <div className={`flex items-center justify-between ${R.recentHead}`}>
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
