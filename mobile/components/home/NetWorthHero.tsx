import { View, Text, Pressable, StyleSheet } from "react-native";
import { TrendingUp, TrendingDown, Eye, EyeOff } from "lucide-react-native";
import type { KPIs } from "@/lib/shared";
import { fmtBalance } from "@/lib/format";

interface Props {
  kpis: KPIs | null;
  loading: boolean;
  dark: boolean;
  hidden: boolean;
  onToggleHide: () => void;
}

function formatRunway(runway: number): { text: string; amber: boolean } {
  if (runway < 1) {
    const days = Math.round(runway * 30);
    return { text: `~${days} days`, amber: days < 7 };
  }
  const months = Math.round(runway);
  return { text: `~${months} months`, amber: false };
}

export function NetWorthHero({ kpis, loading, dark, hidden, onToggleHide }: Props) {
  const netWorth = kpis?.net_worth ?? 0;
  const isPositive = netWorth >= 0;
  const cash = kpis?.cash ?? 0;
  const runway = kpis?.runway ?? 0;
  const runwayFmt = formatRunway(runway);

  const verdictText = isPositive
    ? "Tracking in the right direction"
    : "Building towards net-positive — stay the course";

  const cardBg = dark ? "#1e293b" : "#ffffff";
  const borderColor = dark ? "#334155" : "#f1f5f9";

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: cardBg, borderColor, shadowOpacity: dark ? 0 : 0.06 },
      ]}
    >
      {/* Title row */}
      <View style={styles.titleRow}>
        <View style={styles.titleLeft}>
          {isPositive ? (
            <TrendingUp size={16} color="#10b981" />
          ) : (
            <TrendingDown size={16} color="#f59e0b" />
          )}
          <Text style={[styles.titleText, { color: dark ? "#94a3b8" : "#64748b" }]}>
            Net Worth
          </Text>
        </View>
        <Pressable
          onPress={onToggleHide}
          style={({ pressed }) => [
            styles.eyeBtn,
            { transform: [{ scale: pressed ? 0.95 : 1 }] },
          ]}
          accessibilityLabel={hidden ? "Show balances" : "Hide balances"}
        >
          {hidden ? (
            <EyeOff size={20} color="#94a3b8" />
          ) : (
            <Eye size={20} color="#94a3b8" />
          )}
        </Pressable>
      </View>

      {/* Verdict */}
      <Text style={[styles.verdict, { color: dark ? "#94a3b8" : "#64748b" }]}>
        {verdictText}
      </Text>

      {/* Main figure */}
      {loading ? (
        <View style={[styles.skeleton, { backgroundColor: dark ? "#334155" : "#e2e8f0" }]} />
      ) : (
        <Text
          style={[
            styles.mainFigure,
            { color: dark ? "#f1f5f9" : "#0f172a" },
          ]}
        >
          {hidden ? "••••••" : fmtBalance(netWorth)}
        </Text>
      )}

      {/* Chips row */}
      <View style={styles.chipsRow}>
        <View style={[styles.chip, { backgroundColor: dark ? "#334155" : "#f8fafc" }]}>
          <Text style={[styles.chipLabel, { color: dark ? "#94a3b8" : "#64748b" }]}>Cash</Text>
          <Text style={[styles.chipValue, { color: dark ? "#f1f5f9" : "#0f172a" }]}>
            {hidden ? "••••" : fmtBalance(cash)}
          </Text>
        </View>
        <View style={[styles.chip, { backgroundColor: dark ? "#334155" : "#f8fafc" }]}>
          <Text style={[styles.chipLabel, { color: dark ? "#94a3b8" : "#64748b" }, { textDecorationLine: "underline", textDecorationStyle: "dotted" }]}>Cash runway</Text>
          <Text
            style={[
              styles.chipValue,
              { color: runwayFmt.amber ? "#f59e0b" : (dark ? "#f1f5f9" : "#0f172a") },
            ]}
          >
            {runwayFmt.text}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 3,
    elevation: 2,
    gap: 10,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  titleLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  titleText: {
    fontSize: 14,
    fontWeight: "500",
  },
  eyeBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  verdict: {
    fontSize: 14,
  },
  skeleton: {
    height: 40,
    borderRadius: 8,
  },
  mainFigure: {
    fontSize: 30,
    fontWeight: "700",
    letterSpacing: -0.75,
  },
  chipsRow: {
    flexDirection: "row",
    gap: 10,
  },
  chip: {
    flex: 1,
    borderRadius: 12,
    padding: 12,
    gap: 2,
  },
  chipLabel: {
    fontSize: 11,
    fontWeight: "600",
  },
  chipValue: {
    fontSize: 15,
    fontWeight: "700",
  },
});
