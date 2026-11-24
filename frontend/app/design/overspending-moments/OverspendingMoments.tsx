"use client";

// TEMPORARY PREVIEW — G494. Every figure is fictional. The page composes
// presentational production surfaces but never reads or writes customer data.

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import MoneyText from "@/components/MoneyText";
import HomeBrief from "@/components/HomeBrief";
import SafeToSpendCard from "@/components/SafeToSpendCard";
import UpcomingBillsStrip from "@/components/UpcomingBillsStrip";
import HomeInsightSpotlight from "@/components/HomeInsightSpotlight";
import HomeEstateSection from "@/components/HomeEstateSection";
import { TransactionRowContent } from "@/components/TransactionRow";
import BottomNavRail from "@/components/navigation/BottomNavRail";
import { SpendHeroSkeleton, SpendPeriodBar } from "@/components/SpendHeader";
import SpendPaceHero from "@/components/SpendPaceHero";
import SpendVerdictView from "@/components/SpendVerdictView";
import { BalancesHiddenContext } from "@/lib/balancesHidden";
import {
  cachedEndpoint,
  ENDPOINT,
  invalidateEndpoint,
} from "@/lib/endpointCache";
import type {
  Account,
  CashflowData,
  CompanionItem,
  SafeToSpend,
  SpendVerdict,
  Transaction,
} from "@/lib/api";
import {
  CASES,
  fixture,
  fundingSentence,
  money,
  type Case,
  type Fixture,
  type Moment,
  type Variant,
} from "./fixtures";

type Snapshot = "early" | "crossed" | "closed";
type View = "current" | "proposed";
type Config = {
  variant: Variant;
  moment: Moment;
  state: Case;
  snapshot: Snapshot;
  dark: boolean;
  hidden: boolean;
  drivers: boolean;
  view: View;
};
const CASE_IDS = CASES.map((item) => item.id);
const PERIOD_KEY = "2026-10-30_2026-11-26";
const PERIOD_LABEL = "30 Oct to 26 Nov";

const SAFE: SafeToSpend = {
  status: "ok",
  safe_to_spend: 236,
  next_payday: "2026-11-27",
  days_until_payday: 7,
  bills_total: 842,
  income_before_payday: 0,
  buffer: 180,
  state: "comfortable",
  estimated: true,
  spendable_now: 1258,
  last_synced: "2026-11-20T09:24:00Z",
};
const ACCOUNTS: Account[] = [
  {
    id: "g494-current",
    name: "Everyday current account",
    type: "current",
    balance: 1258,
    currency: "GBP",
    provider: "Barclays",
    status: "active",
  },
];
const CASHFLOW: CashflowData = {
  weekly_projection: [],
  upcoming_bills: [
    {
      name: "Rent",
      amount: 842,
      expected_date: "2026-11-24",
      days_away: 4,
      kind: "commitment",
    },
  ],
  upcoming_income: [],
  avg_daily_spend: 55,
  available_balance: 1258,
  next_payday: "2026-11-27",
  payday_source: "period",
  income_suggestion: null,
};

function incomeTransactions(data: Fixture): Transaction[] {
  return [
    {
      id: "g494-income",
      account_id: "g494-current",
      date: "2026-10-30",
      amount: data.income,
      currency: "GBP",
      description: "Fictional salary",
      merchant_name: "Fictional employer",
      category: "Income",
      transaction_type: "credit",
    },
  ];
}

function recentTransactions(data: Fixture): Transaction[] {
  return data.drivers
    .flatMap((driver) => driver.payments)
    .slice(0, 2)
    .map((payment, index) => ({
      id: `g494-${index}`,
      account_id: "g494-current",
      date: payment.date,
      amount: payment.amount,
      currency: "GBP",
      description: payment.name,
      merchant_name: payment.name,
      category: data.drivers[index]?.category ?? "Travel",
      transaction_type: "debit",
    }));
}

const isCase = (value: string | null): value is Case =>
  CASE_IDS.includes(value as Case);
const isSnapshot = (value: string | null): value is Snapshot =>
  value === "early" || value === "crossed" || value === "closed";
function link(config: Config, changes: Partial<Config> = {}) {
  const next = { ...config, ...changes };
  const query = new URLSearchParams({
    variant: next.variant,
    moment: next.moment,
    state: next.state,
    snapshot: next.snapshot,
    mode: next.dark ? "dark" : "light",
    view: next.view,
  });
  if (next.hidden) query.set("hidden", "1");
  if (next.drivers) query.set("drivers", "1");
  return `?${query.toString()}`;
}

function makeVerdict(data: Fixture, snapshot: Snapshot): SpendVerdict {
  const out = snapshot === "early" ? data.earlyOut : data.out;
  const closed = snapshot === "closed";
  const crossed = out > data.income;
  const onCourse = snapshot === "early" && data.fresh && data.signal;
  return {
    state: snapshot === "early" ? "early" : "normal",
    reading:
      snapshot === "early"
        ? `Out is ${money(data.income - out)} below In so far. At this pace, it may pass In by ${money(data.projectedGap)}.`
        : crossed
          ? `Out is ${money(out - data.income)} above In, mostly on ${data.drivers.map((item) => item.name).join(" and ")}.`
          : "Out remains within income.",
    notables: data.drivers.map((item) => ({
      category: item.category,
      spent: item.amount,
      multiple: item.usual > 0 ? item.amount / item.usual : 1,
      excess: Math.max(0, item.amount - item.usual),
      payments_count: item.payments.length,
      cause: item.payments.map((payment) => ({
        name: payment.name,
        amount: payment.amount,
      })),
      pace: { spent: item.amount, usual_by_now: item.usual },
    })),
    quiet_flags: [],
    majority: [
      {
        category: "Bills",
        spent: Math.max(
          0,
          out - data.drivers.reduce((sum, item) => sum + item.amount, 0),
        ),
        payments_count: 4,
        has_baseline: true,
        elevated: false,
      },
    ],
    unresolved: {
      total: 0,
      payments_count: 0,
      ask_worthy: false,
      weight: "routine",
      largest: null,
    },
    moved: [
      {
        kind: "own_accounts",
        label: "Between your current accounts",
        amount: 480,
        payments_count: 2,
        categories: ["Transfer"],
      },
    ],
    pills: { spent: out, income: data.income, net: data.income - out },
    period: {
      start: "2026-10-30",
      end: "2026-11-26",
      days_elapsed: closed ? 28 : snapshot === "early" ? 22 : 25,
      days_left: closed ? 0 : snapshot === "early" ? 6 : 3,
      offset: 0,
      closed,
    },
    moved_total: 480,
    overspending:
      data.funding.unknown > 0 && crossed
        ? undefined
        : {
            period: {
              start: "2026-10-30",
              end: "2026-11-26",
              length_days: 28,
              days_elapsed: closed ? 28 : snapshot === "early" ? 22 : 25,
            },
            out,
            in: data.income,
            gap: Math.max(0, out - data.income),
            crossed,
            crossed_by: Math.max(0, out - data.income),
            crossed_on: crossed ? "2026-11-23" : null,
            from_savings: crossed ? data.funding.savings : 0,
            funded_by: crossed
              ? {
                  savings: data.funding.savings,
                  cards: data.funding.cards,
                  current_account: data.funding.current,
                }
              : { savings: 0, cards: 0, current_account: 0 },
            savings_covered: crossed && data.funding.savings > 0,
            on_course: {
              available: onCourse,
              projected_out: onCourse ? data.income + data.projectedGap : null,
              projected_in: onCourse ? data.income : null,
              predicted_income: 0,
              on_course_to_cross: onCourse,
              projected_gap: onCourse ? data.projectedGap : null,
              drivers: onCourse
                ? data.drivers.map((item) => ({
                    category: item.category,
                    spent: item.amount,
                    usual_by_now: item.usual,
                    excess: Math.max(0, item.amount - item.usual),
                  }))
                : [],
            },
            trend: {
              periods_considered: data.trend?.periods ?? 0,
              dipped_count: data.trend?.covered ?? 0,
              consecutive: 0,
              periods: [],
            },
            acknowledged: false,
          },
  };
}

function useAcknowledgement(
  config: Config,
  enabled: boolean,
  eligible: boolean,
) {
  const key = `g494:one-off:${config.variant}:${PERIOD_KEY}`;
  const seenKey = `g494:seen:${config.variant}:${PERIOD_KEY}`;
  const [ready, setReady] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [seen, setSeen] = useState(false);
  const readKey = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled) {
      setReady(true);
      return;
    }
    if (readKey.current === key) return;
    readKey.current = key;
    try {
      setAcknowledged(sessionStorage.getItem(key) === "1");
      setSeen(sessionStorage.getItem(seenKey) === "1");
    } catch {
      // Storage can be unavailable in private browsing. The preview remains
      // correct for this mounted comparison using its local state.
    }
    setReady(true);
  }, [enabled, key, seenKey]);
  useEffect(() => {
    if (eligible && ready && !acknowledged && !seen) {
      try {
        sessionStorage.setItem(seenKey, "1");
      } catch {
        /* local fallback */
      }
    }
  }, [acknowledged, eligible, ready, seen, seenKey]);
  return {
    ready,
    acknowledged,
    seen,
    acknowledge: () => {
      try {
        sessionStorage.setItem(key, "1");
      } catch {
        /* local fallback */
      }
      setAcknowledged(true);
    },
    replay: () => {
      try {
        sessionStorage.removeItem(key);
        sessionStorage.removeItem(seenKey);
      } catch {
        /* local fallback */
      }
      setAcknowledged(false);
      setSeen(false);
    },
  };
}

const control =
  "inline-flex min-h-11 items-center rounded-xl px-3 text-xs font-semibold transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-slate-800";

function Controls({
  config,
  view,
  setView,
  replay,
}: {
  config: Config;
  view: View;
  setView: (view: View) => void;
  replay: () => void;
}) {
  return (
    <header className="mx-auto max-w-7xl px-4 pt-4 sm:px-6 lg:px-8">
      <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <a
          href="/design"
          className={`${control} text-slate-700 dark:text-slate-200`}
        >
          Design rounds
        </a>
        <p className="mt-2 text-sm font-bold text-slate-950 dark:text-white">
          G494 · Existing pages, proposed additions
        </p>
        <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">
          Home adds one heads-up. Spend adds the status and funding detail. The
          close gets a short reading.
        </p>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Fictional snapshot · {PERIOD_LABEL} · not live account data.
        </p>
        <div className="mt-3 flex flex-wrap gap-1">
          {(["a", "b"] as Variant[]).map((variant) => (
            <a
              key={variant}
              href={link(config, { variant, view })}
              aria-current={config.variant === variant ? "page" : undefined}
              className={`${control} ${config.variant === variant ? "bg-slate-950 text-white dark:bg-white dark:text-slate-950" : "text-slate-600 dark:text-slate-300"}`}
            >
              {variant === "a" ? "A · Clear moment" : "B · Quieter note"}
            </a>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-1 border-t border-slate-100 pt-2 dark:border-slate-700">
          {(["home", "spend", "close"] as Moment[]).map((moment) => (
            <a
              key={moment}
              href={link(config, {
                moment,
                snapshot:
                  moment === "home"
                    ? "early"
                    : moment === "close"
                      ? "closed"
                      : "crossed",
                view,
              })}
              aria-current={config.moment === moment ? "page" : undefined}
              className={`${control} capitalize ${config.moment === moment ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-400/10 dark:text-indigo-200" : "text-slate-600 dark:text-slate-300"}`}
            >
              {moment === "close" ? "Period close" : moment}
            </a>
          ))}
          <a
            href={link(config, { dark: !config.dark, view })}
            className={`${control} text-slate-600 dark:text-slate-300`}
          >
            {config.dark ? "Light theme" : "Dark theme"}
          </a>
          <a
            href={link(config, { hidden: !config.hidden, view })}
            className={`${control} text-slate-600 dark:text-slate-300`}
          >
            {config.hidden ? "Show figures" : "Hide figures"}
          </a>
        </div>
        <div
          className="mt-2 flex flex-wrap gap-1 border-t border-slate-100 pt-2 dark:border-slate-700"
          role="group"
          aria-label="Compare current and proposed"
        >
          {(["current", "proposed"] as View[]).map((candidate) => (
            <button
              key={candidate}
              type="button"
              aria-pressed={view === candidate}
              onClick={() => setView(candidate)}
              className={`${control} ${view === candidate ? "bg-indigo-600 text-white" : "text-slate-600 dark:text-slate-300"}`}
            >
              {candidate[0].toUpperCase() + candidate.slice(1)}
            </button>
          ))}
          <button
            type="button"
            onClick={replay}
            className={`${control} text-slate-600 dark:text-slate-300`}
          >
            Replay heads-up
          </button>
        </div>
        <details className="mt-2 border-t border-slate-100 pt-1 dark:border-slate-700">
          <summary
            className={`${control} cursor-pointer text-slate-600 dark:text-slate-300`}
          >
            Review cases
          </summary>
          <div className="flex flex-wrap gap-1 pb-1">
            {CASES.map((item) => (
              <a
                key={item.id}
                href={link(config, { state: item.id, view })}
                className={`${control} ${config.state === item.id ? "bg-slate-100 text-slate-950 dark:bg-slate-700 dark:text-white" : "text-slate-600 dark:text-slate-300"}`}
              >
                {item.label}
              </a>
            ))}
          </div>
        </details>
      </div>
    </header>
  );
}

function Warning({
  data,
  variant,
  showLink,
  acknowledge,
}: {
  data: Fixture;
  variant: Variant;
  showLink: string;
  acknowledge: () => void;
}) {
  return (
    <section
      data-g494-addition="home-warning"
      className={
        variant === "a"
          ? "glass-card rounded-2xl p-4"
          : "border-y border-slate-200 py-4 dark:border-slate-700"
      }
      aria-labelledby="g494-warning-title"
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        <span
          className="mr-2 inline-block size-1.5 rounded-full bg-amber-500"
          aria-hidden="true"
        />
        Ahead of payday
      </p>
      <h2
        id="g494-warning-title"
        className="mt-1 text-[17px] font-bold text-slate-950 dark:text-white"
      >
        Spending may pass income
      </h2>
      <p className="mt-1 text-sm leading-5 text-slate-600 dark:text-slate-300">
        <MoneyText
          text={`${money(data.projectedGap)} more out than in by 27 Nov, if this pace continues. Mostly ${data.drivers.map((item) => item.name).join(" and ")}.`}
        />
      </p>
      <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
        You will only see this heads-up once this pay period.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <a
          href={showLink}
          className="inline-flex min-h-11 items-center rounded-xl bg-indigo-600 px-3 text-[13px] font-semibold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900"
        >
          Show me where
        </a>
        <button
          type="button"
          onClick={acknowledge}
          className="min-h-11 rounded-xl px-3 text-[13px] font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Expected, it’s a one-off
        </button>
      </div>
    </section>
  );
}

function Funding({ data, folded }: { data: Fixture; folded: boolean }) {
  const gap = Math.max(0, data.out - data.income);
  const detail = (
    <>
      <p className="mt-1 text-sm leading-5 text-slate-600 dark:text-slate-300">
        <MoneyText text={fundingSentence(data)} />
      </p>
      {data.funding.unknown > 0 && (
        <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
          <MoneyText
            text={`Your accounts do not show what covered the remaining ${money(data.funding.unknown)}.`}
          />
        </p>
      )}
      <details
        data-g494-funding-summary
        className="mt-3 border-y border-slate-200 dark:border-slate-700"
      >
        <summary
          data-balanced-row="g494-funding-disclosure"
          className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-[13px] font-semibold text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-200"
        >
          <span data-row-content>How this adds up</span>
          <span aria-hidden="true">Details</span>
        </summary>
        <p className="border-t border-slate-200 pb-3 pt-3 text-[13px] dark:border-slate-700">
          <MoneyText
            text={`Out ${money(data.out)} · In ${money(data.income)} · Gap ${money(gap)}`}
          />
        </p>
      </details>
    </>
  );
  return folded ? (
    <details
      data-g494-addition="funding-evidence"
      className="mt-4 border-y border-slate-200 py-4 dark:border-slate-700"
    >
      <summary
        data-balanced-row="g494-funding-disclosure"
        className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm font-semibold text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-white"
      >
        <span data-row-content>
          <span
            className="mr-2 inline-block size-1.5 rounded-full bg-amber-500"
            aria-hidden="true"
          />
          More out than in
        </span>
        <span aria-hidden="true">Details</span>
      </summary>
      <div className="pb-4">{detail}</div>
    </details>
  ) : (
    <section
      data-g494-addition="funding-evidence"
      className="mt-4 glass-card rounded-2xl p-4"
    >
      <h2 className="text-[15px] font-bold text-slate-950 dark:text-white">
        What covered the gap
      </h2>
      {detail}
    </section>
  );
}

function HomeSurface({
  config,
  data,
  proposed,
  showWarning,
  acknowledged,
  acknowledge,
}: {
  config: Config;
  data: Fixture;
  proposed: boolean;
  showWarning: boolean;
  acknowledged: boolean;
  acknowledge: () => void;
}) {
  const showLink = link(config, {
    moment: "spend",
    snapshot: "early",
    drivers: true,
    view: "proposed",
  });
  const tip = {
    id: "g494-tip",
    category: "mobile",
    icon: "",
    label: "Mobile",
    pinned: false,
    is_new: false,
    title: "Your mobile bill is £18 this month",
    body: "A quick check can show whether that still suits you.",
    refreshed_at: "2026-11-20T09:00:00Z",
    return_reason: null,
    stopped_line: null,
    substituted: false,
    substituted_merchant: null,
    substituted_line: null,
    deadline_at: null,
    claim_valid_until: null,
    content_valid_until: "2026-11-26T09:00:00Z",
    expiry_line: "Checked today",
    state: "fresh" as const,
    researched_at: "2026-11-20T09:00:00Z",
    triggered_by: [],
    user_context: null,
    has_workflow: false,
    app_route: "/spend",
  };
  return (
    <main className="pb-[calc(9rem+env(safe-area-inset-bottom,0px))] pt-[env(safe-area-inset-top,0px)] lg:mx-auto lg:grid lg:max-w-7xl lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-6 lg:p-6 lg:pb-8">
      <section className="min-w-0">
        <div
          data-g494-production-region="brief"
          className="px-4 pt-5 lg:px-0 lg:pt-0"
        >
          <HomeBrief
            items={[]}
            firstName="Alex"
            displayName="Alex Reed"
            nameResolved
            safeToSpend={SAFE}
            loading={config.state === "loading"}
            loadFailed={config.state === "error"}
            syncError={false}
            hideNetWorth={config.hidden}
            hasAccounts
            dismissible={false}
            banner={
              proposed && showWarning && config.variant === "a" ? (
                <Warning
                  data={data}
                  variant="a"
                  showLink={showLink}
                  acknowledge={acknowledge}
                />
              ) : undefined
            }
          />
        </div>
        <div
          data-g494-production-region="safe-to-spend"
          className="mt-5 px-4 lg:px-0"
        >
          <SafeToSpendCard
            data={config.state === "loading" ? null : SAFE}
            loading={config.state === "loading"}
            error={config.state === "error"}
            spendFrom={{ kind: "unavailable", reason: "loading" }}
            previewBalancesVisible={!config.hidden}
          />
          {proposed && showWarning && config.variant === "b" && (
            <div className="mt-3">
              <Warning
                data={data}
                variant="b"
                showLink={showLink}
                acknowledge={acknowledge}
              />
            </div>
          )}
          {proposed && acknowledged && (
            <p
              role="status"
              className="mt-3 text-sm text-slate-600 dark:text-slate-300"
            >
              We will not show this heads-up again this pay period.
            </p>
          )}
        </div>
        <div data-g494-production-region="your-money" className="mt-5">
          <p className="mb-2 px-4 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 lg:px-0">
            Your money
          </p>
          <div className="space-y-3">
            <UpcomingBillsStrip />
            <HomeInsightSpotlight previewInsight={tip} />
          </div>
        </div>
        <HomeEstateSection
          className="mt-5 px-4 lg:px-0"
          loading={false}
          accountCount={1}
          topPickAccounts={ACCOUNTS}
          totalAccountCount={1}
          pinnedIds={[]}
          onOpenAccount={() => {}}
          onOpenInvestments={() => {}}
          onViewAll={() => {}}
          emptyState={null}
        />
      </section>
      <section data-g494-production-region="recent" className="min-w-0">
        <div className="mt-5 px-4 pb-5 lg:mt-0 lg:px-0">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Recent transactions
            </p>
            <button
              type="button"
              className="min-h-11 rounded px-2 text-xs font-semibold text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300"
            >
              See all
            </button>
          </div>
          <div className="glass-card overflow-hidden rounded-2xl">
            {recentTransactions(data).map((transaction) => (
              <TransactionRowContent
                key={transaction.id}
                transaction={transaction}
                hidden={config.hidden}
                showActivityDate
                onClick={() => {}}
              />
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

function SpendSurface({
  config,
  data,
  proposed,
}: {
  config: Config;
  data: Fixture;
  proposed: boolean;
}) {
  const verdict = useMemo(
    () => makeVerdict(data, config.snapshot),
    [data, config.snapshot],
  );
  const withhold = ["stale", "loading", "error"].includes(config.state);
  const crossed =
    config.snapshot !== "early" && verdict.pills.spent > verdict.pills.income;
  const income = incomeTransactions(data);
  useEffect(() => {
    if (config.drivers) {
      const target = document.getElementById("g494-drivers");
      target?.scrollIntoView({ block: "start" });
      target?.focus();
    }
  }, [config.drivers]);
  if (config.state === "loading")
    return (
      <main className="mx-auto min-h-dvh max-w-xl pb-[calc(9rem+env(safe-area-inset-bottom,0px))] pt-[env(safe-area-inset-top,0px)] lg:pb-8">
        <p role="status" className="sr-only">
          Loading Spend for this fictional preview.
        </p>
        <SpendHeroSkeleton />
        <div className="space-y-3 px-4 pt-4" aria-hidden="true">
          <div className="flex items-center gap-2">
            <div className="h-8 w-24 animate-pulse rounded-full bg-slate-200 dark:bg-slate-700" />
            <div className="h-8 w-16 animate-pulse rounded-full bg-slate-200 dark:bg-slate-700" />
          </div>
          <div className="glass-card space-y-3 rounded-2xl p-4 animate-pulse">
            <div className="h-4 w-32 rounded bg-slate-200 dark:bg-slate-700" />
            <div className="h-3 w-full rounded bg-slate-200 dark:bg-slate-700" />
            <div className="h-9 rounded-xl bg-slate-200 dark:bg-slate-700" />
          </div>
          <div className="glass-card overflow-hidden rounded-2xl animate-pulse">
            {[0, 1, 2, 3, 4].map((row) => (
              <div
                key={row}
                className={`flex min-h-[56px] items-center gap-3 px-4 ${row > 0 ? "border-t border-slate-100 dark:border-white/5" : ""}`}
              >
                <div className="size-9 shrink-0 rounded-xl bg-slate-200 dark:bg-slate-700" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="h-3.5 w-28 rounded bg-slate-200 dark:bg-slate-700" />
                  <div className="h-2.5 w-16 rounded bg-slate-200 dark:bg-slate-700" />
                </div>
                <div className="h-3.5 w-12 shrink-0 rounded bg-slate-200 dark:bg-slate-700" />
              </div>
            ))}
          </div>
        </div>
      </main>
    );
  return (
    <main className="mx-auto min-h-dvh max-w-6xl px-4 pb-[calc(9rem+env(safe-area-inset-bottom,0px))] pt-[calc(1.25rem+env(safe-area-inset-top,0px))] sm:px-6 lg:px-8 lg:pb-8">
      <SpendPeriodBar
        verdict={verdict}
        periodLabel={PERIOD_LABEL}
        isCurrentPeriod
        canGoPrev={false}
        onPrev={() => {}}
        onNext={() => {}}
        onOpenSettings={() => {}}
        onOpenRules={() => {}}
        incomeTxns={income}
        onTransactionClick={() => {}}
      />
      <div className="mt-3 grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(260px,0.72fr)_minmax(0,1.45fr)] lg:gap-14">
        <section
          aria-label="Pay period summary"
          className="min-w-0 lg:sticky lg:top-6"
        >
          <SpendPaceHero
            verdict={verdict}
            incomeTxns={income}
            onTransactionClick={() => {}}
            onOutTap={() => {}}
            onMovedTap={() => {}}
            renderIncomeTransaction={(transaction) => (
              <TransactionRowContent
                transaction={transaction}
                hidden={config.hidden}
                onClick={() => {}}
              />
            )}
          />
          {proposed &&
            !withhold &&
            data.signal &&
            data.projectedGap > 0 &&
            config.snapshot === "early" && (
              <section
                data-g494-addition="early-spend-reading"
                className="mt-4 border-y border-slate-200 py-4 dark:border-slate-700"
              >
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <span
                    className="mr-2 inline-block size-1.5 rounded-full bg-amber-500"
                    aria-hidden="true"
                  />
                  Ahead of payday
                </p>
                <h2 className="mt-1 text-[15px] font-bold text-slate-950 dark:text-white">
                  At this pace, spending may pass income
                </h2>
                <p className="mt-1 text-sm leading-5 text-slate-600 dark:text-slate-300">
                  <MoneyText
                    text={`${money(data.projectedGap)} more out than in by 27 Nov. The main drivers are ${data.drivers.map((item) => item.name).join(" and ")}.`}
                  />
                </p>
              </section>
            )}
          {proposed && !withhold && crossed && (
            <>
              {config.variant === "a" && (
                <span
                  data-g494-addition="spend-chip"
                  className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-full border border-amber-200 px-3 text-[13px] font-semibold text-slate-800 dark:border-amber-300/20 dark:text-slate-100"
                >
                  <span
                    className="size-1.5 rounded-full bg-amber-500"
                    aria-hidden="true"
                  />
                  More out than in
                </span>
              )}
              {config.variant === "b" && (
                <span data-g494-addition="spend-chip" className="sr-only">
                  More out than in
                </span>
              )}
              <Funding data={data} folded={config.variant === "b"} />
              {data.trend && (
                <section
                  data-g494-addition="savings-observation"
                  className="mt-4 border-b border-slate-200 pb-4 dark:border-slate-700"
                >
                  <h2 className="text-[15px] font-bold text-slate-950 dark:text-white">
                    A pattern across pay periods
                  </h2>
                  <p className="mt-1 text-sm leading-5 text-slate-600 dark:text-slate-300">
                    Savings covered part of the gap in {data.trend.covered} of
                    the last {data.trend.periods} completed pay periods. This
                    describes a pattern. It does not set a target.
                  </p>
                </section>
              )}
            </>
          )}
        </section>
        <section
          id="g494-drivers"
          data-g494-driver-focus
          data-g494-production-region="spend-journey"
          tabIndex={-1}
          className="relative min-w-0 pl-8 before:absolute before:bottom-3 before:left-[11px] before:top-3 before:w-px before:bg-slate-300 dark:before:bg-slate-600 sm:pl-10 lg:col-start-2 lg:row-start-1"
        >
          <SpendVerdictView
            verdict={verdict}
            colours={{
              Travel: "#4f46e5",
              "Eating Out": "#d97706",
              Bills: "#64748b",
            }}
            hideReading
            journey
            categoryInsights={[]}
            onOpenCategory={() => {}}
            onIntent={async () => {}}
            signals={{}}
            onAimChanged={() => {}}
            onAskCorrect={() => {}}
          />
        </section>
      </div>
    </main>
  );
}

function CloseSurface({
  config,
  data,
  proposed,
  acknowledged,
}: {
  config: Config;
  data: Fixture;
  proposed: boolean;
  acknowledged: boolean;
}) {
  const canRead =
    proposed &&
    !acknowledged &&
    !["stale", "loading", "error", "quiet"].includes(config.state) &&
    data.fresh &&
    data.signal &&
    data.out > data.income;
  const headline = canRead
    ? `Your month closed on Thursday. Out passed In by ${money(data.out - data.income)}. ${data.funding.unknown > 0 ? "The rest is not established." : `Cards absorbed about ${money(data.funding.cards)}.`}`
    : "Your month closed on Thursday.";
  const item: CompanionItem = {
    id: "needle:g494",
    type: "needle",
    headline,
    body: "",
    action: { label: "Here’s how it went", route: "/month/story?which=last" },
    estimated: false,
  };
  return (
    <main className="mx-auto max-w-3xl px-4 pb-32 pt-5 sm:px-6 lg:px-8">
      <div
        data-g494-production-region="brief"
        data-g494-addition={canRead ? "period-close-reading" : undefined}
      >
        <HomeBrief
          items={[item]}
          firstName="Alex"
          displayName="Alex Reed"
          nameResolved
          safeToSpend={SAFE}
          loading={config.state === "loading"}
          loadFailed={config.state === "error"}
          syncError={false}
          hideNetWorth={config.hidden}
          hasAccounts
          dismissible={false}
        />
      </div>
    </main>
  );
}

export default function OverspendingMoments() {
  const params = useSearchParams();
  const stateParam = params.get("state");
  const state: Case = isCase(stateParam) ? stateParam : "full";
  const moment: Moment =
    params.get("moment") === "spend"
      ? "spend"
      : params.get("moment") === "close"
        ? "close"
        : "home";
  const snapshotParam = params.get("snapshot");
  const snapshot: Snapshot = isSnapshot(snapshotParam)
    ? snapshotParam
    : moment === "home"
      ? "early"
      : moment === "close"
        ? "closed"
        : "crossed";
  const config: Config = {
    variant: params.get("variant") === "b" ? "b" : "a",
    moment,
    state,
    snapshot,
    dark: params.get("mode") === "dark",
    hidden: params.get("hidden") === "1",
    drivers: params.get("drivers") === "1",
    view: params.get("view") === "current" ? "current" : "proposed",
  };
  const data = fixture(state);
  const [view, setView] = useState<View>(config.view);
  const withheld = ["stale", "loading", "error"].includes(state);
  const warningEligible =
    view === "proposed" &&
    moment === "home" &&
    snapshot === "early" &&
    !withheld &&
    state !== "quiet" &&
    data.fresh &&
    data.signal;
  const local = useAcknowledgement(
    config,
    view === "proposed",
    warningEligible,
  );
  const showWarning = warningEligible && !local.acknowledged && !local.seen;
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    const previousScheme = root.style.colorScheme;
    root.classList.toggle("dark", config.dark);
    root.style.colorScheme = config.dark ? "dark" : "light";
    return () => {
      root.classList.toggle("dark", wasDark);
      root.style.colorScheme = previousScheme;
    };
  }, [config.dark]);
  useEffect(() => {
    let live = true;
    void cachedEndpoint(ENDPOINT.cashflow.key, async () => CASHFLOW, {
      force: true,
    }).then(() => {
      if (live) setSeeded(true);
    });
    return () => {
      live = false;
      invalidateEndpoint(ENDPOINT.cashflow.key);
    };
  }, []);
  const changeView = (next: View) => {
    window.history.replaceState(null, "", link(config, { view: next }));
    setView(next);
  };
  const body =
    !seeded || !local.ready ? (
      <p className="mx-auto max-w-7xl px-4 py-8 text-sm text-slate-600 dark:text-slate-300">
        Preparing fictional context…
      </p>
    ) : moment === "home" ? (
      <HomeSurface
        config={config}
        data={data}
        proposed={view === "proposed"}
        showWarning={showWarning}
        acknowledged={local.acknowledged}
        acknowledge={local.acknowledge}
      />
    ) : moment === "spend" ? (
      <SpendSurface
        config={config}
        data={data}
        proposed={view === "proposed"}
      />
    ) : (
      <CloseSurface
        config={config}
        data={data}
        proposed={view === "proposed"}
        acknowledged={local.acknowledged}
      />
    );
  return (
    <BalancesHiddenContext.Provider value={config.hidden}>
      <div className={config.dark ? "dark" : ""}>
        <div className="min-h-dvh bg-[#f0f2f7] text-slate-900 dark:bg-[#0f172a] dark:text-slate-100">
          <Controls
            config={config}
            view={view}
            setView={changeView}
            replay={local.replay}
          />
          {body}
          <BottomNavRail
            appearance="ink"
            resolved
            activeTab={moment === "spend" ? "spend" : "home"}
            pennyActive={false}
            pennyOpen={false}
            pennyCurrent={false}
            paydayActive={false}
            atRiskCount={0}
            onPennyClick={() => {}}
          />
        </div>
      </div>
    </BalancesHiddenContext.Provider>
  );
}
