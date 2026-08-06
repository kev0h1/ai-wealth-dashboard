/**
 * PeriodNav — period navigation bar for the Spend screen.
 *
 * Shows a left chevron (prev), period label in the centre, and a right chevron
 * (next). The "Pay period settings" link is rendered below. Period swipe is
 * handled by the parent via PanResponder so this component is stateless.
 */

import React from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
} from "react-native";
import { ChevronLeft, ChevronRight, Settings2 } from "lucide-react-native";
import { tw } from "@/lib/tw";
import { formatPeriodLocal } from "./periodUtils";

interface PeriodNavProps {
  periodStart: Date;
  periodEnd: Date;
  isCurrentPeriod: boolean;
  canGoPrev: boolean;
  onPrev: () => void;
  onNext: () => void;
  onSettings: () => void;
  dark: boolean;
}

export function PeriodNav({
  periodStart,
  periodEnd,
  isCurrentPeriod,
  canGoPrev,
  onPrev,
  onNext,
  onSettings,
  dark,
}: PeriodNavProps) {
  const cardBg = dark ? tw.color.cardDark : tw.color.cardLight;
  const borderColor = dark ? tw.color.cardBorderDark : tw.color.cardBorderLight;
  const btnBg = dark ? tw.color.slate700 : tw.color.slate100;
  const labelColor = dark ? tw.color.slate200 : tw.color.slate700;
  const subColor = dark ? tw.color.slate400 : tw.color.slate500;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: cardBg,
          borderColor,
          shadowColor: dark ? "transparent" : "#000",
        },
      ]}
    >
      {/* Nav row */}
      <View style={styles.navRow}>
        {/* Prev button */}
        <Pressable
          onPress={onPrev}
          disabled={!canGoPrev}
          style={({ pressed }) => [
            styles.chevronBtn,
            { backgroundColor: pressed && canGoPrev ? (dark ? tw.color.slate600 : tw.color.slate200) : btnBg },
            !canGoPrev && { opacity: 0.3 },
          ]}
          hitSlop={8}
        >
          <ChevronLeft size={16} color={tw.color.slate500} />
        </Pressable>

        {/* Period label */}
        <View style={styles.labelBlock}>
          <Text style={[styles.periodLabel, { color: labelColor }]}>
            {formatPeriodLocal(periodStart, periodEnd)}
          </Text>
          {isCurrentPeriod && (
            <Text style={[styles.currentLabel, { color: subColor }]}>
              Current period
            </Text>
          )}
        </View>

        {/* Next button */}
        <Pressable
          onPress={onNext}
          disabled={isCurrentPeriod}
          style={({ pressed }) => [
            styles.chevronBtn,
            { backgroundColor: pressed && !isCurrentPeriod ? (dark ? tw.color.slate600 : tw.color.slate200) : btnBg },
            isCurrentPeriod && { opacity: 0.3 },
          ]}
          hitSlop={8}
        >
          <ChevronRight size={16} color={tw.color.slate500} />
        </Pressable>
      </View>

      {/* Settings link */}
      <Pressable
        onPress={onSettings}
        style={styles.settingsBtn}
        hitSlop={8}
      >
        <Settings2 size={12} color={subColor} />
        <Text style={[styles.settingsLabel, { color: subColor }]}>
          Pay period settings
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: tw.radius["2xl"],
    paddingHorizontal: tw.space[3],
    paddingVertical: tw.space[3],
    borderWidth: 1,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  chevronBtn: {
    width: 44,
    height: 44,
    borderRadius: tw.radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  labelBlock: {
    flex: 1,
    alignItems: "center",
  },
  periodLabel: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    fontWeight: tw.weight.semibold,
  },
  currentLabel: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
  settingsBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "center",
    marginTop: tw.space[2],
  },
  settingsLabel: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
  },
});
