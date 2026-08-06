/**
 * PennyInsight — AI narration card with indigo→violet gradient badge.
 * Ported from PennyInsight in frontend/app/debt-plan/DebtPlanPage.tsx.
 */

import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import type { DebtPlanView } from "../../lib/api/debt";
import { tw } from "../../lib/tw";
import { maskAmounts } from "./helpers";

interface Props {
  plan: DebtPlanView;
  hide: boolean;
  onAddRates: () => void;
  onOpenCard: (accountId: string) => void;
  dark?: boolean;
}

export function PennyInsight({ plan, hide, onAddRates, onOpenCard, dark }: Props) {
  const narration = plan.narration;
  if (!narration?.text) return null;

  const text = hide ? maskAmounts(narration.text) : narration.text;
  const hasMissingRates = plan.cards.some(c => c.flags.terms_missing && c.debt > 0);
  const ask = narration.ask ?? null;

  const showAskButton = ask != null;
  const showAddRatesButton = !showAskButton && hasMissingRates;
  const askLabel =
    ask?.kind === "usage" ? "How I use this card" : "Add the deal";

  return (
    <View style={[styles.card, dark && styles.cardDark]}>
      {/* Penny badge */}
      <View style={styles.badgeRow}>
        <LinearGradient
          colors={["#4f46e5", "#7c3aed"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.badge}
        >
          <Text style={styles.badgeText}>✦ Penny</Text>
        </LinearGradient>
      </View>

      {/* Narration body */}
      <Text style={[styles.body, dark && styles.bodyDark]}>{text}</Text>

      {/* Optional CTA */}
      {showAskButton && (
        <Pressable
          onPress={() => onOpenCard(ask!.account_id)}
          style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
          accessibilityRole="button"
          accessibilityLabel={askLabel}
        >
          <Text style={styles.btnText}>{askLabel}</Text>
        </Pressable>
      )}
      {showAddRatesButton && (
        <Pressable
          onPress={onAddRates}
          style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
          accessibilityRole="button"
          accessibilityLabel="Add rates"
        >
          <Text style={styles.btnText}>Add rates</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: tw.color.white,
    borderRadius: tw.radius["2xl"],
    padding: tw.space[4],
    borderWidth: 1,
    borderColor: tw.color.cardBorderLight,
    gap: tw.space[3],
  },
  cardDark: {
    backgroundColor: tw.color.slate800,
    borderColor: tw.color.cardBorderDark,
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  badge: {
    borderRadius: tw.radius.full,
    paddingHorizontal: tw.space[2.5],
    paddingVertical: tw.space[1],
  },
  badgeText: {
    ...tw.text["10"],
    fontWeight: tw.weight.semibold,
    textTransform: "uppercase",
    letterSpacing: tw.tracking(tw.trackingEm.wide, 10),
    color: tw.color.white,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    color: tw.color.slate700,
  },
  bodyDark: {
    color: tw.color.slate200,
  },
  btn: {
    backgroundColor: tw.color.indigo600,
    borderRadius: tw.radius.xl,
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[2.5],
    alignSelf: "flex-start",
  },
  btnPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.97 }],
  },
  btnText: {
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
    color: tw.color.white,
  },
});
