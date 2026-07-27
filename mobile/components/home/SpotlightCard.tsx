import { View, Text, Pressable, StyleSheet } from "react-native";
import { X } from "lucide-react-native";
import { LinearGradient } from "expo-linear-gradient";
import type { SavingsInsight } from "@/lib/shared";

interface Props {
  insight: SavingsInsight | null;
  loaded: boolean;
  dark: boolean;
  onDismiss: () => void;
  onNavigate: () => void;
}

export function SpotlightCard({ insight, loaded, dark, onDismiss, onNavigate }: Props) {
  const cardBg = dark ? "#1e293b" : "#ffffff";
  const borderColor = dark ? "#334155" : "#f1f5f9";
  const inkColor = dark ? "#f1f5f9" : "#0f172a";

  if (!loaded) {
    return (
      <View
        style={[
          styles.skeleton,
          { backgroundColor: dark ? "#334155" : "#e2e8f0" },
        ]}
      />
    );
  }

  if (!insight) return null;

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: cardBg, borderColor, shadowOpacity: dark ? 0 : 0.06 },
      ]}
    >
      {/* Dismiss */}
      <Pressable
        onPress={onDismiss}
        style={({ pressed }) => [
          styles.dismissBtn,
          { transform: [{ scale: pressed ? 0.95 : 1 }] },
        ]}
        accessibilityLabel="Dismiss insight"
      >
        <X size={16} color="#94a3b8" />
      </Pressable>

      {/* Category chip with gradient */}
      <View style={styles.chipRow}>
        <LinearGradient
          colors={["#4f46e5", "#7c3aed"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.categoryChip}
        >
          <Text style={styles.categoryIcon}>{insight.icon}</Text>
          <Text style={styles.categoryLabel}>{insight.label}</Text>
        </LinearGradient>
        {insight.is_new && (
          <View style={styles.newBadge}>
            <Text style={styles.newBadgeText}>New</Text>
          </View>
        )}
      </View>

      {insight.return_reason && (
        <Text style={[styles.returnReason, { color: "#94a3b8" }]}>
          {insight.return_reason}
        </Text>
      )}

      {/* Title + body */}
      <Text style={[styles.title, { color: inkColor }]}>{insight.title}</Text>
      <Text style={[styles.body, { color: dark ? "#94a3b8" : "#64748b" }]} numberOfLines={2}>
        {insight.body}
      </Text>

      {/* Savings estimate */}
      {insight.savings_estimate && (
        <View style={styles.savingsCallout}>
          <Text style={styles.savingsIcon}>💚</Text>
          <Text style={styles.savingsText}>{insight.savings_estimate}</Text>
        </View>
      )}

      {/* Link */}
      <Pressable
        onPress={onNavigate}
        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
      >
        <Text style={styles.link}>See all insights →</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: {
    height: 128,
    borderRadius: 16,
  },
  card: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 3,
    elevation: 2,
    gap: 10,
  },
  dismissBtn: {
    position: "absolute",
    top: 12,
    right: 12,
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
  chipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingRight: 44,
  },
  categoryChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  categoryIcon: {
    fontSize: 13,
  },
  categoryLabel: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "600",
  },
  newBadge: {
    backgroundColor: "#eef2ff",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  newBadgeText: {
    color: "#4f46e5",
    fontSize: 11,
    fontWeight: "700",
  },
  returnReason: {
    fontSize: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    paddingRight: 44,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
  },
  savingsCallout: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#d1fae5",
    borderRadius: 10,
    padding: 10,
  },
  savingsIcon: {
    fontSize: 16,
  },
  savingsText: {
    color: "#065f46",
    fontSize: 13,
    fontWeight: "600",
    flex: 1,
  },
  link: {
    color: "#7c3aed",
    fontSize: 14,
    fontWeight: "600",
  },
});
