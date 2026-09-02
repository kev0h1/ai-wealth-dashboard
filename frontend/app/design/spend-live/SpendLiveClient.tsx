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
import Link from "next/link";
import SpendVerdictView from "@/components/SpendVerdictView";
import SpendHeader, { SpendPatternsToggle, RecentPeriodOption } from "@/components/SpendHeader";
import TeachingSheet from "@/components/TeachingSheet";
import PayPeriodSettingsSheet from "@/components/PayPeriodSettingsSheet";
import CategorisationRulesSheet from "@/components/CategorisationRulesSheet";
import { SPEND_VERDICT_FIXTURES, PREVIEW_INCOME_TXNS, PREVIEW_SIGNALS, PREVIEW_ACCOUNTS } from "./fixtures";
import { api } from "@/lib/api";
import type { SpendVerdictState, Transaction } from "@/lib/api";
import { DEFAULT_PAY_PERIOD_CONFIG, prevPeriodWithConfig } from "@/lib/payPeriod";

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

export default function SpendLiveClient() {
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

  // "Breakdown" vs "Charts" (renamed from "This period"/"Over time",
  // 2026-09 — see SpendHeader.tsx's SpendPatternsToggle) — the body swaps in
  // place (matching production's own SpendPage.tsx pattern). This
  // fixture-only route has no live transaction list to chart, so the
  // swapped-in content is an honest placeholder pointing at the real page
  // rather than a fake chart.
  const [showPatterns, setShowPatterns] = useState(false);

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

  const patternsPlaceholder = (
    <div className="glass-card-flat rounded-2xl p-4 text-center">
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Charts draws from your live transactions, this preview doesn&apos;t have any to plot.
      </p>
      <Link href="/spend?view=trends" className="mt-2 inline-block text-[13px] font-semibold text-indigo-600 dark:text-indigo-400">
        See it on the real Spend page →
      </Link>
    </div>
  );

  return (
    <div className={mode === "dark" ? "dark" : ""}>
      <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] pb-28">
        <div className="mx-auto w-full max-w-[430px]">
          <SpendHeader
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
            recentPeriods={recentPeriods}
            onSelectOffset={(o) => setPeriodOffset(o)}
          />

          {/* The real component under test, rendering the fixture payload.
              hideReading is always true — the header already renders the
              reading (20px hero treatment). */}
          <div className="px-4 pt-4">
            {showPatterns ? (
              <>
                <SpendPatternsToggle showPatterns={showPatterns} onSetShowPatterns={setShowPatterns} />
                {patternsPlaceholder}
              </>
            ) : (
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
                expandMajoritySignal={expandSignal}
                aboveMajority={<SpendPatternsToggle showPatterns={showPatterns} onSetShowPatterns={setShowPatterns} />}
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
            )}
          </div>

          {/* Teaching-sheet demo entry points — both forks, the real
              component (not a redrawn mockup). */}
          <div className="px-4 mt-4 flex items-center gap-3">
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

        {/* Fixed state hopper footer */}
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
      </div>
    </div>
  );
}
