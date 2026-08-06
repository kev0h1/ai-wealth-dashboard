import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Sparkles, RefreshCw, BookOpen, TrendingUp } from "lucide-react-native";
import { router } from "expo-router";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Skeleton } from "@/components/ui/Skeleton";
import { useTheme } from "@/lib/ThemeContext";
import { api } from "@/lib/api";
import type { SavingsInsight } from "@/lib/api";
import { insightsApi } from "@/lib/api/insights";
import type {
  SavingsInsights,
  SavingsPlan,
  MoneyBasic,
  WorkflowDef,
} from "@/lib/api/insights";
import { tw } from "@/lib/tw";
import { fmtGBP } from "@/lib/format";
import { SafetyNetCard } from "@/components/insights/SafetyNetCard";
import { SavingsPlanCard } from "@/components/insights/SavingsPlanCard";
import { InsightCard } from "@/components/insights/InsightCard";
import type { FullInsight } from "@/components/insights/InsightCard";
import { TaxPage } from "@/components/insights/TaxPage";

// ── NextHundredCard ───────────────────────────────────────────────────────────

interface NextHundredProps {
  surplus: number;
  debtTotal: number;
  dark: boolean;
}

function NextHundredCard({ surplus, debtTotal, dark }: NextHundredProps) {
  const [open, setOpen] = useState(false);
  const cardBg = dark ? tw.color.cardDark : tw.color.white;
  const cardBorder = dark ? tw.color.cardBorderDark : tw.color.cardBorderLight;
  const textPrimary = dark ? tw.color.slate100 : tw.color.slate800;
  const textSecondary = dark ? tw.color.slate400 : tw.color.slate600;

  const steps: { icon: string; text: string }[] = [];

  if (debtTotal > 0) {
    steps.push({
      icon: "💳",
      text: `Put ${fmtGBP(Math.min(surplus, debtTotal))} of surplus toward clearing card debt`,
    });
  }
  if (surplus > 0) {
    steps.push({
      icon: "🛡️",
      text: "Top up your safety net before spending on wants",
    });
  }
  steps.push({
    icon: "📈",
    text: "Once debt-free, redirect surplus to pension or ISA",
  });
  steps.push({
    icon: "🔍",
    text: "Review your bills in Ways to save for easy cuts",
  });

  const visibleSteps = open ? steps : steps.slice(0, 2);

  return (
    <View
      style={[
        nextStyles.card,
        { backgroundColor: cardBg, borderColor: cardBorder },
      ]}
    >
      <Text style={[nextStyles.title, { color: textPrimary }]}>
        Next moves
      </Text>
      {visibleSteps.map((s, i) => (
        <View key={i} style={nextStyles.stepRow}>
          <Text style={nextStyles.stepIcon}>{s.icon}</Text>
          <Text style={[nextStyles.stepText, { color: textSecondary }]}>
            {s.text}
          </Text>
        </View>
      ))}
      {steps.length > 2 && (
        <Pressable onPress={() => setOpen((o) => !o)}>
          <Text style={nextStyles.toggleLink}>
            {open ? "Show less" : `Show ${steps.length - 2} more`}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const nextStyles = StyleSheet.create({
  card: {
    borderRadius: tw.radius["2xl"],
    borderWidth: 1,
    marginHorizontal: tw.space[4],
    marginBottom: tw.space[3],
    padding: tw.space[4],
    gap: tw.space[3],
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  title: {
    ...tw.text.base,
    fontWeight: tw.weight.bold,
  },
  stepRow: {
    flexDirection: "row",
    gap: tw.space[3],
    alignItems: "flex-start",
  },
  stepIcon: {
    fontSize: 16,
    lineHeight: 22,
  },
  stepText: {
    ...tw.text.sm,
    flex: 1,
    lineHeight: 20,
  },
  toggleLink: {
    ...tw.text.sm,
    color: tw.color.indigo600,
    fontWeight: tw.weight.medium,
  },
});

// ── ReadyToGrowCard ───────────────────────────────────────────────────────────

interface ReadyToGrowProps {
  items: MoneyBasic[];
  dark: boolean;
}

function ReadyToGrowCard({ items, dark }: ReadyToGrowProps) {
  const cardBg = dark ? tw.color.cardDark : tw.color.white;
  const cardBorder = dark ? tw.color.cardBorderDark : tw.color.cardBorderLight;
  const textPrimary = dark ? tw.color.slate100 : tw.color.slate800;
  const textSecondary = dark ? tw.color.slate400 : tw.color.slate600;
  const divider = dark ? tw.color.slate700 : tw.color.slate100;

  if (items.length === 0) return null;

  return (
    <View
      style={[
        growStyles.card,
        { backgroundColor: cardBg, borderColor: cardBorder },
      ]}
    >
      <View style={growStyles.header}>
        <BookOpen size={16} color={tw.color.indigo600} />
        <Text style={[growStyles.title, { color: textPrimary }]}>
          Ready to grow
        </Text>
      </View>
      {items.slice(0, 3).map((item, i) => (
        <React.Fragment key={item.id}>
          {i > 0 && (
            <View style={[growStyles.divider, { backgroundColor: divider }]} />
          )}
          <View style={growStyles.itemRow}>
            <Text style={growStyles.itemIcon}>{item.icon}</Text>
            <View style={growStyles.itemText}>
              <Text style={[growStyles.itemTitle, { color: textPrimary }]}>
                {item.title}
              </Text>
              <Text
                style={[growStyles.itemBody, { color: textSecondary }]}
                numberOfLines={2}
              >
                {item.body}
              </Text>
            </View>
          </View>
        </React.Fragment>
      ))}
    </View>
  );
}

const growStyles = StyleSheet.create({
  card: {
    borderRadius: tw.radius["2xl"],
    borderWidth: 1,
    marginHorizontal: tw.space[4],
    marginBottom: tw.space[3],
    padding: tw.space[4],
    gap: tw.space[3],
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[2],
  },
  title: {
    ...tw.text.base,
    fontWeight: tw.weight.bold,
  },
  divider: {
    height: 1,
  },
  itemRow: {
    flexDirection: "row",
    gap: tw.space[3],
    alignItems: "flex-start",
  },
  itemIcon: {
    fontSize: 18,
    lineHeight: 24,
  },
  itemText: {
    flex: 1,
    gap: 2,
  },
  itemTitle: {
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
  },
  itemBody: {
    ...tw.text.xs,
    lineHeight: 17,
  },
});

// ── LockedCard ────────────────────────────────────────────────────────────────

function LockedCard({ dark }: { dark: boolean }) {
  const cardBg = dark ? tw.color.cardDark : tw.color.white;
  const cardBorder = dark ? tw.color.cardBorderDark : tw.color.cardBorderLight;
  const textPrimary = dark ? tw.color.slate100 : tw.color.slate800;
  const textSecondary = dark ? tw.color.slate400 : tw.color.slate600;

  return (
    <View
      style={[
        lockedStyles.card,
        { backgroundColor: cardBg, borderColor: cardBorder },
      ]}
    >
      <Sparkles size={28} color={tw.color.indigo600} />
      <Text style={[lockedStyles.title, { color: textPrimary }]}>
        Upgrade to unlock insights
      </Text>
      <Text style={[lockedStyles.body, { color: textSecondary }]}>
        AI-powered ways to save are available on Pro and above.
      </Text>
    </View>
  );
}

const lockedStyles = StyleSheet.create({
  card: {
    borderRadius: tw.radius["2xl"],
    borderWidth: 1,
    marginHorizontal: tw.space[4],
    marginBottom: tw.space[3],
    padding: tw.space[6],
    alignItems: "center",
    gap: tw.space[3],
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  title: {
    ...tw.text.base,
    fontWeight: tw.weight.bold,
    textAlign: "center",
  },
  body: {
    ...tw.text.sm,
    textAlign: "center",
    lineHeight: 20,
  },
});

// ── WaysToSaveTab ─────────────────────────────────────────────────────────────

interface WaysToSaveTabProps {
  insights: SavingsInsight[];
  workflows: Record<string, WorkflowDef>;
  loading: boolean;
  locked: boolean;
  onRefresh: () => void;
  onPinToggle: (id: string, pinned: boolean) => void;
  dark: boolean;
}

function WaysToSaveTab({
  insights,
  workflows,
  loading,
  locked,
  onRefresh,
  onPinToggle,
  dark,
}: WaysToSaveTabProps) {
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 5;
  const textSecondary = dark ? tw.color.slate400 : tw.color.slate500;

  if (loading) {
    return (
      <View style={waysStyles.skeletons}>
        {[0, 1, 2].map((i) => (
          <Skeleton
            key={i}
            height={80}
            borderRadius={tw.radius["2xl"]}
            style={waysStyles.skeletonItem}
          />
        ))}
      </View>
    );
  }

  if (locked) {
    return <LockedCard dark={dark} />;
  }

  if (insights.length === 0) {
    return (
      <View style={waysStyles.emptyContainer}>
        <RefreshCw size={32} color={tw.color.slate300} />
        <Text style={[waysStyles.emptyTitle, { color: dark ? tw.color.slate300 : tw.color.slate600 }]}>
          No insights yet
        </Text>
        <Text style={[waysStyles.emptyBody, { color: textSecondary }]}>
          We analyse your spending patterns to find savings. Check back soon.
        </Text>
        <Pressable onPress={onRefresh} style={waysStyles.refreshBtn}>
          <Text style={waysStyles.refreshBtnText}>Refresh</Text>
        </Pressable>
      </View>
    );
  }

  // Pinned first, then unpinned
  const pinned = insights.filter((i) => i.pinned);
  const unpinned = insights.filter((i) => !i.pinned);
  const ordered = [...pinned, ...unpinned];
  const visible = ordered.slice(0, page * PAGE_SIZE);
  const hasMore = ordered.length > visible.length;

  // Map SavingsInsight → FullInsight
  const toFull = (s: SavingsInsight): FullInsight => ({
    id: s.id,
    title: s.title,
    body: s.body,
    category: s.category,
    pinned: s.pinned,
    is_new: s.is_new,
    verified_saving: s.verified_savings ?? undefined,
    triggered_by: s.triggered_by?.[0]?.display_name,
    created_at: s.refreshed_at ?? undefined,
    workflow_key: s.has_workflow ? s.id : undefined,
  });

  return (
    <View>
      {visible.map((insight) => (
        <InsightCard
          key={insight.id}
          insight={toFull(insight)}
          workflows={workflows}
          onPinToggle={onPinToggle}
        />
      ))}
      {hasMore && (
        <Pressable
          onPress={() => setPage((p) => p + 1)}
          style={waysStyles.showMoreBtn}
        >
          <Text style={waysStyles.showMoreText}>
            Show {Math.min(PAGE_SIZE, ordered.length - visible.length)} more
          </Text>
        </Pressable>
      )}
      <Pressable
        onPress={onRefresh}
        style={[
          waysStyles.bottomRefresh,
          { borderColor: dark ? tw.color.slate700 : tw.color.slate200 },
        ]}
      >
        <RefreshCw size={14} color={textSecondary} />
        <Text style={[waysStyles.bottomRefreshText, { color: textSecondary }]}>
          Refresh
        </Text>
      </Pressable>
    </View>
  );
}

const waysStyles = StyleSheet.create({
  skeletons: {
    paddingHorizontal: tw.space[4],
    gap: tw.space[2],
  },
  skeletonItem: {
    marginBottom: 0,
  },
  emptyContainer: {
    alignItems: "center",
    paddingTop: tw.space[10],
    paddingHorizontal: tw.space[6],
    gap: tw.space[3],
  },
  emptyTitle: {
    ...tw.text.base,
    fontWeight: tw.weight.semibold,
  },
  emptyBody: {
    ...tw.text.sm,
    textAlign: "center",
    lineHeight: 20,
  },
  refreshBtn: {
    marginTop: tw.space[2],
    backgroundColor: tw.color.indigo600,
    borderRadius: tw.radius.xl,
    paddingHorizontal: tw.space[6],
    paddingVertical: tw.space[3],
  },
  refreshBtnText: {
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
    color: tw.color.white,
  },
  showMoreBtn: {
    alignSelf: "center",
    marginTop: tw.space[1],
    marginBottom: tw.space[3],
    paddingHorizontal: tw.space[6],
    paddingVertical: tw.space[3],
    backgroundColor: tw.color.indigo50,
    borderRadius: tw.radius.full,
  },
  showMoreText: {
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
    color: tw.color.indigo600,
  },
  bottomRefresh: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[2],
    alignSelf: "center",
    borderWidth: 1,
    borderRadius: tw.radius.full,
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[2],
    marginBottom: tw.space[4],
  },
  bottomRefreshText: {
    ...tw.text.sm,
    fontWeight: tw.weight.medium,
  },
});

// ── HeroCard ──────────────────────────────────────────────────────────────────

const HERO_TITLES = ["Grow your money", "Ways to save", "Tax efficiency"];

interface HeroCardProps {
  tab: number;
  newInsightCount: number;
  dark: boolean;
}

function HeroCard({ tab, newInsightCount, dark }: HeroCardProps) {
  const glass = dark
    ? "rgba(30,41,59,0.85)"
    : "rgba(255,255,255,0.75)";
  const heroBorder = dark ? tw.color.cardBorderDark : "rgba(255,255,255,0.6)";
  const textPrimary = dark ? tw.color.white : tw.color.slate800;

  return (
    <View
      style={[
        heroStyles.card,
        { backgroundColor: glass, borderColor: heroBorder },
      ]}
    >
      <View style={heroStyles.row}>
        <Text style={[heroStyles.title, { color: textPrimary }]}>
          {HERO_TITLES[tab]}
        </Text>
        {tab === 1 && newInsightCount > 0 && (
          <View style={heroStyles.badge}>
            <Sparkles size={10} color={tw.color.violet600} />
            <Text style={heroStyles.badgeText}>{newInsightCount} new</Text>
          </View>
        )}
      </View>
      {tab === 0 && (
        <Text style={[heroStyles.subtitle, { color: dark ? tw.color.slate400 : tw.color.slate500 }]}>
          Safety net, savings plan, and what to do next
        </Text>
      )}
      {tab === 1 && (
        <Text style={[heroStyles.subtitle, { color: dark ? tw.color.slate400 : tw.color.slate500 }]}>
          AI-powered opportunities spotted in your spending
        </Text>
      )}
      {tab === 2 && (
        <Text style={[heroStyles.subtitle, { color: dark ? tw.color.slate400 : tw.color.slate500 }]}>
          Make the most of your allowances this tax year
        </Text>
      )}
    </View>
  );
}

const heroStyles = StyleSheet.create({
  card: {
    marginHorizontal: tw.space[4],
    marginTop: tw.space[4],
    borderRadius: tw.radius["3xl"],
    borderWidth: 1,
    padding: tw.space[5],
    gap: tw.space[1],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[2],
  },
  title: {
    ...tw.text["2xl"],
    fontWeight: tw.weight.bold,
    letterSpacing: tw.tracking(tw.trackingEm.tight, 24),
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: tw.color.violet50,
    borderRadius: tw.radius.full,
    paddingHorizontal: tw.space[2],
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: tw.color.violet200,
  },
  badgeText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: tw.weight.semibold,
    color: tw.color.violet600,
  },
  subtitle: {
    ...tw.text.sm,
  },
});

// ── Main tab ──────────────────────────────────────────────────────────────────

export default function InsightsTab() {
  const { dark } = useTheme();

  const [tab, setTab] = useState(0);

  // Savings tab data
  const [savingsData, setSavingsData] = useState<SavingsInsights | null>(null);
  const [plan, setPlan] = useState<SavingsPlan | null>(null);
  const [debtTotal, setDebtTotal] = useState(0);
  const [growItems, setGrowItems] = useState<MoneyBasic[]>([]);
  const [savingsLoading, setSavingsLoading] = useState(true);

  // Ways to save tab data
  const [insights, setInsights] = useState<SavingsInsight[]>([]);
  const [workflows, setWorkflows] = useState<Record<string, WorkflowDef>>({});
  const [newInsightCount, setNewInsightCount] = useState(0);
  const [insightsLoading, setInsightsLoading] = useState(true);
  const [insightsLocked, setInsightsLocked] = useState(false);
  const [insightsViewed, setInsightsViewed] = useState(false);

  const canvasBg = dark ? tw.color.canvasDark : tw.color.canvasLight;
  const textSecondary = dark ? tw.color.slate400 : tw.color.slate500;

  // Load savings tab data on mount
  useEffect(() => {
    setSavingsLoading(true);
    Promise.all([
      insightsApi.savingsInsights().catch(() => null),
      insightsApi.getSavingsPlan().catch(() => ({ plan: null })),
      api.getDebtPlanView().catch(() => null),
      insightsApi.getMoneyBasics("grow").catch(() => ({ items: [], tax_year: "" })),
    ]).then(([savings, planRes, debtPlan, basics]) => {
      if (savings) setSavingsData(savings);
      setPlan(planRes.plan);
      if (debtPlan?.totals?.debt) setDebtTotal(debtPlan.totals.debt);
      setGrowItems(basics.items);
    }).finally(() => setSavingsLoading(false));
  }, []);

  // Load new insight count on mount
  useEffect(() => {
    api.newInsightCount().then((r) => setNewInsightCount(r.count)).catch(() => {});
  }, []);

  // Load ways to save data when tab 1 is first selected
  useEffect(() => {
    if (tab !== 1) return;

    // Mark insights viewed when tab is opened
    if (!insightsViewed) {
      setInsightsViewed(true);
      api.markInsightsViewed().catch(() => {});
      setNewInsightCount(0);
    }

    if (insights.length > 0) return; // already loaded

    setInsightsLoading(true);
    Promise.all([
      api.getSubscription().catch(() => null),
      api.getSavingsInsights().catch(() => [] as SavingsInsight[]),
      insightsApi.getWorkflows().catch(() => ({} as Record<string, WorkflowDef>)),
    ]).then(([sub, fetchedInsights, fetchedWorkflows]) => {
      if (sub && sub.features.savings_insights === false) {
        setInsightsLocked(true);
      } else {
        setInsights(fetchedInsights ?? []);
        setWorkflows(fetchedWorkflows ?? {});
      }
    }).finally(() => setInsightsLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const handleRefreshInsights = useCallback(async () => {
    setInsightsLoading(true);
    try {
      await api.refreshSavingsInsights();
      const fresh = await api.getSavingsInsights();
      setInsights(fresh);
    } catch {}
    finally {
      setInsightsLoading(false);
    }
  }, []);

  const handlePinToggle = useCallback((id: string, pinned: boolean) => {
    setInsights((prev) =>
      prev.map((ins) => (ins.id === id ? { ...ins, pinned } : ins))
    );
  }, []);

  const handleSavingsUpdate = useCallback((updated: SavingsInsights) => {
    setSavingsData(updated);
  }, []);

  const handlePlanUpdate = useCallback((updated: SavingsPlan | null) => {
    setPlan(updated);
  }, []);

  return (
    <SafeAreaView
      edges={["top"]}
      style={[styles.safeArea, { backgroundColor: canvasBg }]}
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Glass hero card */}
        <HeroCard tab={tab} newInsightCount={newInsightCount} dark={dark} />

        {/* Segmented control */}
        <View style={styles.segmentWrap}>
          <SegmentedControl
            options={["Savings", "Ways to save", "Tax"]}
            selected={tab}
            onChange={setTab}
          />
        </View>

        {/* ── Savings tab ───────────────────────────────────────────────────── */}
        {tab === 0 && (
          <View style={styles.tabContent}>
            {savingsLoading ? (
              <View style={styles.skeletons}>
                {[0, 1, 2].map((i) => (
                  <Skeleton
                    key={i}
                    height={100}
                    borderRadius={tw.radius["2xl"]}
                    style={styles.skeletonItem}
                  />
                ))}
              </View>
            ) : (
              <>
                {savingsData && (
                  <SafetyNetCard
                    data={savingsData}
                    onUpdate={handleSavingsUpdate}
                  />
                )}
                {plan && (
                  <SavingsPlanCard
                    plan={plan}
                    onUpdate={handlePlanUpdate}
                  />
                )}
                <NextHundredCard
                  surplus={savingsData?.monthly_surplus ?? 0}
                  debtTotal={debtTotal}
                  dark={dark}
                />
                <ReadyToGrowCard items={growItems} dark={dark} />

                {/* Receipts entry point */}
                <Pressable
                  onPress={() => router.push("/insights/receipts")}
                  style={[
                    styles.receiptsBtn,
                    {
                      backgroundColor: dark ? tw.color.cardDark : tw.color.white,
                      borderColor: dark ? tw.color.cardBorderDark : tw.color.cardBorderLight,
                    },
                  ]}
                >
                  <TrendingUp size={16} color={tw.color.emerald500} />
                  <Text
                    style={[
                      styles.receiptsBtnText,
                      { color: dark ? tw.color.slate100 : tw.color.slate800 },
                    ]}
                  >
                    View receipt history
                  </Text>
                </Pressable>
              </>
            )}
          </View>
        )}

        {/* ── Ways to save tab ──────────────────────────────────────────────── */}
        {tab === 1 && (
          <View style={styles.tabContent}>
            <WaysToSaveTab
              insights={insights}
              workflows={workflows}
              loading={insightsLoading}
              locked={insightsLocked}
              onRefresh={handleRefreshInsights}
              onPinToggle={handlePinToggle}
              dark={dark}
            />
          </View>
        )}

        {/* ── Tax tab ───────────────────────────────────────────────────────── */}
        {tab === 2 && (
          <View style={styles.tabContent}>
            <TaxPage embedded={true} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 100,
  },
  segmentWrap: {
    marginHorizontal: tw.space[4],
    marginTop: tw.space[3],
    marginBottom: tw.space[3],
  },
  tabContent: {
    gap: 0,
  },
  skeletons: {
    paddingHorizontal: tw.space[4],
    gap: tw.space[3],
  },
  skeletonItem: {
    marginBottom: 0,
  },
  receiptsBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[2],
    marginHorizontal: tw.space[4],
    marginBottom: tw.space[3],
    borderWidth: 1,
    borderRadius: tw.radius["2xl"],
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[3],
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  receiptsBtnText: {
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
  },
});
