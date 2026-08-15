"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { api, Account, Transaction, CategorySignal, SpendVerdict } from "@/lib/api";
import { useAllTransactions, invalidateTransactionsCache } from "@/lib/useAllTransactions";
import { useColours } from "@/components/ColourProvider";
import { getToken, setToken } from "@/lib/auth";
import {
  getPayPeriodWithConfig,
  prevPeriodWithConfig,
  nextPeriodWithConfig,
  filterPeriod,
} from "@/lib/payPeriod";
import { usePreferences } from "@/components/PreferencesContext";
import { usePeriodSwipe } from "@/lib/usePeriodSwipe";
import { isHomeCurrency } from "@/lib/currency";
import { CategoryData } from "@/components/CategoryRow";
import CategorySheet from "@/components/CategorySheet";
import TeachingSheet from "@/components/TeachingSheet";
import MiscategorisedReviewSheet from "@/components/MiscategorisedReviewSheet";
import CategorisationRulesSheet from "@/components/CategorisationRulesSheet";
import BottomNav from "@/components/BottomNav";
import Spinner from "@/components/Spinner";
import SpendTrends from "@/components/SpendTrends";
import SpendVerdictView from "@/components/SpendVerdictView";
import SpendHeader, { SpendPatternsToggle, RecentPeriodOption } from "@/components/SpendHeader";
import PayPeriodSettingsSheet, { formatPeriodLocal } from "@/components/PayPeriodSettingsSheet";

async function ensureAuth() {}

const SKIP_FROM_SPEND = new Set(["Transfer"]);

// YYYY-MM-DD in the date's own UTC calendar day — periodStart/periodEnd are
// built with Date.UTC (lib/payPeriod.ts), so this reads back the exact day
// boundary the period math intended, matching what the hub's `from`/`to`
// query params (backend/app/routers/transactions.py) expect.
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ── Category-signal cache (module level, per period offset) ──────────────────
// The tiles themselves render from `useAllTransactions`, which is memoised for
// 60 s — so on a revisit or a period swipe the amounts paint instantly while a
// freshly-fetched multiple lands a round trip later. That gap is the whole
// "× usual appears late" symptom. Mirroring the transactions cache (same TTL,
// same in-flight dedupe) closes it: a period we have already read is instant.
// Any mutation that can move a multiple clears this cache explicitly.
type SignalMap = Record<string, CategorySignal>;
const SIGNALS_TTL_MS = 60_000;
const signalsCache = new Map<number, { data: SignalMap; at: number }>();
const signalsInflight = new Map<number, Promise<SignalMap>>();

export function invalidateSignalsCache() {
  signalsCache.clear();
  signalsInflight.clear();
}

function cachedSignals(offset: number): SignalMap | null {
  const hit = signalsCache.get(offset);
  return hit && Date.now() - hit.at < SIGNALS_TTL_MS ? hit.data : null;
}

function fetchSignals(offset: number, force = false): Promise<SignalMap> {
  if (!force) {
    const hit = cachedSignals(offset);
    if (hit) return Promise.resolve(hit);
    const pending = signalsInflight.get(offset);
    if (pending) return pending;
  }
  const p = api.categorySignals(offset)
    .then(d => {
      const data = d.signals ?? {};
      signalsCache.set(offset, { data, at: Date.now() });
      return data;
    })
    .finally(() => { signalsInflight.delete(offset); });
  signalsInflight.set(offset, p);
  return p;
}

// ── Verdict cache (module level, per period offset) ──────────────────────────
// Same shape as the signals cache above, for the same reason: a revisit (most
// commonly BACK-navigation from /transactions, since every category tap and
// the header search icon now push a real route instead of opening a sheet)
// should paint the last-known verdict immediately instead of a spinner at
// near-zero height — there's nothing to scroll-restore onto otherwise. Unlike
// signals, every read here also kicks off a silent revalidation against the
// server so a stale cached verdict never lingers past one paint.
const VERDICT_TTL_MS = 90_000; // matches the server's own /spend/verdict cache window
const verdictCache = new Map<number, { data: SpendVerdict; at: number }>();
const verdictInflight = new Map<number, Promise<SpendVerdict>>();

export function invalidateVerdictCache() {
  verdictCache.clear();
  verdictInflight.clear();
}

function cachedVerdict(offset: number): SpendVerdict | null {
  const hit = verdictCache.get(offset);
  return hit && Date.now() - hit.at < VERDICT_TTL_MS ? hit.data : null;
}

function fetchVerdictData(offset: number): Promise<SpendVerdict> {
  const pending = verdictInflight.get(offset);
  if (pending) return pending;
  const p = api.spendVerdict(offset)
    .then(v => {
      verdictCache.set(offset, { data: v, at: Date.now() });
      return v;
    })
    .finally(() => { verdictInflight.delete(offset); });
  verdictInflight.set(offset, p);
  return p;
}

export default function SpendPage() {
  const { payPeriodConfig, setPayPeriodConfig, region } = usePreferences();
  const { colours } = useColours();
  const searchParams = useSearchParams();
  const router = useRouter();
  // The old three-way Categories/Transactions/Trends tabs are retired — the
  // verdict hub replaces the first two; only the quiet "This period ·
  // Patterns" split survives (approved spec, "NO Categories/Transactions/
  // Trends tabs").
  const [showPatterns, setShowPatterns] = useState<boolean>(() => searchParams.get("view") === "trends");
  const { transactions: allTransactions, loading: txLoading, setTransactions: setAllTransactions } = useAllTransactions();
  const [loading, setLoading] = useState(true);
  const [periodStart, setPeriodStart] = useState<Date>(() => {
    const [s] = getPayPeriodWithConfig(new Date(), { type: "calendar_month" });
    return s;
  });
  const [periodEnd, setPeriodEnd] = useState<Date>(() => {
    const [, e] = getPayPeriodWithConfig(new Date(), { type: "calendar_month" });
    return e;
  });
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
  const [periodOffset, setPeriodOffset] = useState(0);
  const [signals, setSignals] = useState<SignalMap>(() => cachedSignals(0) ?? {});
  const signalsOffsetRef = useRef(0);
  // force = the Door or a category just changed, so the cached copy is dead.
  const refetchSignals = useCallback((force = true) => {
    const captured = signalsOffsetRef.current;
    if (force) invalidateSignalsCache();
    fetchSignals(captured, force)
      .then(d => { if (signalsOffsetRef.current === captured) setSignals(d); })
      .catch(() => { if (signalsOffsetRef.current === captured) setSignals({}); });
  }, []);
  useEffect(() => {
    signalsOffsetRef.current = periodOffset;
    // Only blank the multiples when we have nothing for this period — a
    // remembered period keeps its readings and never flashes empty.
    const hit = cachedSignals(periodOffset);
    setSignals(hit ?? {});
    if (!hit) refetchSignals(false);
    // Warm the period the user is one swipe away from, after this one settles.
    const warm = setTimeout(() => { fetchSignals(periodOffset - 1).catch(() => {}); }, 400);
    return () => clearTimeout(warm);
  }, [periodOffset, refetchSignals]);

  // ── /spend/verdict — the reading + notable cards + ask/unresolved +
  // majority rows + money-you-moved. Seeded from the module-level cache
  // above so a revisit (period swipe back, or BACK-navigation from
  // /transactions) paints instantly; every read still revalidates against
  // the server and updates in place — never a stale-data lie, just an
  // instant first paint while the fresh copy lands a round trip later.
  const [verdict, setVerdict] = useState<SpendVerdict | null>(() => cachedVerdict(0));
  const [verdictLoading, setVerdictLoading] = useState(() => cachedVerdict(0) == null);
  const verdictOffsetRef = useRef(0);
  // `silent` = we already have something on screen for this offset (cache
  // or a previous fetch) — revalidate in the background without flipping
  // the spinner back on, and never blank a good verdict on a transient error.
  const fetchVerdict = useCallback((offset: number, silent = false) => {
    verdictOffsetRef.current = offset;
    if (!silent) setVerdictLoading(true);
    fetchVerdictData(offset)
      .then(v => { if (verdictOffsetRef.current === offset) setVerdict(v); })
      .catch(() => { if (verdictOffsetRef.current === offset && !silent) setVerdict(null); })
      .finally(() => { if (verdictOffsetRef.current === offset) setVerdictLoading(false); });
  }, []);
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
  }, [periodOffset, fetchVerdict]);

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

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isPro, setIsPro] = useState<boolean>(false);
  const [miscategorisedCount, setMiscategorisedCount] = useState(0);
  const [miscategorisedIds, setMiscategorisedIds] = useState<string[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);

  const loadData = useCallback(async () => {
    try {
      await ensureAuth();
      const accs = await api.accounts().catch(() => [] as Account[]);
      setAccounts(accs);
      api.getMiscategorisedCount()
        .then(m => { setMiscategorisedCount(m.count); setMiscategorisedIds(m.ids); })
        .catch(() => {});
    } catch {}
    finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    api.getSubscription()
      .then(s => setIsPro(s.tier !== "free"))
      .catch(() => setIsPro(true));
  }, []);

  // Category deep-link — e.g. from RhythmCard "I'd like to change this"
  // (sessionStorage). Insight cards route straight to /transactions now
  // (savings_insights.py's CATEGORY_APP_ROUTES) so this is the one surviving
  // producer of "/spend?category=X" — RhythmCard's rhythm item is about
  // *this period's* pattern, so the redirect below carries the live period
  // as the hub's removable period chip rather than landing on all-time.
  // Task 3 — every category tap now opens the global hub, never the sheet.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const cat = sessionStorage.getItem("wealth_open_category") ?? searchParams.get("category");
    if (cat) {
      sessionStorage.removeItem("wealth_open_category");
      const merchants = searchParams.get("merchants");
      const params = new URLSearchParams();
      params.set("category", cat);
      if (merchants) params.set("merchants", merchants);
      params.set("from", isoDate(periodStart));
      params.set("to", isoDate(periodEnd));
      router.replace(`/transactions?${params.toString()}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Page is ready once both accounts and transactions are loaded.
  const pageLoading = loading || txLoading;

  // Re-initialise period when config loads/changes
  const configKey = JSON.stringify(payPeriodConfig);
  useEffect(() => {
    const [s, e] = getPayPeriodWithConfig(new Date(), payPeriodConfig);
    setPeriodStart(s);
    setPeriodEnd(e);
    setPeriodOffset(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configKey]);

  // Period txns
  const periodTxns = useMemo(
    () => filterPeriod(allTransactions, periodStart, periodEnd),
    [allTransactions, periodStart, periodEnd]
  );

  // Totals are single-currency: foreign-currency transactions (e.g. a KES
  // statement import) show in the list with their own symbol but must not be
  // summed into home-currency figures
  const homeTxns = useMemo(
    () => periodTxns.filter(tx => isHomeCurrency(tx.currency, region)),
    [periodTxns, region]
  );
  const homeAllTxns = useMemo(
    () => allTransactions.filter(tx => isHomeCurrency(tx.currency, region)),
    [allTransactions, region]
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
  // are refunds and live in their own category
  const incomeTxns = useMemo(
    () =>
      homeTxns
        .filter(
          (tx) =>
            tx.transaction_type === "credit" &&
            (tx.category || "Other") === "Income"
        )
        .sort(
          (a, b) =>
            new Date(b.date).getTime() - new Date(a.date).getTime()
        ),
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
    const [s, e] = prevPeriodWithConfig(periodStart, payPeriodConfig);
    setPeriodStart(s);
    setPeriodEnd(e);
    setPeriodOffset(o => o - 1);
  }

  function handleNext() {
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

  // Sync the This period/Patterns split with ?view= when it changes (e.g. a
  // deep-link from the home strip). "list" — the retired Transactions view —
  // falls back to "This period", the hub that replaces it.
  useEffect(() => {
    const v = searchParams.get("view");
    if (v === "upcoming") { router.replace("/planning"); return; }
    if (v === "trends") setShowPatterns(true);
    else if (v === "categories" || v === "list") setShowPatterns(false);
  }, [searchParams, router]);


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
    api.getMiscategorisedCount()
      .then(m => { setMiscategorisedCount(m.count); setMiscategorisedIds(m.ids); })
      .catch(() => {});
    // A correction can move which categories are notable/majority this period.
    fetchVerdict(periodOffset);
  }

  const sym = region === "Kenya" ? "KES " : "£";

  return (
    <div className="min-h-dvh pb-[calc(9rem+env(safe-area-inset-bottom,0px))] lg:pb-8 lg:max-w-6xl lg:mx-auto" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      {/* Header — shared with /design/spend-live so the two can never draw
          different Spent/Income figures again (SpendHeader.tsx). */}
      <SpendHeader
        verdict={verdict}
        loading={pageLoading}
        periodLabel={formatPeriodLocal(periodStart, periodEnd)}
        isCurrentPeriod={isCurrentPeriod}
        canGoPrev={canGoPrev}
        onPrev={handlePrev}
        onNext={handleNext}
        swipeHandlers={periodSwipe}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenRules={() => setRulesOpen(true)}
        incomeTxns={incomeTxns}
        onTransactionClick={(tx) => { setAskHandoffTxId(null); setSelectedTx(tx); }}
        onOutTap={handleOutTap}
        recentPeriods={recentPeriods}
        onSelectOffset={handleSelectOffset}
      />

      {/* This period — the verdict hub — or Patterns (SpendTrends, unchanged).
          The This period/Over time tablist moves with the content it
          switches: inside SpendVerdictView's aboveMajority slot when "This
          period" is showing, above SpendTrends when "Over time" is. */}
      {!showPatterns ? (
        <div className="px-4 pt-4" data-tutorial-id="tutorial-spend-categories">
          {verdict ? (
            // A cached verdict (warm from a previous visit — see
            // cachedVerdict above) paints immediately even while pageLoading
            // (accounts/transactions) or a silent revalidation is still in
            // flight; this is what makes the page restorable on BACK-nav —
            // there's no spinner-at-near-zero-height for ScrollReset's
            // gated restore to land on.
            <SpendVerdictView
              verdict={verdict}
              colours={colours}
              hideReading
              expandMajoritySignal={expandSignal}
              aboveMajority={<SpendPatternsToggle showPatterns={showPatterns} onSetShowPatterns={setShowPatterns} />}
              miscategorisedCount={miscategorisedCount}
              onMiscategorisedTap={handleMiscategorisedTap}
              // Task 3 — every category tap (notable card's "See the N
              // payments", every majority row) opens the global hub with
              // both the category and this period pre-applied as removable
              // chips, instead of CategorySheet.
              onOpenCategory={(name) => {
                const params = new URLSearchParams();
                params.set("category", name);
                params.set("from", isoDate(periodStart));
                params.set("to", isoDate(periodEnd));
                router.push(`/transactions?${params.toString()}`);
              }}
              signals={signals}
              sym={sym}
              onAimChanged={refetchSignals}
              onIntent={(category, answer) => {
                // Returns the request promise (no swallowed .catch()) so the
                // card can await the real result and only claim success once
                // the write has actually landed — see SpendVerdictView.
                return api.recordTrendIntent(category, answer)
                  .then(() => { refetchSignals(); fetchVerdict(periodOffset); });
              }}
              onAskCorrect={() => {
                // "Tell me what this was" opens the teaching sheet directly
                // on the unresolved transaction — no detour through a
                // synthetic "Other" category sheet first. category stays
                // "Other" (honest — that's what the row really is); the
                // sheet is told separately (forceMovementRoot below) to
                // open on "Is this account yours?" rather than the spend
                // picker, matching /design/spend-live's preview of this
                // handoff (fix-round Blocker 4 — the Destination Rule's
                // movement question is the better first question for a
                // payment the engine explicitly couldn't place).
                const largest = verdict.unresolved.largest;
                if (!largest) return;
                setAskHandoffTxId(largest.id);
                setSelectedTx({
                  id: largest.id,
                  account_id: "",
                  date: largest.date,
                  amount: largest.amount,
                  currency: region === "Kenya" ? "KES" : "GBP",
                  // description carries the raw provider string (the sheet's
                  // evidence line); merchant_name only carries a display_name
                  // when one actually survived the cleanup — never launder
                  // the raw string into the field that means "cleaned
                  // merchant" (TeachingSheet's `name` falls back to
                  // `description` automatically when this is undefined).
                  description: largest.raw_description,
                  merchant_name: largest.display_name || undefined,
                  category: "Other",
                  transaction_type: "debit",
                });
              }}
            />
          ) : pageLoading || verdictLoading ? (
            <div className="flex items-center justify-center py-16">
              <Spinner size={32} />
            </div>
          ) : (
            <div className="glass-card rounded-2xl p-8 text-center">
              <p className="text-slate-500 dark:text-slate-400 text-sm">Couldn&apos;t load this period. Try again shortly.</p>
            </div>
          )}
        </div>
      ) : (
        <>
          {pageLoading ? (
            <div className="flex items-center justify-center py-16">
              <Spinner size={32} />
            </div>
          ) : (
            <>
              <div className="px-4 pt-4">
                <SpendPatternsToggle showPatterns={showPatterns} onSetShowPatterns={setShowPatterns} />
              </div>
              <SpendTrends
                periodTxns={homeTxns}
                allTxns={homeAllTxns}
                periodStart={periodStart}
                periodEnd={periodEnd}
                payPeriodConfig={payPeriodConfig}
                colours={colours}
                onReviewLarge={() => {
                  // No standalone Transactions/list view survives the redesign
                  // — reuse the existing CategorySheet as a synthetic, scoped
                  // list rather than inventing a new surface.
                  const large = listTxns.filter((tx) => Math.abs(tx.amount) >= 250);
                  setOpenCategory({
                    name: "Other",
                    title: "Payments over £250",
                    total: large.reduce((s, t) => s + Math.abs(t.amount), 0),
                    count: large.length,
                    transactions: large,
                    pct: 0,
                  });
                }}
              />
            </>
          )}
        </>
      )}

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
          account={accounts.find(a => a.id === selectedTx.account_id) ? { name: accounts.find(a => a.id === selectedTx.account_id)!.name, provider: accounts.find(a => a.id === selectedTx.account_id)!.provider } : undefined}
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
            api.getMiscategorisedCount()
              .then(m => { setMiscategorisedCount(m.count); setMiscategorisedIds(m.ids); })
              .catch(() => {});
            fetchVerdict(periodOffset);
          }}
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

      <BottomNav />
    </div>
  );
}
