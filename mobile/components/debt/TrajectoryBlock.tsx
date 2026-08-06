/**
 * TrajectoryBlock — "As it stands" + "Dearest card first" comparison cards.
 * Labels come from the API as sentence-case strings; displayed UPPERCASE via textTransform.
 * Ported from TrajectoryBlocks in frontend/app/debt-plan/DebtPlanPage.tsx.
 */

import React from "react";
import { View, Text, StyleSheet } from "react-native";
import type { DebtPlanView, DebtPlanScenarioB } from "../../lib/api/debt";
import { tw } from "../../lib/tw";
import { fmtMoney, fmtMonth } from "./helpers";

interface Props {
  plan: DebtPlanView;
  hide: boolean;
  dark?: boolean;
}

export function TrajectoryBlock({ plan, hide, dark }: Props) {
  const { scenario_b, totals, cards } = plan;
  const nc = totals.nonclearing;

  const showAsItStands =
    totals.monthly_interest_now >= 1 ||
    (nc.count > 0 && nc.monthly_interest_share >= 1) ||
    totals.potential_monthly_interest >= 1;

  const sb: (DebtPlanScenarioB & { note?: undefined }) | null =
    "note" in scenario_b ? null : (scenario_b as Exclude<DebtPlanScenarioB, { note: string }>);

  const showDearest =
    sb != null &&
    sb.debt_free_month != null &&
    sb.interest_saved != null &&
    sb.interest_saved >= 50;

  if (!showAsItStands && !showDearest) return null;

  const pool = Math.round(
    cards
      .filter(
        c =>
          c.debt > 0 &&
          c.movement.monthly != null &&
          c.movement.monthly > 0,
      )
      .reduce((sum, c) => sum + c.movement.monthly!, 0),
  );
  const poolStr = hide ? "£••••" : "£" + pool.toLocaleString("en-GB");

  // ── Dearest-card-first sentence ───────────────────────────────────────────
  let dearestBody: React.ReactNode = null;
  if (sb != null && sb.debt_free_month != null) {
    const clearsWhat = sb.covers_all_debt ? "everything" : "every card you're paying down";
    const byMonth = fmtMonth(sb.debt_free_month);

    if (!sb.as_is_clears && sb.as_is_interest_over_window != null) {
      const k = sb.pooled_nonclearing_count;
      const dontClear =
        k === sb.pooled_count
          ? "none of those cards clear at all"
          : k === 1
          ? "1 of those cards doesn't clear at all"
          : `${k} of those cards don't clear at all`;
      dearestBody = (
        <Text style={[s.body, dark && s.bodyDark]}>
          {`Same ${poolStr} a month, dearest card first — clears ${clearsWhat} by `}
          <Text style={[s.emph, dark && s.emphDark]}>{byMonth}</Text>
          {` with ${fmtMoney(sb.total_interest, hide)} interest. As it stands, ${dontClear}; by ${byMonth} they'd have cost ${fmtMoney(sb.as_is_interest_over_window, hide)}.`}
        </Text>
      );
    } else if (sb.as_is_clears && sb.as_is_interest_over_window != null) {
      const soonerClause =
        sb.months_sooner != null && sb.months_sooner > 0
          ? `, ${sb.months_sooner} months sooner than your current pace${sb.as_is_debt_free_month ? ` (${fmtMonth(sb.as_is_debt_free_month)})` : ""}`
          : "";
      dearestBody = (
        <Text style={[s.body, dark && s.bodyDark]}>
          {`Same ${poolStr} a month, dearest card first — clears ${clearsWhat} by `}
          <Text style={[s.emph, dark && s.emphDark]}>{byMonth}</Text>
          {` with ${fmtMoney(sb.total_interest, hide)} interest${soonerClause}. As it stands the same cards would have cost ${fmtMoney(sb.as_is_interest_over_window, hide)} by ${byMonth}.`}
        </Text>
      );
    }
  }

  return (
    <View style={s.stack}>
      {/* ── As it stands ── */}
      {showAsItStands && (
        <View style={[s.card, dark && s.cardDark]}>
          <Text style={[s.sectionLabel, dark && s.sectionLabelDark]}>
            {"As it stands"}
          </Text>
          {totals.monthly_interest_now >= 1 ? (
            <>
              <View style={s.interestRow}>
                <Text style={[s.interestFigure, dark && s.interestFigureDark]}>
                  {fmtMoney(totals.monthly_interest_now, hide)}
                </Text>
                <Text style={[s.interestSuffix, dark && s.interestSuffixDark]}>
                  {" a month in interest right now"}
                </Text>
              </View>
              {nc.count > 0 && nc.monthly_interest_share >= 1 && (
                <Text style={[s.body, dark && s.bodyDark, s.mt2]}>
                  {`${fmtMoney(nc.monthly_interest_share, hide)} of that is on ${nc.count} ${nc.count === 1 ? "card that isn't" : "cards that aren't"} clearing at your pace.`}
                </Text>
              )}
              {totals.interest_to_clear >= 1 && (
                <Text style={[s.body, dark && s.bodyDark, s.mt1]}>
                  {`${fmtMoney(totals.interest_to_clear, hide)} to clear ${nc.count > 0 ? "the rest" : "them at your pace"}.`}
                </Text>
              )}
            </>
          ) : (
            <>
              <Text style={[s.noInterest, dark && s.noInterestDark]}>
                No interest is hitting your cards right now.
              </Text>
              {totals.potential_monthly_interest >= 1 && (
                <Text style={[s.body, dark && s.bodyDark, s.mt1]}>
                  {`If these balances ran past their 0% windows at the rates on file, they'd cost about ${fmtMoney(totals.potential_monthly_interest, hide)} a month.`}
                </Text>
              )}
            </>
          )}
        </View>
      )}

      {/* ── Dearest card first ── */}
      {showDearest && sb != null && (
        <View style={[s.card, dark && s.cardDark]}>
          <Text style={[s.sectionLabel, dark && s.sectionLabelDark]}>
            {"Dearest card first"}
          </Text>
          {dearestBody}
          {sb.interest_saved != null && sb.interest_saved >= 1 && (
            <Text style={[s.body, dark && s.bodyDark, s.mt1]}>
              {"That's "}
              <Text style={[s.emerald, dark && s.emeraldDark]}>
                {fmtMoney(sb.interest_saved, hide)}
              </Text>
              {" less interest."}
            </Text>
          )}
          {plan.history?.rising && (
            <Text style={[s.body, dark && s.bodyDark, s.mt1]}>
              {`Your carried debt has risen ${fmtMoney(plan.history.trend_3m, hide)} over the last three months.`}
            </Text>
          )}
          {sb.assumption ? (
            <Text style={[s.assumption, dark && s.assumptionDark, s.mt1]}>
              {sb.assumption}
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  stack: {
    gap: tw.space[3],
  },
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
  // Labels arrive as sentence-case from API; textTransform makes them uppercase
  sectionLabel: {
    ...tw.text["11"],
    fontWeight: tw.weight.semibold,
    textTransform: "uppercase",
    letterSpacing: tw.tracking(tw.trackingEm.widest, 11),
    color: tw.color.slate600,
    marginBottom: tw.space[1],
  },
  sectionLabelDark: {
    color: tw.color.slate300,
  },
  interestRow: {
    flexDirection: "row",
    alignItems: "baseline",
    flexWrap: "wrap",
    marginTop: tw.space[1],
  },
  interestFigure: {
    fontSize: 24,
    lineHeight: 32,
    fontWeight: tw.weight.bold,
    letterSpacing: tw.tracking(tw.trackingEm.tight, 24),
    color: tw.color.slate900,
  },
  interestFigureDark: {
    color: tw.color.slate100,
  },
  interestSuffix: {
    ...tw.text.sm,
    color: tw.color.slate700,
    marginLeft: tw.space[1],
  },
  interestSuffixDark: {
    color: tw.color.slate200,
  },
  noInterest: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: tw.weight.semibold,
    color: tw.color.slate900,
    marginTop: tw.space[2],
  },
  noInterestDark: {
    color: tw.color.slate100,
  },
  body: {
    ...tw.text.sm,
    lineHeight: 20,
    color: tw.color.slate700,
  },
  bodyDark: {
    color: tw.color.slate200,
  },
  emph: {
    fontWeight: tw.weight.semibold,
    color: tw.color.slate900,
  },
  emphDark: {
    color: tw.color.slate100,
  },
  emerald: {
    fontWeight: tw.weight.semibold,
    color: tw.color.emerald500,
  },
  emeraldDark: {
    color: tw.color.emerald400,
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
  mt1: { marginTop: tw.space[1] },
  mt2: { marginTop: tw.space[2] },
});
