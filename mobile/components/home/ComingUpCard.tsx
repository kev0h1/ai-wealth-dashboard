import { View, Text, Pressable, StyleSheet } from "react-native";
import { CalendarClock } from "lucide-react-native";
import type { CashflowData } from "@/lib/shared";
import { fmtBalance } from "@/lib/format";

interface Props {
  cashflow: CashflowData | null;
  loading: boolean;
  dark: boolean;
  onPress: () => void;
}

type Part = { label: string; urgent: boolean };

export function ComingUpCard({ cashflow, loading, dark, onPress }: Props) {
  if (loading || !cashflow) return null;

  const all = [
    ...(cashflow.upcoming_bills ?? []),
    ...(cashflow.upcoming_income ?? []),
  ].filter((b) => b.days_away <= 14);

  if (all.length === 0) return null;

  const today = all.filter((b) => b.days_away === 0);
  const tomorrow = all.filter((b) => b.days_away === 1);
  const later = all.filter((b) => b.days_away > 1);

  const parts: Part[] = [];
  if (today.length > 0) parts.push({ label: `${today.length} due today`, urgent: true });
  if (tomorrow.length > 0) parts.push({ label: `${tomorrow.length} due tomorrow`, urgent: true });
  if (later.length > 0) parts.push({ label: `${later.length} bills over the next 2 weeks`, urgent: false });

  const totalBillAmount = (cashflow.upcoming_bills ?? [])
    .filter((b) => b.days_away <= 14)
    .reduce((s, b) => s + b.amount, 0);

  const cardBg = dark ? "#1e293b" : "#ffffff";
  const borderColor = dark ? "#334155" : "#f1f5f9";
  const mutedColor = dark ? "#cbd5e1" : "#475569";

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
        <CalendarClock size={17} color="#f59e0b" />
      </View>

      {/* Center */}
      <View style={styles.center}>
        <Text style={[styles.label, { color: dark ? "#94a3b8" : "#64748b" }]}>
          Coming up · 14 days
        </Text>
        <View style={styles.partsRow}>
          {parts.map((part, idx) => (
            <Text
              key={idx}
              style={[
                styles.partText,
                { color: part.urgent ? "#f59e0b" : mutedColor },
              ]}
            >
              {part.label}
              {idx < parts.length - 1 ? "  " : ""}
            </Text>
          ))}
        </View>
      </View>

      {/* Right: total out */}
      <View style={styles.rightCol}>
        <Text style={[styles.totalOutLabel, { color: dark ? "#94a3b8" : "#64748b" }]}>
          total out
        </Text>
        <Text style={[styles.totalOutAmount, { color: dark ? "#f1f5f9" : "#0f172a" }]}>
          {fmtBalance(totalBillAmount)}
        </Text>
      </View>
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
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: "#fef3c726",
    alignItems: "center",
    justifyContent: "center",
  },
  center: {
    flex: 1,
    gap: 4,
  },
  label: {
    fontSize: 12,
    fontWeight: "500",
  },
  partsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  partText: {
    fontSize: 14,
    fontWeight: "600",
  },
  rightCol: {
    alignItems: "flex-end",
    gap: 2,
  },
  totalOutLabel: {
    fontSize: 12,
    fontWeight: "400",
  },
  totalOutAmount: {
    fontSize: 14,
    fontWeight: "700",
  },
});
