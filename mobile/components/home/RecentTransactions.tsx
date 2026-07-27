import { useState } from "react";
import { View, Text, StyleSheet, Image } from "react-native";
import { Pressable } from "react-native";
import { WhisperLabel } from "@/components/ui/WhisperLabel";
import { logoUrl } from "@/lib/api";
import type { Transaction } from "@/lib/shared";

// Merchant-chip fallback colour. Transcribed verbatim from the web source of
// truth (frontend/lib/categories.ts CATEGORY_COLOURS). The web chip derives its
// background from colours[category] ?? CATEGORY_COLOURS.Other, so unknown/absent
// categories fall back to Other's slate rather than a custom colour.
const MERCHANT_CHIP_COLOURS: Record<string, string> = {
  Groceries: "#34d399",
  "Eating Out": "#fb923c",
  Transport: "#60a5fa",
  Entertainment: "#c084fc",
  Shopping: "#f472b6",
  Bills: "#fb7185",
  "Bills & Utilities": "#fb7185",
  Subscriptions: "#22d3ee",
  Health: "#2dd4bf",
  Beauty: "#e879f9",
  Travel: "#818cf8",
  Software: "#a3e635",
  Savings: "#fbbf24",
  Debt: "#f87171",
  Transfer: "#cbd5e1",
  Transfers: "#cbd5e1",
  Income: "#4ade80",
  Cash: "#facc15",
  Charity: "#f9a8d4",
  Other: "#94a3b8",
};

function categoryColour(category?: string): string {
  return MERCHANT_CHIP_COLOURS[category ?? "Other"] ?? MERCHANT_CHIP_COLOURS.Other;
}

// ── Merchant identity ──────────────────────────────────────────────────────────

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

function MerchantChip({ tx }: { tx: Transaction }) {
  const [imgFailed, setImgFailed] = useState(false);
  const name = tx.merchant_name || tx.description || "";
  const domain = !imgFailed ? getMerchantDomain(name) : null;

  if (domain) {
    return (
      <View style={styles.merchantChipLogo}>
        <Image
          source={{ uri: logoUrl(domain) }}
          onError={() => setImgFailed(true)}
          style={styles.merchantLogo}
          resizeMode="contain"
        />
      </View>
    );
  }

  return (
    <View style={[styles.merchantChipFallback, { backgroundColor: categoryColour(tx.category) }]}>
      <Text style={styles.merchantInitial}>{initialFor(name)}</Text>
    </View>
  );
}

interface Props {
  transactions: Transaction[];
  loading: boolean;
  dark: boolean;
  onSeeAll: () => void;
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  } catch {
    return dateStr;
  }
}

export function RecentTransactions({ transactions, loading, dark, onSeeAll }: Props) {
  const cardBg = dark ? "#1e293b" : "#ffffff";
  const borderColor = dark ? "#334155" : "#f1f5f9";
  const inkColor = dark ? "#f1f5f9" : "#0f172a";
  const dividerColor = dark ? "#1e293b" : "#f8fafc";

  const filtered = transactions
    .filter(t => !(t.category === "Transfer" && t.amount < 1))
    .slice(0, 6);

  return (
    <View style={styles.section}>
      {/* Header */}
      <View style={styles.sectionHeader}>
        <WhisperLabel style={{ color: dark ? "#94a3b8" : "#64748b" }}>Recent Transactions</WhisperLabel>
        <Pressable
          onPress={onSeeAll}
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
        >
          <Text style={styles.seeAllLink}>See all →</Text>
        </Pressable>
      </View>

      <View
        style={[
          styles.card,
          { backgroundColor: cardBg, borderColor, shadowOpacity: dark ? 0 : 0.06 },
        ]}
      >
        {loading ? (
          <View style={styles.loadingRows}>
            {[0, 1, 2, 3, 4].map((i) => (
              <View
                key={i}
                style={[styles.skeletonRow, { backgroundColor: dark ? "#334155" : "#e2e8f0" }]}
              />
            ))}
          </View>
        ) : filtered.length === 0 ? (
          <Text style={[styles.emptyText, { color: "#94a3b8" }]}>No transactions yet</Text>
        ) : (
          filtered.map((tx, idx) => {
            const isIncome = tx.transaction_type === "credit";
            const amountColor = isIncome ? "#10b981" : (dark ? "#f1f5f9" : "#0f172a");
            const merchant = tx.merchant_name || tx.description;

            return (
              <View key={tx.id}>
                {idx > 0 && (
                  <View style={[styles.divider, { backgroundColor: dividerColor }]} />
                )}
                <View style={styles.txRow}>
                  <MerchantChip tx={tx} />
                  <View style={styles.txCenter}>
                    <Text
                      style={[styles.txMerchant, { color: inkColor }]}
                      numberOfLines={1}
                    >
                      {merchant}
                    </Text>
                    <Text style={[styles.txDate, { color: "#94a3b8" }]}>
                      {formatDate(tx.date)}{tx.category ? ` · ${tx.category}` : ""}
                    </Text>
                  </View>
                  <Text style={[styles.txAmount, { color: amountColor }]}>
                    {isIncome ? "+" : "-"}£{Math.abs(tx.amount).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </Text>
                </View>
              </View>
            );
          })
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  seeAllLink: {
    color: "#4f46e5",
    fontSize: 13,
    fontWeight: "600",
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 3,
    elevation: 2,
    overflow: "hidden",
  },
  loadingRows: {
    padding: 16,
    gap: 12,
  },
  skeletonRow: {
    height: 36,
    borderRadius: 8,
  },
  emptyText: {
    padding: 24,
    textAlign: "center",
    fontSize: 14,
  },
  divider: {
    height: 1,
    marginHorizontal: 16,
  },
  txRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  txCenter: {
    flex: 1,
    gap: 2,
  },
  txMerchant: {
    fontSize: 14,
    fontWeight: "500",
  },
  txDate: {
    fontSize: 12,
  },
  txAmount: {
    fontSize: 14,
    fontWeight: "600",
  },
  merchantChipLogo: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  merchantLogo: {
    width: 28,
    height: 28,
  },
  merchantChipFallback: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  merchantInitial: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 14,
  },
});
