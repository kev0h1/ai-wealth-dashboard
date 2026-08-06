import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { TrendingUp, TrendingDown, Minus } from "lucide-react-native";
import { tw } from "@/lib/tw";
import type { NeedleSummary } from "@/lib/api";

interface Props {
  needle: NeedleSummary | null;
  loading: boolean;
  dark: boolean;
}

function fmtGBP(n: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(Math.abs(n));
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
    });
  } catch {
    return iso;
  }
}

// Variant A — just closed a period (days_into_period <= 2 and last_closed exists)
function ClosedVariant({
  needle,
  dark,
}: {
  needle: NeedleSummary;
  dark: boolean;
}) {
  const lc = needle.last_closed!;
  const delta = lc.card_delta;
  const improved = delta <= 0; // card went down = good (less debt / more cash)
  const accentColor = improved ? tw.color.emerald500 : tw.color.rose500;
  const inkColor = dark ? tw.color.slate100 : tw.color.slate900;
  const subColor = dark ? tw.color.slate400 : tw.color.slate500;
  const bgColor = dark ? tw.color.cardDark : tw.color.cardLight;
  const borderColor = dark ? tw.color.cardBorderDark : tw.color.cardBorderLight;

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: bgColor, borderColor },
      ]}
    >
      <View style={styles.row}>
        <View
          style={[styles.iconChip, { backgroundColor: `${accentColor}18` }]}
        >
          {improved ? (
            <TrendingDown size={18} color={accentColor} />
          ) : (
            <TrendingUp size={18} color={accentColor} />
          )}
        </View>
        <View style={styles.textBlock}>
          <Text style={[styles.label, { color: subColor }]}>
            Last month · closed {fmtDate(lc.period_end)}
          </Text>
          <Text style={[styles.headline, { color: inkColor }]} numberOfLines={2}>
            {lc.lines.headline}
          </Text>
          <View style={styles.subRow}>
            <Text style={[styles.sub, { color: subColor }]}>
              {lc.lines.movement}
            </Text>
            {lc.lines.streak ? (
              <Text style={[styles.streak, { color: accentColor }]}>
                {lc.lines.streak}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={styles.deltaBlock}>
          <Text style={[styles.deltaValue, { color: accentColor }]}>
            {improved ? "−" : "+"}{fmtGBP(delta)}
          </Text>
          <Text style={[styles.deltaSub, { color: subColor }]}>card</Text>
        </View>
      </View>
    </View>
  );
}

// Variant B — live period
function LiveVariant({
  needle,
  dark,
}: {
  needle: NeedleSummary;
  dark: boolean;
}) {
  const cur = needle.current;
  const delta = cur.card_delta_so_far;
  const improved = delta <= 0;
  const accentColor =
    Math.abs(delta) < 10
      ? dark
        ? tw.color.slate400
        : tw.color.slate500
      : improved
      ? tw.color.emerald500
      : tw.color.rose500;
  const inkColor = dark ? tw.color.slate100 : tw.color.slate900;
  const subColor = dark ? tw.color.slate400 : tw.color.slate500;
  const bgColor = dark ? tw.color.cardDark : tw.color.cardLight;
  const borderColor = dark ? tw.color.cardBorderDark : tw.color.cardBorderLight;
  const daysLeft = cur.days_to_payday;
  const daysIn = cur.days_into_period;

  const dirLabel =
    Math.abs(delta) < 10
      ? "Holding steady"
      : improved
      ? "Card balance down"
      : "Card balance up";

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: bgColor, borderColor },
      ]}
    >
      <View style={styles.row}>
        <View
          style={[styles.iconChip, { backgroundColor: `${accentColor}18` }]}
        >
          {Math.abs(delta) < 10 ? (
            <Minus size={18} color={accentColor} />
          ) : improved ? (
            <TrendingDown size={18} color={accentColor} />
          ) : (
            <TrendingUp size={18} color={accentColor} />
          )}
        </View>
        <View style={styles.textBlock}>
          <Text style={[styles.label, { color: subColor }]}>
            This period · day {daysIn}
          </Text>
          <Text style={[styles.headline, { color: inkColor }]}>{dirLabel}</Text>
          <Text style={[styles.sub, { color: subColor }]}>
            {daysLeft} day{daysLeft === 1 ? "" : "s"} to payday ·{" "}
            {fmtGBP(cur.cash_now)} in account
          </Text>
        </View>
        <View style={styles.deltaBlock}>
          <Text style={[styles.deltaValue, { color: accentColor }]}>
            {delta === 0 ? "±£0" : `${improved ? "−" : "+"}${fmtGBP(delta)}`}
          </Text>
          <Text style={[styles.deltaSub, { color: subColor }]}>so far</Text>
        </View>
      </View>
    </View>
  );
}

export function ThisMonthStrip({ needle, loading, dark }: Props) {
  if (loading || !needle || needle.status !== "ok") return null;

  const showClosed =
    needle.last_closed !== null && needle.current.days_into_period <= 2;

  if (showClosed) {
    return <ClosedVariant needle={needle} dark={dark} />;
  }

  return <LiveVariant needle={needle} dark={dark} />;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: tw.radius["2xl"],
    padding: tw.space[4],
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 3,
    shadowOpacity: 0.05,
    elevation: 1,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[3],
  },
  iconChip: {
    width: 36,
    height: 36,
    borderRadius: tw.radius.xl,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  textBlock: {
    flex: 1,
    gap: 2,
  },
  label: {
    ...tw.text.xs,
    fontWeight: tw.weight.medium,
  },
  headline: {
    ...tw.text.base,
    fontWeight: tw.weight.bold,
  },
  subRow: {
    flexDirection: "row",
    gap: tw.space[2],
    alignItems: "center",
    flexWrap: "wrap",
  },
  sub: {
    ...tw.text.xs,
  },
  streak: {
    ...tw.text.xs,
    fontWeight: tw.weight.semibold,
  },
  deltaBlock: {
    alignItems: "flex-end",
    flexShrink: 0,
  },
  deltaValue: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: tw.weight.bold,
  },
  deltaSub: {
    ...tw.text.xs,
    textAlign: "right",
  },
});
