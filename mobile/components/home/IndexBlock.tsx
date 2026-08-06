import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Sparkles, ScanFace, ChevronRight } from "lucide-react-native";
import { useRouter } from "expo-router";
import { tw } from "@/lib/tw";
import type { ValueDelivered } from "@/lib/api";

interface Props {
  data: ValueDelivered | null;
  dark: boolean;
  onNavigate: () => void;
}

function fmtGBP(n: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(n);
}

export function IndexBlock({ data, dark, onNavigate }: Props) {
  const router = useRouter();

  const bgColor = dark ? tw.color.cardDark : tw.color.cardLight;
  const borderColor = dark ? tw.color.cardBorderDark : tw.color.cardBorderLight;
  const dividerColor = dark ? "rgba(51,65,85,0.5)" : tw.color.slate100; // slate-700/50 dark, slate-100 light
  const inkColor = dark ? tw.color.slate100 : tw.color.slate900;
  const subColor = dark ? tw.color.slate300 : tw.color.slate600;
  const muteColor = dark ? tw.color.slate400 : tw.color.slate500;

  // ValueDeliveredStat row — only render if there is savings data
  const hasValueData =
    data &&
    (data.total_monthly_saving > 0 || (data.verified_monthly_saving ?? 0) > 0);

  const verified = data?.verified_monthly_saving ?? 0;
  const possible = data?.total_monthly_saving ?? 0;
  const n = data?.insights_acted_on ?? 0;

  const savingsLabel = hasValueData
    ? verified > 0
      ? `${fmtGBP(verified)}/mo saved`
      : `${fmtGBP(possible)}/mo potential savings`
    : null;

  const accentColor =
    hasValueData && verified > 0 ? tw.color.emerald500 : tw.color.indigo600;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: bgColor,
          borderColor,
          shadowOpacity: dark ? 0 : 0.04,
        },
      ]}
    >
      {/* Row 1: ValueDeliveredStat — only when savings data exists */}
      {hasValueData && (
        <>
          <Pressable
            onPress={onNavigate}
            style={({ pressed }) => [
              styles.row,
              { opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <View style={[styles.iconChip, { backgroundColor: `${accentColor}18` }]}>
              <Sparkles size={15} color={accentColor} />
            </View>
            <View style={styles.labelBlock}>
              <Text style={[styles.rowPrimary, { color: inkColor }]}>
                {savingsLabel}
              </Text>
              {n > 0 && (
                <Text style={[styles.rowSub, { color: muteColor }]}>
                  {n} insight{n === 1 ? "" : "s"} identified
                </Text>
              )}
            </View>
            <ChevronRight size={14} color={muteColor} />
          </Pressable>

          {/* Divider */}
          <View style={[styles.divider, { backgroundColor: dividerColor }]} />
        </>
      )}

      {/* Row 2: Mirror row — always shown */}
      <Pressable
        onPress={() => router.push("/mirror" as any)}
        style={({ pressed }) => [
          styles.row,
          { opacity: pressed ? 0.8 : 1 },
        ]}
      >
        <View style={[styles.iconChip, { backgroundColor: `${tw.color.slate400}18` }]}>
          <ScanFace size={15} color={muteColor} />
        </View>
        <Text style={[styles.rowPrimary, { color: subColor, flex: 1 }]}>
          How your money behaves
        </Text>
        <Text style={[styles.chevronText, { color: muteColor }]}>›</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: tw.radius["2xl"],
    borderWidth: 1,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 2,
    elevation: 1,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 44,
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[2],
    gap: tw.space[3],
  },
  iconChip: {
    width: 30,
    height: 30,
    borderRadius: tw.radius.xl,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  labelBlock: {
    flex: 1,
    gap: 1,
  },
  rowPrimary: {
    ...tw.text.sm,
    fontWeight: tw.weight.medium,
  },
  rowSub: {
    ...tw.text.xs,
  },
  chevronText: {
    ...tw.text.sm,
    flexShrink: 0,
  },
  divider: {
    height: 1,
    marginHorizontal: tw.space[4],
  },
});
