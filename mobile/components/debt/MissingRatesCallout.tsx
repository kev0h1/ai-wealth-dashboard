/**
 * MissingRatesCallout — shown when cards have no rate on file.
 */

import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import type { DebtPlanView } from "../../lib/api/debt";
import { tw } from "../../lib/tw";

interface Props {
  plan: DebtPlanView;
  onAddRates: () => void;
  dark?: boolean;
}

export function MissingRatesCallout({ plan, onAddRates, dark }: Props) {
  const n = plan.cards.filter(c => c.flags.terms_missing && c.debt > 0).length;
  if (n === 0) return null;

  const primary =
    n === 1
      ? "1 card has no rate on file, so its interest isn't counted."
      : `${n} cards have no rate on file, so their interest isn't counted.`;

  return (
    <View style={[styles.card, dark && styles.cardDark]}>
      <Text style={[styles.headline, dark && styles.headlineDark]}>{primary}</Text>
      <Text style={[styles.sub, dark && styles.subDark]}>
        Add them once and the plan can count every pound of interest.
      </Text>
      <Pressable
        onPress={onAddRates}
        style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
        accessibilityRole="button"
        accessibilityLabel="Add rates"
      >
        <Text style={styles.btnText}>Add rates</Text>
      </Pressable>
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
  },
  cardDark: {
    backgroundColor: tw.color.slate800,
    borderColor: tw.color.cardBorderDark,
  },
  headline: {
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
    color: tw.color.slate900,
  },
  headlineDark: {
    color: tw.color.slate100,
  },
  sub: {
    fontSize: 13,
    lineHeight: 18,
    color: tw.color.slate600,
    marginTop: tw.space[1],
  },
  subDark: {
    color: tw.color.slate300,
  },
  btn: {
    marginTop: tw.space[3],
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
