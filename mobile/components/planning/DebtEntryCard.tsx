import React from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
} from "react-native";
import { tw } from "@/lib/tw";
import { DebtPlanView } from "@/lib/api";
import { useTheme } from "@/lib/ThemeContext";

interface DebtEntryCardProps {
  view: DebtPlanView | null;
  onTap: () => void;
}

function isCliffSoon(until: string): boolean {
  const y = parseInt(until.slice(0, 4), 10);
  const m = parseInt(until.slice(5, 7), 10);
  const lastDay = new Date(y, m, 0);
  return (lastDay.getTime() - Date.now()) / 86_400_000 <= 60;
}

function fmtCliffMonth(ym: string): string {
  const y = parseInt(ym.slice(0, 4), 10);
  const m = parseInt(ym.slice(5, 7), 10);
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
  });
}

export function DebtEntryCard({ view, onTap }: DebtEntryCardProps) {
  const { dark } = useTheme();

  if (!view) return null;
  const buckets = (view.totals as { buckets?: { carried_total?: number; float_total?: number } }).buckets;
  const carried = buckets?.carried_total ?? 0;
  const float = buckets?.float_total ?? 0;
  if (carried < 1 && float < 1) return null;

  const now = Date.now();
  const ONE_YEAR_MS = 365 * 86_400_000;
  let nextCliff: { until: string; name: string } | null = null;

  for (const card of view.cards) {
    const seg = card.rate_schedule[0];
    if (!seg || seg.source !== "promo" || !seg.until) continue;
    const y = parseInt(seg.until.slice(0, 4), 10);
    const m = parseInt(seg.until.slice(5, 7), 10);
    const lastDay = new Date(y, m, 0).getTime();
    if (lastDay - now > ONE_YEAR_MS) continue;
    if (!nextCliff) {
      nextCliff = { until: seg.until, name: card.name };
    } else {
      const ey = parseInt(nextCliff.until.slice(0, 4), 10);
      const em = parseInt(nextCliff.until.slice(5, 7), 10);
      const existLastDay = new Date(ey, em, 0).getTime();
      if (lastDay < existLastDay) nextCliff = { until: seg.until, name: card.name };
    }
  }

  return (
    <View>
      <Text
        style={[
          styles.whisper,
          { color: dark ? tw.color.slate500 : tw.color.slate400 },
        ]}
      >
        YOUR CARDS
      </Text>
      <Pressable
        onPress={onTap}
        style={[
          styles.card,
          {
            backgroundColor: dark ? tw.color.cardDark : tw.color.cardLight,
            borderColor: dark ? tw.color.cardBorderDark : tw.color.cardBorderLight,
          },
        ]}
      >
        <View style={styles.textSection}>
          <Text
            style={[
              styles.title,
              { color: dark ? tw.color.slate100 : tw.color.slate900 },
            ]}
          >
            Card plan
          </Text>
          {nextCliff && (() => {
            const soon = isCliffSoon(nextCliff.until);
            const dateStr = fmtCliffMonth(nextCliff.until);
            return (
              <Text
                style={[
                  styles.subtitle,
                  { color: dark ? tw.color.slate400 : tw.color.slate500 },
                ]}
              >
                {"Next 0% ends "}
                <Text
                  style={
                    soon
                      ? {
                          color: dark ? tw.color.amber400 : tw.color.amber600,
                          fontWeight: tw.weight.semibold,
                        }
                      : undefined
                  }
                >
                  {dateStr}
                </Text>
                {" — " + nextCliff.name}
              </Text>
            );
          })()}
        </View>
        <Text
          style={[
            styles.chevron,
            { color: dark ? tw.color.slate500 : tw.color.slate400 },
          ]}
        >
          ›
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  whisper: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: tw.weight.semibold,
    textTransform: "uppercase",
    letterSpacing: 1,
    paddingHorizontal: tw.space[1],
    marginBottom: tw.space[2],
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[3],
    borderRadius: tw.radius["2xl"],
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[3],
    minHeight: 44,
    borderWidth: 1,
  },
  textSection: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: tw.weight.semibold,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  chevron: {
    fontSize: tw.text.lg.fontSize,
    lineHeight: tw.text.lg.lineHeight,
    flexShrink: 0,
  },
});
