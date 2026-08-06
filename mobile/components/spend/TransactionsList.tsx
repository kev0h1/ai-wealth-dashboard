/**
 * TransactionsList — paginated transaction list for the Spend screen list view.
 *
 * Features:
 *   - FlatList with pull-to-refresh
 *   - Optional "Payments over £250" filter banner
 *   - Merchant icon (favicon via logoUrl or initials fallback)
 *   - Amount coloured green (credit) / default (debit)
 *   - Tap row → opens TransactionSheet (via onTransactionPress)
 */

import React, { useState } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  Image,
  ActivityIndicator,
} from "react-native";
import { tw } from "@/lib/tw";
import { CATEGORY_COLOURS } from "@/lib/shared";
import { formatDate, formatCurrency } from "./periodUtils";
import type { Transaction } from "@/lib/api/spend";

const API_BASE = "https://wealth.auriqltd.co.uk/api";

function logoUrl(domain: string): string {
  return `${API_BASE}/logo/${encodeURIComponent(domain)}`;
}

const MERCHANT_DOMAINS: Array<[RegExp, string]> = [
  [/tesco/i, "tesco.com"],
  [/sainsbury/i, "sainsburys.co.uk"],
  [/asda/i, "asda.com"],
  [/waitrose/i, "waitrose.com"],
  [/lidl/i, "lidl.co.uk"],
  [/aldi/i, "aldi.co.uk"],
  [/morrisons?/i, "morrisons.com"],
  [/amazon/i, "amazon.co.uk"],
  [/netflix/i, "netflix.com"],
  [/spotify/i, "spotify.com"],
  [/apple/i, "apple.com"],
  [/google/i, "google.com"],
  [/uber/i, "uber.com"],
  [/deliveroo/i, "deliveroo.co.uk"],
  [/just.?eat/i, "just-eat.co.uk"],
  [/mcdonald/i, "mcdonalds.com"],
  [/starbucks/i, "starbucks.com"],
  [/costa/i, "costa.co.uk"],
  [/greggs/i, "greggs.co.uk"],
  [/pret/i, "pret.co.uk"],
  [/nando/i, "nandos.co.uk"],
  [/tfl|oyster|transport for london/i, "tfl.gov.uk"],
  [/trainline/i, "thetrainline.com"],
  [/bp\b/i, "bp.com"],
  [/shell\b/i, "shell.co.uk"],
  [/boots\b/i, "boots.com"],
  [/superdrug/i, "superdrug.com"],
  [/asos/i, "asos.com"],
  [/next\b/i, "next.co.uk"],
  [/john lewis/i, "johnlewis.com"],
  [/argos/i, "argos.co.uk"],
  [/currys/i, "currys.co.uk"],
  [/ebay/i, "ebay.co.uk"],
  [/paypal/i, "paypal.com"],
  [/monzo/i, "monzo.com"],
  [/revolut/i, "revolut.com"],
  [/barclays/i, "barclays.co.uk"],
  [/natwest/i, "natwest.com"],
  [/hsbc/i, "hsbc.co.uk"],
  [/starling/i, "starlingbank.com"],
  [/amex|american express/i, "americanexpress.com"],
  [/vodafone/i, "vodafone.co.uk"],
  [/sky\b/i, "sky.com"],
  [/bt\b/i, "bt.com"],
  [/virgin/i, "virginmedia.com"],
  [/octopus/i, "octopusenergy.com"],
  [/british gas/i, "britishgas.co.uk"],
  [/disney/i, "disneyplus.com"],
  [/microsoft/i, "microsoft.com"],
  [/github/i, "github.com"],
  [/notion/i, "notion.so"],
  [/figma/i, "figma.com"],
  [/slack/i, "slack.com"],
  [/zoom/i, "zoom.us"],
  [/airbnb/i, "airbnb.com"],
  [/booking\.com/i, "booking.com"],
  [/ryanair/i, "ryanair.com"],
  [/easyjet/i, "easyjet.com"],
  [/british airways/i, "britishairways.com"],
  [/odeon/i, "odeon.co.uk"],
  [/vue/i, "myvue.com"],
  [/cineworld/i, "cineworld.co.uk"],
  [/puregym/i, "puregym.com"],
  [/ticketmaster/i, "ticketmaster.co.uk"],
  [/goldman sachs|marcus/i, "goldmansachs.com"],
];

function getMerchantDomain(name: string): string | null {
  for (const [pattern, domain] of MERCHANT_DOMAINS) {
    if (pattern.test(name)) return domain;
  }
  return null;
}

function initialFor(name: string): string {
  const m = name.match(/[a-z0-9]/i);
  return m ? m[0].toUpperCase() : "•";
}

function catColour(tx: Transaction): string {
  return CATEGORY_COLOURS[tx.category ?? "Other"] ?? "#94a3b8";
}

function txDisplayName(tx: Transaction): string {
  return tx.merchant_name || tx.description || "Unknown";
}

interface MerchantIconProps {
  tx: Transaction;
  dark: boolean;
}

function MerchantIcon({ tx, dark }: MerchantIconProps) {
  const [failed, setFailed] = useState(false);
  const name = tx.merchant_name || tx.description || "";
  const domain = !failed ? getMerchantDomain(name) : null;
  const colour = catColour(tx);
  const iconBg = dark ? tw.color.slate700 : "#ffffff";

  if (domain) {
    return (
      <View style={[styles.iconWrap, { backgroundColor: iconBg }]}>
        <Image
          source={{ uri: logoUrl(domain) }}
          style={styles.logoImg}
          onError={() => setFailed(true)}
        />
      </View>
    );
  }

  return (
    <View style={[styles.iconWrap, { backgroundColor: colour }]}>
      <Text style={styles.iconInitial}>{initialFor(name)}</Text>
    </View>
  );
}

interface TransactionRowProps {
  tx: Transaction;
  dark: boolean;
  onPress: () => void;
  showDivider: boolean;
}

function TransactionRow({ tx, dark, onPress, showDivider }: TransactionRowProps) {
  const isCredit = tx.transaction_type === "credit";
  const nameTone = dark ? tw.color.slate100 : tw.color.slate800;
  const subTone = dark ? tw.color.slate400 : tw.color.slate500;
  const amtCredit = tw.color.emerald500;
  const amtDebit = dark ? tw.color.slate100 : tw.color.slate800;
  const dividerColor = dark ? tw.color.slate700 : tw.color.slate100;

  return (
    <>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.row,
          { backgroundColor: pressed ? (dark ? "rgba(51,65,85,0.4)" : tw.color.slate100) : "transparent" },
        ]}
      >
        <MerchantIcon tx={tx} dark={dark} />
        <View style={styles.rowInfo}>
          <Text style={[styles.rowName, { color: nameTone }]} numberOfLines={1}>
            {txDisplayName(tx)}
          </Text>
          <Text style={[styles.rowSub, { color: subTone }]} numberOfLines={1}>
            {formatDate(tx.date)}
            {tx.category ? ` · ${tx.category}` : ""}
          </Text>
        </View>
        <Text style={[styles.rowAmt, { color: isCredit ? amtCredit : amtDebit }]}>
          {isCredit ? "+" : "-"}
          {formatCurrency(tx.amount, tx.currency)}
        </Text>
      </Pressable>
      {showDivider && (
        <View style={[styles.divider, { backgroundColor: dividerColor }]} />
      )}
    </>
  );
}

interface TransactionsListProps {
  transactions: Transaction[];
  loading: boolean;
  dark: boolean;
  largeOnly: boolean;
  onClearLargeFilter: () => void;
  onTransactionPress: (tx: Transaction) => void;
  onRefresh: () => void;
  refreshing: boolean;
}

export function TransactionsList({
  transactions,
  loading,
  dark,
  largeOnly,
  onClearLargeFilter,
  onTransactionPress,
  onRefresh,
  refreshing,
}: TransactionsListProps) {
  const displayTxns = largeOnly
    ? transactions.filter((tx) => Math.abs(tx.amount) >= 250)
    : transactions;

  const cardBg = dark ? tw.color.cardDark : tw.color.cardLight;
  const borderColor = dark ? tw.color.cardBorderDark : tw.color.cardBorderLight;
  const emptyText = dark ? tw.color.slate400 : tw.color.slate500;
  const filterBg = dark ? "rgba(67,56,202,0.4)" : tw.color.indigo50;
  const filterBorder = dark ? "rgba(99,102,241,0.6)" : tw.color.indigo200;
  const filterText = dark ? tw.color.indigo300 : "#4338ca";
  const clearText = dark ? tw.color.slate400 : tw.color.slate500;

  if (loading) {
    return (
      <View style={[styles.emptyCard, { backgroundColor: cardBg, borderColor }]}>
        <ActivityIndicator size="small" color={tw.color.indigo500} />
      </View>
    );
  }

  return (
    <>
      {/* Large-only filter banner */}
      {largeOnly && (
        <View style={styles.filterBanner}>
          <View
            style={[
              styles.filterPill,
              { backgroundColor: filterBg, borderColor: filterBorder },
            ]}
          >
            <Text style={[styles.filterPillText, { color: filterText }]}>
              Payments over £250
            </Text>
          </View>
          <Pressable onPress={onClearLargeFilter} hitSlop={8}>
            <Text style={[styles.filterClear, { color: clearText }]}>
              Show all
            </Text>
          </Pressable>
        </View>
      )}

      {displayTxns.length === 0 ? (
        <View style={[styles.emptyCard, { backgroundColor: cardBg, borderColor }]}>
          <Text style={[styles.emptyText, { color: emptyText }]}>
            {largeOnly
              ? "No payments over £250 in this period"
              : "No transactions in this period"}
          </Text>
        </View>
      ) : (
        <View
          style={[
            styles.listCard,
            { backgroundColor: cardBg, borderColor },
          ]}
        >
          <FlatList
            data={displayTxns}
            keyExtractor={(tx) => tx.id}
            scrollEnabled={false}
            onRefresh={onRefresh}
            refreshing={refreshing}
            renderItem={({ item, index }) => (
              <TransactionRow
                tx={item}
                dark={dark}
                onPress={() => onTransactionPress(item)}
                showDivider={index < displayTxns.length - 1}
              />
            )}
          />
        </View>
      )}
    </>
  );
}

// Export TransactionRow standalone for reuse in CategorySheet and income drill-down
export { TransactionRow };
export type { TransactionRowProps };

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[3],
    gap: tw.space[3],
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: tw.radius.xl,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    overflow: "hidden",
  },
  logoImg: {
    width: 28,
    height: 28,
    resizeMode: "contain",
  },
  iconInitial: {
    fontSize: 14,
    fontWeight: tw.weight.bold,
    color: "#ffffff",
  },
  rowInfo: {
    flex: 1,
    minWidth: 0,
  },
  rowName: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    fontWeight: tw.weight.medium,
  },
  rowSub: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
    marginTop: 2,
  },
  rowAmt: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    fontWeight: tw.weight.semibold,
    flexShrink: 0,
  },
  divider: {
    height: 1,
    marginLeft: tw.space[4] + 36 + tw.space[3], // align with text, past icon
  },
  listCard: {
    borderRadius: tw.radius["2xl"],
    overflow: "hidden",
    borderWidth: 1,
  },
  emptyCard: {
    borderRadius: tw.radius["2xl"],
    padding: tw.space[8],
    borderWidth: 1,
    alignItems: "center",
  },
  emptyText: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
  },
  filterBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: tw.space[2],
    paddingHorizontal: tw.space[1],
  },
  filterPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: tw.radius.full,
    borderWidth: 1,
  },
  filterPillText: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
    fontWeight: tw.weight.semibold,
  },
  filterClear: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
    fontWeight: tw.weight.semibold,
  },
});
