import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import {
  ShieldCheck,
  AlertCircle,
  AlertTriangle,
} from "lucide-react-native";
import { useRouter } from "expo-router";
import { tw } from "@/lib/tw";
import type { SafeToSpend } from "@/lib/api";

interface Props {
  data: SafeToSpend;
  suppressCTA?: boolean;
  dark: boolean;
}

function fmt(n: number): string {
  return `£${Math.abs(n).toLocaleString("en-GB", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function fmt2(n: number): string {
  return `£${Math.abs(n).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Returns a human-readable freshness string, or null if data is fresh (< 3h). */
function syncAgeLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 0) return null;
  const diffH = diffMs / 3600000;
  if (diffH < 3) return null;
  if (diffH < 24) return `Synced ${Math.floor(diffH)} hours ago`;
  if (diffH < 48) return "Synced yesterday";
  const diffD = diffMs / 86400000;
  if (diffD < 7) return `Synced ${Math.floor(diffD)} days ago`;
  const d = new Date(iso);
  return `Synced on ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
}

// spec: comfortable=emerald-600, tight=amber-500, short=red-500
// tw.ts has rose500=#f43f5e but no red500; use #ef4444 directly for short
const STATE_ICON_COLOR = {
  comfortable: tw.color.emerald600,  // #059669
  tight: tw.color.amber500,          // #f59e0b
  short: "#ef4444",                  // red-500 (spec exact)
} as const;

// dark mode state colours per spec
const STATE_ICON_COLOR_DARK = {
  comfortable: tw.color.emerald400,  // #34d399
  tight: tw.color.amber400,          // #fbbf24
  short: "#f87171",                  // red-400
} as const;

export function SafeToSpendCard({ data, suppressCTA, dark }: Props) {
  const router = useRouter();

  if (data.status === "insufficient_data") return null;

  const sts = data;
  const state = sts.state;
  const spendable = sts.spendable_now ?? sts.safe_to_spend;
  const billsTotal = sts.bills_total;
  const safeToSpend = sts.safe_to_spend;
  const paydayIncome = sts.payday_income ?? 0;
  const cardDebt = sts.card_delta ?? 0; // card_delta in mobile type = card_debt on web
  const hasSpendableNow = sts.spendable_now != null;

  // Weekday name of next payday
  const weekday = new Date(sts.next_payday).toLocaleDateString("en-GB", { weekday: "long" });

  // Spec-exact verdict text
  const gap = Math.abs(safeToSpend);
  let verdictText: string;
  if (state === "comfortable") {
    verdictText = `You're okay — ${fmt(safeToSpend)} to spare before payday.`;
  } else if (state === "tight") {
    verdictText = `Tight until ${weekday} — ${fmt(safeToSpend)} in hand until payday.`;
  } else {
    verdictText = `Short before payday — ${fmt(gap)} to cover.`;
  }

  const iconColor = dark ? STATE_ICON_COLOR_DARK[state] : STATE_ICON_COLOR[state];
  const inkColor = dark ? tw.color.slate100 : tw.color.slate900;
  const subColor = dark ? tw.color.slate400 : tw.color.slate500;

  // "Free" column colour: emerald-600/400 comfortable, amber-500/400 tight, red-500/400 short
  const freeColor = dark ? STATE_ICON_COLOR_DARK[state] : STATE_ICON_COLOR[state];

  const StateIcon =
    state === "comfortable" ? ShieldCheck
    : state === "tight" ? AlertCircle
    : AlertTriangle;

  // Pace: only show sustainable rate for non-risk states
  const pace = sts.pace;
  const showPace =
    pace != null &&
    (pace.state === "comfortable" || pace.state === "on_pace" || pace.state === "ahead" || pace.state === "early") &&
    pace.sustainable != null;

  const freshnessLabel = syncAgeLabel(sts.last_synced);

  // CTA: short → "See what's due ›" → /planning
  //       tight + card debt ≥ £1000 → "See your cards ›" → /cards
  const showSpendCTA = state === "short" && !suppressCTA;
  const showDebtCTA  = state === "tight" && cardDebt >= 1000 && !suppressCTA;

  const gradientColors: [string, string] = dark
    ? [tw.color.slate800, tw.color.slate900]
    : [tw.color.indigo50, tw.color.violet50];

  return (
    <LinearGradient
      colors={gradientColors}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.wrapper}
    >
      {/* Whisper label + state icon */}
      <View style={styles.labelRow}>
        <Text style={[styles.whisperLabel, { color: subColor }]}>SAFE TO SPEND</Text>
        <StateIcon size={14} color={iconColor} />
      </View>

      {/* Verdict headline */}
      <Text style={[styles.headline, { color: inkColor }]}>
        {verdictText}
        {sts.estimated && (
          <Text style={[styles.estimatedCaveat, { color: subColor }]}> · estimated</Text>
        )}
      </Text>

      {/* 3-col instrument grid */}
      {hasSpendableNow && (
        <View style={styles.grid}>
          {/* NOW */}
          <View style={styles.col}>
            <Text style={[styles.colLabel, { color: subColor }]}>NOW</Text>
            <Text style={[styles.colValue, { color: inkColor }]}>
              {fmt(spendable)}
            </Text>
          </View>
          {/* BILLS */}
          <View style={[styles.col, styles.colMid]}>
            <Text style={[styles.colLabel, { color: subColor }]}>BILLS</Text>
            <Text style={[styles.colValue, { color: inkColor }]}>
              −{fmt(billsTotal)}
            </Text>
          </View>
          {/* FREE */}
          <View style={styles.col}>
            <Text style={[styles.colLabel, { color: subColor }]}>FREE</Text>
            <Text style={[styles.colValue, { color: freeColor }]}>
              {state === "short" ? `−${fmt(gap)}` : fmt(safeToSpend)}
            </Text>
          </View>
        </View>
      )}

      {/* Pace rate — "£X.XX/day to payday" */}
      {showPace && (
        <Text style={[styles.paceText, { color: subColor }]}>
          {fmt2(pace!.sustainable!)}/day to payday
        </Text>
      )}

      {/* Payday muted line */}
      {paydayIncome > 0 && (
        <Text style={[styles.paydayText, { color: subColor }]}>
          Payday {weekday} · +{fmt(paydayIncome)} lands
        </Text>
      )}

      {/* Freshness caveat */}
      {freshnessLabel && (
        <Text style={[styles.freshnessText, { color: subColor }]}>
          {freshnessLabel}
        </Text>
      )}

      {/* CTAs — text links matching web */}
      {showSpendCTA && (
        <Pressable
          onPress={() => router.push("/planning" as any)}
          style={({ pressed }) => [styles.ctaLink, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Text style={styles.ctaLinkText}>See what's due ›</Text>
        </Pressable>
      )}
      {showDebtCTA && (
        <Pressable
          onPress={() => router.push("/cards" as any)}
          style={({ pressed }) => [styles.ctaLink, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Text style={styles.ctaLinkText}>See your cards ›</Text>
        </Pressable>
      )}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    borderRadius: tw.radius["3xl"],
    padding: tw.space[5],
    gap: tw.space[3],
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[1],
  },
  whisperLabel: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: tw.weight.semibold,
    textTransform: "uppercase",
    letterSpacing: tw.tracking(tw.trackingEm.wide, 11),
  },
  headline: {
    ...tw.text.lg,
    fontWeight: tw.weight.bold,
  },
  estimatedCaveat: {
    ...tw.text.sm,
    fontWeight: "400",
  },
  grid: {
    flexDirection: "row",
  },
  col: {
    flex: 1,
    gap: tw.space[0.5],
  },
  colMid: {
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: "rgba(0,0,0,0.08)",
    paddingHorizontal: tw.space[3],
    marginHorizontal: tw.space[3],
  },
  colLabel: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: tw.weight.semibold,
    textTransform: "uppercase",
    letterSpacing: tw.tracking(tw.trackingEm.wide, 11),
  },
  colValue: {
    ...tw.text.base,
    fontWeight: tw.weight.semibold,
  },
  paceText: {
    fontSize: 13,
    lineHeight: 18,
  },
  paydayText: {
    ...tw.text.sm,
  },
  freshnessText: {
    ...tw.text.sm,
  },
  ctaLink: {
    alignSelf: "flex-start",
  },
  ctaLinkText: {
    ...tw.text.sm,
    fontWeight: tw.weight.medium,
    color: tw.color.indigo600,
  },
});
