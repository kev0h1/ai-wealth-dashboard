import { View, Text, Pressable, StyleSheet } from "react-native";
import type { CashflowData } from "@/lib/shared";
import { fmtBalance } from "@/lib/format";

interface Props {
  cashflow: CashflowData | null;
  loading: boolean;
  dark: boolean;
  onPress: () => void;
}

export function ComingUpCard({ cashflow, loading, dark, onPress }: Props) {
  if (loading || !cashflow) return null;

  const bills14 = cashflow.upcoming_bills.filter((b) => b.days_away <= 14);
  if (bills14.length === 0) return null;

  const today = bills14.filter((b) => b.days_away === 0);
  const tomorrow = bills14.filter((b) => b.days_away === 1);
  const later = bills14.filter((b) => b.days_away > 1);
  const totalAmount = bills14.reduce((s, b) => s + b.amount, 0);

  const parts: string[] = [];
  if (today.length > 0) parts.push(`${today.length} today`);
  if (tomorrow.length > 0) parts.push(`${tomorrow.length} tomorrow`);
  if (later.length > 0) parts.push(`${later.length} later`);
  const summary = parts.join(" · ");

  const cardBg = dark ? "#1e293b" : "#ffffff";
  const borderColor = dark ? "#334155" : "#f1f5f9";
  const inkColor = dark ? "#f1f5f9" : "#0f172a";

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: cardBg,
          borderColor,
          transform: [{ scale: pressed ? 0.99 : 1 }],
          shadowOpacity: dark ? 0 : 0.06,
        },
      ]}
    >
      {/* Left icon */}
      <View style={styles.iconChip}>
        <Text style={styles.iconEmoji}>⏰</Text>
      </View>

      {/* Center */}
      <View style={styles.center}>
        <Text style={[styles.label, { color: dark ? "#94a3b8" : "#64748b" }]}>
          Coming up · 14 days
        </Text>
        <Text style={[styles.summary, { color: inkColor }]}>{summary}</Text>
        {(today.length > 0 || tomorrow.length > 0) && (
          <Text style={styles.urgent}>
            {today.length > 0 ? "Due today!" : "Due tomorrow"}
          </Text>
        )}
      </View>

      {/* Right amount */}
      <Text style={[styles.amount, { color: inkColor }]}>
        {fmtBalance(totalAmount)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 3,
    elevation: 2,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  iconChip: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#fef3c726",
    alignItems: "center",
    justifyContent: "center",
  },
  iconEmoji: {
    fontSize: 22,
  },
  center: {
    flex: 1,
    gap: 2,
  },
  label: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  summary: {
    fontSize: 14,
    fontWeight: "600",
  },
  urgent: {
    color: "#f59e0b",
    fontSize: 12,
    fontWeight: "500",
  },
  amount: {
    fontSize: 16,
    fontWeight: "700",
  },
});
