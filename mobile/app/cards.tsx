import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft } from "lucide-react-native";

import { tw } from "@/lib/tw";
import { api, CardsStory } from "@/lib/api";
import { useTheme } from "@/lib/ThemeContext";
import { usePreferences } from "@/lib/PreferencesContext";
import { useColours } from "@/lib/ColourContext";
import { WhisperLabel } from "@/components/ui";
import { Skeleton } from "@/components/ui";

import { MovementHero } from "@/components/cards/MovementHero";
import { CardRow } from "@/components/cards/CardRow";
import { CategoryBreakdown } from "@/components/cards/CategoryBreakdown";
import { TrajectoryChart } from "@/components/cards/TrajectoryChart";

function fmt(pence: number): string {
  return `£${Math.round(Math.abs(pence)).toLocaleString("en-GB")}`;
}

export default function CardsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { dark } = useTheme();
  const { hideNetWorth } = usePreferences();
  const { colours } = useColours();

  const [data, setData] = useState<CardsStory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const mask = useCallback(
    (s: string) => (hideNetWorth ? "£••••" : s),
    [hideNetWorth]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const story = await api.getCardsStory("current");
      setData(story);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const canvas = dark ? tw.color.canvasDark : tw.color.canvasLight;
  const textPrimary = dark ? tw.color.slate100 : tw.color.slate900;
  const textSecondary = dark ? tw.color.slate400 : tw.color.slate500;
  const glassBg = dark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.55)";
  const glassBorder = dark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.6)";

  // ── Loading state ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={[styles.fill, { backgroundColor: canvas }]}>
        <View style={{ paddingTop: insets.top }} />
        <View style={styles.header}>
          <Pressable
            style={({ pressed }) => [
              styles.backBtn,
              { opacity: pressed ? 0.7 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] },
            ]}
            onPress={() => router.back()}
            hitSlop={8}
          >
            <ChevronLeft size={15} color={dark ? tw.color.slate400 : tw.color.slate500} />
            <Text style={[styles.backLabel, { color: dark ? tw.color.slate400 : tw.color.slate500 }]}>Back</Text>
          </Pressable>
        </View>
        <View style={styles.skeletonContainer}>
          <Skeleton height={120} borderRadius={tw.radius["3xl"]} />
          <Skeleton height={96} borderRadius={tw.radius["3xl"]} />
          <Skeleton height={80} borderRadius={tw.radius["3xl"]} />
        </View>
      </View>
    );
  }

  // ── Error / empty state ───────────────────────────────────────────────────
  if (error || !data || data.status !== "ok") {
    return (
      <View style={[styles.fill, { backgroundColor: canvas }]}>
        <View style={{ paddingTop: insets.top }} />
        <View style={styles.header}>
          <Pressable
            style={({ pressed }) => [
              styles.backBtn,
              { opacity: pressed ? 0.7 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] },
            ]}
            onPress={() => router.back()}
            hitSlop={8}
          >
            <ChevronLeft size={15} color={dark ? tw.color.slate400 : tw.color.slate500} />
            <Text style={[styles.backLabel, { color: dark ? tw.color.slate400 : tw.color.slate500 }]}>Back</Text>
          </Pressable>
        </View>
        <View style={styles.errorContainer}>
          <View
            style={[
              styles.glassCard,
              styles.errorCard,
              { backgroundColor: glassBg, borderColor: glassBorder },
            ]}
          >
            <Text style={[styles.errorTitle, { color: textPrimary }]}>
              Nothing to read yet
            </Text>
            <Text style={[styles.errorBody, { color: textSecondary }]}>
              Connect a credit card and check back after a few days of spending.
            </Text>
          </View>
        </View>
      </View>
    );
  }

  // ── Populated state ───────────────────────────────────────────────────────
  const { period, movement, per_card, drivers, pattern_line, trajectory } = data;

  const dateLabel = (() => {
    try {
      const s = new Date(period.start).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
      });
      const e = new Date(period.end).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
      });
      return `${s} – ${e}`;
    } catch {
      return "";
    }
  })();

  return (
    <ScrollView
      style={[styles.fill, { backgroundColor: canvas }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + tw.space[6], paddingBottom: insets.bottom + tw.space[9] },
      ]}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Section 1: Header — vertical stack matching web layout ── */}
      <View style={styles.headerCol}>
        {/* Back button */}
        <Pressable
          style={({ pressed }) => [
            styles.backBtn,
            { opacity: pressed ? 0.7 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] },
          ]}
          onPress={() => router.back()}
          hitSlop={8}
        >
          <ChevronLeft size={15} color={dark ? tw.color.slate400 : tw.color.slate500} />
          <Text style={[styles.backLabel, { color: dark ? tw.color.slate400 : tw.color.slate500 }]}>
            Back
          </Text>
        </Pressable>

        {/* Whisper label + period range — mb-5 gap from back btn handled by headerCol gap */}
        <View style={styles.headerText}>
          <WhisperLabel>CARDS · THIS CYCLE</WhisperLabel>
          {dateLabel ? (
            <Text style={[styles.dateRange, { color: textSecondary }]}>
              {dateLabel}
            </Text>
          ) : null}
        </View>
      </View>

      {/* ── Section 2: Movement Hero ── */}
      <MovementHero
        days_elapsed={period.days_elapsed}
        delta={movement.delta}
        new_spend={movement.new_spend}
        payments={movement.payments}
        dark={dark}
        mask={mask}
      />

      {/* ── Section 3: WHERE IT MOVED ── */}
      {per_card.length > 0 && (
        <View style={styles.section}>
          <WhisperLabel>WHERE IT MOVED</WhisperLabel>
          <View
            style={[
              styles.listCard,
              styles.glassCard,
              { backgroundColor: glassBg, borderColor: glassBorder },
            ]}
          >
            {per_card.map((card, i) => (
              <CardRow
                key={card.account_id}
                name={card.name}
                provider={card.provider}
                balance={card.balance}
                delta={card.delta}
                apr={card.apr}
                dark={dark}
                mask={mask}
                isLast={i === per_card.length - 1}
              />
            ))}
          </View>
        </View>
      )}

      {/* ── Section 4: WHAT DROVE IT ── */}
      {drivers.length > 0 && (
        <View style={styles.section}>
          <WhisperLabel>WHAT DROVE IT</WhisperLabel>
          <CategoryBreakdown
            drivers={drivers}
            pattern_line={pattern_line}
            colours={colours}
            dark={dark}
            mask={mask}
          />
        </View>
      )}

      {/* ── Section 5: THE TRAJECTORY ── */}
      <View style={styles.section}>
        <WhisperLabel>THE TRAJECTORY</WhisperLabel>
        <View
          style={[
            styles.glassCard,
            styles.trajCard,
            { backgroundColor: glassBg, borderColor: glassBorder },
          ]}
        >
          <TrajectoryChart trajectory={trajectory} dark={dark} />
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  content: {
    paddingHorizontal: tw.space[4],
    gap: tw.space[8],
  },
  // Loading / error
  header: {
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[3],
  },
  skeletonContainer: {
    paddingHorizontal: tw.space[4],
    gap: tw.space[4],
  },
  errorContainer: {
    paddingHorizontal: tw.space[4],
    paddingTop: tw.space[4],
  },
  errorCard: {
    padding: tw.space[6], // p-6 per spec
  },
  errorTitle: {
    ...tw.text.base,
    fontWeight: tw.weight.bold,
    marginBottom: tw.space[2],
  },
  errorBody: {
    ...tw.text.sm,
    lineHeight: 20, // leading-relaxed for text-sm
  },
  // Header — vertical stack (web: Back button then whisper+date below)
  headerCol: {
    gap: tw.space[5], // mb-5 between back and whisper block
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6, // gap-1.5 = 6px
    height: 44, // 44pt touch target
    alignSelf: "flex-start",
    marginLeft: -tw.space[1], // nudge left so chevron aligns with gutter edge
  },
  backLabel: {
    ...tw.text.sm,
    fontWeight: tw.weight.medium,
  },
  headerText: {
    gap: tw.space[1], // mt-1 between whisper and date
  },
  dateRange: {
    ...tw.text.sm, // spec: text-sm (was wrongly text-xs)
    fontWeight: tw.weight.medium,
  },
  // Sections
  section: {
    gap: tw.space[3],
  },
  // Glass surfaces — hero (rounded-3xl) is self-contained in MovementHero;
  // card sections (WHERE/WHAT/TRAJECTORY) use rounded-2xl (16px) per spec
  glassCard: {
    borderRadius: tw.radius["2xl"], // rounded-2xl = 16px per spec for WHERE/WHAT/TRAJECTORY cards
    borderWidth: 1,
  },
  listCard: {
    overflow: "hidden",
  },
  // Trajectory card
  trajCard: {
    padding: tw.space[4], // p-4 = 16px per spec (was wrongly space[5]=20px)
  },
});
