import { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  Animated,
} from "react-native";
import { useRouter } from "expo-router";
import { ChevronLeft, RefreshCw, Sparkles } from "lucide-react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, type MirrorPortrait, type MirrorTrait, type ActiveAim } from "@/lib/api";
import { useTheme } from "@/lib/ThemeContext";
import { tw } from "@/lib/tw";
import { TraitCard } from "@/components/mirror/TraitCard";
import { AimsTracker } from "@/components/mirror/AimsTracker";
import { MirrorSkeleton } from "@/components/mirror/MirrorSkeleton";

// Max content width: 672px centred (2xl equivalent)
const MAX_WIDTH = 672;

function SpinningRefresh({ spinning, color }: { spinning: boolean; color: string }) {
  const rotation = useRef(new Animated.Value(0)).current;
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (spinning) {
      animRef.current = Animated.loop(
        Animated.timing(rotation, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        })
      );
      animRef.current.start();
    } else {
      animRef.current?.stop();
      rotation.setValue(0);
    }
    return () => animRef.current?.stop();
  }, [spinning, rotation]);

  const rotate = rotation.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <RefreshCw size={12} color={color} />
    </Animated.View>
  );
}

export default function MirrorScreen() {
  const router = useRouter();
  const { dark } = useTheme();

  const [portrait, setPortrait] = useState<MirrorPortrait | null>(null);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [aims, setAims] = useState<ActiveAim[]>([]);

  const canvas  = dark ? tw.color.canvasDark  : tw.color.canvasLight;
  const inkPri  = dark ? tw.color.slate100    : tw.color.slate900;
  const inkSec  = dark ? tw.color.slate200    : tw.color.slate700;
  const muted   = dark ? tw.color.slate500    : tw.color.slate400;
  const indigoBadgeBg = dark ? "#312e8150" : tw.color.indigo50; // indigo-900/30 dark

  // ── Data loading ────────────────────────────────────────────────────────────

  const load = useCallback(async (refresh = false) => {
    try {
      const data = await api.getMirror(refresh);
      setPortrait(data);
    } catch {
      setPortrait(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api.listCheckpoints()
      .then((d) => setAims(d.checkpoints))
      .catch(() => {});
  }, []);

  async function handleRefresh() {
    setRefreshing(true);
    await load(true);
  }

  // ── Optimistic choice update ─────────────────────────────────────────────────
  // TraitCard owns the API call; this callback syncs parent portrait state only.
  function handleChoice(traitId: string, choice: "keep" | "change") {
    setPortrait((prev) => {
      if (!prev || prev.status !== "ok") return prev;
      return {
        ...prev,
        traits: prev.traits.map((t) =>
          t.id === traitId ? { ...t, choice } : t
        ),
      };
    });
  }

  // ── Cancel aim ───────────────────────────────────────────────────────────────
  function handleCancelAim(id: string) {
    setAims((prev) => prev.filter((a) => a.id !== id));
    api.cancelCheckpoint(id).catch(() => {
      // Silent — row is already removed; user can refresh if needed
    });
  }

  // ── Duration label ────────────────────────────────────────────────────────────
  const monthsLabel =
    portrait?.status === "ok"
      ? `${Math.round(portrait.window_days / 30)} months`
      : "6 months";

  const isOk = !loading && portrait?.status === "ok";
  const isInsufficient =
    !loading && (!portrait || portrait.status === "insufficient_data");
  const hasTraits = isOk && (portrait as Extract<MirrorPortrait, { status: "ok" }>).traits.length > 0;
  const traits: MirrorTrait[] = isOk
    ? (portrait as Extract<MirrorPortrait, { status: "ok" }>).traits
    : [];

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: canvas }]} edges={["top", "bottom"]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.centeredContent}>

          {/* Back navigation */}
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [
              styles.backBtn,
              { opacity: pressed ? 0.7 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ChevronLeft size={15} color={dark ? tw.color.slate400 : tw.color.slate500} />
            <Text style={[styles.backLabel, { color: dark ? tw.color.slate400 : tw.color.slate500 }]}>
              Back
            </Text>
          </Pressable>

          {/* Title block */}
          <View style={styles.titleRow}>
            <View style={styles.titleLeft}>
              <Text style={[styles.eyebrow, { color: muted }]}>
                THE MIRROR
              </Text>
              <Text style={[styles.headline, { color: inkPri }]}>
                How your money behaves
              </Text>
            </View>
            {/* Icon badge */}
            <View style={[styles.iconBadge, { backgroundColor: indigoBadgeBg }]}>
              <Sparkles size={16} color={tw.color.indigo500} />
            </View>
          </View>

          {/* Intro paragraph */}
          <Text style={[styles.intro, { color: inkSec }]}>
            {`Computed from your last ${monthsLabel} of transactions. No judgement — just what the data says.`}
          </Text>

          {/* Refresh button — only when portrait is loaded and ok */}
          {isOk && (
            <Pressable
              onPress={handleRefresh}
              disabled={refreshing}
              style={({ pressed }) => [
                styles.refreshBtn,
                { opacity: refreshing ? 0.6 : pressed ? 0.7 : 1 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={refreshing ? "Recomputing" : "Recompute portrait"}
            >
              <SpinningRefresh
                spinning={refreshing}
                color={dark ? tw.color.indigo400 : tw.color.indigo500}
              />
              <Text style={[styles.refreshLabel, { color: dark ? tw.color.indigo400 : tw.color.indigo500 }]}>
                {refreshing ? "Recomputing…" : "Recompute"}
              </Text>
            </Pressable>
          )}

          {/* Active aims */}
          {aims.length > 0 && (
            <AimsTracker aims={aims} dark={dark} onCancel={handleCancelAim} />
          )}

          {/* Content states */}
          {loading ? (
            <MirrorSkeleton dark={dark} />
          ) : isInsufficient ? (
            /* Insufficient data */
            <View
              style={[
                styles.emptyCard,
                {
                  backgroundColor: dark ? tw.color.cardDark : tw.color.cardLight,
                  borderColor: dark ? tw.color.cardBorderDark : tw.color.cardBorderLight,
                },
              ]}
            >
              <View
                style={[
                  styles.emptyIconWrap,
                  { backgroundColor: dark ? tw.color.slate700 : tw.color.slate100 },
                ]}
              >
                <Sparkles size={22} color={tw.color.slate400} />
              </View>
              <Text style={[styles.emptyHeadline, { color: inkPri }]}>
                Not enough data yet
              </Text>
              <Text style={[styles.emptyBody, { color: dark ? tw.color.slate400 : tw.color.slate500 }]}>
                The Mirror needs at least 60 days of transactions to compute your behavioural portrait. Check back after a couple of months of connected banking.
              </Text>
            </View>
          ) : !hasTraits ? (
            /* No traits fired */
            <View
              style={[
                styles.emptyCard,
                {
                  backgroundColor: dark ? tw.color.cardDark : tw.color.cardLight,
                  borderColor: dark ? tw.color.cardBorderDark : tw.color.cardBorderLight,
                },
              ]}
            >
              <Text style={[styles.emptyBody, { color: dark ? tw.color.slate400 : tw.color.slate500 }]}>
                No distinct patterns detected yet — check back after more transactions have been synced.
              </Text>
            </View>
          ) : (
            /* Populated traits list */
            <View style={styles.traitsList}>
              {traits.map((trait) => (
                <TraitCard
                  key={trait.id}
                  trait={trait}
                  dark={dark}
                  onChoice={handleChoice}
                />
              ))}
            </View>
          )}

        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: tw.space[10],
    alignItems: "center",
  },
  centeredContent: {
    width: "100%",
    maxWidth: MAX_WIDTH,
    alignSelf: "center",
    paddingHorizontal: tw.space[4],
    paddingTop: tw.space[6],
    paddingBottom: tw.space[2],
  },

  // Back nav
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[1] + tw.space[0.5], // gap-1.5 = 6px
    marginBottom: tw.space[5],
    alignSelf: "flex-start",
    minHeight: 44,
    minWidth: 44,
  },
  backLabel: {
    ...tw.text.sm,
    fontWeight: tw.weight.medium,
  },

  // Title block
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: tw.space[1],
  },
  titleLeft: {
    flex: 1,
    paddingRight: tw.space[2],
  },
  eyebrow: {
    ...tw.text["11"],
    fontWeight: tw.weight.semibold,
    textTransform: "uppercase",
    letterSpacing: tw.tracking(tw.trackingEm.widest, 11),
    marginBottom: tw.space[1],
  },
  headline: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: tw.weight.bold,
    letterSpacing: tw.tracking(tw.trackingEm.tight, 28),
  },
  iconBadge: {
    width: 36,
    height: 36,
    borderRadius: tw.radius.xl,
    alignItems: "center",
    justifyContent: "center",
    marginTop: tw.space[1],
    flexShrink: 0,
  },

  // Intro
  intro: {
    fontSize: 15,
    lineHeight: 23,
    marginTop: tw.space[3],
    marginBottom: tw.space[6],
  },

  // Refresh button
  refreshBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[1] + tw.space[0.5], // gap-1.5
    marginBottom: tw.space[5],
    alignSelf: "flex-start",
    minHeight: 44,
  },
  refreshLabel: {
    ...tw.text.xs,
    fontWeight: tw.weight.semibold,
  },

  // Empty / insufficient data card
  emptyCard: {
    borderRadius: tw.radius["2xl"],
    borderWidth: 1,
    padding: tw.space[6],
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  emptyIconWrap: {
    width: 48,
    height: 48,
    borderRadius: tw.radius["2xl"],
    alignItems: "center",
    justifyContent: "center",
    marginBottom: tw.space[4],
  },
  emptyHeadline: {
    ...tw.text.base,
    fontWeight: tw.weight.bold,
    marginBottom: tw.space[2],
    textAlign: "center",
  },
  emptyBody: {
    ...tw.text.sm,
    lineHeight: 21,
    textAlign: "center",
  },

  // Traits list
  traitsList: {
    gap: tw.space[4],
  },
});
