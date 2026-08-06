import React from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
} from "react-native";
import { tw } from "@/lib/tw";
import { CATEGORY_ICONS, CATEGORY_COLOURS } from "@/lib/categories";

export interface BillRowItem {
  name: string;
  amount: number;
  expected_date: string;
  original_date?: string | null;
  days_away: number;
  account_id?: string | null;
  account_name?: string | null;
  account_bank?: string | null;
  account_balance?: number | null;
  category?: string | null;
  pending?: boolean;
  days_past_due?: number;
  planned?: boolean;
  planned_id?: string | null;
  edited?: boolean;
  rule_label?: string | null;
  type: "bill" | "income";
  balance_after: number;
  at_risk: boolean;
  account_short: boolean;
  is_credit_card: boolean;
  flagged: boolean;
}

interface BillRowProps {
  item: BillRowItem;
  dark: boolean;
  onPress: () => void;
  onSkip: () => void;
  highlighted?: boolean;
}

function formatItemDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export function BillRow({ item, dark, onPress, onSkip, highlighted }: BillRowProps) {
  const catName =
    item.type === "income"
      ? item.category || "Income"
      : item.category || "Other";
  const colour = CATEGORY_COLOURS[catName] ?? CATEGORY_COLOURS["Other"] ?? "#795548";
  const emoji = CATEGORY_ICONS[catName] ?? "📦";
  const sym = "£";
  const dpd = item.days_past_due ?? 0;

  const cardBg = item.flagged
    ? dark
      ? "rgba(159,18,57,0.2)"
      : "#fff1f2"
    : dark
    ? tw.color.cardDark
    : tw.color.cardLight;

  const cardBorder = item.flagged
    ? dark
      ? "rgba(159,18,57,0.6)"
      : "#fecdd3"
    : dark
    ? tw.color.cardBorderDark
    : tw.color.cardBorderLight;

  const highlightBorder = highlighted ? tw.color.rose500 : cardBorder;

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.card,
        {
          backgroundColor: cardBg,
          borderColor: highlightBorder,
          borderWidth: highlighted ? 2 : 1,
        },
      ]}
    >
      {/* Icon badge */}
      {item.flagged ? (
        <View
          style={[
            styles.iconBadgeRose,
            {
              backgroundColor: dark
                ? "rgba(159,18,57,0.4)"
                : "#fee2e2",
            },
          ]}
        >
          <Text style={styles.warnEmoji}>⚠</Text>
        </View>
      ) : (
        <View
          style={[
            styles.iconBadge,
            { backgroundColor: colour + "26" },
          ]}
        >
          <Text style={styles.emoji}>{emoji}</Text>
        </View>
      )}

      {/* Content */}
      <View style={styles.content}>
        {/* Name row */}
        <View style={styles.nameRow}>
          <Text
            style={[
              styles.name,
              {
                color: item.flagged
                  ? dark
                    ? "#fca5a5"
                    : "#b91c1c"
                  : dark
                  ? tw.color.slate100
                  : tw.color.slate800,
              },
            ]}
            numberOfLines={1}
          >
            {item.name}
          </Text>
          {item.planned ? (
            <View
              style={[
                styles.badge,
                { backgroundColor: dark ? "rgba(49,46,129,0.3)" : tw.color.indigo50 },
              ]}
            >
              <Text
                style={[
                  styles.badgeText,
                  { color: dark ? tw.color.indigo400 : tw.color.indigo600 },
                ]}
              >
                planned
              </Text>
            </View>
          ) : item.edited ? (
            <View
              style={[
                styles.badge,
                { backgroundColor: dark ? "rgba(49,46,129,0.3)" : tw.color.indigo50 },
              ]}
            >
              <Text
                style={[
                  styles.badgeText,
                  { color: dark ? tw.color.indigo400 : tw.color.indigo600 },
                ]}
              >
                edited
              </Text>
            </View>
          ) : null}
        </View>

        {/* Subtext lines */}
        {item.account_short && (item.account_bank || item.account_name) && (
          <Text
            style={[styles.roseSubtext, { color: dark ? "#fb7185" : tw.color.rose500 }]}
            numberOfLines={1}
          >
            {item.account_bank || item.account_name} · only {sym}
            {(item.account_balance ?? 0).toLocaleString("en-GB", {
              maximumFractionDigits: 0,
            })}{" "}
            available
          </Text>
        )}
        {item.at_risk && !item.account_short && (
          <>
            <Text style={[styles.roseSubtext, { color: dark ? "#fb7185" : tw.color.rose500 }]}>Overall balance will be low</Text>
            {item.type === "bill" && (item.account_bank || item.account_name) && (
              <Text
                style={[
                  styles.subtext,
                  { color: dark ? tw.color.slate500 : tw.color.slate400 },
                ]}
                numberOfLines={1}
              >
                {item.account_bank || item.account_name}
              </Text>
            )}
          </>
        )}
        {item.is_credit_card &&
          (item.account_bank || item.account_name) &&
          !item.flagged && (
            <Text
              style={[
                styles.subtext,
                { color: dark ? tw.color.slate400 : tw.color.slate500 },
              ]}
              numberOfLines={1}
            >
              {item.account_bank || item.account_name}
            </Text>
          )}
        {item.type === "bill" &&
          !item.account_short &&
          !item.is_credit_card &&
          !item.at_risk &&
          (item.account_bank || item.account_name) &&
          !item.flagged && (
            <Text
              style={[
                styles.subtext,
                { color: dark ? tw.color.slate500 : tw.color.slate400 },
              ]}
              numberOfLines={1}
            >
              {item.account_bank || item.account_name}
            </Text>
          )}

        {/* Date */}
        <Text
          style={[
            styles.subtext,
            { color: dark ? tw.color.slate400 : tw.color.slate500 },
          ]}
        >
          {formatItemDate(item.expected_date)}
        </Text>

        {/* Pending logic */}
        {item.type === "bill" && item.pending && dpd >= 5 && (() => {
          const pendingDateStr = formatItemDate(
            item.original_date ?? item.expected_date
          );
          const isDebt = item.category === "Debt";
          return (
            <>
              <Text
                style={[
                  styles.subtext,
                  {
                    color: isDebt
                      ? dark
                        ? tw.color.red600
                        : tw.color.red600
                      : dark
                      ? tw.color.slate400
                      : tw.color.slate500,
                  },
                ]}
              >
                {isDebt
                  ? `Expected ${pendingDateStr} — hasn't left. A missed card payment can mean fees, so worth checking today.`
                  : `Expected ${pendingDateStr} — we haven't seen it leave. Worth checking with them.`}
              </Text>
              <Pressable
                onPress={(e) => {
                  e.stopPropagation?.();
                  onSkip();
                }}
                style={styles.dismissBtn}
              >
                <Text
                  style={[
                    styles.subtext,
                    { color: dark ? tw.color.slate400 : tw.color.slate500 },
                  ]}
                >
                  Dismiss for this month
                </Text>
              </Pressable>
            </>
          );
        })()}
        {item.type === "bill" && item.pending && dpd < 5 && (
          <Text
            style={[
              styles.subtext,
              { color: dark ? tw.color.slate500 : tw.color.slate400 },
            ]}
          >
            expected{" "}
            {new Date(
              item.original_date ?? item.expected_date
            ).toLocaleDateString("en-GB", { weekday: "short" })}{" "}
            — hasn't left yet
          </Text>
        )}
      </View>

      {/* Amount + balance_after */}
      <View style={styles.amountCol}>
        <Text
          style={[
            styles.amount,
            {
              color:
                item.type === "income"
                  ? tw.color.emerald500
                  : item.flagged
                  ? dark
                    ? "#fb7185"
                    : "#e11d48"
                  : dark
                  ? tw.color.slate100
                  : tw.color.slate800,
            },
          ]}
        >
          {item.type === "income" ? "+" : "−"}
          {sym}
          {item.amount.toLocaleString("en-GB", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </Text>
        <Text
          style={[
            styles.balanceAfter,
            {
              color:
                item.balance_after >= 0
                  ? dark
                    ? tw.color.slate400
                    : tw.color.slate500
                  : "#fb7185",
            },
          ]}
        >
          {item.balance_after < 0 ? "−" : ""}
          {sym}
          {Math.abs(item.balance_after).toLocaleString("en-GB", {
            maximumFractionDigits: 0,
          })}{" "}
          left
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[3],
    borderRadius: tw.radius["2xl"],
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[3],
    minHeight: 56,
    borderWidth: 1,
  },
  iconBadge: {
    width: 32,
    height: 32,
    borderRadius: tw.radius.lg,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  iconBadgeRose: {
    width: 32,
    height: 32,
    borderRadius: tw.radius.lg,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  emoji: {
    fontSize: 15,
    lineHeight: 20,
  },
  warnEmoji: {
    fontSize: 14,
    lineHeight: 20,
    color: tw.color.rose500,
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
  },
  name: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    fontWeight: tw.weight.medium,
    flex: 1,
  },
  badge: {
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    flexShrink: 0,
  },
  badgeText: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: tw.weight.semibold,
  },
  subtext: {
    fontSize: tw.text["11"].fontSize,
    lineHeight: tw.text["11"].lineHeight,
  },
  roseSubtext: {
    fontSize: tw.text["11"].fontSize,
    lineHeight: tw.text["11"].lineHeight,
    fontWeight: tw.weight.semibold,
  },
  dismissBtn: {
    marginTop: 2,
    minHeight: 22,
  },
  amountCol: {
    alignItems: "flex-end",
    flexShrink: 0,
  },
  amount: {
    fontSize: tw.text.base.fontSize,
    lineHeight: tw.text.base.lineHeight,
    fontWeight: tw.weight.bold,
  },
  balanceAfter: {
    fontSize: tw.text["11"].fontSize,
    lineHeight: tw.text["11"].lineHeight,
    fontWeight: tw.weight.medium,
  },
});
