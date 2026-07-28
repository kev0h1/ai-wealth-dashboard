import { View, Text, Pressable, StyleSheet } from "react-native";
import { TrendingUp, TrendingDown, Eye, EyeOff } from "lucide-react-native";
import type { KPIs } from "@/lib/shared";
import { fmtBalance } from "@/lib/format";
import { tw } from "@/lib/tw";

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

  const cardBg = dark ? tw.color.cardDark : tw.color.cardLight;
  const borderColor = dark ? tw.color.cardBorderDark : tw.color.cardBorderLight;

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
            <TrendingUp size={16} color={tw.color.emerald500} />
          ) : (
            <TrendingDown size={16} color={tw.color.amber500} />
          )}
          <Text style={[styles.titleText, { color: dark ? tw.color.slate400 : tw.color.slate500 }]}>
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
            <EyeOff size={16} color={tw.color.slate400} />
          ) : (
            <Eye size={16} color={tw.color.slate400} />
          )}
        </Pressable>
      </View>

      {/* Verdict */}
      <Text style={[styles.verdict, { color: dark ? tw.color.slate400 : tw.color.slate500 }]}>
        {verdictText}
      </Text>

      {/* Main figure */}
      {loading ? (
        <View style={[styles.skeleton, { backgroundColor: dark ? tw.color.cardBorderDark : tw.color.slate200 }]} />
      ) : (
        <Text
          style={[
            styles.mainFigure,
            { color: dark ? tw.color.slate100 : tw.color.slate900 },
          ]}
        >
          {hidden ? "••••••" : fmtBalance(netWorth)}
        </Text>
      )}

      {/* Chips row */}
      <View style={styles.chipsRow}>
        <View style={[styles.chip, { backgroundColor: dark ? tw.color.cardBorderDark : tw.color.slate50 }]}>
          <Text style={[styles.chipLabel, { color: dark ? tw.color.slate400 : tw.color.slate500 }]}>Cash</Text>
          <Text style={[styles.chipValue, { color: dark ? tw.color.slate100 : tw.color.slate900 }]}>
            {hidden ? "••••" : fmtBalance(cash)}
          </Text>
        </View>
        <View style={[styles.chip, { backgroundColor: dark ? tw.color.cardBorderDark : tw.color.slate50 }]}>
          <Text style={[styles.chipLabel, { color: dark ? tw.color.slate400 : tw.color.slate500 }, { textDecorationLine: "underline", textDecorationStyle: "dotted" }]}>Cash runway</Text>
          <Text
            style={[
              styles.chipValue,
              { color: runwayFmt.amber ? tw.color.amber500 : (dark ? tw.color.slate100 : tw.color.slate900) },
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
    borderRadius: tw.radius["3xl"],
    padding: tw.space[6],
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 3,
    elevation: 2,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: tw.space[1],
  },
  titleLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[1.5],
  },
  titleText: {
    ...tw.text.sm,
    fontWeight: tw.weight.medium,
  },
  eyeBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  verdict: {
    ...tw.text.sm,
    marginTop: tw.space[1],
    marginBottom: tw.space[2],
  },
  skeleton: {
    height: 40,
    borderRadius: tw.radius.lg,
    marginBottom: tw.space[4],
  },
  mainFigure: {
    ...tw.text["4xl"],
    fontWeight: tw.weight.bold,
    letterSpacing: tw.tracking(tw.trackingEm.tight, 36),
    marginBottom: tw.space[4],
  },
  chipsRow: {
    flexDirection: "row",
    gap: tw.space[3],
    alignItems: "flex-start",
  },
  chip: {
    flex: 1,
    borderRadius: tw.radius.xl,
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[2],
  },
  chipLabel: {
    ...tw.text.xs,
    fontWeight: tw.weight.medium,
    marginBottom: tw.space[0.5],
  },
  chipValue: {
    ...tw.text.base,
    fontWeight: tw.weight.semibold,
  },
});
