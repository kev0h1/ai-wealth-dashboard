/**
 * CategoryGrid — 2-column grid of tinted category cards for the Spend screen.
 *
 * Each card shows:
 *   - Tinted icon chip (15% alpha background, full-strength icon emoji)
 *   - Category name + transaction count + "× usual" fragment
 *   - Amount (lg/bold)
 *   - Spend bar (proportional to total spend)
 *   - Badge slot: checkpoint > "is this usual?" > quick-link hints
 *
 * Tap → opens SpendCategorySheet (handled by parent via onCategoryPress).
 */

import React from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
} from "react-native";
import {
  ChevronRight,
  Fuel,
  ReceiptText,
} from "lucide-react-native";
import { tw } from "@/lib/tw";
import { CATEGORY_COLOURS, CATEGORY_ICONS } from "@/lib/shared";
import type { CategorySignal } from "@/lib/api/spend";
import type { Transaction } from "@/lib/shared";
import { Skeleton } from "@/components/ui";

export interface CategoryData {
  name: string;
  total: number;
  count: number;
  pct: number;
  transactions: Transaction[];
}

interface CategoryGridProps {
  categories: CategoryData[];
  signals: Record<string, CategorySignal>;
  loading: boolean;
  dark: boolean;
  onCategoryPress: (cat: CategoryData) => void;
}

function catColour(name: string, colours: Record<string, string> = {}): string {
  return (
    colours[name] ??
    CATEGORY_COLOURS[name] ??
    CATEGORY_COLOURS["Other"] ??
    "#94a3b8"
  );
}

function catIcon(name: string): string {
  return CATEGORY_ICONS[name] ?? "📦";
}

function fmtAmount(n: number): string {
  return `£${Math.abs(n).toLocaleString("en-GB", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

interface CategoryCardProps {
  cat: CategoryData;
  sig: CategorySignal | undefined;
  dark: boolean;
  onPress: () => void;
}

function CategoryCard({ cat, sig, dark, onPress }: CategoryCardProps) {
  const colour = catColour(cat.name);
  const icon = catIcon(cat.name);
  const chipBg = colour + "26"; // 15% alpha hex
  const s = cat.count !== 1 ? "s" : "";
  const multipleFragment =
    sig?.multiple != null ? ` · ${sig.multiple.toFixed(1)}× usual` : "";

  const cardBg = dark ? tw.color.cardDark : tw.color.cardLight;
  const borderColor = dark ? tw.color.cardBorderDark : tw.color.cardBorderLight;
  const nameTone = dark ? tw.color.slate100 : tw.color.slate800;
  const subTone = dark ? tw.color.slate400 : tw.color.slate500;
  const amtTone = dark ? tw.color.slate100 : tw.color.slate900;
  const trackBg = dark ? tw.color.slate700 : tw.color.slate200;
  const badgeBg = dark ? "rgba(51,65,85,0.6)" : tw.color.slate100;
  const badgeText = dark ? tw.color.slate300 : tw.color.slate500;
  const badgeChevron = dark ? tw.color.slate500 : tw.color.slate400;

  const renderBadge = () => {
    if (sig?.checkpoint) {
      return (
        <View style={[styles.badge, { backgroundColor: badgeBg }]}>
          <Text style={[styles.badgeText, { color: badgeText }]} numberOfLines={1}>
            {fmtAmount(sig.checkpoint.spent_so_far)} of {fmtAmount(sig.checkpoint.aim_amount)} aim
          </Text>
          <ChevronRight size={10} color={badgeChevron} />
        </View>
      );
    }
    if (sig?.multiple != null && sig.multiple >= 1.5 && !sig.door_engaged) {
      return (
        <View style={[styles.badge, { backgroundColor: badgeBg }]}>
          <Text style={[styles.badgeText, { color: badgeText }]}>is this usual?</Text>
          <ChevronRight size={10} color={badgeChevron} />
        </View>
      );
    }
    const lower = cat.name.toLowerCase();
    if (lower === "transport") {
      return (
        <View style={[styles.badge, { backgroundColor: badgeBg }]}>
          <Fuel size={10} color={colour} />
          <Text style={[styles.badgeText, { color: badgeText }]}>cheaper fuel inside</Text>
          <ChevronRight size={10} color={badgeChevron} />
        </View>
      );
    }
    if (lower === "groceries") {
      return (
        <View style={[styles.badge, { backgroundColor: badgeBg }]}>
          <ReceiptText size={10} color={colour} />
          <Text style={[styles.badgeText, { color: badgeText }]}>scan receipts inside</Text>
          <ChevronRight size={10} color={badgeChevron} />
        </View>
      );
    }
    return null;
  };

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: cardBg,
          borderColor,
          shadowColor: dark ? "transparent" : "#000",
          transform: [{ scale: pressed ? 0.96 : 1 }],
        },
      ]}
    >
      {/* Header row: chip + name + count */}
      <View style={styles.headerRow}>
        <View style={[styles.chip, { backgroundColor: chipBg, borderRadius: tw.radius.xl }]}>
          <Text style={styles.chipIcon}>{icon}</Text>
        </View>
        <View style={styles.nameBlock}>
          <Text style={[styles.catName, { color: nameTone }]} numberOfLines={1}>
            {cat.name}
          </Text>
          <Text style={[styles.catSub, { color: subTone }]} numberOfLines={1}>
            {cat.count} txn{s}{multipleFragment}
          </Text>
        </View>
      </View>

      {/* Amount */}
      <Text style={[styles.amount, { color: amtTone }]}>
        {fmtAmount(cat.total)}
      </Text>

      {/* Spend bar */}
      <View style={[styles.barTrack, { backgroundColor: trackBg }]}>
        <View
          style={[
            styles.barFill,
            { width: `${Math.min(cat.pct, 100)}%`, backgroundColor: colour },
          ]}
        />
      </View>

      {/* Badge slot */}
      {renderBadge()}
    </Pressable>
  );
}

export function CategoryGrid({
  categories,
  signals,
  loading,
  dark,
  onCategoryPress,
}: CategoryGridProps) {
  const cardBg = dark ? tw.color.cardDark : tw.color.cardLight;
  const borderColor = dark ? tw.color.cardBorderDark : tw.color.cardBorderLight;
  const emptyText = dark ? tw.color.slate400 : tw.color.slate500;

  if (loading) {
    return (
      <View style={styles.grid}>
        {[0, 1, 2, 3].map((i) => (
          <View
            key={i}
            style={[
              styles.card,
              { backgroundColor: cardBg, borderColor, shadowColor: "transparent" },
            ]}
          >
            <Skeleton height={36} width={36} borderRadius={tw.radius.xl} />
            <Skeleton height={14} width="60%" style={{ marginTop: tw.space[2] }} />
            <Skeleton height={20} width="80%" style={{ marginTop: tw.space[1] }} />
            <Skeleton height={6} style={{ marginTop: tw.space[2] }} borderRadius={tw.radius.full} />
          </View>
        ))}
      </View>
    );
  }

  if (categories.length === 0) {
    return (
      <View
        style={[
          styles.emptyCard,
          { backgroundColor: cardBg, borderColor },
        ]}
      >
        <Text style={[styles.emptyText, { color: emptyText }]}>
          No spending in this period
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.grid}>
      {categories.map((cat) => (
        <CategoryCard
          key={cat.name}
          cat={cat}
          sig={signals[cat.name]}
          dark={dark}
          onPress={() => onCategoryPress(cat)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: tw.space[3],
  },
  card: {
    // Exactly half the container width minus the gap (gap/2 per side)
    width: "47.5%",
    borderRadius: tw.radius["2xl"],
    padding: tw.space[4],
    borderWidth: 1,
    gap: tw.space[2],
    overflow: "hidden",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10, // 2.5 spacing = 10px
  },
  chip: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  chipIcon: {
    fontSize: 16,
  },
  nameBlock: {
    flex: 1,
    minWidth: 0,
  },
  catName: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    fontWeight: tw.weight.semibold,
  },
  catSub: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
  amount: {
    fontSize: tw.text.lg.fontSize,
    lineHeight: tw.text.lg.lineHeight,
    fontWeight: tw.weight.bold,
  },
  barTrack: {
    height: 6,
    width: "100%",
    borderRadius: tw.radius.full,
    overflow: "hidden",
  },
  barFill: {
    height: "100%",
    borderRadius: tw.radius.full,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: tw.radius.full,
  },
  badgeText: {
    fontSize: 11,
    lineHeight: 16,
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
});
