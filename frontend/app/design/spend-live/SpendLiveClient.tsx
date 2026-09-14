"use client";

// TEMPORARY PREVIEW — delete after design review.
// Renders the REAL SpendVerdictView + SpendHeader components (not redrawn
// mockups) with fixture /spend/verdict payloads, so design review sees the
// exact rendered truth for all five backend states, in both themes, with
// zero auth. The notable-card intent buttons (onIntent) call the real,
// unauthenticated backend and genuinely 401 — same reasoning as the
// teaching-sheet demo modes below: this route exists to show the real
// failure path, not an always-succeeds stub.
//
// Deep-linkable:
//   /design/spend-live?mode=light|dark&state=normal|nothing|everything|nobaseline|early
//
// The owner picked the Verdict Header (2026-08) — the `?top=` variant
// switcher and the "current"/"a" tops it used to flip between are retired;
// this route now renders exactly what production renders. SpendHeader.tsx
// is the SAME component file SpendPage.tsx imports, so this route and the
// real page structurally cannot draw different Spent/Income figures again
// (the bug this build fixed: SpendPage.tsx used to sum its own "spent"
// client-side, including Savings/Investment/Debt-kind transactions, while
// this route hand-copied a header that happened to read the correct
// verdict.pills figure — nothing forced the two to agree).

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BarChart3, WalletCards } from "lucide-react";
import SpendVerdictView from "@/components/SpendVerdictView";
import { SpendJourneySummary, SpendPeriodBar, type RecentPeriodOption } from "@/components/SpendHeader";
import SpendJourneyNav, { type SpendJourneyDestination } from "@/components/SpendJourneyNav";
import SpendTrends, { DEFAULT_WIDGETS } from "@/components/SpendTrends";
import TeachingSheet from "@/components/TeachingSheet";
import PayPeriodSettingsSheet from "@/components/PayPeriodSettingsSheet";
import CategorisationRulesSheet from "@/components/CategorisationRulesSheet";
import {
  PREVIEW_ACCOUNTS,
  PREVIEW_CHART_PERIOD_TXNS,
  PREVIEW_CHART_TRANSACTIONS,
  PREVIEW_INCOME_TXNS,
  PREVIEW_SIGNALS,
  SPEND_VERDICT_FIXTURES,
} from "./fixtures";
import { api } from "@/lib/api";
import type { SpendVerdictState, Transaction } from "@/lib/api";
import { DEFAULT_PAY_PERIOD_CONFIG, prevPeriodWithConfig } from "@/lib/payPeriod";
import { OPEN_TIPS } from "../spend-tips/fixtures";

// Fixture transactions for the teaching-sheet demo modes below — one per
// fork (ENGINE.md Destination Rule: movement gets destinations, spend gets
// vocabulary). This route is unauthenticated, so any submit inside the real
// TeachingSheet will fail its network call and surface the sheet's own
// inline error copy — expected here; the point is the rendered surface, not
// a working mutation.
const MOVE_FIXTURE_TX: Transaction = {
  id: "fixture-wise-1",
  account_id: "fixture-account",
  date: "2026-08-04",
  amount: 1020,
  currency: "GBP",
  description: "WISE *8827 TRANSFER",
  merchant_name: "WISE",
  category: "Transfer",
  transaction_type: "debit",
};
// The ask card's "Tell me what this was" fixture — same WISE row as
// MOVE_FIXTURE_TX, but category: "Other" (genuinely unresolved, matching
// the `normal`/`everything` fixtures' unresolved.largest) rather than an
// already-movement-kind category. Routing this to the movement-root step
// goes through TeachingSheet's forceMovementRoot prop below, exactly like
// SpendPage.tsx's real onAskCorrect (fix-round Blocker 4) — so this preview
// renders the same handoff production does, via the same mechanism, not
// just a fixture that happens to land on the same fork.
const ASK_FIXTURE_TX: Transaction = {
  id: "fixture-wise-1",
  account_id: "fixture-account",
  date: "2026-08-04",
  amount: 1020,
  currency: "GBP",
  description: "WISE *8827 TRANSFER",
  merchant_name: "WISE",
  category: "Other",
  transaction_type: "debit",
};
const SPEND_FIXTURE_TX: Transaction = {
  id: "fixture-playtomic-1",
  account_id: "fixture-account",
  date: "2026-07-11",
  amount: 48,
  currency: "GBP",
  description: "PLAYTOMIC* PI-F0D6 ON 11 JUL BCC",
  merchant_name: "PLAYTOMIC",
  category: "Shopping",
  transaction_type: "debit",
};
// Credit fork of movement-root (owner review defect 2) — a CREDIT already
// sitting in a movement-kind category (mirrors the real £1,106 "TEST"
// shape), so the sheet opens straight on movement-root exactly like
// MOVE_FIXTURE_TX does for a debit, but renders the credit-appropriate
// option list (Transfer / Income / something else) instead of the
// debit-only mine-here/mine-goal/mine-offline destinations.
const MOVE_CREDIT_FIXTURE_TX: Transaction = {
  id: "fixture-test-credit-1",
  account_id: "fixture-account",
  date: "2026-08-01",
  amount: 1106.77,
  currency: "GBP",
  description: "TEST",
  merchant_name: undefined,
  category: "Transfer",
  transaction_type: "credit",
};

type Mode = "light" | "dark";
const STATES: SpendVerdictState[] = ["normal", "nothing", "everything", "nobaseline", "early"];
const STATE_LABEL: Record<SpendVerdictState, string> = {
  normal: "Normal",
  nothing: "Nothing",
  everything: "Everything",
  nobaseline: "No baseline",
  early: "Early",
};

function periodLabel(start: string, end: string): string {
  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  };
  return `${fmtDate(start)} → ${fmtDate(end)}`;
}

export default function SpendLiveClient({ hidePreviewControls = false }: { hidePreviewControls?: boolean } = {}) {
  const params = useSearchParams();
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";
  const state: SpendVerdictState = STATES.includes(params.get("state") as SpendVerdictState)
    ? (params.get("state") as SpendVerdictState)
    : "normal";

  const verdict = SPEND_VERDICT_FIXTURES[state];

  // Teaching-sheet demo modes — the REAL TeachingSheet, both forks, so
  // design review sees the rendered surface exactly as shipped. Deep-linkable
  // via `?sheet=move` (movement fork, opens on the WISE transfer) or
  // `?sheet=spend` (spend fork, opens on the Playtomic miscategorisation).
  const sheetParam = params.get("sheet");
  const [sheetOpen, setSheetOpen] = useState(sheetParam === "move" || sheetParam === "spend" || sheetParam === "movecredit");
  const [sheetTx, setSheetTx] = useState<Transaction>(
    sheetParam === "spend" ? SPEND_FIXTURE_TX : sheetParam === "movecredit" ? MOVE_CREDIT_FIXTURE_TX : MOVE_FIXTURE_TX
  );
  // Mirrors SpendPage.tsx's askHandoffTxId — true only when the sheet was
  // opened via the ask card, not the movement/spend demo links below.
  const [sheetForceMovementRoot, setSheetForceMovementRoot] = useState(false);

  // Local-only sheets — neither makes a network call on open (verified:
  // PayPeriodSettingsSheet's onSave is a pure prop callback; Categorisation-
  // RulesSheet is static copy), so both render for real here rather than as
  // an inert stub.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);

  // Cosmetic period-nav state — the fixture payload doesn't change with
  // offset (there's one fixture per `state`, not per period), but the top
  // region's chevron-presence rule, "Back to this period" chip and period
  // sheet are all genuinely interactive so review can see them work.
  const [periodOffset, setPeriodOffset] = useState(0);
  const isCurrentPeriod = periodOffset === 0;

  const recentPeriods: RecentPeriodOption[] = useMemo(() => {
    const list: RecentPeriodOption[] = [];
    let s = new Date(verdict.period.start);
    let e = new Date(verdict.period.end);
    for (let i = 0; i < 6; i++) {
      list.push({ offset: -i, label: periodLabel(s.toISOString(), e.toISOString()) });
      const [ps, pe] = prevPeriodWithConfig(s, DEFAULT_PAY_PERIOD_CONFIG);
      s = ps;
      e = pe;
    }
    return list;
  }, [verdict.period.start, verdict.period.end]);

  // "Out" tap's Show Your Working destination — force the majority list
  // open and scroll to it, the exact reconciled transactions behind the
  // Out/Spent figure (notables + majority + unresolved = pills.spent).
  // Starts undefined (not 0) — SpendVerdictView's expandMajoritySignal
  // effect fires whenever the prop is non-null, so 0 would force-expand on
  // the very first render before any tap.
  const [expandSignal, setExpandSignal] = useState<number | undefined>(undefined);
  function handleOutTap() {
    setExpandSignal((s) => (s ?? 0) + 1);
    document.getElementById("spend-majority-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function handleMovedTap() {
    document.getElementById("spend-money-moved")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function handleUnresolvedTap() {
    document.getElementById("spend-unresolved")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  useEffect(() => {
    const t = setTimeout(() => {
      document.documentElement.classList.toggle("dark", mode === "dark");
      document
        .querySelector('meta[name="color-scheme"]')
        ?.setAttribute("content", mode === "dark" ? "dark" : "only light");
    }, 0);
    return () => clearTimeout(t);
  }, [mode]);

  const hrefFor = (s: SpendVerdictState) => `?mode=${mode}&state=${s}`;
  const latestPace = [...(verdict.pace_series ?? [])].reverse().find((point) => point.usual != null);
  const paceDifference = latestPace?.usual == null ? null : verdict.pills.spent - latestPace.usual;
  const money = (value: number) => `£${Math.abs(Math.round(value)).toLocaleString("en-GB")}`;
  const destinations: SpendJourneyDestination[] = [
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

  return (
    <div className={mode === "dark" ? "dark" : ""}>
      <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] pb-28">
        <div className="mx-auto w-full max-w-6xl px-4 pt-5 sm:px-6 lg:px-8">
          <SpendPeriodBar
            verdict={verdict}
            loading={false}
            periodLabel={periodLabel(verdict.period.start, verdict.period.end)}
            isCurrentPeriod={isCurrentPeriod}
            canGoPrev={true}
            onPrev={() => setPeriodOffset((o) => o - 1)}
            onNext={() => setPeriodOffset((o) => Math.min(0, o + 1))}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenRules={() => setRulesOpen(true)}
            incomeTxns={PREVIEW_INCOME_TXNS}
            onTransactionClick={(tx) => { setSheetTx(tx); setSheetForceMovementRoot(false); setSheetOpen(true); }}
            onOutTap={handleOutTap}
            onMovedTap={handleMovedTap}
            onUnresolvedTap={handleUnresolvedTap}
            recentPeriods={recentPeriods}
            onSelectOffset={(o) => setPeriodOffset(o)}
          />

          <div className="sticky top-0 z-30 -mx-4 mt-3 border-y border-slate-200/90 bg-[#f0f2f7]/95 px-4 py-2 backdrop-blur-sm dark:border-slate-700/80 dark:bg-[#0f172a]/95 lg:hidden">
            <SpendJourneyNav destinations={destinations} />
          </div>

          <div className="mt-7 grid items-start gap-9 lg:grid-cols-[minmax(260px,0.72fr)_minmax(0,1.45fr)] lg:gap-14">
            <aside className="lg:sticky lg:top-6">
              <SpendJourneySummary
                verdict={verdict}
                periodLabel={periodLabel(verdict.period.start, verdict.period.end)}
                isCurrentPeriod={isCurrentPeriod}
                canGoPrev
                onPrev={() => setPeriodOffset((offset) => offset - 1)}
                onNext={() => setPeriodOffset((offset) => Math.min(0, offset + 1))}
                onOpenSettings={() => setSettingsOpen(true)}
                onOpenRules={() => setRulesOpen(true)}
                incomeTxns={PREVIEW_INCOME_TXNS}
                onTransactionClick={(transaction) => { setSheetTx(transaction); setSheetForceMovementRoot(false); setSheetOpen(true); }}
                onOutTap={handleOutTap}
                onMovedTap={handleMovedTap}
                onUnresolvedTap={handleUnresolvedTap}
                recentPeriods={recentPeriods}
                onSelectOffset={(offset) => setPeriodOffset(offset)}
              />
              <div className="mt-5 hidden lg:block"><SpendJourneyNav destinations={destinations} desktop /></div>
            </aside>

            <main className="relative pl-8 before:absolute before:bottom-3 before:left-[11px] before:top-3 before:w-px before:bg-slate-300 dark:before:bg-slate-600 sm:pl-10">
              <section className="relative pb-10">
                <span className="absolute -left-8 top-1 flex size-6 items-center justify-center rounded-full bg-indigo-600 text-white ring-4 ring-[#f0f2f7] dark:ring-[#0f172a] sm:-left-10" aria-hidden="true"><WalletCards size={12} /></span>
                <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-600 dark:text-slate-400">Pay arrived · 31 Jul</p>
                <h2 className="mt-2 text-xl font-bold text-slate-950 dark:text-white"><span className="font-mono tabular-nums">{money(verdict.pills.income)}</span> recorded coming in</h2>
                <p className="mt-1 max-w-2xl text-pretty text-[13px] leading-5 text-slate-600 dark:text-slate-400">Income is evidence for this period, not a claim that every pound of spending came from this pay packet.</p>
              </section>

              <SpendVerdictView
                verdict={verdict}
                colours={{}}
                onOpenCategory={() => {}}
                // This route is unauthenticated (see file header), so this hits
                // the real backend and genuinely 401s — same pattern as the
                // teaching-sheet demo entries below: design review sees the
                // exact rendered truth, including the failure path, not an
                // always-succeeds stub.
                onIntent={(category, answer) => api.recordTrendIntent(category, answer).then(() => {})}
                signals={PREVIEW_SIGNALS}
                sym="£"
                onAimChanged={() => {}}
                onAskCorrect={() => { setSheetTx(ASK_FIXTURE_TX); setSheetForceMovementRoot(true); setSheetOpen(true); }}
                hideReading
                journey
                categoryInsights={OPEN_TIPS}
                expandMajoritySignal={expandSignal}
                // Mirrors SpendPage.tsx's own resolve-off-accounts-state
                // pattern (Change 3), against the small PREVIEW_ACCOUNTS
                // fixture — proves the ask card renders the account name,
                // not the raw provider-derived display_name.
                unresolvedAccountName={PREVIEW_ACCOUNTS.find(a => a.id === verdict.unresolved.largest?.account_id)?.name}
                // Money-you-moved rows (Change 6) — this route has no router
                // navigation of its own, so the demo just surfaces which row
                // was tapped and its resolved category filter, the same
                // construction SpendPage.tsx's real onOpenMoved uses.
                onOpenMoved={(m) => {
                  if (!m.categories || m.categories.length === 0) return;
                  window.alert(`Would open /transactions?category=${m.categories.join(",")}&txn_type=debit&label=${encodeURIComponent(m.label)}`);
                }}
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
          </div>

          {/* Teaching-sheet demo entry points — both forks, the real
              component (not a redrawn mockup). */}
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => { setSheetTx(MOVE_FIXTURE_TX); setSheetForceMovementRoot(false); setSheetOpen(true); }}
              className="text-[11px] font-medium text-indigo-500/80 dark:text-indigo-400/80 active:opacity-70 transition-opacity"
            >
              teaching sheet, movement fork ↗
            </button>
            <button
              type="button"
              onClick={() => { setSheetTx(MOVE_CREDIT_FIXTURE_TX); setSheetForceMovementRoot(false); setSheetOpen(true); }}
              className="text-[11px] font-medium text-indigo-500/80 dark:text-indigo-400/80 active:opacity-70 transition-opacity"
            >
              teaching sheet, movement fork (credit) ↗
            </button>
            <button
              type="button"
              onClick={() => { setSheetTx(SPEND_FIXTURE_TX); setSheetForceMovementRoot(false); setSheetOpen(true); }}
              className="text-[11px] font-medium text-indigo-500/80 dark:text-indigo-400/80 active:opacity-70 transition-opacity"
            >
              teaching sheet, spend fork ↗
            </button>
          </div>
        </div>

        {sheetOpen && (
          <TeachingSheet
            transaction={sheetTx}
            onClose={() => { setSheetOpen(false); setSheetForceMovementRoot(false); }}
            onUpdated={() => {}}
            // fixture-only: the fixture transactions all carry account_id
            // "fixture-account", which matches nothing in PREVIEW_ACCOUNTS, so
            // hardcode PREVIEW_ACCOUNTS[0] here to always demonstrate the
            // header's bank badge in this design-preview route.
            account={PREVIEW_ACCOUNTS[0]}
            forceMovementRoot={sheetForceMovementRoot}
          />
        )}

        {settingsOpen && (
          <PayPeriodSettingsSheet
            current={DEFAULT_PAY_PERIOD_CONFIG}
            onClose={() => setSettingsOpen(false)}
            onSave={() => setSettingsOpen(false)}
          />
        )}

        {rulesOpen && <CategorisationRulesSheet onClose={() => setRulesOpen(false)} />}

        {!hidePreviewControls && (
          <div
            className="fixed bottom-0 left-0 right-0 glass-sheet border-t border-slate-100 dark:border-slate-700 px-3 py-2 space-y-1.5"
            style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom, 0px))" }}
          >
            <div className="mx-auto w-full max-w-[430px] flex items-center gap-2 overflow-x-auto">
              {STATES.map((s) => (
                <a
                  key={s}
                  href={hrefFor(s)}
                  className={`flex-shrink-0 px-3 py-1.5 rounded-full text-[11px] font-semibold whitespace-nowrap transition-colors ${
                    s === state
                      ? "bg-indigo-500 text-white"
                      : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                  }`}
                >
                  {STATE_LABEL[s]}
                </a>
              ))}
              <a
                href={`?mode=${mode === "dark" ? "light" : "dark"}&state=${state}`}
                className="flex-shrink-0 ml-auto px-3 py-1.5 rounded-full text-[11px] font-semibold bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
              >
                {mode === "dark" ? "Light" : "Dark"}
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
