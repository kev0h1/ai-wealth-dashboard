"use client";

// G282 (Kevin 2026-10-17): one account display name everywhere, and one spacing
// rhythm on Home and Accounts. Design skill: impeccable (audit, then fix, no
// variant round). Renders PRODUCTION components through props: SafeToSpendCard,
// the HomeBrief cards and cleared row, HomeInsightSpotlight, UpcomingBillsStrip,
// PinnedWidgetCard, HomeEstateSection and TransactionRow for Home; AccountsHeader,
// ReconnectStrip, AccountsEstateControls, AccountGroupCard and AccountLedgerRow
// for Accounts. HomePage and AccountsPage fetch their own data, so they are NOT
// rendered whole. The wrapper classes between sections live inline in those two
// pages, so RHYTHM below mirrors them and `check:g282-account-names` pins it
// against the page source. Stand-ins, said plainly: the Home greeting row, the
// Accounts Offline block (inline in the page), and a fetch stand-in that answers
// only GET /cashflow for the self-fetching Coming up strip.

import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ChevronRight } from "lucide-react";
import SafeToSpendCard from "@/components/SafeToSpendCard";
import HomeInsightSpotlight from "@/components/HomeInsightSpotlight";
import UpcomingBillsStrip from "@/components/UpcomingBillsStrip";
import TransactionRow from "@/components/TransactionRow";
import HomeEstateSection from "@/components/HomeEstateSection";
import { MoveCard, CelebrationCard, HomeBriefClearedRow } from "@/components/HomeBrief";
import { PinnedWidgetCard, DEFAULT_HOME_PINNED_WIDGET } from "@/components/SpendTrends";
import AccountsHeader from "@/components/AccountsHeader";
import ReconnectStrip from "@/components/ReconnectStrip";
import AccountsEstateControls from "@/components/AccountsEstateControls";
import AccountGroupCard from "@/components/AccountGroupCard";
import AccountLedgerRow from "@/components/AccountLedgerRow";
import { useColours } from "@/components/ColourProvider";
import { buildEstate, filterEstate, type EstateLens } from "@/lib/accountsEstate";
import { getPayPeriodWithConfig, DEFAULT_PAY_PERIOD_CONFIG } from "@/lib/payPeriod";
import { FIGURE_DATA } from "../safe-to-spend-figure/fixtures";
import { SPEND_FROM_RAIL } from "../sts-accounts-route/fixtures";
import { REAL_MOVE_ITEM, REAL_CELEBRATION_ITEM } from "../g88-home-real/realFixtures";
import { CLEARED_ADVICE, RECENT_TRANSACTIONS } from "../g134-home-inventory/fixtures";
import { TIP, cashflowFixture, pinnedTransactions, topPicks } from "../home-cleanup/fixtures";
import FixtureBottomNav from "../_components/FixtureBottomNav";
import { ACCOUNTS, INVESTMENT, HOME_PINNED_IDS, RECONNECT_PROVIDERS, OFFLINE } from "./fixtures";

type Mode = "light" | "dark";
type Surface = "home" | "accounts";
const noop = () => {};
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
const router = { push: noop, back: noop, forward: noop, refresh: noop, replace: noop, prefetch: noop };

/**
 * Page Rhythm (DESIGN.md): 12 between cards in a group (space-y-3), 20 between
 * section groups (mt-5, page top pt-5), 8 under a section label (mb-2).
 * Home and Accounts both use it. `accountsFirst` is the 12 between the Net worth
 * card and the first card or control under it.
 */
export const RHYTHM = { top: "pt-5", brief: "space-y-3", section: "mt-5", label: "mb-2", group: "space-y-3", tail: "pb-5", accountsFirst: "pt-3" } as const;

function Label({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <p className={`text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 ${className}`}>{children}</p>;
}

function Controls({ surface, mode, q }: { surface: Surface; mode: Mode; q: (n: Partial<{ surface: Surface; mode: Mode }>) => string }) {
  const chip = (on: boolean) => `inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl px-3 text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 active:scale-95 ${on ? "bg-white text-slate-950" : "text-slate-300 hover:bg-white/10"}`;
  return (
    <nav aria-label="G282 preview controls" className="border-b border-white/10 bg-slate-950 px-2 py-1 text-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-1">
        <a href={q({ surface: "home" })} aria-current={surface === "home" ? "page" : undefined} className={chip(surface === "home")}>Home</a>
        <a href={q({ surface: "accounts" })} aria-current={surface === "accounts" ? "page" : undefined} className={chip(surface === "accounts")}>Accounts</a>
        <span className="mx-1 h-5 w-px bg-white/15" aria-hidden="true" />
        <a href={q({ mode: mode === "dark" ? "light" : "dark" })} className={chip(false)}>{mode === "dark" ? "Light" : "Dark"}</a>
      </div>
    </nav>
  );
}

function HomeSurface() {
  const R = RHYTHM;
  const picks = topPicks(ACCOUNTS, HOME_PINNED_IDS, INVESTMENT);
  const { colours } = useColours();
  const pinnedTxns = useMemo(() => pinnedTransactions(), []);
  const [ps, pe] = getPayPeriodWithConfig(new Date(), DEFAULT_PAY_PERIOD_CONFIG);
  const cardCommon = { maskAmounts: (t: string) => t, dismissible: true, onHomeDismiss: noop };
  return (
    <div className={R.top} data-g282-home-stack>
      <div className="px-4" data-g282-brief>
        <div className="flex items-center gap-2 mb-3" data-stand-in="greeting">
          <span className="flex size-11 shrink-0 items-center justify-center" aria-hidden="true"><span className="flex size-9 items-center justify-center rounded-full bg-indigo-500/15 text-[13px] font-semibold text-indigo-600 dark:text-indigo-400">KM</span></span>
          <h1 className="min-w-0 flex-1 truncate text-[28px] font-bold leading-tight tracking-tight text-slate-900 dark:text-slate-100">Good morning, Kevin</h1>
        </div>
        <div className={R.brief}>
          <MoveCard item={REAL_MOVE_ITEM} hideNetWorth={false} previewMode {...cardCommon} />
          <CelebrationCard item={REAL_CELEBRATION_ITEM} router={router as never} {...cardCommon} />
        </div>
      </div>
      <div className={`px-4 ${R.section}`}>
        <SafeToSpendCard data={FIGURE_DATA["on-track"]} loading={false} onRetry={noop} spendFrom={SPEND_FROM_RAIL} previewBalancesVisible />
        <HomeBriefClearedRow cleared={CLEARED_ADVICE} router={router as never} />
      </div>
      <div className={R.section}>
        <div className="px-4"><Label className={R.label}>Your money</Label></div>
        <div className={R.group}>
          <UpcomingBillsStrip />
          <HomeInsightSpotlight previewInsight={TIP} />
          <div className="space-y-3 px-4">
            <PinnedWidgetCard id={DEFAULT_HOME_PINNED_WIDGET} transactions={pinnedTxns} periodStart={ps} periodEnd={pe} payPeriodConfig={DEFAULT_PAY_PERIOD_CONFIG} colours={colours} onOpen={noop} />
          </div>
        </div>
      </div>
      <HomeEstateSection
        className={`px-4 ${R.section}`}
        loading={false}
        accountCount={ACCOUNTS.length}
        topPickAccounts={picks.top}
        topPickInvestment={INVESTMENT}
        totalAccountCount={ACCOUNTS.length + 1}
        pinnedIds={HOME_PINNED_IDS}
        onOpenAccount={noop}
        onOpenInvestments={noop}
        onViewAll={noop}
        emptyState={null}
      />
      <div className={`px-4 ${R.section} ${R.tail}`}>
        <div className={`flex items-center justify-between ${R.label}`}>
          <Label>Recent Transactions</Label>
          <span className="flex items-center gap-1 text-xs font-semibold text-indigo-500 dark:text-indigo-400">See all <ChevronRight size={13} aria-hidden="true" /></span>
        </div>
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="divide-y divide-slate-50 dark:divide-slate-700">
            {RECENT_TRANSACTIONS.slice(0, 3).map((tx) => <TransactionRow key={tx.id} transaction={tx} onClick={noop} />)}
          </div>
        </div>
      </div>
    </div>
  );
}

function AccountsSurface() {
  const R = RHYTHM;
  const [query, setQuery] = useState("");
  const [lens, setLens] = useState<EstateLens>("All");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const estate = useMemo(() => buildEstate(ACCOUNTS, [INVESTMENT], []), []);
  const filtering = query.trim() !== "" || lens !== "All";
  const filtered = useMemo(() => filterEstate(estate.rows, { query, lens }), [estate, query, lens]);
  const netWorth = { value: estate.netWorth, accountCount: estate.rows.length + OFFLINE.length };
  return (
    <div data-g282-accounts-stack>
      <div className={`px-4 ${R.top}`}>
        <AccountsHeader netWorth={netWorth} hidden={false} showChip={false} onShow={noop} onAdd={noop} updated="Updated 8 min ago" />
      </div>
      <div className={`px-4 ${R.accountsFirst} ${R.group}`} data-g282-accounts-list>
        <ReconnectStrip providers={RECONNECT_PROVIDERS} onReconnect={noop} />
        <AccountsEstateControls query={query} onQuery={setQuery} lens={lens} onLens={setLens} />
        {filtering ? (
          <div>
            <p className="px-1 mb-2 text-xs font-medium text-slate-400 dark:text-slate-500">{filtered.length} result{filtered.length === 1 ? "" : "s"}</p>
            <div className="glass-card rounded-2xl overflow-hidden">
              {filtered.map((row, i) => (
                <div key={row.id} className={i > 0 ? "border-t border-slate-100 dark:border-white/5" : ""}><AccountLedgerRow row={row} onClick={noop} hideAmount={false} /></div>
              ))}
            </div>
          </div>
        ) : estate.groups.map((group) => (
          <AccountGroupCard key={group.label} label={group.label} count={group.count} subtotal={group.subtotal} hidden={false} collapsed={collapsed[group.label] ?? false} onToggle={() => setCollapsed((c) => ({ ...c, [group.label]: !c[group.label] }))}>
            {group.rows.map((row) => <AccountLedgerRow key={row.id} row={row} onClick={noop} hideAmount={false} />)}
          </AccountGroupCard>
        ))}
      </div>
      {!filtering && (
        <div className={`px-4 ${R.section} ${R.tail}`} data-stand-in="offline">
          <div className={R.label}>
            <h2 className="text-sm font-bold text-slate-700 dark:text-slate-200">Offline accounts</h2>
            <p className="text-xs text-slate-400 dark:text-slate-500">Track balances we can&apos;t connect to: pots, cash, store cards. Tap to add transactions &amp; rules.</p>
          </div>
          <div className="space-y-3">
            {OFFLINE.map((acc) => (
              <div key={acc.id} className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{acc.name}</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">{acc.label} · Offline</p>
                </div>
                <span className="text-sm font-bold font-mono tabular-nums text-slate-800 dark:text-slate-100">£{acc.balance}</span>
                <ChevronRight size={16} className="text-slate-400 dark:text-slate-500 flex-shrink-0" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function HomeAccountsRhythmClient() {
  const params = useSearchParams();
  const surface: Surface = (params.get("surface") ?? params.get("state")) === "accounts" ? "accounts" : "home";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";

  useEffect(() => {
    const root = document.documentElement;
    const previous = root.classList.contains("dark");
    const apply = () => root.classList.toggle("dark", mode === "dark");
    apply();
    const observer = new MutationObserver(() => { if (root.classList.contains("dark") !== (mode === "dark")) apply(); });
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => { observer.disconnect(); root.classList.toggle("dark", previous); };
  }, [mode]);

  // Answers GET /cashflow for the self-fetching Coming up strip with dated fixtures.
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

  const q = (n: Partial<{ surface: Surface; mode: Mode }>) => `?surface=${n.surface ?? surface}&mode=${n.mode ?? mode}`;
  return (
    <div className={`${mode === "dark" ? "dark" : ""} min-h-dvh bg-[#f0f2f7] text-slate-900 dark:bg-[#0f172a] dark:text-slate-100`} style={{ colorScheme: mode }}>
      <style>{`html.nav-exempt aside[aria-label="Card balance activity"] { display: block !important; }`}</style>
      <Controls surface={surface} mode={mode} q={q} />
      <main id="content" className="mx-auto max-w-md pb-40">
        <header className="px-4 pt-3">
          <a href="/design" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-400">
            <ArrowLeft size={16} aria-hidden="true" />
            Design rounds
          </a>
          <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
            G282 · names and rhythm. Production sections with fixture data, not the whole page. Stand-ins: the Home greeting row and the Accounts Offline block.
          </p>
        </header>
        {surface === "home" ? <HomeSurface /> : <AccountsSurface />}
      </main>
      <FixtureBottomNav active="Home" />
    </div>
  );
}
