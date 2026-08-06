import React, { useEffect, useState, useRef, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  Animated,
  PanResponder,
  StatusBar,
  StyleSheet,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { X } from "lucide-react-native";
import { tw } from "@/lib/tw";
import { usePreferences } from "@/lib/PreferencesContext";
import { getCycleStoryFull, buildSlides, type Slide } from "@/lib/api/month";
import {
  TitleSlide,
  SpendingSlide,
  WhereItWentSlide,
  CardsSlide,
  WinSlide,
  CloseSlide,
} from "@/components/month";

// ─── Constants ────────────────────────────────────────────────────────────────

const BG = "#0f172a"; // always dark, never inherits theme
const SWIPE_THRESHOLD = 48; // dp
const TRANSITION_MS = 200;

// ─── Progress bar ─────────────────────────────────────────────────────────────

function ProgressDots({
  total,
  current,
}: {
  total: number;
  current: number;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        gap: 4,
        flex: 1,
      }}
    >
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={{
            flex: 1,
            height: 3,
            borderRadius: 4,
            backgroundColor:
              i <= current
                ? "rgba(255,255,255,0.90)"
                : "rgba(255,255,255,0.25)",
          }}
        />
      ))}
    </View>
  );
}

// ─── Slide renderer ───────────────────────────────────────────────────────────

function renderSlide(slide: Slide, hideNetWorth: boolean) {
  switch (slide.kind) {
    case "title":
      return <TitleSlide slide={slide} />;
    case "spending":
      return <SpendingSlide slide={slide} hideNetWorth={hideNetWorth} />;
    case "whereItWent":
      return <WhereItWentSlide slide={slide} />;
    case "cards":
      return <CardsSlide slide={slide} hideNetWorth={hideNetWorth} />;
    case "win":
      return <WinSlide slide={slide} hideNetWorth={hideNetWorth} />;
    case "close":
      return <CloseSlide slide={slide} hideNetWorth={hideNetWorth} />;
    default:
      return null;
  }
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function MonthStoryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { hideNetWorth } = usePreferences();
  const params = useLocalSearchParams<{
    persona?: string;
    preview?: string;
    which?: string;
  }>();

  const persona = params.persona ?? null;
  const isPreview = !persona && params.preview === "1";
  const which: "current" | "last" =
    persona || isPreview
      ? "current"
      : params.which === "current"
      ? "current"
      : "last";

  // ─── Data ─────────────────────────────────────────────────────────────────

  const [slides, setSlides] = useState<Slide[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getCycleStoryFull(
          which,
          isPreview && !persona,
          persona ?? undefined
        );
        if (cancelled) return;
        if (data.status !== "ok") {
          setError("No story data available yet.");
        } else if (data.early_days && which === "current") {
          // Spec: early-days current cycle → redirect to /month, no player shown
          router.replace("/month" as never);
          return;
        } else {
          setSlides(buildSlides(data, isPreview, persona));
        }
      } catch {
        if (!cancelled) setError("Could not load your month story.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Navigation state ──────────────────────────────────────────────────────

  const [current, setCurrent] = useState(0);
  const opacity = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const transitioning = useRef(false);

  const goTo = useCallback(
    (next: number) => {
      if (transitioning.current) return;
      if (next < 0 || next >= slides.length) return;
      transitioning.current = true;

      const dir = next > current ? 1 : -1;

      // Fade + slide out
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 0,
          duration: TRANSITION_MS / 2,
          useNativeDriver: true,
        }),
        Animated.timing(translateX, {
          toValue: dir * -30,
          duration: TRANSITION_MS / 2,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setCurrent(next);
        translateX.setValue(dir * 30);
        // Fade + slide in
        Animated.parallel([
          Animated.timing(opacity, {
            toValue: 1,
            duration: TRANSITION_MS / 2,
            useNativeDriver: true,
          }),
          Animated.timing(translateX, {
            toValue: 0,
            duration: TRANSITION_MS / 2,
            useNativeDriver: true,
          }),
        ]).start(() => {
          transitioning.current = false;
        });
      });
    },
    [current, slides.length, opacity, translateX]
  );

  const goNext = useCallback(() => {
    if (current < slides.length - 1) {
      goTo(current + 1);
    } else {
      router.back();
    }
  }, [current, slides.length, goTo, router]);

  const goPrev = useCallback(() => {
    if (current > 0) goTo(current - 1);
  }, [current, goTo]);

  // ─── Swipe gesture ────────────────────────────────────────────────────────

  const swipeStartX = useRef(0);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dx) > 8 && Math.abs(gs.dx) > Math.abs(gs.dy),
      onPanResponderGrant: (e) => {
        swipeStartX.current = e.nativeEvent.pageX;
      },
      onPanResponderRelease: (_, gs) => {
        if (gs.dx < -SWIPE_THRESHOLD) {
          // swipe left → next
          goNext();
        } else if (gs.dx > SWIPE_THRESHOLD) {
          // swipe right → prev
          goPrev();
        }
      },
    })
  ).current;

  // ─── Tap zones ────────────────────────────────────────────────────────────
  // Left third → prev, right two-thirds → next
  // Implemented via two absolute Pressable overlays sitting behind the slide content.

  // ─── Render ───────────────────────────────────────────────────────────────

  const topPad = insets.top + 12;
  const bottomPad = insets.bottom + 16;

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: BG,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <StatusBar barStyle="light-content" backgroundColor={BG} />
        <Text style={{ fontSize: 14, color: tw.color.slate400 }}>
          Reading your month…
        </Text>
      </View>
    );
  }

  if (error || slides.length === 0) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: BG,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: 32,
        }}
      >
        <StatusBar barStyle="light-content" backgroundColor={BG} />
        <Text
          style={{
            fontSize: 16,
            color: tw.color.slate400,
            textAlign: "center",
            marginBottom: 24,
          }}
        >
          {error ?? "Nothing to play yet."}
        </Text>
        <Pressable onPress={() => router.back()}>
          <Text style={{ fontSize: 14, color: tw.color.indigo400, fontWeight: "600" }}>
            Go back
          </Text>
        </Pressable>
      </View>
    );
  }

  const slide = slides[current];

  return (
    <View style={{ flex: 1, backgroundColor: BG }} {...panResponder.panHandlers}>
      <StatusBar barStyle="light-content" backgroundColor={BG} />

      {/* Top bar: progress + close */}
      <View
        style={{
          position: "absolute",
          top: topPad,
          left: 16,
          right: 16,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          zIndex: 20,
        }}
      >
        <ProgressDots total={slides.length} current={current} />
        <Pressable
          onPress={() =>
            router.push(
              (persona
                ? `/month?persona=${encodeURIComponent(persona)}`
                : isPreview
                ? "/month?preview=1"
                : "/month") as never
            )
          }
          accessibilityLabel="Close story"
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={{
            width: 32,
            height: 32,
            borderRadius: 16,
            backgroundColor: "rgba(255,255,255,0.08)",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <X size={16} color={tw.color.slate300} />
        </Pressable>
      </View>

      {/* Ambient glows */}
      <LinearGradient
        colors={["rgba(99,102,241,0.32)", "rgba(99,102,241,0.0)"]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={{
          position: "absolute",
          top: "4%",
          left: "-17.5%",
          right: "-17.5%",
          height: 560,
        }}
        pointerEvents="none"
      />
      <LinearGradient
        colors={["rgba(139,92,246,0.13)", "rgba(139,92,246,0.0)"]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={{
          position: "absolute",
          top: "30%",
          left: "-17.5%",
          right: "-17.5%",
          height: 400,
        }}
        pointerEvents="none"
      />

      {/* Tap zones — sit below slide content in z order; spec: 50/50 */}
      <View style={{ ...StyleSheet.absoluteFill, flexDirection: "row", zIndex: 5 }}>
        {/* Left half → prev */}
        <Pressable
          style={{ flex: 1 }}
          onPress={goPrev}
          accessibilityLabel="Previous slide"
        />
        {/* Right half → next */}
        <Pressable
          style={{ flex: 1 }}
          onPress={goNext}
          accessibilityLabel="Next slide"
        />
      </View>

      {/* Slide content */}
      <Animated.View
        style={{
          flex: 1,
          opacity,
          transform: [{ translateX }],
          zIndex: 10,
          paddingTop: topPad + 36,
          paddingBottom: bottomPad,
        }}
        pointerEvents="box-none"
      >
        {renderSlide(slide, hideNetWorth)}
      </Animated.View>

    </View>
  );
}
