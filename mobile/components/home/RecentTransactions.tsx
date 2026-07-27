import { View, Text, StyleSheet } from "react-native";
import { Pressable } from "react-native";
import { WhisperLabel } from "@/components/ui/WhisperLabel";
import { CategoryChip } from "@/components/ui/CategoryChip";
import type { Transaction } from "@/lib/shared";

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
    .filter((t) => !(t.category === "Transfer" || t.category === "Transfers") || Math.abs(t.amount) >= 1)
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
                  <CategoryChip category={tx.category ?? "Other"} size={36} />
                  <View style={styles.txCenter}>
                    <Text
                      style={[styles.txMerchant, { color: inkColor }]}
                      numberOfLines={1}
                    >
                      {merchant}
                    </Text>
                    <Text style={[styles.txDate, { color: "#94a3b8" }]}>
                      {formatDate(tx.date)}
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
});
