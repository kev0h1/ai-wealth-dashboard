import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { CalendarClock } from "lucide-react-native";
import { useRouter } from "expo-router";
import { tw } from "@/lib/tw";
import type { CashflowData } from "@/lib/shared";

interface Props {
  cashflow: CashflowData | null;
  loading: boolean;
  dark: boolean;
}

function fmtGBP(n: number): string {
  return `£${n.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
}

export function UpcomingBillsStrip({ cashflow, loading, dark }: Props) {
  const router = useRouter();

  if (loading || !cashflow) return null;

  const all = [
    ...(cashflow.upcoming_bills ?? []).map((b) => ({ ...b, type: "bill" as const })),
    ...(cashflow.upcoming_income ?? []).map((b) => ({ ...b, type: "income" as const })),
  ].filter((b) => b.days_away <= 14);

  if (all.length === 0) return null;

  const today    = all.filter((b) => b.days_away === 0);
  const tomorrow = all.filter((b) => b.days_away === 1);
  const later    = all.filter((b) => b.days_away > 1);

  // Build summary parts — matches web exactly
  const parts: { label: string; count: number; urgent: boolean; noDue?: boolean }[] = [];
  if (today.length)    parts.push({ label: "today",    count: today.length,    urgent: true });
  if (tomorrow.length) parts.push({ label: "tomorrow", count: tomorrow.length, urgent: true });
  if (later.length)    parts.push({ label: "bills over the next 2 weeks", count: later.length, urgent: false, noDue: true });

  const totalBillAmount = all
    .filter((b) => b.type === "bill")
    .reduce((s, b) => s + b.amount, 0);

  const cardBg = dark ? tw.color.cardDark : tw.color.cardLight;
  const borderColor = dark ? tw.color.cardBorderDark : tw.color.cardBorderLight;
  const subColor = dark ? tw.color.slate500 : tw.color.slate400;
  const totalColor = dark ? tw.color.slate200 : tw.color.slate700;
  const iconBg = dark ? "rgba(245,158,11,0.3)" : tw.color.amber50; // amber-900/30 dark, amber-50 light

  return (
    <Pressable
      onPress={() => router.push("/planning" as any)}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: cardBg,
          borderColor,
          transform: [{ scale: pressed ? 0.99 : 1 }],
          shadowOpacity: dark ? 0 : 0.05,
        },
      ]}
    >
      {/* Icon container */}
      <View style={[styles.iconBox, { backgroundColor: iconBg }]}>
        <CalendarClock size={17} color={tw.color.amber500} />
      </View>

      {/* Content */}
      <View style={styles.content}>
        <Text style={[styles.label, { color: subColor }]}>Coming up · 14 days</Text>
        <View style={styles.partsRow}>
          {parts.map((p) => (
            <Text
              key={p.label}
              style={[
                styles.partText,
                {
                  color: p.urgent
                    ? tw.color.amber500
                    : dark
                    ? tw.color.slate300
                    : tw.color.slate600,
                },
              ]}
            >
              {p.noDue ? `${p.count} ${p.label}` : `${p.count} due ${p.label}`}
            </Text>
          ))}
        </View>
      </View>

      {/* Total out */}
      <View style={styles.totalBlock}>
        <Text style={[styles.totalLabel, { color: subColor }]}>total out</Text>
        <Text style={[styles.totalAmount, { color: totalColor }]}>
          {fmtGBP(totalBillAmount)}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[3],
    borderRadius: tw.radius["2xl"],
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[3],
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 3,
    elevation: 1,
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: tw.radius.xl,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  content: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  label: {
    ...tw.text.xs,
    fontWeight: tw.weight.medium,
  },
  partsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: tw.space[2],
  },
  partText: {
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
  },
  totalBlock: {
    alignItems: "flex-end",
    flexShrink: 0,
  },
  totalLabel: {
    ...tw.text.xs,
  },
  totalAmount: {
    ...tw.text.sm,
    fontWeight: tw.weight.bold,
  },
});
