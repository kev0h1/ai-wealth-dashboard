import { View, Text, Pressable, StyleSheet } from "react-native";
import { X } from "lucide-react-native";
import { LinearGradient } from "expo-linear-gradient";
import type { SavingsInsight } from "@/lib/shared";
import { tw } from "@/lib/tw";

interface Props {
  insight: SavingsInsight | null;
  loaded: boolean;
  dark: boolean;
  onDismiss: () => void;
  onNavigate: () => void;
}

export function SpotlightCard({ insight, loaded, dark, onDismiss, onNavigate }: Props) {
  const cardBg = dark ? tw.color.cardDark : tw.color.cardLight;
  const borderColor = dark ? tw.color.cardBorderDark : tw.color.cardBorderLight;
  const inkColor = dark ? tw.color.slate100 : tw.color.slate900;

  if (!loaded) {
    return (
      <View
        style={[
          styles.skeleton,
          { backgroundColor: dark ? tw.color.cardBorderDark : tw.color.slate200 },
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
        <X size={16} color={tw.color.slate400} />
      </Pressable>

      {/* Category chip with gradient */}
      <View style={styles.chipRow}>
        <LinearGradient
          colors={[tw.color.indigo600, tw.color.violet600]}
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
        <Text style={[styles.returnReason, { color: tw.color.slate400 }]}>
          {insight.return_reason}
        </Text>
      )}

      {/* Title + body */}
      <Text style={[styles.title, { color: inkColor }]}>{insight.title}</Text>
      <Text style={[styles.body, { color: dark ? tw.color.slate400 : tw.color.slate500 }]} numberOfLines={2}>
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
    borderRadius: tw.radius["2xl"],
  },
  card: {
    borderRadius: tw.radius["2xl"],
    padding: tw.space[4],
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 3,
    elevation: 2,
    gap: tw.space[2.5],
  },
  dismissBtn: {
    position: "absolute",
    top: tw.space[3],
    right: tw.space[3],
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
  chipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[2],
    paddingRight: 44,
  },
  categoryChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[1],
    paddingHorizontal: tw.space[2.5],
    paddingVertical: tw.space[1],
    borderRadius: tw.radius.full,
  },
  categoryIcon: {
    fontSize: 13,
    lineHeight: 18,
  },
  categoryLabel: {
    color: tw.color.white,
    ...tw.text.xs,
    fontWeight: tw.weight.semibold,
  },
  newBadge: {
    backgroundColor: tw.color.indigo50,
    paddingHorizontal: tw.space[2],
    paddingVertical: tw.space[0.5],
    borderRadius: tw.space[2.5],
  },
  newBadgeText: {
    color: tw.color.indigo600,
    ...tw.text["11"],
    fontWeight: tw.weight.bold,
  },
  returnReason: {
    ...tw.text.xs,
  },
  title: {
    ...tw.text.base,
    fontWeight: tw.weight.bold,
    paddingRight: 44,
  },
  body: {
    ...tw.text.sm,
  },
  savingsCallout: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[1.5],
    backgroundColor: tw.color.emerald100,
    borderRadius: tw.space[2.5],
    padding: tw.space[2.5],
  },
  savingsIcon: {
    fontSize: 16,
    lineHeight: 20,
  },
  savingsText: {
    color: tw.color.emerald600,
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
    flex: 1,
  },
  link: {
    color: tw.color.violet600,
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
  },
});
