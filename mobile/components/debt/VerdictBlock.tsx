/**
 * VerdictBlock — hero card showing total debt, payoff horizon, verdict sentence.
 * Ported from the VerdictBlock function in frontend/app/debt-plan/DebtPlanPage.tsx.
 */

import React from "react";
import { View, Text, StyleSheet } from "react-native";
import type { DebtPlanView } from "../../lib/api/debt";
import { tw } from "../../lib/tw";
import { fmtMoney, fmtMonth } from "./helpers";

interface Props {
  plan: DebtPlanView;
  hide: boolean;
  dark?: boolean;
}

export function VerdictBlock({ plan, hide, dark }: Props) {
  const { totals } = plan;
  const buckets = totals.buckets;
  const showFloatBuckets = !!(buckets && buckets.float_total >= 1);

  // ── Headline figure ───────────────────────────────────────────────────────
  const headlineFigure = showFloatBuckets
    ? hide
      ? "£••••"
      : "£" + Math.round(buckets!.carried_total).toLocaleString("en-GB")
    : hide
    ? "£••••"
    : "£" + Math.round(totals.debt).toLocaleString("en-GB");

  // ── Split line ────────────────────────────────────────────────────────────
  let splitText: string | null = null;
  if (showFloatBuckets && buckets) {
    const carried = fmtMoney(buckets.carried_total, hide);
    const float = fmtMoney(buckets.float_total, hide);
    const interest = buckets.carried_interest ?? 0;
    const zero = buckets.carried_zero ?? 0;
    if (interest >= 1) {
      splitText = `${carried} carried — ${fmtMoney(interest, hide)} of it costing interest · ${float} of monthly spending you clear as you go`;
    } else if (zero >= 0.9 * buckets.carried_total) {
      splitText = `${carried} carried on 0% deals · ${float} of monthly spending you clear as you go`;
    } else {
      splitText = `${carried} carried · ${float} of monthly spending you clear as you go`;
    }
  }

  // ── Verdict sentence ──────────────────────────────────────────────────────
  const isBad = totals.verdict === "bad";
  const isDrifting = totals.verdict === "drifting";
  let verdictParts: Array<{ text: string; amber?: boolean }> = [];

  if (isBad) {
    if (!totals.debt_free_month) {
      verdictParts = [
        { text: "At your current pace the cards aren't coming down.", amber: true },
      ];
    } else {
      verdictParts = [
        {
          text: `At your current pace the cards clear in ${fmtMonth(totals.debt_free_month)} — further out than five years.`,
          amber: true,
        },
      ];
    }
    if (plan.history?.rising) {
      verdictParts.push({
        text: ` Your carried debt has risen ${fmtMoney(plan.history.trend_3m, hide)} over the last three months.`,
      });
    }
  } else if (isDrifting) {
    verdictParts = [
      {
        text: `At your current pace the cards clear in ${fmtMonth(totals.debt_free_month!)} — ${fmtMoney(totals.interest_to_clear, hide)} of that will be interest.`,
        amber: true,
      },
    ];
  } else {
    // good
    if (totals.debt < 50 || !totals.debt_free_month) {
      verdictParts = [{ text: "Nothing material on the cards right now." }];
    } else {
      verdictParts = [
        {
          text: `At your current pace the cards clear in ${fmtMonth(totals.debt_free_month)}, with ${fmtMoney(totals.interest_to_clear, hide)} interest.`,
        },
      ];
    }
  }

  const showAmberDot = isBad || isDrifting;

  return (
    <View style={[styles.card, dark && styles.cardDark]}>
      <Text style={[styles.label, dark && styles.labelDark]}>
        {showFloatBuckets ? "CARRIED ON YOUR CARDS" : "ACROSS YOUR CARDS"}
      </Text>
      <Text style={[styles.headline, dark && styles.headlineDark]}>
        {headlineFigure}
      </Text>
      {splitText ? (
        <Text style={[styles.split, dark && styles.splitDark]}>{splitText}</Text>
      ) : null}
      <View style={styles.verdictRow}>
        {showAmberDot ? (
          <View style={styles.amberDot} />
        ) : null}
        <Text style={[styles.verdict, dark && styles.verdictDark, showAmberDot && styles.verdictWithDot]}>
          {verdictParts.map((part, i) => (
            <Text key={i}>{part.text}</Text>
          ))}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: tw.color.white,
    borderRadius: tw.radius["3xl"],
    padding: tw.space[5],
    borderWidth: 1,
    borderColor: tw.color.cardBorderLight,
  },
  cardDark: {
    backgroundColor: tw.color.slate800,
    borderColor: tw.color.cardBorderDark,
  },
  label: {
    ...tw.text["11"],
    fontWeight: tw.weight.semibold,
    textTransform: "uppercase",
    letterSpacing: tw.tracking(tw.trackingEm.widest, 11),
    color: tw.color.slate600,
  },
  labelDark: {
    color: tw.color.slate300,
  },
  headline: {
    fontSize: 36,
    lineHeight: 40,
    fontWeight: tw.weight.bold,
    letterSpacing: tw.tracking(tw.trackingEm.tight, 36),
    color: tw.color.slate900,
    marginTop: tw.space[1],
  },
  headlineDark: {
    color: tw.color.slate100,
  },
  split: {
    ...tw.text["11"],
    fontSize: 13,
    lineHeight: 18,
    color: tw.color.slate600,
    marginTop: tw.space[1],
  },
  splitDark: {
    color: tw.color.slate300,
  },
  verdictRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginTop: tw.space[2],
  },
  amberDot: {
    width: 8,
    height: 8,
    borderRadius: tw.radius.full,
    backgroundColor: tw.color.amber500,
    marginRight: tw.space[2],
    marginTop: 4, // align with first line of text
  },
  verdict: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
    color: tw.color.slate700,
  },
  verdictDark: {
    color: tw.color.slate200,
  },
  verdictWithDot: {
    // slightly more compact when the dot is showing
  },
});
