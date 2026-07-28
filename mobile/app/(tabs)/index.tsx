import { useCallback } from "react";
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
import { Sparkles } from "lucide-react-native";
import { useAuth } from "@/lib/AuthContext";
import { useTheme } from "@/lib/ThemeContext";
import DashboardWebView from "@/components/DashboardWebView";
import { useHomeData } from "@/lib/useHomeData";
import { HomeHeader } from "@/components/home/HomeHeader";
import { NetWorthHero } from "@/components/home/NetWorthHero";
import { GoalsCard } from "@/components/home/GoalsCard";
import { ComingUpCard } from "@/components/home/ComingUpCard";
import { SpotlightCard } from "@/components/home/SpotlightCard";
import { AccountsGrid } from "@/components/home/AccountsGrid";
import { RecentTransactions } from "@/components/home/RecentTransactions";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "@/lib/api";
import type { ValueDelivered } from "@/lib/api";
import { tw } from "@/lib/tw";

function ErrorCard({ onRetry, dark }: { onRetry: () => void; dark: boolean }) {
  return (
    <View
      style={[
        styles.errorCard,
        { backgroundColor: dark ? tw.color.cardDark : tw.color.cardLight, borderColor: dark ? tw.color.cardBorderDark : tw.color.cardBorderLight },
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

function ValueDeliveredRow({
  valueDelivered,
  onPress,
}: {
  valueDelivered: ValueDelivered | null;
  onPress: () => void;
}) {
  if (
    !valueDelivered ||
    (valueDelivered.total_monthly_saving === 0 && !valueDelivered.verified_monthly_saving)
  ) {
    return null;
  }

  const verified = valueDelivered.verified_monthly_saving ?? 0;
  const monthly = valueDelivered.total_monthly_saving;
  const n = valueDelivered.insights_acted_on;

  const gbp = (num: number) => num.toLocaleString("en-GB", { maximumFractionDigits: 0 });
  const label =
    verified > 0
      ? `£${gbp(verified)}/mo saved · £${gbp(monthly)}/mo more possible`
      : `£${gbp(monthly)}/mo potential savings across ${n} insight${n === 1 ? "" : "s"}`;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.valueDeliveredRow,
        { opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Sparkles size={11} color={tw.color.indigo400} />
      <Text style={styles.valueDeliveredText}>{label}</Text>
    </Pressable>
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

  const canvasColor = dark ? tw.color.canvasDark : tw.color.canvasLight;

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

  return (
    <View style={[styles.screen, { backgroundColor: canvasColor }]}>
      <SafeAreaView style={{ flex: 1, backgroundColor: canvasColor }} edges={["top"]}>
        <ScrollView
          refreshControl={
            <RefreshControl
              refreshing={loading && !data}
              onRefresh={refresh}
              tintColor={dark ? tw.color.slate100 : tw.color.indigo600}
            />
          }
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.scrollContent, { paddingHorizontal: gutter }]}
        >
          <HomeHeader
            firstName={data?.userName?.split(" ")[0]?.trim()}
            syncing={syncing}
            syncError={syncError}
            onSync={handleSync}
            dark={dark}
          />

          {error && !data ? (
            <ErrorCard onRetry={refresh} dark={dark} />
          ) : (
            <>
              <NetWorthHero
                kpis={data?.kpis ?? null}
                loading={loading && !data}
                dark={dark}
                hidden={hideBalances}
                onToggleHide={toggleHideBalances}
              />

              <ValueDeliveredRow
                valueDelivered={data?.valueDelivered ?? null}
                onPress={() => router.navigate("/(tabs)/insights" as any)}
              />

              <GoalsCard
                goals={data?.goals ?? []}
                loading={loading && !data}
                dark={dark}
                onNavigate={(url) => handleNavigateWeb(url, "Goals")}
              />

              <ComingUpCard
                cashflow={data?.cashflow ?? null}
                loading={loading && !data}
                dark={dark}
                onPress={() => router.navigate("/(tabs)/spend" as any)}
              />

              <SpotlightCard
                insight={data?.spotlightInsight ?? null}
                loaded={!loading || !!data}
                dark={dark}
                onDismiss={handleDismissInsight}
                onNavigate={() => router.navigate("/(tabs)/insights" as any)}
              />

              <AccountsGrid
                accounts={data?.accounts ?? []}
                investmentAccounts={data?.investmentAccounts ?? []}
                loading={loading && !data}
                dark={dark}
                hidden={hideBalances}
                pinnedIds={data?.pinnedAccountIds ?? []}
                onManage={() => handleNavigateWeb("/accounts", "Accounts")}
                onAccountPress={(_id) => handleNavigateWeb(`/accounts`, "Accounts")}
                onInvestmentsPress={() => handleNavigateWeb("/investments", "Investments")}
              />

              <RecentTransactions
                transactions={data?.transactions ?? []}
                loading={loading && !data}
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
    gap: tw.space[5],
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
  valueDeliveredRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: -8,
    paddingHorizontal: tw.space[1],
  },
  valueDeliveredText: {
    color: tw.color.indigo400,
    ...tw.text.xs,
    fontWeight: tw.weight.medium,
  },
});
