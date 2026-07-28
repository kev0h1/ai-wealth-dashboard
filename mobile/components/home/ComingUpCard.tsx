import { View, Text, Pressable, StyleSheet } from "react-native";
import { CalendarClock } from "lucide-react-native";
import type { CashflowData } from "@/lib/shared";
import { fmtBalance } from "@/lib/format";
import { tw } from "@/lib/tw";

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

  const cardBg = dark ? tw.color.cardDark : tw.color.cardLight;
  const borderColor = dark ? tw.color.cardBorderDark : tw.color.cardBorderLight;

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
        <CalendarClock size={17} color={tw.color.amber500} />
      </View>

      {/* Center */}
      <View style={styles.center}>
        <Text style={[styles.label, { color: dark ? tw.color.slate400 : tw.color.slate500 }]}>
          Coming up · 14 days
        </Text>
        <View style={styles.partsRow}>
          {parts.map((part, idx) => (
            <Text
              key={idx}
              style={[
                styles.partText,
                { color: part.urgent ? tw.color.amber500 : (dark ? tw.color.slate300 : tw.color.slate600) },
              ]}
            >
              {part.label}
            </Text>
          ))}
        </View>
      </View>

      {/* Right: total out */}
      <View style={styles.rightCol}>
        <Text style={[styles.totalOutLabel, { color: dark ? tw.color.slate400 : tw.color.slate500 }]}>
          total out
        </Text>
        <Text style={[styles.totalOutAmount, { color: dark ? tw.color.slate200 : tw.color.slate700 }]}>
          {fmtBalance(totalBillAmount)}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: tw.radius["2xl"],
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[3],
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 3,
    elevation: 2,
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[3],
  },
  iconChip: {
    width: 36,
    height: 36,
    borderRadius: tw.radius.xl,
    backgroundColor: tw.color.amber50,
    alignItems: "center",
    justifyContent: "center",
  },
  center: {
    flex: 1,
  },
  label: {
    ...tw.text.xs,
    fontWeight: tw.weight.medium,
  },
  partsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: tw.space[0.5],
    gap: tw.space[2],
  },
  partText: {
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
  },
  rightCol: {
    alignItems: "flex-end",
  },
  totalOutLabel: {
    ...tw.text.xs,
  },
  totalOutAmount: {
    ...tw.text.sm,
    fontWeight: tw.weight.bold,
  },
});
