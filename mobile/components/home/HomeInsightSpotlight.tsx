import React, { useRef } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  PanResponder,
  Animated,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { X, ChevronRight, TrendingDown } from "lucide-react-native";
import { tw } from "@/lib/tw";
import { Skeleton } from "@/components/ui";
import type { SavingsInsight } from "@/lib/shared";

interface Props {
  insight: SavingsInsight | null;
  loaded: boolean;
  dark: boolean;
  onDismiss: () => void;
  onNavigate: () => void;
}

export function HomeInsightSpotlight({
  insight,
  loaded,
  dark,
  onDismiss,
  onNavigate,
}: Props) {
  const translateX = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dx) > 10 && Math.abs(gs.dx) > Math.abs(gs.dy),
      onPanResponderMove: (_, gs) => {
        translateX.setValue(gs.dx);
        opacity.setValue(Math.max(0, 1 - Math.abs(gs.dx) / 200));
      },
      onPanResponderRelease: (_, gs) => {
        if (Math.abs(gs.dx) > 100) {
          Animated.parallel([
            Animated.timing(translateX, {
              toValue: gs.dx > 0 ? 400 : -400,
              duration: 200,
              useNativeDriver: true,
            }),
            Animated.timing(opacity, {
              toValue: 0,
              duration: 200,
              useNativeDriver: true,
            }),
          ]).start(() => onDismiss());
        } else {
          Animated.parallel([
            Animated.spring(translateX, {
              toValue: 0,
              useNativeDriver: true,
            }),
            Animated.timing(opacity, {
              toValue: 1,
              duration: 150,
              useNativeDriver: true,
            }),
          ]).start();
        }
      },
    }),
  ).current;

  if (!loaded) {
    return <Skeleton style={{ height: 128, borderRadius: tw.radius["2xl"] }} />;
  }

  if (!insight) return null;

  const cardBg = dark ? tw.color.cardDark : tw.color.cardLight;
  const borderColor = dark ? tw.color.cardBorderDark : tw.color.cardBorderLight;
  const inkColor = dark ? tw.color.slate100 : tw.color.slate900;
  const subColor = dark ? tw.color.slate400 : tw.color.slate500;

  return (
    <Animated.View
      style={{ transform: [{ translateX }], opacity }}
      {...panResponder.panHandlers}
    >
      <View
        style={[
          styles.card,
          {
            backgroundColor: cardBg,
            borderColor,
            shadowOpacity: dark ? 0 : 0.06,
          },
        ]}
      >
        {/* Dismiss */}
        <Pressable
          onPress={onDismiss}
          style={styles.dismissBtn}
          accessibilityLabel="Dismiss insight"
          hitSlop={8}
        >
          <X size={15} color={tw.color.slate400} />
        </Pressable>

        {/* Category chip */}
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

        {/* Title */}
        <Text style={[styles.title, { color: inkColor }]} numberOfLines={2}>
          {insight.title}
        </Text>

        {/* Body */}
        <Text
          style={[styles.body, { color: subColor }]}
          numberOfLines={3}
        >
          {insight.body}
        </Text>

        {/* Savings estimate */}
        {insight.savings_estimate && (
          <View
            style={[
              styles.savingsCallout,
              {
                backgroundColor: dark
                  ? `${tw.color.emerald800}60`
                  : tw.color.emerald50,
              },
            ]}
          >
            <TrendingDown size={14} color={tw.color.emerald600} />
            <Text style={[styles.savingsText, { color: tw.color.emerald600 }]}>
              {insight.savings_estimate}
            </Text>
          </View>
        )}

        {/* CTA */}
        <Pressable
          onPress={onNavigate}
          style={({ pressed }) => [
            styles.ctaRow,
            { opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Text style={styles.ctaText}>See all insights</Text>
          <ChevronRight size={14} color={tw.color.violet600} />
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: tw.radius["2xl"],
    padding: tw.space[4],
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 3,
    elevation: 2,
    gap: tw.space[2],
  },
  dismissBtn: {
    position: "absolute",
    top: tw.space[3],
    right: tw.space[3],
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
  chipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[2],
    paddingRight: 40,
  },
  categoryChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[1],
    paddingHorizontal: tw.space[2],
    paddingVertical: 4,
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
    backgroundColor: tw.color.violet500,
    paddingHorizontal: tw.space[2],
    paddingVertical: 2,
    borderRadius: tw.radius.full,
  },
  newBadgeText: {
    color: tw.color.white,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: tw.weight.bold,
  },
  title: {
    ...tw.text.base,
    fontWeight: tw.weight.bold,
    paddingRight: 40,
  },
  body: {
    ...tw.text.sm,
  },
  savingsCallout: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[2],
    borderRadius: tw.radius.xl,
    padding: tw.space[2],
  },
  savingsText: {
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
    flex: 1,
  },
  ctaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
  ctaText: {
    color: tw.color.violet600,
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
  },
});
