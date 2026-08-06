/**
 * DebtCard — the per-card rows inside "THE CARDS" section.
 * Each card shows: bank badge (initials), name, debt, rate pill, movement/payoff lines.
 * Ported from CardRows in frontend/app/debt-plan/DebtPlanPage.tsx.
 */

import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { WhisperLabel } from "../ui/WhisperLabel";
import type { DebtPlanViewCard } from "../../lib/api/debt";
import { tw } from "../../lib/tw";
import { fmtMoney, fmtMonth, isCliff } from "./helpers";

interface Props {
  cards: DebtPlanViewCard[];
  hide: boolean;
  onOpenSheet: (accountId: string) => void;
  dark?: boolean;
}

// Simple bank badge using 2-letter initials (no logo fetch on native for now).
function BankBadge({ name, provider }: { name: string; provider: string }) {
  const initials = (provider || name || "?")
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join("") || "?";

  return (
    <View style={badge.wrap}>
      <Text style={badge.text}>{initials}</Text>
    </View>
  );
}

const badge = StyleSheet.create({
  wrap: {
    width: 36,
    height: 36,
    borderRadius: tw.radius["2xl"],
    backgroundColor: tw.color.indigo50,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  text: {
    fontSize: 13,
    fontWeight: tw.weight.bold,
    color: tw.color.indigo600,
    letterSpacing: 0.5,
  },
});

// Rate pill button
function RatePill({
  card,
  onClick,
  dark,
}: {
  card: DebtPlanViewCard;
  onClick: () => void;
  dark?: boolean;
}) {
  const seg = card.rate_schedule[0];

  if (card.flags.terms_missing || !seg) {
    return (
      <Pressable
        onPress={onClick}
        style={({ pressed }) => [
          pill.base,
          pill.indigo,
          dark && pill.indigoDark,
          pressed && pill.pressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={`Add rate for ${card.name}`}
      >
        <Text style={[pill.textIndigo, dark && pill.textIndigoDark]}>
          Add rate
        </Text>
      </Pressable>
    );
  }

  if (seg.source === "promo") {
    const cliff = seg.until ? isCliff(seg.until) : false;
    // Label: "${apr_pct}% until ${month}" or "${apr_pct}%". No "a month" suffix.
    const label = seg.until
      ? `${seg.apr_pct ?? 0}% until ${fmtMonth(seg.until)}`
      : `${seg.apr_pct ?? 0}%`;

    if (cliff) {
      return (
        <Pressable
          onPress={onClick}
          style={({ pressed }) => [
            pill.base,
            pill.amber,
            dark && pill.amberDark,
            pressed && pill.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Edit rate for ${card.name}: ${label} — ending soon`}
        >
          <Text style={[pill.textAmber, dark && pill.textAmberDark]}>{label}</Text>
        </Pressable>
      );
    }

    return (
      <Pressable
        onPress={onClick}
        style={({ pressed }) => [
          pill.base,
          pill.slate,
          dark && pill.slateDark,
          pressed && pill.pressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={`Edit rate for ${card.name}: ${label}`}
      >
        <Text style={[pill.textSlate, dark && pill.textSlateDark]}>{label}</Text>
      </Pressable>
    );
  }

  // standard or unknown — "Rate on file" when apr_pct is null
  const rateLabel = seg.apr_pct != null ? `${seg.apr_pct}%` : "Rate on file";
  return (
    <Pressable
      onPress={onClick}
      style={({ pressed }) => [
        pill.base,
        pill.slate,
        dark && pill.slateDark,
        pressed && pill.pressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Edit rate for ${card.name}: ${rateLabel}`}
    >
      <Text style={[pill.textSlate, dark && pill.textSlateDark]}>{rateLabel}</Text>
    </Pressable>
  );
}

const pill = StyleSheet.create({
  base: {
    borderRadius: tw.radius.full,
    borderWidth: 1,
    paddingHorizontal: tw.space[2.5],
    paddingVertical: tw.space[2],
    alignSelf: "flex-start",
  },
  pressed: { opacity: 0.75, transform: [{ scale: 0.97 }] },
  // Add rate (indigo)
  indigo: {
    borderColor: tw.color.indigo200,
  },
  indigoDark: {
    borderColor: tw.color.indigo800,
  },
  textIndigo: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: tw.weight.semibold,
    color: tw.color.indigo600,
  },
  textIndigoDark: {
    color: tw.color.indigo400,
  },
  // Cliff / amber promo
  amber: {
    borderColor: tw.color.amber200,
    backgroundColor: tw.color.amber50,
  },
  amberDark: {
    borderColor: tw.color.amber800,
    backgroundColor: "rgba(120,53,15,0.2)",
  },
  textAmber: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: tw.weight.semibold,
    color: tw.color.amber700,
  },
  textAmberDark: {
    color: tw.color.amber300,
  },
  // Standard / promo non-cliff
  slate: {
    borderColor: tw.color.slate200,
  },
  slateDark: {
    borderColor: tw.color.slate600,
  },
  textSlate: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: tw.weight.semibold,
    color: tw.color.slate600,
  },
  textSlateDark: {
    color: tw.color.slate300,
  },
});

export function DebtCard({ cards, hide, onOpenSheet, dark }: Props) {
  return (
    <View>
      <WhisperLabel
        style={[s.sectionLabel, dark && s.sectionLabelDark]}
      >
        THE CARDS
      </WhisperLabel>
      <View style={[s.cardWrap, dark && s.cardWrapDark]}>
        {cards.map((card, idx) => {
          const isCleared = card.classification === "cleared_monthly";
          const hasMovement =
            !isCleared &&
            card.movement.monthly != null &&
            card.movement.monthly > 1;
          const projectedFlat =
            !isCleared && !hasMovement
              ? (card.flags.assumptions ?? []).find(a =>
                  a.includes("projected flat"),
                )
              : undefined;

          return (
            <View
              key={card.account_id}
              style={[
                s.row,
                dark && s.rowDark,
                idx > 0 && s.rowBorder,
                idx > 0 && (dark ? s.rowBorderDark : undefined),
              ]}
            >
              {/* Line 1: badge + name + debt */}
              <View style={s.line1}>
                <BankBadge name={card.name} provider={card.provider} />
                <Text
                  style={[s.cardName, dark && s.cardNameDark]}
                  numberOfLines={1}
                >
                  {card.name}
                </Text>
                <Text style={[s.debtAmt, dark && s.debtAmtDark]}>
                  {card.debt === 0 ? "£0" : fmtMoney(card.debt, hide)}
                </Text>
              </View>

              {/* Line 2: rate pill */}
              <RatePill
                card={card}
                onClick={() => onOpenSheet(card.account_id)}
                dark={dark}
              />

              {/* Line 3: cleared or movement/payoff */}
              {isCleared ? (
                <Text style={[s.meta, dark && s.metaDark]}>
                  Cleared monthly — this is spending, not carried debt.
                </Text>
              ) : (
                <>
                  {hasMovement && (
                    <Text style={[s.meta, dark && s.metaDark]}>
                      +{fmtMoney(card.movement.monthly!, hide)}/mo at your pace
                    </Text>
                  )}
                  {!hasMovement && projectedFlat && (
                    <Text style={[s.meta, dark && s.metaDark]}>
                      {projectedFlat}
                    </Text>
                  )}
                  {card.payoff_month && (
                    <Text style={[s.meta, dark && s.metaDark]}>
                      {"Clears "}
                      {fmtMonth(card.payoff_month)}
                      {card.total_interest != null &&
                        card.total_interest >= 1 &&
                        ` · ${fmtMoney(card.total_interest, hide)} interest`}
                    </Text>
                  )}
                  {!card.payoff_month &&
                    card.debt > 0 &&
                    card.monthly_interest_now >= 1 && (
                      <Text style={[s.meta, dark && s.metaDark]}>
                        {`Not clearing at your pace · ${fmtMoney(card.monthly_interest_now, hide)}/mo interest right now`}
                      </Text>
                    )}
                </>
              )}

              {/* Usage conflict warning */}
              {card.usage_conflict && (
                <Text style={[s.conflict, dark && s.conflictDark]}>
                  You said you clear this monthly, but interest charges are
                  appearing — worth a look.
                </Text>
              )}

              {/* Near-term payment note */}
              {card.near_term_source === "upcoming bills" && (
                <Text style={[s.nearTerm, dark && s.nearTermDark]}>
                  Its usual payment is already in your upcoming bills
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
  sectionLabel: {
    color: tw.color.slate600,
    marginBottom: tw.space[3],
  },
  sectionLabelDark: {
    color: tw.color.slate300,
  },
  cardWrap: {
    backgroundColor: tw.color.white,
    borderRadius: tw.radius["2xl"],
    borderWidth: 1,
    borderColor: tw.color.cardBorderLight,
    overflow: "hidden",
  },
  cardWrapDark: {
    backgroundColor: tw.color.slate800,
    borderColor: tw.color.cardBorderDark,
  },
  row: {
    padding: tw.space[4],
    gap: tw.space[2],
  },
  rowDark: {},
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: tw.color.cardBorderLight,
  },
  rowBorderDark: {
    borderTopColor: tw.color.cardBorderDark,
  },
  line1: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[3],
  },
  cardName: {
    flex: 1,
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
    color: tw.color.slate900,
  },
  cardNameDark: {
    color: tw.color.slate100,
  },
  debtAmt: {
    ...tw.text.base,
    fontWeight: tw.weight.bold,
    color: tw.color.slate900,
    flexShrink: 0,
  },
  debtAmtDark: {
    color: tw.color.slate100,
  },
  meta: {
    fontSize: 13,
    lineHeight: 18,
    color: tw.color.slate600,
  },
  metaDark: {
    color: tw.color.slate300,
  },
  // amber 8×8 dot is inline in the amberDot style in VerdictBlock;
  // usage conflict uses text only (amber calm tone)
  conflict: {
    fontSize: 13,
    lineHeight: 18,
    color: tw.color.amber700,
  },
  conflictDark: {
    color: tw.color.amber400,
  },
  nearTerm: {
    ...tw.text.xs,
    color: tw.color.slate400,
  },
  nearTermDark: {
    color: tw.color.slate500,
  },
});
