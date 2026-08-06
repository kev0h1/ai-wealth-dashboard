/**
 * SpendScreen — native Spend tab (replaces DashboardWebView stub).
 *
 * Architecture:
 *   - All data fetched on mount + on period change
 *   - Category signals cached per offset (60s TTL, in-flight dedup)
 *   - Period navigation via chevron buttons + horizontal swipe (PanResponder)
 *   - View switching: Categories | Transactions | Trends (SegmentedControl)
 *   - Income drill-down below summary pills
 *   - Untracked (Transfer) collapsible section
 *   - Category sheet → TransactionSheet flow
 *   - Toast for "largeOnly" filter (2.5s)
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  PanResponder,
  Animated,
  StyleSheet,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ChevronDown,
  ChevronUp,
  SlidersHorizontal,
} from "lucide-react-native";
import { tw } from "@/lib/tw";
import { useTheme } from "@/lib/ThemeContext";
import { api } from "@/lib/api";
import type { Account } from "@/lib/api";
import { spendApi } from "@/lib/api/spend";
import type { CategorySignal, Transaction } from "@/lib/api/spend";
import { CATEGORY_COLOURS, CATEGORY_ICONS } from "@/lib/shared";
import { SegmentedControl, Skeleton } from "@/components/ui";
import {
  getCurrentPeriod,
  prevPeriod,
  nextPeriod,
  isSamePeriod,
  filterPeriod,
  isHomeCurrency,
} from "@/components/spend/periodUtils";
import type { PeriodBounds } from "@/components/spend/periodUtils";
import { PeriodNav } from "@/components/spend/PeriodNav";
import { CategoryGrid } from "@/components/spend/CategoryGrid";
import type { CategoryData } from "@/components/spend/CategoryGrid";
import { TransactionsList, TransactionRow } from "@/components/spend/TransactionsList";
import { SpendCategorySheet } from "@/components/spend/SpendCategorySheet";
import { TransactionSheet } from "@/components/spend/TransactionSheet";
import { SpendTrends } from "@/components/spend/SpendTrends";

// ── Signals cache (module-level, per offset, 60s TTL) ─────────────────────────

type SignalMap = Record<string, CategorySignal>;
const SIGNALS_TTL_MS = 60_000;
const signalsCache = new Map<number, { data: SignalMap; at: number }>();
const signalsInflight = new Map<number, Promise<SignalMap>>();

function cachedSignals(offset: number): SignalMap | null {
  const hit = signalsCache.get(offset);
  return hit && Date.now() - hit.at < SIGNALS_TTL_MS ? hit.data : null;
}

function invalidateSignalsCache() {
  signalsCache.clear();
  signalsInflight.clear();
}

function fetchSignals(offset: number, force = false): Promise<SignalMap> {
  if (!force) {
    const hit = cachedSignals(offset);
    if (hit) return Promise.resolve(hit);
    const pending = signalsInflight.get(offset);
    if (pending) return pending;
  }
  const p = spendApi
    .categorySignals(offset)
    .then((d) => {
      const data: SignalMap = d.signals ?? {};
      signalsCache.set(offset, { data, at: Date.now() });
      return data;
    })
    .finally(() => {
      signalsInflight.delete(offset);
    });
  signalsInflight.set(offset, p);
  return p;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const SKIP_FROM_SPEND = new Set(["Transfer"]);

function fmtSummary(n: number): string {
  return `£${Math.abs(n).toLocaleString("en-GB", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

// ── SpendScreen ───────────────────────────────────────────────────────────────

type ViewTab = "categories" | "list" | "trends";

export default function SpendScreen() {
  const { dark } = useTheme();
  const insets = useSafeAreaInsets();

  // ── Period state ────────────────────────────────────────────────────────────
  const [period, setPeriod] = useState<PeriodBounds>(() => getCurrentPeriod());
  const [periodOffset, setPeriodOffset] = useState(0);
  const currentPeriod = useMemo(() => getCurrentPeriod(), []);
  const isCurrentPeriod = isSamePeriod(period, currentPeriod);

  // ── Data state ──────────────────────────────────────────────────────────────
  const [allTransactions, setAllTransactions] = useState<Transaction[]>([]);
  const [txLoading, setTxLoading] = useState(true);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [oldestTxDate, setOldestTxDate] = useState<Date | null>(null);
  const [isPro, setIsPro] = useState(false);
  const [allCategories, setAllCategories] = useState<string[]>([]);
  const [signals, setSignals] = useState<SignalMap>(() => cachedSignals(0) ?? {});
  const [refreshing, setRefreshing] = useState(false);
  const signalsOffsetRef = useRef(0);

  // ── View state ──────────────────────────────────────────────────────────────
  const [view, setView] = useState<ViewTab>("categories");
  const [incomeExpanded, setIncomeExpanded] = useState(false);
  const [untrackedOpen, setUntrackedOpen] = useState(false);
  const [largeOnly, setLargeOnly] = useState(false);
  const [largeToast, setLargeToast] = useState(false);
  const toastOpacity = useRef(new Animated.Value(0)).current;

  // ── Sheet state ─────────────────────────────────────────────────────────────
  const [openCategory, setOpenCategory] = useState<CategoryData | null>(null);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);

  // ── Derived: can go prev ────────────────────────────────────────────────────
  const canGoPrev =
    !oldestTxDate || period.start.getTime() > oldestTxDate.getTime();

  // ── Period navigation ───────────────────────────────────────────────────────
  const handlePrev = useCallback(() => {
    if (!canGoPrev) return;
    setPeriod((p) => prevPeriod(p.start));
    setPeriodOffset((o) => o - 1);
    setLargeOnly(false);
    setView("categories");
  }, [canGoPrev]);

  const handleNext = useCallback(() => {
    if (isCurrentPeriod) return;
    setPeriod((p) => nextPeriod(p.end));
    setPeriodOffset((o) => o + 1);
    setLargeOnly(false);
    setView("categories");
  }, [isCurrentPeriod]);

  // ── Swipe gesture (PanResponder — no gesture-handler installed) ─────────────
  // Use mutable refs so the PanResponder (created once) always calls the latest
  // handlePrev / handleNext without going stale.
  const handlePrevRef = useRef(handlePrev);
  const handleNextRef = useRef(handleNext);
  useEffect(() => { handlePrevRef.current = handlePrev; }, [handlePrev]);
  useEffect(() => { handleNextRef.current = handleNext; }, [handleNext]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderRelease: (_, g) => {
        const VELOCITY_THRESHOLD = 0.3;
        const DISTANCE_THRESHOLD = 50;
        if (g.dx < -DISTANCE_THRESHOLD || g.vx < -VELOCITY_THRESHOLD) {
          // Swipe left → next period
          handleNextRef.current();
        } else if (g.dx > DISTANCE_THRESHOLD || g.vx > VELOCITY_THRESHOLD) {
          // Swipe right → prev period
          handlePrevRef.current();
        }
      },
    })
  ).current;

  // ── Signals refresh ─────────────────────────────────────────────────────────
  const refetchSignals = useCallback((force = true) => {
    const captured = signalsOffsetRef.current;
    if (force) invalidateSignalsCache();
    fetchSignals(captured, force)
      .then((d) => {
        if (signalsOffsetRef.current === captured) setSignals(d);
      })
      .catch(() => {
        if (signalsOffsetRef.current === captured) setSignals({});
      });
  }, []);

  useEffect(() => {
    signalsOffsetRef.current = periodOffset;
    const hit = cachedSignals(periodOffset);
    setSignals(hit ?? {});
    if (!hit) refetchSignals(false);
    // Warm adjacent period
    const warm = setTimeout(() => {
      fetchSignals(periodOffset - 1).catch(() => {});
    }, 400);
    return () => clearTimeout(warm);
  }, [periodOffset, refetchSignals]);

  // ── Data loading ────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    try {
      const [txns, accs, oldest, sub, cats] = await Promise.all([
        spendApi.allTransactions().catch(() => [] as Transaction[]),
        api.accounts().catch(() => [] as Account[]),
        spendApi.oldestTransaction().catch(() => ({ date: null as string | null })),
        spendApi.getSubscription().catch(() => ({ tier: "free", status: "free", limits: {}, features: {} })),
        spendApi.getCategories().catch(() => ({ builtin: [] as string[], custom: [] as string[], all: [] as string[] })),
      ]);
      setAllTransactions(txns);
      setAccounts(accs);
      if (oldest.date) setOldestTxDate(new Date(oldest.date));
      setIsPro(sub.tier !== "free");
      setAllCategories(cats.all);
    } catch {
      // Graceful degradation — show empty states
    } finally {
      setTxLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    invalidateSignalsCache();
    await loadData();
    refetchSignals(true);
    setRefreshing(false);
  }, [loadData, refetchSignals]);

  // ── Transaction update ──────────────────────────────────────────────────────
  const handleTxUpdated = useCallback(
    (updated: Transaction, additionalIds?: string[]) => {
      invalidateSignalsCache();
      setAllTransactions((prev) =>
        prev.map((t) => {
          if (t.id === updated.id) return { ...t, category: updated.category };
          if (additionalIds?.includes(t.id))
            return { ...t, category: updated.category };
          return t;
        })
      );
      refetchSignals(true);
    },
    [refetchSignals]
  );

  // ── Derived: period transactions ────────────────────────────────────────────
  const periodTxns = useMemo(
    () => filterPeriod(allTransactions, period.start, period.end),
    [allTransactions, period]
  );

  const homeTxns = useMemo(
    () => periodTxns.filter((tx) => isHomeCurrency(tx.currency)),
    [periodTxns]
  );

  const homeAllTxns = useMemo(
    () => allTransactions.filter((tx) => isHomeCurrency(tx.currency)),
    [allTransactions]
  );

  // ── Summary ─────────────────────────────────────────────────────────────────
  const summary = useMemo(() => {
    let spent = 0;
    let income = 0;
    for (const tx of homeTxns) {
      const cat = tx.category || "Other";
      if (cat === "Transfer") continue;
      const amt = Math.abs(tx.amount);
      if (cat === "Income") {
        income += tx.transaction_type === "credit" ? amt : -amt;
      } else {
        spent += tx.transaction_type === "debit" ? amt : -amt;
      }
    }
    return { spent, income, net: income - spent };
  }, [homeTxns]);

  // ── Category breakdown ──────────────────────────────────────────────────────
  const categories = useMemo((): CategoryData[] => {
    const map: Record<
      string,
      { total: number; count: number; transactions: Transaction[] }
    > = {};
    for (const tx of homeTxns) {
      const cat = tx.category || "Other";
      if (SKIP_FROM_SPEND.has(cat) || cat === "Income") continue;
      if (!map[cat]) map[cat] = { total: 0, count: 0, transactions: [] };
      map[cat].total +=
        tx.transaction_type === "credit"
          ? -Math.abs(tx.amount)
          : Math.abs(tx.amount);
      map[cat].count += 1;
      map[cat].transactions.push(tx);
    }
    const totalSpend = Object.values(map).reduce(
      (s, v) => s + Math.max(v.total, 0),
      0
    );
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

  // ── Untracked (Transfer only) ───────────────────────────────────────────────
  const untrackedCategories = useMemo((): CategoryData[] => {
    const map: Record<
      string,
      { total: number; count: number; transactions: Transaction[] }
    > = {};
    for (const tx of homeTxns) {
      const cat = tx.category || "Other";
      if (cat !== "Transfer") continue;
      const label =
        tx.transaction_type === "credit" ? "Transfer (in)" : "Transfer (out)";
      if (!map[label]) map[label] = { total: 0, count: 0, transactions: [] };
      map[label].total += Math.abs(tx.amount);
      map[label].count += 1;
      map[label].transactions.push(tx);
    }
    return Object.entries(map)
      .map(([name, { total, count, transactions }]) => ({
        name,
        total,
        count,
        transactions: transactions.sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
        ),
        pct: 0,
      }))
      .sort((a, b) => b.total - a.total);
  }, [homeTxns]);

  // ── Income transactions ─────────────────────────────────────────────────────
  const incomeTxns = useMemo(
    () =>
      homeTxns
        .filter(
          (tx) =>
            tx.transaction_type === "credit" &&
            (tx.category || "Other") === "Income"
        )
        .sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
        ),
    [homeTxns]
  );

  // ── List transactions (full period, sorted newest-first) ────────────────────
  const listTxns = useMemo(
    () =>
      [...periodTxns].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      ),
    [periodTxns]
  );

  // ── Large filter toast ──────────────────────────────────────────────────────
  function showLargeToast() {
    setLargeToast(true);
    Animated.sequence([
      Animated.timing(toastOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(2100),
      Animated.timing(toastOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => setLargeToast(false));
  }

  // ── Design tokens ───────────────────────────────────────────────────────────
  const canvasBg = dark ? tw.color.canvasDark : tw.color.canvasLight;
  const cardBg = dark ? tw.color.cardDark : tw.color.cardLight;
  const borderColor = dark ? tw.color.cardBorderDark : tw.color.cardBorderLight;
  const headText = dark ? tw.color.slate100 : tw.color.slate900;
  const subText = dark ? tw.color.slate400 : tw.color.slate500;
  const manageBg = dark ? tw.color.slate800 : tw.color.white;
  const manageBorder = dark ? tw.color.slate700 : tw.color.slate100;
  const manageText = dark ? tw.color.slate300 : tw.color.slate600;
  const incomePillActiveBg = dark ? "rgba(79,70,229,0.2)" : tw.color.indigo50;
  const segContainerBg = dark ? tw.color.slate800 : tw.color.slate100;

  const pageLoading = txLoading;

  return (
    <View style={[styles.root, { backgroundColor: canvasBg }]}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          styles.scroll,
          {
            paddingTop: insets.top + tw.space[6],
            paddingBottom: insets.bottom + 100,
          },
        ]}
        showsVerticalScrollIndicator={false}
        {...panResponder.panHandlers}
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <View style={styles.header}>
          {/* Title row */}
          <View style={styles.titleRow}>
            <View>
              <Text
                style={[
                  styles.eyebrow,
                  { color: subText },
                ]}
              >
                WHERE YOUR MONEY GOES
              </Text>
              <Text style={[styles.pageTitle, { color: headText }]}>Spending</Text>
            </View>
            <Pressable
              onPress={() => {
                // Category manager — not yet ported to mobile
              }}
              style={({ pressed }) => [
                styles.manageBtn,
                {
                  backgroundColor: manageBg,
                  borderColor: manageBorder,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <SlidersHorizontal size={14} color={manageText} />
              <Text style={[styles.manageBtnText, { color: manageText }]}>
                Manage
              </Text>
            </Pressable>
          </View>

          {/* Period nav */}
          <PeriodNav
            periodStart={period.start}
            periodEnd={period.end}
            isCurrentPeriod={isCurrentPeriod}
            canGoPrev={canGoPrev}
            onPrev={handlePrev}
            onNext={handleNext}
            onSettings={() => {
              // Pay period settings — not yet ported to mobile
            }}
            dark={dark}
          />

          {/* Summary pills */}
          {!pageLoading ? (
            <View style={styles.pillsSection}>
              <View style={styles.pillsRow}>
                {/* Spent */}
                <View style={[styles.pill, { backgroundColor: cardBg, borderColor }]}>
                  <Text style={[styles.pillLabel, { color: subText }]}>Spent</Text>
                  <Text style={[styles.pillValue, { color: headText }]}>
                    {fmtSummary(summary.spent)}
                  </Text>
                </View>

                {/* Income — tappable to drill down */}
                <Pressable
                  onPress={() => setIncomeExpanded((v) => !v)}
                  style={({ pressed }) => [
                    styles.pill,
                    {
                      backgroundColor: incomeExpanded
                        ? incomePillActiveBg
                        : cardBg,
                      borderColor,
                      opacity: pressed ? 0.75 : 1,
                    },
                  ]}
                >
                  <View style={styles.pillLabelRow}>
                    <Text style={[styles.pillLabel, { color: subText }]}>Income</Text>
                    {incomeExpanded ? (
                      <ChevronUp size={10} color={subText} />
                    ) : (
                      <ChevronDown size={10} color={subText} />
                    )}
                  </View>
                  <Text style={[styles.pillValue, { color: headText }]}>
                    {fmtSummary(summary.income)}
                  </Text>
                </Pressable>

                {/* Net */}
                <View style={[styles.pill, { backgroundColor: cardBg, borderColor }]}>
                  <Text style={[styles.pillLabel, { color: subText }]}>Net</Text>
                  <Text
                    style={[
                      styles.pillValue,
                      {
                        color:
                          summary.net >= 0
                            ? dark
                              ? tw.color.emerald400
                              : "#047857" // emerald-700
                            : headText,
                      },
                    ]}
                  >
                    {summary.net >= 0 ? "+" : "−"}
                    {fmtSummary(Math.abs(summary.net))}
                  </Text>
                </View>
              </View>

              {/* Income drill-down list */}
              {incomeExpanded && incomeTxns.length > 0 && (
                <View
                  style={[styles.incomeDrillCard, { backgroundColor: cardBg, borderColor }]}
                >
                  <Text
                    style={[
                      styles.incomeDrillHeading,
                      { color: subText },
                    ]}
                  >
                    INCOME THIS PERIOD
                  </Text>
                  {incomeTxns.map((tx, index) => (
                    <TransactionRow
                      key={tx.id}
                      tx={tx}
                      dark={dark}
                      onPress={() => setSelectedTx(tx)}
                      showDivider={index < incomeTxns.length - 1}
                    />
                  ))}
                </View>
              )}
            </View>
          ) : (
            /* Loading skeleton for pills */
            <View style={styles.pillsSection}>
              <View style={styles.pillsRow}>
                {[0, 1, 2].map((i) => (
                  <View
                    key={i}
                    style={[styles.pill, { backgroundColor: cardBg, borderColor }]}
                  >
                    <Skeleton height={11} width="60%" />
                    <Skeleton height={14} width="80%" style={{ marginTop: 4 }} />
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* View tab switcher */}
          <View style={[styles.segContainer, { backgroundColor: segContainerBg }]}>
            <SegmentedControl
              options={["Categories", "Transactions", "Trends"]}
              selected={view === "categories" ? 0 : view === "list" ? 1 : 2}
              onChange={(i) =>
                setView(i === 0 ? "categories" : i === 1 ? "list" : "trends")
              }
            />
          </View>
        </View>

        {/* ── Content ────────────────────────────────────────────────────── */}
        <View style={styles.content}>
          {/* Categories view */}
          {view === "categories" && (
            <>
              <CategoryGrid
                categories={categories}
                signals={signals}
                loading={pageLoading}
                dark={dark}
                onCategoryPress={setOpenCategory}
              />

              {/* Untracked (Transfers) section */}
              {!pageLoading && untrackedCategories.length > 0 && (
                <View style={styles.untrackedSection}>
                  <Pressable
                    onPress={() => setUntrackedOpen((v) => !v)}
                    style={[
                      styles.untrackedHeader,
                      { backgroundColor: cardBg, borderColor },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[styles.untrackedTitle, { color: subText }]}
                      >
                        UNTRACKED
                      </Text>
                      <Text style={[styles.untrackedDesc, { color: subText }]}>
                        Transfers — not counted in spend
                      </Text>
                    </View>
                    <View style={styles.untrackedRight}>
                      <View
                        style={[
                          styles.untrackedBadge,
                          {
                            backgroundColor: dark
                              ? tw.color.slate700
                              : tw.color.slate100,
                          },
                        ]}
                      >
                        <Text
                          style={[styles.untrackedBadgeText, { color: subText }]}
                        >
                          {untrackedCategories.reduce((s, c) => s + c.count, 0)}
                        </Text>
                      </View>
                      {untrackedOpen ? (
                        <ChevronUp size={16} color={subText} />
                      ) : (
                        <ChevronDown size={16} color={subText} />
                      )}
                    </View>
                  </Pressable>

                  {untrackedOpen && (
                    <View style={[styles.untrackedGrid, { marginTop: tw.space[2] }]}>
                      {untrackedCategories.map((cat) => {
                        const colour =
                          CATEGORY_COLOURS[cat.name] ?? tw.color.slate400;
                        const icon = CATEGORY_ICONS[cat.name] ?? "↔️";
                        const chipBg = colour + "26";
                        return (
                          <Pressable
                            key={cat.name}
                            onPress={() => setOpenCategory(cat)}
                            style={({ pressed }) => [
                              styles.untrackedCard,
                              {
                                backgroundColor: cardBg,
                                borderColor,
                                opacity: pressed ? 0.75 : 1,
                              },
                            ]}
                          >
                            <View style={styles.untrackedCardRow}>
                              <View
                                style={[
                                  styles.untrackedChip,
                                  { backgroundColor: chipBg },
                                ]}
                              >
                                <Text style={styles.untrackedChipIcon}>
                                  {icon}
                                </Text>
                              </View>
                              <View style={{ flex: 1, minWidth: 0 }}>
                                <Text
                                  style={[
                                    styles.untrackedCatName,
                                    { color: headText },
                                  ]}
                                  numberOfLines={1}
                                >
                                  {cat.name}
                                </Text>
                                <Text
                                  style={[
                                    styles.untrackedCatSub,
                                    { color: subText },
                                  ]}
                                >
                                  {cat.count} txn{cat.count !== 1 ? "s" : ""}
                                </Text>
                              </View>
                            </View>
                            <Text
                              style={[styles.untrackedAmt, { color: headText }]}
                            >
                              £
                              {cat.total.toLocaleString("en-GB", {
                                minimumFractionDigits: 0,
                                maximumFractionDigits: 0,
                              })}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                </View>
              )}
            </>
          )}

          {/* List view */}
          {view === "list" && (
            <TransactionsList
              transactions={listTxns}
              loading={pageLoading}
              dark={dark}
              largeOnly={largeOnly}
              onClearLargeFilter={() => setLargeOnly(false)}
              onTransactionPress={setSelectedTx}
              onRefresh={handleRefresh}
              refreshing={refreshing}
            />
          )}

          {/* Trends view */}
          {view === "trends" && (
            pageLoading ? (
              <View style={styles.trendsLoading}>
                <Skeleton height={200} borderRadius={tw.radius["2xl"]} />
              </View>
            ) : (
              <SpendTrends
                periodTxns={homeTxns}
                allTxns={homeAllTxns}
                periodStart={period.start}
                periodEnd={period.end}
                colours={{}}
                dark={dark}
                onReviewLarge={() => {
                  setLargeOnly(true);
                  setView("list");
                  showLargeToast();
                }}
              />
            )
          )}
        </View>
      </ScrollView>

      {/* ── Bottom sheets ──────────────────────────────────────────────────── */}
      <SpendCategorySheet
        category={openCategory}
        signal={openCategory ? signals[openCategory.name] : undefined}
        isCurrentPeriod={isCurrentPeriod}
        isPro={isPro}
        dark={dark}
        onClose={() => setOpenCategory(null)}
        onTransactionPress={(tx) => setSelectedTx(tx)}
        onSignalChanged={() => refetchSignals(true)}
      />

      <TransactionSheet
        transaction={selectedTx}
        allCategories={allCategories}
        dark={dark}
        account={(() => {
          if (!selectedTx) return undefined;
          const acct = accounts.find((a) => a.id === selectedTx.account_id);
          return acct ? { name: acct.name, provider: acct.provider } : undefined;
        })()}
        onClose={() => setSelectedTx(null)}
        onUpdated={handleTxUpdated}
      />

      {/* ── Toast ──────────────────────────────────────────────────────────── */}
      {largeToast && (
        <Animated.View
          style={[
            styles.toast,
            {
              opacity: toastOpacity,
              bottom: insets.bottom + 96,
              backgroundColor: dark
                ? "rgba(241,245,249,0.95)"
                : "rgba(15,23,42,0.95)",
            },
          ]}
          pointerEvents="none"
        >
          <Text
            style={[
              styles.toastText,
              { color: dark ? tw.color.slate900 : tw.color.white },
            ]}
          >
            Showing payments over £250
          </Text>
        </Animated.View>
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
  },
  header: {
    paddingHorizontal: tw.space[4],
    gap: tw.space[3],
    paddingBottom: tw.space[2],
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  eyebrow: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: tw.weight.medium,
    letterSpacing: 0.6,
  },
  pageTitle: {
    fontSize: tw.text.xl.fontSize,
    lineHeight: tw.text.xl.lineHeight,
    fontWeight: tw.weight.bold,
  },
  manageBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: tw.space[3],
    paddingVertical: tw.space[2],
    borderRadius: tw.radius.xl,
    borderWidth: 1,
  },
  manageBtnText: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
    fontWeight: tw.weight.semibold,
  },
  pillsSection: {
    gap: tw.space[2],
  },
  pillsRow: {
    flexDirection: "row",
    gap: tw.space[2],
  },
  pill: {
    flex: 1,
    borderRadius: tw.radius.xl,
    paddingHorizontal: tw.space[3],
    paddingVertical: 10,
    alignItems: "center",
    borderWidth: 1,
  },
  pillLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    marginBottom: 2,
  },
  pillLabel: {
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 2,
  },
  pillValue: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    fontWeight: tw.weight.bold,
  },
  incomeDrillCard: {
    borderRadius: tw.radius.xl,
    overflow: "hidden",
    borderWidth: 1,
  },
  incomeDrillHeading: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
    fontWeight: tw.weight.semibold,
    letterSpacing: 0.5,
    paddingHorizontal: tw.space[4],
    paddingTop: 10,
    paddingBottom: 4,
  },
  segContainer: {
    borderRadius: tw.radius.xl,
    padding: 2,
  },
  content: {
    paddingHorizontal: tw.space[4],
    gap: tw.space[3],
    paddingTop: tw.space[1],
  },
  trendsLoading: {
    paddingVertical: tw.space[4],
  },
  // Untracked section
  untrackedSection: {
    gap: 0,
  },
  untrackedHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[3],
    borderRadius: tw.radius["2xl"],
    borderWidth: 1,
  },
  untrackedTitle: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
    fontWeight: tw.weight.semibold,
    letterSpacing: 0.5,
  },
  untrackedDesc: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
    marginTop: 2,
  },
  untrackedRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[2],
    flexShrink: 0,
    marginLeft: tw.space[3],
  },
  untrackedBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: tw.radius.full,
  },
  untrackedBadgeText: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
    fontWeight: tw.weight.semibold,
  },
  untrackedGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: tw.space[3],
  },
  untrackedCard: {
    width: "47.5%",
    borderRadius: tw.radius["2xl"],
    padding: tw.space[4],
    borderWidth: 1,
    gap: tw.space[2],
  },
  untrackedCardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  untrackedChip: {
    width: 36,
    height: 36,
    borderRadius: tw.radius.xl,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  untrackedChipIcon: {
    fontSize: 16,
  },
  untrackedCatName: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    fontWeight: tw.weight.semibold,
  },
  untrackedCatSub: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
  untrackedAmt: {
    fontSize: tw.text.base.fontSize,
    lineHeight: tw.text.base.lineHeight,
    fontWeight: tw.weight.bold,
  },
  // Toast
  toast: {
    position: "absolute",
    left: tw.space[4],
    right: tw.space[4],
    borderRadius: tw.radius.xl,
    paddingHorizontal: tw.space[4],
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 8,
  },
  toastText: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    fontWeight: tw.weight.medium,
  },
});
