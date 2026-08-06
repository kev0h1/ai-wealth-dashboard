/**
 * TransferRoutes — balance-transfer opportunity cards.
 * Ported from TransferRoutes in frontend/app/debt-plan/DebtPlanPage.tsx.
 */

import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { WhisperLabel } from "../ui/WhisperLabel";
import type { DebtPlanView } from "../../lib/api/debt";
import { tw } from "../../lib/tw";
import { fmtMoney } from "./helpers";

interface Props {
  plan: DebtPlanView;
  hide: boolean;
  dark?: boolean;
}

export function TransferRoutes({ plan, hide, dark }: Props) {
  const opts = plan.refinance_options;
  if (!opts || opts.length === 0) return null;

  return (
    <View style={s.container}>
      <WhisperLabel style={[s.label, dark && s.labelDark]}>
        TRANSFER ROUTES
      </WhisperLabel>
      <View style={s.stack}>
        {opts.map((opt, i) => {
          // Find source card's standard segment APR for the parenthetical
          const srcCard = plan.cards.find(
            c => c.account_id === opt.source_account_id,
          );
          const stdSeg = srcCard?.rate_schedule.find(
            seg => seg.source === "standard",
          );
          const rateParenthetical =
            stdSeg?.apr_pct != null ? ` (${stdSeg.apr_pct}%)` : "";

          const monthly =
            opt.window_months > 0
              ? Math.round(opt.interest_saved / opt.window_months)
              : 0;

          return (
            <View key={i} style={[s.card, dark && s.cardDark]}>
              <Text style={[s.body, dark && s.bodyDark]}>
                {`Moving ${fmtMoney(opt.transferable, hide)} from ${opt.source_name}${rateParenthetical} to ${opt.destination_name}'s offer: ${fmtMoney(opt.fee, hide)} fee once instead of ~${fmtMoney(monthly, hide)}/mo interest.`}
                {opt.break_even_weeks != null
                  ? ` Break-even in ${opt.break_even_weeks} weeks.`
                  : ""}
              </Text>
              {opt.assumptions.length > 0 && (
                <Text style={[s.assumption, dark && s.assumptionDark]}>
                  {opt.assumptions.join(" · ")}
                </Text>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
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
  stack: {
    gap: tw.space[3],
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
  assumption: {
    fontSize: 12,
    lineHeight: 16,
    fontStyle: "italic",
    color: tw.color.slate600,
  },
  assumptionDark: {
    color: tw.color.slate300,
  },
});
