import { useCallback, useEffect, useState } from "react";
import {
  View,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  StyleSheet,
  Text,
  Pressable,
  useWindowDimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/lib/AuthContext";
import { useTheme } from "@/lib/ThemeContext";
import DashboardWebView from "@/components/DashboardWebView";
import { useHomeData } from "@/lib/useHomeData";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "@/lib/api";
import type { SafeToSpend, NeedleSummary, CompanionItem } from "@/lib/api";
import { tw } from "@/lib/tw";

// Existing components (signatures unchanged)
import { HomeHeader } from "@/components/home/HomeHeader";
import { AccountsGrid } from "@/components/home/AccountsGrid";
import { RecentTransactions } from "@/components/home/RecentTransactions";

// New components
import { SafeToSpendCard } from "@/components/home/SafeToSpendCard";
import { HomeBrief } from "@/components/home/HomeBrief";
import { UpcomingBillsStrip } from "@/components/home/UpcomingBillsStrip";
import { ThisMonthStrip } from "@/components/home/ThisMonthStrip";
import { HomeInsightSpotlight } from "@/components/home/HomeInsightSpotlight";
import { IndexBlock } from "@/components/home/IndexBlock";
import { ReauthBanners } from "@/components/home/ReauthBanners";

function ErrorCard({ onRetry, dark }: { onRetry: () => void; dark: boolean }) {
  return (
    <View
      style={[
        styles.errorCard,
        {
          backgroundColor: dark ? tw.color.cardDark : tw.color.cardLight,
          borderColor: dark
            ? tw.color.cardBorderDark
            : tw.color.cardBorderLight,
        },
      ]}
    >
      <Text style={[styles.errorCardText, { color: tw.color.slate400 }]}>
        Couldn't load your dashboard
      </Text>
      <Pressable
        onPress={onRetry}
        style={({ pressed }) => [
          styles.retryBtn,
          { transform: [{ scale: pressed ? 0.95 : 1 }] },
        ]}
      >
        <Text style={styles.retryBtnText}>Retry</Text>
      </Pressable>
    </View>
  );
}

function NativeHomeScreen() {
  const { dark } = useTheme();
  const router = useRouter();
  const { width: winW } = useWindowDimensions();
  const gutter = Math.max(0, (winW - 430) / 2) + tw.space[4];

  const {
    data,
    loading,
    error,
    refresh,
    syncing,
    syncError,
    handleSync,
    hideBalances,
    toggleHideBalances,
  } = useHomeData();

  // Augmented data from new endpoints
  const [safeToSpend, setSafeToSpend] = useState<SafeToSpend | null>(null);
  const [todayItems, setTodayItems] = useState<CompanionItem[]>([]);
  const [needle, setNeedle] = useState<NeedleSummary | null>(null);
  const [augLoading, setAugLoading] = useState(true);

  const fetchAugmented = useCallback(async () => {
    setAugLoading(true);
    const [stsRes, todayRes, needleRes] = await Promise.allSettled([
      api.safeToSpend(),
      api.getToday(),
      api.getNeedleSummary(),
    ]);
    if (stsRes.status === "fulfilled") setSafeToSpend(stsRes.value);
    if (todayRes.status === "fulfilled") setTodayItems(todayRes.value.items ?? []);
    if (needleRes.status === "fulfilled") setNeedle(needleRes.value);
    setAugLoading(false);
  }, []);

  useEffect(() => {
    fetchAugmented();
  }, [fetchAugmented]);

  const handleRefresh = useCallback(async () => {
    await Promise.all([refresh(), fetchAugmented()]);
  }, [refresh, fetchAugmented]);

  const handleDismissInsight = useCallback(async () => {
    if (!data?.spotlightInsight) return;
    try {
      await api.dismissSpotlightInsight(data.spotlightInsight.id);
      await refresh();
    } catch {
      // non-fatal
    }
  }, [data?.spotlightInsight, refresh]);

  const handleNavigateWeb = useCallback(
    (path: string, title: string) => {
      router.push({ pathname: "/web", params: { path, title } } as any);
    },
    [router],
  );

  const canvasColor = dark ? tw.color.canvasDark : tw.color.canvasLight;
  const isFirstLoad = loading && !data;

  return (
    <View style={[styles.screen, { backgroundColor: canvasColor }]}>
      <SafeAreaView style={{ flex: 1, backgroundColor: canvasColor }} edges={["top"]}>
        <ScrollView
          refreshControl={
            <RefreshControl
              refreshing={isFirstLoad}
              onRefresh={handleRefresh}
              tintColor={dark ? tw.color.slate100 : tw.color.indigo600}
            />
          }
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingHorizontal: gutter },
          ]}
        >
          <HomeHeader
            firstName={data?.userName?.split(" ")[0]?.trim()}
            syncing={syncing}
            syncError={syncError}
            onSync={handleSync}
            onTutorial={() =>
              router.push({
                pathname: "/web",
                params: { path: "/", title: "Guide", tutorial: "1" },
              } as any)
            }
            dark={dark}
          />

          {error && !data ? (
            <ErrorCard onRetry={handleRefresh} dark={dark} />
          ) : (
            <>
              {/* 1. HomeBrief: greeting + companion items */}
              <HomeBrief
                firstName={data?.userName?.split(" ")[0]?.trim()}
                companionItems={todayItems}
                dark={dark}
                onRefresh={fetchAugmented}
              />

              {/* 2. WHERE YOU STAND: SafeToSpendCard + IndexBlock */}
              {safeToSpend && (
                <SafeToSpendCard
                  data={safeToSpend}
                  suppressCTA={todayItems.some((i) => i.type === "move")}
                  dark={dark}
                />
              )}
              {/* IndexBlock always renders — Mirror row is unconditional */}
              <IndexBlock
                data={data?.valueDelivered ?? null}
                dark={dark}
                onNavigate={() => router.navigate("/(tabs)/insights" as any)}
              />

              {/* 3. Reauth banners — after WHERE YOU STAND, before YOUR MONEY */}
              <ReauthBanners
                accounts={data?.accounts ?? []}
                reauthIds={[]}
                dark={dark}
              />

              {/* 4. YOUR MONEY: section label + KPI strips */}
              <View style={styles.sectionLabelRow}>
                <Text style={[styles.sectionLabel, { color: dark ? tw.color.slate500 : tw.color.slate400 }]}>
                  Your money
                </Text>
              </View>
              <UpcomingBillsStrip
                cashflow={data?.cashflow ?? null}
                loading={isFirstLoad}
                dark={dark}
              />
              <ThisMonthStrip
                needle={needle}
                loading={augLoading && !needle}
                dark={dark}
              />
              <HomeInsightSpotlight
                insight={data?.spotlightInsight ?? null}
                loaded={!isFirstLoad || !!data}
                dark={dark}
                onDismiss={handleDismissInsight}
                onNavigate={() => router.navigate("/(tabs)/insights" as any)}
              />

              {/* 5. YOUR ESTATE: accounts grid */}
              <AccountsGrid
                accounts={data?.accounts ?? []}
                investmentAccounts={data?.investmentAccounts ?? []}
                loading={isFirstLoad}
                dark={dark}
                hidden={hideBalances}
                pinnedIds={data?.pinnedAccountIds ?? []}
                onManage={() => handleNavigateWeb("/accounts", "Accounts")}
                onAccountPress={(_id) =>
                  handleNavigateWeb("/accounts", "Accounts")
                }
                onInvestmentsPress={() =>
                  handleNavigateWeb("/investments", "Investments")
                }
              />

              {/* 6. Recent transactions */}
              <RecentTransactions
                transactions={data?.transactions ?? []}
                loading={isFirstLoad}
                dark={dark}
                onSeeAll={() => router.navigate("/(tabs)/spend" as any)}
              />
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

export default function HomeTab() {
  const { token, isLoading } = useAuth();
  const { dark } = useTheme();

  const canvasColor = dark ? tw.color.canvasDark : tw.color.canvasLight;

  if (isLoading) {
    return (
      <View style={[styles.loadingScreen, { backgroundColor: canvasColor }]}>
        <ActivityIndicator size="large" color={tw.color.indigo600} />
      </View>
    );
  }

  if (!token) {
    return <DashboardWebView initialPath="" />;
  }

  return <NativeHomeScreen />;
}

const styles = StyleSheet.create({
  loadingScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  screen: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: tw.space[4],
    paddingBottom: 100,
    gap: tw.space[4],
  },
  sectionLabelRow: {
    marginBottom: -tw.space[1], // collapse gap so strips sit mb-3 below label
  },
  sectionLabel: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: tw.weight.semibold as "600",
    textTransform: "uppercase",
    letterSpacing: tw.tracking(tw.trackingEm.wide, 11),
  },
  errorCard: {
    borderRadius: tw.radius["2xl"],
    padding: tw.space[6],
    borderWidth: 1,
    alignItems: "center",
    gap: tw.space[3],
  },
  errorCardText: {
    ...tw.text.sm,
  },
  retryBtn: {
    backgroundColor: tw.color.indigo600,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: tw.radius.xl,
  },
  retryBtnText: {
    color: tw.color.white,
    fontWeight: tw.weight.semibold,
    ...tw.text.sm,
  },
});
