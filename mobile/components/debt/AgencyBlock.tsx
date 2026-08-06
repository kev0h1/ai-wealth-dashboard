/**
 * AgencyBlock — "What it would take" card.
 * Shows extra monthly payment needed + winning cards that are clearing.
 */

import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { WhisperLabel } from "../ui/WhisperLabel";
import type { DebtPlanView } from "../../lib/api/debt";
import { tw } from "../../lib/tw";
import { fmtMoney, fmtMonth } from "./helpers";

interface Props {
  plan: DebtPlanView;
  hide: boolean;
  dark?: boolean;
}

export function AgencyBlock({ plan, hide, dark }: Props) {
  const extra = plan.extra_to_clear;
  const wins = plan.whats_working ?? [];
  const hasFloat = (plan.totals.buckets?.float_total ?? 0) >= 1;
  const cardWord = hasFloat ? "carried card" : "card";

  const hasExtra = extra != null;
  const hasWins = wins.length > 0;
  if (!hasExtra && !hasWins) return null;

  return (
    <View style={styles.container}>
      <WhisperLabel style={[styles.label, dark && styles.labelDark]}>
        WHAT IT WOULD TAKE
      </WhisperLabel>
      <View style={[styles.card, dark && styles.cardDark]}>
        {hasExtra && (
          extra!.amount === 0 ? (
            <Text style={[styles.body, dark && styles.bodyDark]}>
              Your current pace already clears every {cardWord} by{" "}
              {fmtMonth(extra!.debt_free_month)}.
            </Text>
          ) : (
            <Text style={[styles.body, dark && styles.bodyDark]}>
              <Text style={[styles.bold, dark && styles.boldDark]}>
                {fmtMoney(extra!.amount, hide)} more a month
              </Text>{" "}
              clears every {cardWord} by {fmtMonth(extra!.debt_free_month)}.
            </Text>
          )
        )}
        {wins.map((win, i) => (
          <Text
            key={win.account_id}
            style={[styles.body, dark && styles.bodyDark, i > 0 && styles.bodyGap]}
          >
            {win.name} is on its way out — clearing{" "}
            <Text style={[styles.emerald, dark && styles.emeraldDark]}>
              {fmtMonth(win.payoff_month)}
            </Text>{" "}
            at your pace.
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: tw.space[2],
  },
  label: {
    color: tw.color.slate600,
    marginBottom: tw.space[2],
  },
  labelDark: {
    color: tw.color.slate300,
  },
  card: {
    backgroundColor: tw.color.white,
    borderRadius: tw.radius["2xl"],
    padding: tw.space[4],
    borderWidth: 1,
    borderColor: tw.color.cardBorderLight,
    gap: tw.space[2],
  },
  cardDark: {
    backgroundColor: tw.color.slate800,
    borderColor: tw.color.cardBorderDark,
  },
  body: {
    ...tw.text.sm,
    lineHeight: 20,
    color: tw.color.slate700,
  },
  bodyDark: {
    color: tw.color.slate200,
  },
  bodyGap: {
    marginTop: tw.space[1],
  },
  bold: {
    fontWeight: tw.weight.semibold,
    color: tw.color.slate900,
  },
  boldDark: {
    color: tw.color.slate100,
  },
  emerald: {
    fontWeight: tw.weight.semibold,
    color: tw.color.emerald500,
  },
  emeraldDark: {
    color: tw.color.emerald400,
  },
});
