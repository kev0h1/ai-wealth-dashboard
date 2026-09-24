"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import { useSearchParams, useRouter } from "next/navigation";
import { BarChart3, Check, WalletCards, Undo2 } from "lucide-react";
import { api, Account, Transaction, SpendVerdict, type SavingsInsight, type MoneyShape } from "@/lib/api";
import { loadMoneyShape, peekMoneyShape } from "@/lib/moneyShape";
import SpendShapeCard from "@/components/SpendShapeCard";
import { useAllTransactions, invalidateTransactionsCache } from "@/lib/useAllTransactions";
import { cachedVerdict, fetchVerdictData, invalidateVerdictCache } from "@/lib/verdictCache";
import { cachedSignals, fetchSignals, invalidateSignalsCache, SignalMap } from "@/lib/signalsCache";
import { useColours } from "@/components/ColourProvider";
import { getToken, setToken } from "@/lib/auth";
import {
  getPayPeriodWithConfig,
  prevPeriodWithConfig,
  nextPeriodWithConfig,
  filterPeriod,
  findPeriodByStart,
  DEFAULT_PAY_PERIOD_CONFIG,
} from "@/lib/payPeriod";
import { usePreferences } from "@/components/PreferencesContext";
import { getAccountsCached } from "@/lib/accountsCache";
import { usePeriodSwipe } from "@/lib/usePeriodSwipe";
import { isHomeCurrency } from "@/lib/currency";
import { CategoryData } from "@/components/CategoryRow";
import Spinner from "@/components/Spinner";
import SpendVerdictView from "@/components/SpendVerdictView";
import { SpendJourneySummary, SpendPeriodBar, type RecentPeriodOption, SpendHeroSkeleton } from "@/components/SpendHeader";
import SpendJourneyNav, { type SpendJourneyDestination } from "@/components/SpendJourneyNav";
import PayPeriodSettingsSheet, { formatPeriodLocal } from "@/components/PayPeriodSettingsSheet";
import { consumeSpendUiState, writeSpendUiState, SpendUiState } from "@/lib/spendUiState";
import { useTutorialReady } from "@/components/TutorialContext";
import { setPennyScreenView } from "@/components/PennySheetProvider";
import { buildSpendPeriodView } from "@/lib/pennyScreenViews";

// These surfaces are absent from the initial This period view. Keeping them
// outside its client graph avoids paying for charts, portals, and form logic
// until the user explicitly opens that branch.
const SpendTrends = dynamic(() => import("@/components/SpendTrends"), {
  loading: () => <div className="flex items-center justify-center py-16"><Spinner size={32} /></div>,
});
const CategorySheet = dynamic(() => import("@/components/CategorySheet"));
const TeachingSheet = dynamic(() => import("@/components/TeachingSheet"));
const MiscategorisedReviewSheet = dynamic(() => import("@/components/MiscategorisedReviewSheet"));
const CategorisationRulesSheet = dynamic(() => import("@/components/CategorisationRulesSheet"));
const IntentConsentSheet = dynamic(() => import("@/components/IntentConsentSheet"));

// Re-exported for any external caller that still reaches invalidateVerdictCache
// via this module's path, now that the cache itself lives in lib/verdictCache.ts.
export { invalidateVerdictCache } from "@/lib/verdictCache";
// Same re-export convention for the signals cache, now in lib/signalsCache.ts.
export { invalidateSignalsCache } from "@/lib/signalsCache";

async function ensureAuth() {}

// Savings insights annotate the category breakdown (via SpendVerdictView's
// own openTipsFor/tipSubline signifier, see lib/spendTips.ts); they never
// gate the page's first paint. Cache the full, unfiltered list for this
// browser session and dedupe a concurrent request if Spend remounts while
// the first one is still running — SpendVerdictView derives each row/card's
// own open tips off this same array via openTipsFor(category, insights),
// so nothing here needs to pre-group or de-dupe by category any more.
let cachedCategoryInsights: SavingsInsight[] | null = null;
let categoryInsightsRequest: Promise<SavingsInsight[]> | null = null;

function loadCategoryInsights(): Promise<SavingsInsight[]> {
  if (!categoryInsightsRequest) {
    categoryInsightsRequest = api.getSavingsInsights()
      .then((insights) => {
        cachedCategoryInsights = insights;
        return insights;
      })
      .finally(() => { categoryInsightsRequest = null; });
  }
  return categoryInsightsRequest;
}

// ── Resolve toast, with Undo — mirrors components/TeachingSheet.tsx's
// established toast-with-undo pattern (its `step === "done" && toast` block:
// emerald check-circle, message, an indigo "Undo" link) rather than
// inventing a new one, and matches the approved
// app/design/spend-bridge/SpendBridgeClient.tsx port exactly. Auto-dismisses
// after 5s via a timer kept in a ref so it survives parent re-renders and is
// cleared cleanly on Undo or unmount. One toast for both answers (One-off on
// a card, or "File it" from the consent sheet) — both funnel through the
// same resolve-in-place lifecycle and the same toast.
function ResolveToast({
  category, answer, onUndo, onDone,
}: {
  category: string;
  answer: "one_off" | "new_normal";
  onUndo: () => void;
  onDone: () => void;
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    timerRef.current = setTimeout(() => onDoneRef.current(), 5000);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  const message = answer === "one_off" ? `${category} noted as a one-off.` : `${category} filed as your new normal.`;

  return (
    <div
      role="status"
      className="fixed left-1/2 -translate-x-1/2 z-[80] w-[calc(100%-24px)] max-w-[406px] glass-card-flat rounded-2xl p-3 flex items-center gap-3 shadow-sm"
      style={{ bottom: "76px" }}
    >
      <span className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
        <Check size={15} className="text-emerald-600 dark:text-emerald-400" />
      </span>
      <p className="flex-1 text-[13px] font-semibold text-slate-800 dark:text-slate-100">{message}</p>
      <button
        type="button"
        onClick={() => {
          if (timerRef.current) clearTimeout(timerRef.current);
          onUndo();
        }}
        className="-mr-2 flex min-h-[44px] shrink-0 items-center gap-1 rounded-lg px-2 text-[12px] font-semibold text-indigo-600 transition-opacity hover:text-indigo-700 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300"
      >
        <Undo2 size={13} aria-hidden="true" />
        Undo
      </button>
    </div>
  );
}

const SKIP_FROM_SPEND = new Set(["Transfer"]);

// YYYY-MM-DD in the date's own UTC calendar day — periodStart/periodEnd are
// built with Date.UTC (lib/payPeriod.ts), so this reads back the exact day
// boundary the period math intended, matching what the hub's `from`/`to`
// query params (backend/app/routers/transactions.py) expect.
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ── Initial period, restoration-aware ─────────────────────────────────────
// The very first render's best guess for periodStart/periodEnd/periodOffset
// (and the signals cache lookup that's keyed by the same offset — see the
// `signals` useState below). Mirrors this page's pre-existing pattern of
// guessing DEFAULT_PAY_PERIOD_CONFIG at mount and letting the "re-initialise
// period when config loads" effect correct it once the account's real
// payPeriodConfig has actually loaded (see usePreferences — it always
// starts at the default synchronously, then resolves async).
//
// A restored periodStart (lib/spendUiState.ts) takes priority over "now"
// when it resolves to a real period under that guessed config — this is
// what makes the offset passed to fetchVerdict/fetchSignals/
// fetchMiscategorisedCount on the very first effect pass already the
// restored one, instead of always starting at the current period (offset 0)
// and correcting to the restored period a moment later in a second fetch
// (a visible flash of the wrong month's data, and a wasted current-period
// request every single restored visit).
function computeInitialPeriod(restoredUi: SpendUiState): { start: Date; end: Date; offset: number } {
  if (restoredUi.periodStart) {
    const found = findPeriodByStart(new Date(restoredUi.periodStart), DEFAULT_PAY_PERIOD_CONFIG);
    if (found) return found;
  }
  const [s, e] = getPayPeriodWithConfig(new Date(), DEFAULT_PAY_PERIOD_CONFIG);
  return { start: s, end: e, offset: 0 };
}

/** Full-page cold-load skeleton — see the `showFullSkeleton` hold inside
 *  SpendPage below. Shape-matches the real header hero (period row, the
 *  weighted Out/In/Moved instrument, the reading line), the Breakdown/
 *  Charts toggle, a notable-card, and the majority-list rows, at the same
 *  positions and approximate heights, so swapping in the real tree doesn't
 *  itself shift anything. BottomNav is mounted once in app/layout.tsx
 *  (G79) rather than by this page, so it's already real (never a
 *  placeholder) and navigation stays available while the page settles
 *  with no extra work here. No entrance animation beyond the shared
 *  `animate-pulse` shimmer — this codebase's
 *  rule against visibility-gating cascades. Never shown on a warm-cache
 *  revisit (BACK-nav) — see `initialHadWarmVerdict` in SpendPage.
 *
 *  The hero block itself is SpendHeroSkeleton (SpendHeader.tsx) — the same
 *  component SpendHeader renders as its own no-verdict placeholder — rather
 *  than a second copy of the same markup, so this cold-load skeleton and
 *  SpendHeader's warm-cache placeholder can never drift into two different
 *  heights. */
function SpendSkeleton() {
  return (
    <div
      className="mx-auto min-h-dvh max-w-xl pb-[calc(9rem+env(safe-area-inset-bottom,0px))] lg:pb-8"
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      aria-hidden="true"
    >
      <SpendHeroSkeleton />

      <div className="px-4 pt-4 space-y-3">
        <div className="flex items-center gap-2">
          <div className="h-8 w-24 rounded-full bg-slate-200 dark:bg-slate-700 animate-pulse" />
          <div className="h-8 w-16 rounded-full bg-slate-200 dark:bg-slate-700 animate-pulse" />
        </div>

        {/* Notable-card shape */}
        <div className="glass-card rounded-2xl p-4 animate-pulse space-y-3">
          <div className="h-4 w-32 rounded bg-slate-200 dark:bg-slate-700" />
          <div className="h-3 w-full rounded bg-slate-200 dark:bg-slate-700" />
          <div className="h-9 rounded-xl bg-slate-200 dark:bg-slate-700" />
        </div>

        {/* Majority-list row shape */}
        <div className="glass-card rounded-2xl overflow-hidden animate-pulse">
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className={`flex items-center gap-3 px-4 min-h-[56px] ${i > 0 ? "border-t border-slate-100 dark:border-white/5" : ""}`}
            >
              <div className="w-9 h-9 rounded-xl bg-slate-200 dark:bg-slate-700 flex-shrink-0" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="h-3.5 w-28 rounded bg-slate-200 dark:bg-slate-700" />
                <div className="h-2.5 w-16 rounded bg-slate-200 dark:bg-slate-700" />
              </div>
              <div className="h-3.5 w-12 rounded bg-slate-200 dark:bg-slate-700 flex-shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function SpendPage() {
  const { payPeriodConfig, setPayPeriodConfig, rawPrefs, hideNetWorth, spendWidgets } = usePreferences();
  const { colours } = useColours();
  const searchParams = useSearchParams();
  const router = useRouter();
  // BACK-navigation restore (lib/spendUiState.ts) — read once at mount,
  // before any of the state below that seeds from it. Empty on a fresh
  // tab/session or a hard reload of /spend; otherwise whatever this page's
  // last visit in this session left behind (tab, "Show all" expansion,
  // "Money you moved" accordion). This is what fixes the reported bug: a
  // drill-in to /transactions and BACK used to always land collapsed and
  // re-truncated, which also meant there was nothing tall enough on the
  // page for the app-wide scroll restore (ScrollReset.tsx) to land its
  // saved offset onto — restoring this state first restores the page's
  // real height too, so that height-gated scroll restore succeeds normally.
  const [restoredUi] = useState<SpendUiState>(() => consumeSpendUiState());
  // G57 A keeps charts at the end of the same pay-period journey. Their
  // transaction-heavy data still loads only when the section is requested
  // or approaches the viewport, preserving the old period view's fast first
  // answer while removing the separate Patterns destination.
  const [chartsRequested, setChartsRequested] = useState(
    () => ["patterns", "trends", "charts"].includes(searchParams.get("view") ?? "")
  );
  const [chartsAnchor, setChartsAnchor] = useState<HTMLElement | null>(null);
  const [categoryInsights, setCategoryInsights] = useState<SavingsInsight[]>(
    () => cachedCategoryInsights ?? []
  );
  // Load after the verdict has had a chance to paint. This request only adds
  // contextual annotations; a failure leaves the category UI unchanged.
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      loadCategoryInsights()
        .then((mapped) => { if (active) setCategoryInsights(mapped); })
        .catch(() => {});
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, []);
  const [transactionsRequested, setTransactionsRequested] = useState(false);
  const transactionsEnabled = chartsRequested || transactionsRequested;
  const { transactions: allTransactions, loading: txLoading, setTransactions: setAllTransactions } = useAllTransactions(transactionsEnabled);

  useEffect(() => {
    if (chartsRequested) return;
    if (!chartsAnchor) return;
    if (typeof IntersectionObserver === "undefined") {
      setChartsRequested(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setChartsRequested(true);
          observer.disconnect();
        }
      },
      { rootMargin: "500px 0px" },
    );
    observer.observe(chartsAnchor);
    return () => observer.disconnect();
  }, [chartsAnchor, chartsRequested]);
  // Computed exactly once (ref-memoized, not useMemo — this must never be
  // silently recomputed) from restoredUi.periodStart, so periodStart,
  // periodEnd, periodOffset AND the signals cache lookup below all agree on
  // the very same restored period from their first render, rather than each
  // independently guessing "now" and only converging later.
  const initialPeriodRef = useRef<{ start: Date; end: Date; offset: number } | null>(null);
  if (initialPeriodRef.current === null) {
    initialPeriodRef.current = computeInitialPeriod(restoredUi);
  }
  const initialPeriod = initialPeriodRef.current;
  // Set only when there's a saved period to restore; cleared the instant
  // it's actually applied against a real (non-default-guess) config — see
  // the "re-initialise period when config loads" effect below. Guards
  // against re-applying a stale restore after the user has already
  // manually navigated (handlePrev/handleNext/handleSelectOffset flip
  // hasNavigatedRef first) — a live Settings pay-period edit after that
  // point must always land back on the current period, same as today.
  const pendingRestoreRef = useRef<string | null>(restoredUi.periodStart ?? null);
  const hasNavigatedRef = useRef(false);
  const [periodStart, setPeriodStart] = useState<Date>(() => initialPeriod.start);
  const [periodEnd, setPeriodEnd] = useState<Date>(() => initialPeriod.end);
  const [oldestTxDate, setOldestTxDate] = useState<Date | null>(null);

  useEffect(() => {
    api.oldestTransaction().then(r => { if (r.date) setOldestTxDate(new Date(r.date)); }).catch(() => {});
  }, []);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  // Set only by the ask card's "Tell me what this was" — see onAskCorrect
  // below. Tracks the id rather than a plain boolean so it can't stick
  // after a later, unrelated setSelectedTx call reuses "truthy state".
  const [askHandoffTxId, setAskHandoffTxId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // `title` marks this as the synthetic "Payments over £250" list (Spend
  // Trends' onReviewLarge) — the one CategorySheet use this page has left
  // (Task 3/5): every real-category tap now opens the global hub instead
  // (notable cards, majority rows, the RhythmCard deep-link above).
  const [openCategory, setOpenCategory] = useState<(CategoryData & { title?: string }) | null>(null);
  const [periodOffset, setPeriodOffset] = useState(() => initialPeriod.offset);
  const [fetchedSignals, setFetchedSignals] = useState<Record<number, SignalMap>>({});
  const signals = fetchedSignals[periodOffset] ?? cachedSignals(periodOffset) ?? {};
  // force = the Door or a category just changed, so the cached copy is dead.
  const refetchSignals = useCallback((force = true) => {
    if (force) invalidateSignalsCache();
    fetchSignals(periodOffset, force)
      .then(data => setFetchedSignals((current) => ({ ...current, [periodOffset]: data })))
      .catch(() => setFetchedSignals((current) => ({ ...current, [periodOffset]: {} })));
  }, [periodOffset]);

  // ── /spend/verdict — the reading + notable cards + ask/unresolved +
  // majority rows + money-you-moved. Seeded from the module-level cache
  // above so a revisit (period swipe back, or BACK-navigation from
  // /transactions) paints instantly; every read still revalidates against
  // the server and updates in place — never a stale-data lie, just an
  // instant first paint while the fresh copy lands a round trip later.
  const [verdict, setVerdict] = useState<SpendVerdict | null>(() => cachedVerdict(initialPeriod.offset));
  const [verdictLoading, setVerdictLoading] = useState(() => cachedVerdict(initialPeriod.offset) == null);
  const verdictOffsetRef = useRef(initialPeriod.offset);
  // The period view's closing SpendShapeCard — undefined while its own idle
  // fetch hasn't settled yet (skeleton), null once a fetch resolves with
  // nothing to show (card renders nothing). Seeded from any value already
  // warm from a previous visit (lib/moneyShape.ts) so a fast revisit paints
  // immediately instead of skeletoning again.
  const [moneyShape, setMoneyShape] = useState<MoneyShape | null | undefined>(() => peekMoneyShape() ?? undefined);
  const moneyShapeRequestedRef = useRef(false);
  // Penny screen context (B39) — published via `buildSpendPeriodView`
  // (lib/pennyScreenViews.ts), which only maps GET /spend/verdict's own
  // already-server-computed `pills`/`reading`/`period` onto the shared
  // view shape — no arithmetic of its own, so what Penny can quote back
  // can never disagree with SpendHeader's rendered Out/In/Net pills or its
  // reading line, both sourced from this same `verdict` object. Cleared
  // (not stale) while a period is loading or errored.
  useEffect(() => {
    if (verdictLoading || !verdict) {
      setPennyScreenView("spend", null);
      return;
    }
    setPennyScreenView("spend", buildSpendPeriodView(verdict));
  }, [verdict, verdictLoading]);
  // `silent` = we already have something on screen for this offset (cache
  // or a previous fetch) — never flip the spinner back on, and never blank
  // a good verdict on a transient error. G83 (2026-09-18): calling this
  // when a fresh cache hit already exists no longer makes a second network
  // request — fetchVerdictData itself now checks the same TTL cachedVerdict
  // reads below and resolves from it directly, so the call on the `if (hit)`
  // branch just re-confirms what's already on screen (belt-and-braces
  // against a hit expiring in the gap between the two calls) rather than
  // the real "revalidate against the server" it used to be.
  const fetchVerdict = useCallback((offset: number, silent = false) => {
    verdictOffsetRef.current = offset;
    if (!silent) setVerdictLoading(true);
    fetchVerdictData(offset)
      .then(v => { if (verdictOffsetRef.current === offset) setVerdict(v); })
      .catch(() => { if (verdictOffsetRef.current === offset && !silent) setVerdict(null); })
      .finally(() => { if (verdictOffsetRef.current === offset) setVerdictLoading(false); });
  }, []);
  // G83 fix-round (2026-09-18 review): `payPeriodConfig` is a dependency —
  // NOT just `periodOffset` — because the two are not interchangeable.
  // Moving payday mid-cycle changes what date range offset 0 actually
  // covers without necessarily changing the `periodOffset` NUMBER itself
  // (the "re-initialise period" effect below resets periodOffset to 0,
  // which is a no-op re-render when it was already 0), so without this,
  // a config edit while viewing the current period never re-ran this
  // effect at all — the screen kept showing the OLD boundaries' verdict
  // indefinitely, not just for one TTL window. cachedVerdict(periodOffset)
  // below still governs whether this repaints instantly from a hit or
  // shows the loading state; PreferencesContext's payPeriodConfig saver
  // invalidates the verdict cache itself once the save actually lands, so
  // a hit here is only ever this SAME (still-current) config's data.
  useEffect(() => {
    verdictOffsetRef.current = periodOffset;
    const hit = cachedVerdict(periodOffset);
    if (hit) {
      setVerdict(hit);
      setVerdictLoading(false);
      fetchVerdict(periodOffset, true);
    } else {
      setVerdict(null);
      fetchVerdict(periodOffset);
    }
  }, [periodOffset, fetchVerdict, payPeriodConfig]);

  // The closing SpendShapeCard's own GET /money-shape — independent of the
  // period fetch above (the shape is the user's own recent-period pattern,
  // not this specific period's verdict), so it fires once on mount, in
  // parallel with the verdict fetch, rather than being chained behind it.
  // Measured 2026-09-05: the endpoint itself is cheap (15-30ms, Mongo-
  // cached) — the long cold-load skeleton was the serialisation behind
  // verdict plus a 300ms idle-callback defer, not the request. Fires once
  // per mount (moneyShapeRequestedRef), not once per verdict/period change.
  useEffect(() => {
    if (moneyShapeRequestedRef.current) return;
    moneyShapeRequestedRef.current = true;
    let cancelled = false;
    loadMoneyShape()
      .then((shape) => { if (!cancelled) setMoneyShape(shape); })
      .catch(() => {
        // A failed fetch never clobbers a warm value already on screen
        // (peekMoneyShape() seeded `moneyShape` above, or a previous
        // successful load this same session) — null only when there is
        // genuinely nothing cached to fall back to.
        if (!cancelled) setMoneyShape((current) => current ?? null);
      });
    return () => { cancelled = true; };
  }, []);

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

  // "Moved" tap's Show Your Working destination — scroll to the "Money you
  // moved" block, which now carries id="spend-money-moved" (SpendVerdictView).
  function handleMovedTap() {
    document.getElementById("spend-money-moved")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // OUT-pill footnote tap's Show Your Working destination — the ask/whisper
  // block for the unresolved bucket, id="spend-unresolved" (SpendVerdictView).
  function handleUnresolvedTap() {
    document.getElementById("spend-unresolved")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // ── Spend card resolve-in-place lifecycle (approved spend-bridge spec) ──
  // `resolved` is the single source of truth for every notable card's
  // resolve state, whether it got there by an on-card "One-off" tap or a
  // consent-sheet "File it" — both funnel through handleResolved below,
  // which also drives the single ResolveToast instance. `toast` uses
  // key={category+answer} at the render site to force a clean remount
  // (fresh 5s timer) if a different answer fires while one is already
  // showing. `undoError` is a brief, separate banner for when the undo POST
  // itself fails (rare — the resolved state was already restored by then).
  const [resolved, setResolved] = useState<Record<string, "one_off" | "new_normal">>({});
  const [toast, setToast] = useState<{ category: string; answer: "one_off" | "new_normal" } | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);
  const undoErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // "New normal" consent sheet — declared alongside resolved/toast above
  // since the period-reset effect below needs to close it too. A notable
  // card's "New normal" never posts directly — it always asks to open this
  // sheet, which prices the filing before it saves. Filing itself (the real
  // POST /trends/intent write) is owned here, not by the sheet, so a failed
  // write keeps the sheet open with an inline error instead of resolving
  // the card optimistically.
  const [consentFor, setConsentFor] = useState<string | null>(null);
  const [filing, setFiling] = useState(false);
  const [fileError, setFileError] = useState(false);

  // resolved/toast/consentFor are period-scoped — a stale entry from a
  // previous period must never bleed into the next one's cards (same
  // category name, unrelated answer).
  useEffect(() => {
    setResolved({});
    setToast(null);
    setUndoError(null);
    setConsentFor(null);
  }, [periodOffset]);

  function handleResolved(category: string, answer: "one_off" | "new_normal") {
    setResolved((r) => ({ ...r, [category]: answer }));
    setToast({ category, answer });
  }

  async function handleUndo(category: string) {
    const prevAnswer = resolved[category];
    setResolved((r) => {
      const next = { ...r };
      delete next[category];
      return next;
    });
    setToast(null);
    try {
      await api.deleteIntent(category);
      refetchSignals();
      // G83 fix-round: an undone one_off/new_normal answer changes which
      // notables/majority rows this verdict shows — without clearing the
      // cache first, fetchVerdict's own TTL check would just repaint the
      // still-fresh PRE-undo verdict for up to 90s.
      invalidateVerdictCache();
      fetchVerdict(periodOffset);
    } catch {
      // The delete didn't actually land server-side — put the card back to
      // resolved (existing error style: red-600/role=alert, same as the
      // card's own inline intent error) rather than silently losing the
      // undo request.
      if (prevAnswer) setResolved((r) => ({ ...r, [category]: prevAnswer }));
      setUndoError(category);
      if (undoErrorTimerRef.current) clearTimeout(undoErrorTimerRef.current);
      undoErrorTimerRef.current = setTimeout(() => setUndoError(null), 4000);
    }
  }

  function closeConsentSheet() {
    setConsentFor(null);
    setFileError(false);
  }

  async function handleFileNewNormal() {
    if (!consentFor) return;
    const category = consentFor;
    setFileError(false);
    setFiling(true);
    try {
      await api.recordTrendIntent(category, "new_normal");
      refetchSignals();
      // G83 fix-round: filing "new normal" changes this category's notable
      // treatment for the rest of the period — see handleUndo's identical
      // comment above.
      invalidateVerdictCache();
      fetchVerdict(periodOffset);
      handleResolved(category, "new_normal");
      setConsentFor(null);
    } catch {
      setFileError(true);
    } finally {
      setFiling(false);
    }
  }

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isPro, setIsPro] = useState<boolean>(false);
  const [miscategorisedCount, setMiscategorisedCount] = useState(0);
  const [miscategorisedIds, setMiscategorisedIds] = useState<string[]>([]);
  // Additive — suggested cross-account transfer pairs with a leg in the
  // viewed period (see the banner's own comment in SpendVerdictView.tsx).
  const [pairCount, setPairCount] = useState(0);
  // Additive, all-time — mirrors the review sheet's actual total (series +
  // pairs). Undefined until the first fetch resolves; SpendVerdictView
  // treats undefined as "no value yet" and falls back to the period-scoped
  // miscategorisedCount + pairCount below.
  const [reviewTotal, setReviewTotal] = useState<number | undefined>(undefined);
  const [reviewOpen, setReviewOpen] = useState(false);
  // Guards the ?review=1 auto-open effect below against reading the counts'
  // initial/default state as "zero candidates" — flips true once
  // fetchMiscategorisedCount's request for the current period has settled
  // (success or failure), never on the very first synchronous render.
  const [miscategorisedLoaded, setMiscategorisedLoaded] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);

  // Banner count is period-scoped server-side now (a series counts only if
  // it has a transaction inside the requested period) — refetch whenever
  // the viewed period changes, not just on mount.
  const fetchMiscategorisedCount = useCallback((offset: number) => {
    api.getMiscategorisedCount(offset)
      .then(m => { setMiscategorisedCount(m.count); setMiscategorisedIds(m.ids); setPairCount(m.pair_count ?? 0); setReviewTotal(m.review_total); })
      .catch(() => {})
      .finally(() => setMiscategorisedLoaded(true));
  }, []);

  const loadData = useCallback(async () => {
    try {
      await ensureAuth();
      // G135 (2026-09-21), audited and deliberately not changed here: this
      // page has no notion of a fresh user. It fetches accounts but never
      // tests `.length`, and its empty states are about a pay period having
      // no data, not about having nothing connected at all, so a brand-new
      // user sees empty figures rather than a "connect something" route.
      // G135 fixed the two surfaces that DID claim to lead somewhere (Home's
      // fresh-user card, app/planning/GrowPanel.tsx's empty ladder). Giving
      // this page one is a new empty state needing a design round, not a
      // route fix. Do not re-investigate; propose it to Kevin instead.
      const accs = await getAccountsCached().catch(() => [] as Account[]);
      setAccounts(accs);
    } catch {}
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    fetchMiscategorisedCount(periodOffset);
  }, [periodOffset, fetchMiscategorisedCount]);

  // Penny's spend chip ("Review transfers", lib/pennyScreenConfig.tsx) links
  // here as /spend?review=1 instead of trying to open the sheet itself
  // (MiscategorisedReviewSheet is this page's own component state, no route
  // of its own). Auto-open it on arrival, same one-shot-query-param idiom as
  // PlanningPage's ?day=/?bill= deep link and AccountsPage's ?cardTerms=:
  // read the param, act on it, then router.replace it away so a refresh or
  // back-navigation never replays it.
  //
  // RACE: reviewTotal/miscategorisedCount/pairCount above start at their
  // empty defaults and only reflect the real answer once
  // fetchMiscategorisedCount's request for the current period resolves — on
  // a cold direct visit to /spend?review=1 that fetch hasn't landed yet on
  // this effect's first pass. Gating on `miscategorisedLoaded` (set in
  // fetchMiscategorisedCount's .finally above, on both success and failure)
  // rather than reading the counts' initial zero values means this effect
  // waits and re-checks once the real data lands, instead of misreading
  // "not loaded yet" as "zero candidates" and wrongly bouncing to
  // /transactions when there was actually something to review.
  //
  // This also covers the PRIMARY flow: the chip can be tapped from Penny's
  // sheet while it's open OVER /spend itself (pathname unchanged). The
  // chip's own generic handler (PennyConversation.tsx's link-chip tap)
  // closes the sheet and does router.push("/spend?review=1") — same
  // pathname, new query string. Next's app router still gives an
  // already-mounted page a fresh useSearchParams() value on a same-route
  // navigation, so this effect re-runs against the new `searchParams`
  // reference and fires normally; no remount required.
  useEffect(() => {
    if (searchParams.get("review") !== "1") return;
    if (!miscategorisedLoaded) return;
    const hasCandidates = (reviewTotal ?? (miscategorisedCount + pairCount)) > 0;
    if (!hasCandidates) {
      router.replace("/transactions");
      return;
    }
    setReviewOpen(true);
    const rest = new URLSearchParams(searchParams.toString());
    rest.delete("review");
    const q = rest.toString();
    router.replace(q ? `/spend?${q}` : "/spend", { scroll: false });
  }, [searchParams, miscategorisedLoaded, reviewTotal, miscategorisedCount, pairCount, router]);

  useEffect(() => {
    // "statements" is the new free tier (statement upload only, no open
    // banking) — everything above it counts as isPro for this hint gate.
    api.getSubscription()
      .then(s => setIsPro(s.tier !== "statements"))
      .catch(() => setIsPro(true));
  }, []);

  // Category deep-link — e.g. from RhythmCard "See the payments"
  // (sessionStorage). Insight cards route straight to /transactions now
  // (savings_insights.py's CATEGORY_APP_ROUTES) so this is the one surviving
  // producer of "/spend?category=X" — RhythmCard's rhythm item is about
  // *this period's* pattern, so the redirect below carries the live period
  // as the hub's removable period chip rather than landing on all-time.
  // Task 3 — every category tap now opens the global hub, never the sheet.
  //
  // The category itself is consumed from sessionStorage ONCE, right on
  // mount, and immediately removed — so a stale value can never leak into a
  // later visit — but the actual redirect is deferred until usePreferences
  // has resolved the account's REAL pay-period config. usePreferences
  // starts synchronously at DEFAULT_PAY_PERIOD_CONFIG (calendar month,
  // PreferencesContext.tsx) and only becomes the true config once
  // api.getPreferences() lands, which is what flips `rawPrefs` from null to
  // the preferences object. Firing this redirect before that landed a real
  // last-Friday-of-month payer on a calendar-month /transactions filter
  // that didn't even contain the transaction the rhythm insight was about
  // (a 30 Aug payment, "1 Sept to 30 Sept" calendar-month chip, "No
  // payments matching"). `payPeriodConfig` and `rawPrefs` are set from the
  // same getPreferences().then callback, so by the render where rawPrefs is
  // non-null, payPeriodConfig already holds the real value too — this
  // effect recomputes the window itself from payPeriodConfig at fire time
  // rather than reading the periodStart/periodEnd state (which is corrected
  // by a separate effect a render later, and would still be stale here).
  // Bounded by a short timeout so a getPreferences() network failure
  // (rawPrefs stays null forever — see its .catch(() => {})) can't strand
  // the user on Spend forever; a slightly-wrong range beats a dead link.
  const pendingCategoryRef = useRef<{ cat: string; merchants: string | null } | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const cat = sessionStorage.getItem("wealth_open_category") ?? searchParams.get("category");
    if (cat) {
      sessionStorage.removeItem("wealth_open_category");
      pendingCategoryRef.current = { cat, merchants: searchParams.get("merchants") };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [categoryRedirectReady, setCategoryRedirectReady] = useState(false);
  useEffect(() => {
    if (categoryRedirectReady) return;
    if (rawPrefs != null) { setCategoryRedirectReady(true); return; }
    const timer = setTimeout(() => setCategoryRedirectReady(true), 4000);
    return () => clearTimeout(timer);
  }, [rawPrefs, categoryRedirectReady]);

  useEffect(() => {
    if (!categoryRedirectReady) return;
    const pending = pendingCategoryRef.current;
    if (!pending) return;
    pendingCategoryRef.current = null;
    const [s, e] = getPayPeriodWithConfig(new Date(), payPeriodConfig);
    const params = new URLSearchParams();
    params.set("category", pending.cat);
    if (pending.merchants) params.set("merchants", pending.merchants);
    params.set("from", isoDate(s));
    params.set("to", isoDate(e));
    router.replace(`/transactions?${params.toString()}`);
  }, [categoryRedirectReady, payPeriodConfig, router]);

  // Breakdown is verdict-led and does not need a year of transactions or an
  // accounts response to become useful. Transaction history is requested only
  // for an explicit income/chart interaction and gates that branch alone.
  const pageLoading = transactionsEnabled && txLoading;

  // ── Cold-load skeleton hold ────────────────────────────────────────────
  // The owner's "stop this jerking loading of the screen" fix (mirrored on
  // AccountsPage.tsx). Guards only the very FIRST paint of this page, never
  // a period swipe — those already have their own in-place treatment (the
  // remembered verdict for that offset paints instantly, or a small inline
  // spinner shows; see the periodOffset effects above), so holding on every
  // swipe would just reintroduce a different jerk.
  //
  // A warm verdict cache for the initial offset is the BACK-nav/restorable
  // page case (see the `verdict`/`verdictLoading` seeds and the comment
  // above them) — that MUST keep painting instantly, never held, so
  // `initialHadWarmVerdict` bypasses the hold entirely when true.
  //
  // The verdict is the page's meaningful first response. Supporting counts,
  // signals and account labels may settle after reveal; none can hold the
  // whole screen behind a network request the user did not ask for.
  const [initialHadWarmVerdict] = useState(() => cachedVerdict(initialPeriod.offset) != null);
  const [initialSettled, setInitialSettled] = useState(initialHadWarmVerdict);
  const [forceReveal, setForceReveal] = useState(false);
  useEffect(() => {
    if (initialHadWarmVerdict) return;
    const t = setTimeout(() => setForceReveal(true), 5000);
    return () => clearTimeout(t);
  }, [initialHadWarmVerdict]);
  useEffect(() => {
    if (initialSettled) return;
    if (!verdictLoading) {
      setInitialSettled(true);
    }
  }, [initialSettled, verdictLoading]);
  // True only until the real tree has actually taken the skeleton's place.
  const showFullSkeleton = !initialSettled && !forceReveal;

  // Tour readiness — the verdict hero and category breakdown must both have
  // real data before the tour can highlight them; a skeleton is not a valid
  // tour target (see TutorialContext.tsx's useTutorialReady contract).
  // Gating on `showFullSkeleton` (rather than the raw loading flags it's
  // built from) guarantees this can never fire while the skeleton is still
  // the thing actually painted.
  useTutorialReady("spend", !showFullSkeleton && !!verdict);

  // Re-initialise period when config loads/changes. usePreferences always
  // starts at DEFAULT_PAY_PERIOD_CONFIG synchronously and resolves the
  // account's real config a moment later (PreferencesContext.tsx), so this
  // fires at least twice on a normal mount: once for the guess, once for
  // the real value. A restored period (lib/spendUiState.ts) has to survive
  // that resolution too — re-derive it against whatever config this run
  // actually has, rather than only ever trusting the initial guess.
  const configKey = JSON.stringify(payPeriodConfig);
  useEffect(() => {
    if (!hasNavigatedRef.current && pendingRestoreRef.current) {
      const found = findPeriodByStart(new Date(pendingRestoreRef.current), payPeriodConfig);
      if (found) {
        // Applied — never retried again, even if this effect fires once
        // more for an unrelated later config change.
        pendingRestoreRef.current = null;
        setPeriodStart(found.start);
        setPeriodEnd(found.end);
        setPeriodOffset(found.offset);
        return;
      }
      // Not reachable under this config yet — leave pendingRestoreRef set
      // so the next resolution (the real config, if this run was still the
      // default guess) gets another attempt. Falls through to the current
      // period below in the meantime, same as an unrestored visit.
    } else {
      pendingRestoreRef.current = null;
    }
    const [s, e] = getPayPeriodWithConfig(new Date(), payPeriodConfig);
    setPeriodStart(s);
    setPeriodEnd(e);
    setPeriodOffset(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configKey]);

  // Persist the viewed period (lib/spendUiState.ts) on every change — same
  // cheap on-every-change pattern as showPatterns above. Written as a plain
  // YYYY-MM-DD string (not the offset) so a BACK-navigation restore lands on
  // the same real period even if the calendar rolled in between (see
  // spendUiState.ts's file header and payPeriod.ts's findPeriodByStart).
  useEffect(() => {
    writeSpendUiState({ periodStart: isoDate(periodStart) });
  }, [periodStart]);

  // Period txns
  const periodTxns = useMemo(
    () => filterPeriod(allTransactions, periodStart, periodEnd),
    [allTransactions, periodStart, periodEnd]
  );

  // Totals are single-currency: foreign-currency transactions (e.g. a KES
  // statement import) show in the list with their own symbol but must not be
  // summed into home-currency figures
  const homeTxns = useMemo(
    () => periodTxns.filter(tx => isHomeCurrency(tx.currency)),
    [periodTxns]
  );
  const homeAllTxns = useMemo(
    () => allTransactions.filter(tx => isHomeCurrency(tx.currency)),
    [allTransactions]
  );

  // NOTE: the top-region Spent/Income/Net figures come from `verdict.pills`
  // (SpendHeader), not a client-side re-derivation. A previous local
  // `summary` here summed all non-"Transfer" categories as spend, which
  // silently counted Savings/Investment/Debt-kind transactions (movement,
  // per ENGINE.md's Destination Rule — SKIP_FROM_SPEND only ever named
  // "Transfer") as spending. verdict.pills is the engine's reconciled
  // figure and is the same number SpendVerdictView's own majority/notables/
  // unresolved breakdown adds up to — this is exactly the invariant
  // fixtures.ts's assertFixtureInvariants checks.

  // Category breakdown
  const categories = useMemo((): CategoryData[] => {
    const map: Record<string, { total: number; count: number; transactions: Transaction[] }> = {};
    for (const tx of homeTxns) {
      const cat = tx.category || "Other";
      if (SKIP_FROM_SPEND.has(cat) || cat === "Income") continue;
      if (!map[cat]) map[cat] = { total: 0, count: 0, transactions: [] };
      // Credits here are refunds — they net against the category's spend
      map[cat].total += tx.transaction_type === "credit" ? -Math.abs(tx.amount) : Math.abs(tx.amount);
      map[cat].count += 1;
      map[cat].transactions.push(tx);
    }
    const totalSpend = Object.values(map).reduce((s, v) => s + Math.max(v.total, 0), 0);
    return Object.entries(map)
      .map(([name, { total, count, transactions }]) => ({
        name,
        total,
        count,
        transactions: transactions.sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
        ),
        pct: totalSpend > 0 && total > 0 ? (total / totalSpend) * 100 : 0,
      }))
      .sort((a, b) => b.total - a.total);
  }, [homeTxns]);


  // Income transactions for drill-down — Income category only; other credits
  // are refunds and live in their own category. Sorted amount-descending
  // (largest first) rather than by date — a period's salary (often dated
  // day 1) would otherwise sort to the bottom, buried under a run of small
  // P2P credits dated later in the period. IncomeDrilldown (SpendHeader.tsx)
  // just maps the list in order with no date-grouping assumption, so this
  // reorder is safe.
  const incomeTxns = useMemo(
    () =>
      homeTxns
        .filter(
          (tx) =>
            tx.transaction_type === "credit" &&
            (tx.category || "Other") === "Income"
        )
        .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)),
    [homeTxns]
  );

  // All transactions in the period, newest first — the chronological list
  // view itself is retired, but SpendTrends' "review large payments" cta
  // still needs the raw period list to build its synthetic sheet.
  const listTxns = useMemo(
    () =>
      [...periodTxns].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      ),
    [periodTxns]
  );

  // Stop at the period containing the oldest transaction — no empty pre-history
  const canGoPrev = !oldestTxDate || periodStart.getTime() > oldestTxDate.getTime();

  function handlePrev() {
    if (!canGoPrev) return;
    hasNavigatedRef.current = true;
    const [s, e] = prevPeriodWithConfig(periodStart, payPeriodConfig);
    setPeriodStart(s);
    setPeriodEnd(e);
    setPeriodOffset(o => o - 1);
  }

  function handleNext() {
    hasNavigatedRef.current = true;
    const [s, e] = nextPeriodWithConfig(periodEnd, payPeriodConfig);
    setPeriodStart(s);
    setPeriodEnd(e);
    setPeriodOffset(o => o + 1);
  }

  // Jump straight to an arbitrary offset — the period sheet's row taps and
  // "Back to this period" (offset 0). handlePrev/handleNext only ever step
  // by one, so this walks from "now" the same number of steps the sheet's
  // own recentPeriods list below was built with.
  function handleSelectOffset(offset: number) {
    hasNavigatedRef.current = true;
    let [s, e] = getPayPeriodWithConfig(new Date(), payPeriodConfig);
    if (offset < 0) {
      for (let i = 0; i > offset; i--) {
        const [ps, pe] = prevPeriodWithConfig(s, payPeriodConfig);
        s = ps; e = pe;
      }
    } else if (offset > 0) {
      for (let i = 0; i < offset; i++) {
        const [ns, ne] = nextPeriodWithConfig(e, payPeriodConfig);
        s = ns; e = ne;
      }
    }
    setPeriodStart(s);
    setPeriodEnd(e);
    setPeriodOffset(offset);
  }

  // Recent periods for the period sheet — six most recent, stopping early if
  // we'd walk before the oldest known transaction (mirrors canGoPrev's own
  // boundary, no empty pre-history rows).
  const recentPeriods = useMemo<RecentPeriodOption[]>(() => {
    const list: RecentPeriodOption[] = [];
    let [s, e] = getPayPeriodWithConfig(new Date(), payPeriodConfig);
    for (let i = 0; i < 6; i++) {
      list.push({ offset: -i, label: formatPeriodLocal(s, e) });
      if (oldestTxDate && s.getTime() <= oldestTxDate.getTime()) break;
      const [ps, pe] = prevPeriodWithConfig(s, payPeriodConfig);
      s = ps; e = pe;
    }
    return list;
  }, [payPeriodConfig, oldestTxDate]);

  // Miscategorised-transfers chip: opens the review sheet where each flagged
  // transaction can be recategorised or dismissed in place (replaces the old
  // deep-link/glow-the-tile behaviour).
  function handleMiscategorisedTap() {
    setReviewOpen(true);
  }

  const [currentStart, currentEnd] = getPayPeriodWithConfig(new Date(), payPeriodConfig);
  const isCurrentPeriod =
    periodStart.getTime() === currentStart.getTime() &&
    periodEnd.getTime() === currentEnd.getTime();

  const periodSwipe = usePeriodSwipe({ onPrev: handlePrev, onNext: handleNext, canPrev: canGoPrev, canNext: !isCurrentPeriod });

  // Old Patterns/Trends links remain valid: they now request and scroll to
  // the inline chart stop instead of opening a separate page state.
  useEffect(() => {
    const v = searchParams.get("view");
    if (v === "upcoming") { router.replace("/upcoming"); return; }
    if (!["patterns", "trends", "charts"].includes(v ?? "")) return;
    setChartsRequested(true);
    if (showFullSkeleton) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById("spend-journey-charts")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [searchParams, router, showFullSkeleton]);


  function handleTxUpdated(updated: Transaction, additionalIds?: string[]) {
    invalidateTransactionsCache();
    // Re-categorising moves what "usual" means for both categories involved
    // — and can move which categories are notable/majority for any period,
    // not just the one currently in view.
    invalidateSignalsCache();
    invalidateVerdictCache();
    setAllTransactions((prev) =>
      prev.map((t) => {
        if (t.id === updated.id) return { ...t, category: updated.category };
        if (additionalIds?.includes(t.id)) return { ...t, category: updated.category };
        return t;
      })
    );
    // A recategorise can clear (or add) a miscategorised flag — refresh the
    // chip's count/ids so it drops off once the flagged transfer is fixed.
    fetchMiscategorisedCount(periodOffset);
    // A correction can move which categories are notable/majority this period.
    fetchVerdict(periodOffset);
  }

  const sym = "£";
  const wholeMoney = (value: number) => `${value < 0 ? "−" : ""}${sym}${Math.abs(Math.round(value)).toLocaleString("en-GB")}`;
  const latestPace = verdict ? [...(verdict.pace_series ?? [])].reverse().find((point) => point.usual != null) : undefined;
  const paceDifference = verdict && latestPace?.usual != null ? verdict.pills.spent - latestPace.usual : null;
  const journeyDestinations: SpendJourneyDestination[] = verdict ? [
    ...(verdict.notables.length > 0 ? [{
      id: "spend-journey-changes",
      label: "Changes",
      value: paceDifference == null
        ? `${verdict.notables.length} to review`
        : <span className="font-mono tabular-nums">{wholeMoney(Math.abs(paceDifference))}</span>,
      needsLook: paceDifference != null && paceDifference > 0,
    }] : []),
    ...(verdict.unresolved.total > 0 ? [{
      id: "spend-unresolved",
      label: "To categorise",
      value: <>{verdict.unresolved.payments_count} payment{verdict.unresolved.payments_count === 1 ? "" : "s"} · <span className="font-mono tabular-nums">{wholeMoney(verdict.unresolved.total)}</span></>,
    }] : []),
    {
      id: "spend-majority-section",
      label: "Spending",
      value: <span className="font-mono tabular-nums">{wholeMoney(verdict.majority.reduce((sum, row) => sum + Math.max(0, row.spent), 0))}</span>,
    },
    {
      id: "spend-journey-charts",
      label: "Charts",
      value: `${spendWidgets?.length ?? 4} shown`,
      onBeforeJump: () => setChartsRequested(true),
    },
  ] : [];

  // Cold-load hold — see `showFullSkeleton` above. Placed after every hook
  // in the component (same pattern as AccountsPage.tsx's detail-view/list-
  // view branches) so every effect above — including the category deep-link
  // redirect and its `rawPrefs`-gated timer — keeps running exactly the
  // same regardless of which tree actually renders; a pending redirect
  // still fires router.replace("/transactions?…") while the skeleton (or
  // the real page) is on screen, unaffected by this branch.
  if (showFullSkeleton) {
    return <SpendSkeleton />;
  }

  return (
    <div className="mx-auto min-h-dvh max-w-6xl px-4 pb-[calc(9rem+env(safe-area-inset-bottom,0px))] pt-5 sm:px-6 lg:px-8 lg:pb-8" style={{ paddingTop: "max(1.25rem, env(safe-area-inset-top, 0px))" }}>
      <SpendPeriodBar
        verdict={verdict}
        periodLabel={formatPeriodLocal(periodStart, periodEnd)}
        isCurrentPeriod={isCurrentPeriod}
        canGoPrev={canGoPrev}
        onPrev={handlePrev}
        onNext={handleNext}
        swipeHandlers={periodSwipe}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenRules={() => setRulesOpen(true)}
        incomeTxns={incomeTxns}
        onIncomeOpen={() => setTransactionsRequested(true)}
        onTransactionClick={(tx) => { setAskHandoffTxId(null); setSelectedTx(tx); }}
        onOutTap={handleOutTap}
        onMovedTap={handleMovedTap}
        onUnresolvedTap={handleUnresolvedTap}
        recentPeriods={recentPeriods}
        onSelectOffset={handleSelectOffset}
      />

      <div className="mt-7 grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(260px,0.72fr)_minmax(0,1.45fr)] lg:gap-14">
        <section aria-label="Pay period summary" className="min-w-0 lg:sticky lg:top-6">
          <SpendJourneySummary
            verdict={verdict}
            periodLabel={formatPeriodLocal(periodStart, periodEnd)}
            isCurrentPeriod={isCurrentPeriod}
            canGoPrev={canGoPrev}
            onPrev={handlePrev}
            onNext={handleNext}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenRules={() => setRulesOpen(true)}
            incomeTxns={incomeTxns}
            onIncomeOpen={() => setTransactionsRequested(true)}
            onTransactionClick={(tx) => { setAskHandoffTxId(null); setSelectedTx(tx); }}
            onOutTap={handleOutTap}
            onMovedTap={handleMovedTap}
            onUnresolvedTap={handleUnresolvedTap}
            recentPeriods={recentPeriods}
            onSelectOffset={handleSelectOffset}
          />
          {verdict && <div className="mt-5 hidden lg:block"><SpendJourneyNav destinations={journeyDestinations} desktop /></div>}
        </section>

        {verdict && (
          <div className="sticky top-0 z-30 -mx-4 min-w-0 bg-[#f0f2f7]/95 px-4 py-2 backdrop-blur-sm dark:bg-[#0f172a]/95 lg:hidden">
            <SpendJourneyNav destinations={journeyDestinations} />
          </div>
        )}

        <main data-tutorial-id="tutorial-spend-categories" className="relative min-w-0 pl-8 before:absolute before:bottom-3 before:left-[11px] before:top-3 before:w-px before:bg-slate-300 dark:before:bg-slate-600 sm:pl-10 lg:col-start-2 lg:row-start-1">
          {verdict ? (
            <>
              <section className="relative pb-10">
                <span className="absolute -left-8 top-1 flex size-6 items-center justify-center rounded-full bg-indigo-600 text-white ring-4 ring-[#f0f2f7] dark:ring-[#0f172a] sm:-left-10" aria-hidden="true">
                  <WalletCards size={12} />
                </span>
                <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-600 dark:text-slate-400">Pay arrived · {periodStart.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</p>
                <h2 className="mt-2 text-xl font-bold text-slate-950 dark:text-white"><span className="font-mono tabular-nums">{wholeMoney(verdict.pills.income)}</span> recorded coming in</h2>
              </section>

              <SpendVerdictView
                verdict={verdict}
                colours={colours}
                hideReading
                journey
                categoryInsights={categoryInsights}
                expandMajoritySignal={expandSignal}
                miscategorisedCount={miscategorisedCount}
                pairCount={pairCount}
                reviewTotal={reviewTotal}
                onMiscategorisedTap={handleMiscategorisedTap}
                onOpenCategory={(name) => {
                  const params = new URLSearchParams();
                  params.set("category", name);
                  params.set("from", isoDate(periodStart));
                  params.set("to", isoDate(periodEnd));
                  router.push(`/transactions?${params.toString()}`);
                }}
                unresolvedAccountName={accounts.find(a => a.id === verdict.unresolved.largest?.account_id)?.name}
                onOpenMoved={(m) => {
                  if (!m.categories || m.categories.length === 0) return;
                  const params = new URLSearchParams();
                  m.categories.forEach((category) => params.append("categories", category));
                  params.set("txn_type", "debit");
                  params.set("from", isoDate(periodStart));
                  params.set("to", isoDate(periodEnd));
                  params.set("label", m.label);
                  router.push(`/transactions?${params.toString()}`);
                }}
                initialMajorityExpanded={restoredUi.majorityExpanded}
                onMajorityExpandedChange={(expanded) => writeSpendUiState({ majorityExpanded: expanded })}
                initialMovedOpen={restoredUi.movedOpen}
                onMovedOpenChange={(open) => writeSpendUiState({ movedOpen: open })}
                signals={signals}
                sym={sym}
                onAimChanged={refetchSignals}
                onIntent={(category, answer) => api.recordTrendIntent(category, answer)
                  // G83 fix-round: same "the cache would otherwise repaint
                  // the pre-decision verdict" gap as handleUndo/
                  // handleFileNewNormal above — this is the one_off/
                  // new_normal answer path reached from SpendVerdictView's
                  // own inline controls rather than the consent sheet.
                  .then(() => { refetchSignals(); invalidateVerdictCache(); fetchVerdict(periodOffset); })}
                resolved={resolved}
                onResolved={handleResolved}
                onNewNormalRequest={(category) => { setFileError(false); setConsentFor(category); }}
                onAskCorrect={() => {
                  const largest = verdict.unresolved.largest;
                  if (!largest) return;
                  setAskHandoffTxId(largest.id);
                  setSelectedTx({
                    id: largest.id,
                    account_id: largest.account_id ?? "",
                    date: largest.date,
                    amount: largest.amount,
                    currency: "GBP",
                    description: largest.raw_description,
                    merchant_name: largest.display_name || undefined,
                    category: "Other",
                    transaction_type: "debit",
                  });
                }}
              />

              <section className="relative scroll-mt-24 pb-10">
                <span aria-hidden="true" className="absolute -left-8 top-1 size-6 rounded-full border-[6px] border-emerald-400 bg-white ring-4 ring-[#f0f2f7] dark:bg-slate-900 dark:ring-[#0f172a] sm:-left-10" />
                <SpendShapeCard shape={moneyShape} hideValues={hideNetWorth} onOpen={() => router.push("/spend/shape")} />
              </section>

              <section ref={setChartsAnchor} id="spend-journey-charts" tabIndex={-1} className="relative scroll-mt-24 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
                <span className="absolute -left-8 top-1 flex size-6 items-center justify-center rounded-full border border-indigo-300 bg-indigo-50 text-indigo-700 ring-4 ring-[#f0f2f7] dark:border-indigo-400/30 dark:bg-indigo-400/10 dark:text-indigo-300 dark:ring-[#0f172a] sm:-left-10" aria-hidden="true">
                  <BarChart3 size={12} />
                </span>
                <h2 className="text-xl font-bold text-slate-950 dark:text-white">Your charts</h2>
                <p className="mt-1 max-w-2xl text-pretty text-[13px] leading-5 text-slate-600 dark:text-slate-400">Choose what appears here, drag the handle to reorder, or pin one chart to Home.</p>
                {!chartsRequested || pageLoading ? (
                  <div className="flex min-h-36 items-center justify-center" aria-label="Loading charts"><Spinner size={32} /></div>
                ) : (
                  <SpendTrends
                    embedded
                    periodTxns={homeTxns}
                    allTxns={homeAllTxns}
                    periodStart={periodStart}
                    periodEnd={periodEnd}
                    payPeriodConfig={payPeriodConfig}
                    colours={colours}
                    paceSeries={verdict.pace_series}
                    onReviewLarge={() => {
                      const large = listTxns.filter((tx) => Math.abs(tx.amount) >= 250);
                      setOpenCategory({
                        name: "Other",
                        title: "Payments over £250",
                        total: large.reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0),
                        count: large.length,
                        transactions: large,
                        pct: 0,
                      });
                    }}
                  />
                )}
              </section>
            </>
          ) : verdictLoading ? (
            <div className="flex items-center justify-center py-16"><Spinner size={32} /></div>
          ) : (
            <div className="glass-card rounded-2xl p-8 text-center">
              <p className="text-sm text-slate-500 dark:text-slate-400">Couldn&apos;t load this period. Try again shortly.</p>
            </div>
          )}
        </main>
      </div>

      {/* Category sheet — survives ONLY for the synthetic "Payments over
          £250" list (Spend Trends' onReviewLarge, below): an amount-
          threshold cut across every category, which the hub's
          category/merchants/period filters can't express. Every real
          category now opens the hub instead (Task 3/5), so `door` (the aim
          mechanism) never applies here any more — it lives on the notable
          card (SpendVerdictView's AimBlock) for real categories. */}
      {openCategory && (
        <CategorySheet
          name={openCategory.name}
          title={openCategory.title}
          total={openCategory.total}
          count={openCategory.count}
          transactions={openCategory.transactions}
          sym={sym}
          onClose={() => setOpenCategory(null)}
          onTransactionClick={(tx) => { setOpenCategory(null); setAskHandoffTxId(null); setSelectedTx(tx); }}
          isPro={isPro}
        />
      )}

      {/* Teaching sheet — absorbs the recategorise flow for every entry
          point into a transaction from Spend (category rows, income
          drill-down, the miscategorised guardrail's "Recategorise", and the
          ask card's "Tell me what this was"). */}
      {selectedTx && (
        <TeachingSheet
          transaction={selectedTx}
          onClose={() => { setSelectedTx(null); setAskHandoffTxId(null); }}
          onUpdated={handleTxUpdated}
          account={accounts.find(a => a.id === selectedTx.account_id)}
          forceMovementRoot={selectedTx.id === askHandoffTxId}
        />
      )}

      {/* Miscategorised-transfers review sheet — "Recategorise" opens the
          TeachingSheet on top (stacked), reusing the same selectedTx state
          and onUpdated handler as everywhere else. */}
      {reviewOpen && (
        <MiscategorisedReviewSheet
          onClose={() => setReviewOpen(false)}
          onRecategorise={(tx) => { setAskHandoffTxId(null); setSelectedTx(tx); }}
          onChanged={() => {
            fetchMiscategorisedCount(periodOffset);
            // G83 fix-round: a dismiss / transfer-pair confirm-reject here
            // can change what "money you moved"/notables show, same as any
            // other transaction-affecting write — without this the TTL
            // cache would just repaint the pre-change verdict.
            invalidateVerdictCache();
            fetchVerdict(periodOffset);
          }}
          accounts={accounts}
          // The sheet lists every flagged series all-time, but the banner
          // that opens it is period-scoped — passing periodStart lets the
          // sheet split into "This period"/"Earlier periods" so the two
          // deliberately-different scopes read as explained, not buggy.
          periodStart={periodStart}
        />
      )}

      {/* Categorisation rules sheet — explains the money-to-self rules */}
      {rulesOpen && (
        <CategorisationRulesSheet onClose={() => setRulesOpen(false)} />
      )}

      {/* Pay period settings sheet */}
      {settingsOpen && (
        <PayPeriodSettingsSheet
          current={payPeriodConfig}
          onClose={() => setSettingsOpen(false)}
          onSave={(config) => {
            setPayPeriodConfig(config);
            setSettingsOpen(false);
          }}
        />
      )}

      {/* "New normal" consent sheet — opened by a notable card's "New
          normal" tap (onNewNormalRequest above). "File it" runs the real
          intent write here (handleFileNewNormal) and only resolves the card
          + shows the toast once that succeeds; a failed write keeps the
          sheet open with its own inline error. "Keep as one-off for now"
          and the close X both just dismiss the sheet, leaving the card's
          own intent pair untouched for a later tap. */}
      {consentFor && (
        <IntentConsentSheet
          category={consentFor}
          onFile={handleFileNewNormal}
          onKeepOneOff={closeConsentSheet}
          onClose={closeConsentSheet}
          filing={filing}
          fileError={fileError}
        />
      )}

      {/* Resolve toast — one instance for both "One-off" (on-card) and
          "New normal" (via the consent sheet) resolves. key={category+answer}
          forces a fresh remount (and fresh 5s timer) if a different resolve
          fires while one is already showing. */}
      {toast && (
        <ResolveToast
          key={`${toast.category}-${toast.answer}`}
          category={toast.category}
          answer={toast.answer}
          onUndo={() => handleUndo(toast.category)}
          onDone={() => setToast(null)}
        />
      )}

      {/* Undo failure — brief, separate from the resolve toast above (the
          resolved state has already been restored by the time this shows). */}
      {undoError && (
        <div
          role="alert"
          className="fixed left-1/2 -translate-x-1/2 z-[80] w-[calc(100%-24px)] max-w-[406px] glass-card-flat rounded-2xl p-3 text-center shadow-sm"
          style={{ bottom: "76px" }}
        >
          <p className="text-[12px] font-semibold text-red-600 dark:text-red-400">
            Couldn&apos;t undo that, try again.
          </p>
        </div>
      )}
    </div>
  );
}
