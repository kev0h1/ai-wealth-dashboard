import React from "react";
import { View, Text } from "react-native";
import { tw } from "@/lib/tw";
import type { Slide } from "@/lib/api/month";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtGBP(n: number) {
  return `£${Math.round(Math.abs(n)).toLocaleString("en-GB")}`;
}

function fmt(n: number, hide: boolean) {
  return hide ? "£••••" : fmtGBP(n);
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  slide: Extract<Slide, { kind: "win" }>;
  hideNetWorth?: boolean;
}

export function WinSlide({ slide, hideNetWorth = false }: Props) {
  const { story } = slide;
  const ch = story.chapters;
  const close = ch?.close;
  const keeping = ch?.keeping;
  const moves = ch?.moves;

  const streakWeeks = close?.streak_weeks ?? null;
  const kept = keeping?.kept ?? 0;
  const setAside = keeping?.set_aside ?? 0;
  const drawnBack = keeping?.drawn_back ?? 0;
  const deliberateCount = moves?.deliberate_saving?.count ?? 0;
  const deliberateTotal = moves?.deliberate_saving?.total ?? 0;

  // Priority order per spec: streak ≥ 4 → kept > 0 → deliberate > 0
  // Variant A
  if (streakWeeks != null && streakWeeks >= 4) {
    return (
      <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: 24 }}>
        {/* spec: text-2xl font-bold slate-100; ✦ in amber-300 */}
        <Text
          style={{
            fontSize: 24,
            fontWeight: "700",
            color: tw.color.slate100,
            lineHeight: 32,
            marginBottom: 12,
          }}
        >
          <Text style={{ color: tw.color.amber300 }}>✦</Text>
          {` ${streakWeeks} weeks of saving, unbroken.`}
        </Text>
        {/* spec: text-[15px] slate-300 */}
        <Text
          style={{
            fontSize: 15,
            lineHeight: 22,
            color: tw.color.slate300,
          }}
        >
          Still going. That habit is yours.
        </Text>
      </View>
    );
  }

  // Variant B
  if (kept > 0) {
    return (
      <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: 24 }}>
        <Text
          style={{
            fontSize: 24,
            fontWeight: "700",
            color: tw.color.slate100,
            lineHeight: 32,
            marginBottom: 12,
          }}
        >
          <Text style={{ color: tw.color.amber300 }}>✦</Text>
          {` You kept ${fmt(kept, hideNetWorth)} of what you set aside.`}
        </Text>
        <Text
          style={{
            fontSize: 15,
            lineHeight: 22,
            color: tw.color.slate300,
          }}
        >
          {`Set aside ${fmt(setAside, hideNetWorth)}, drew back ${fmt(drawnBack, hideNetWorth)} — the rest stayed put.`}
        </Text>
      </View>
    );
  }

  // Variant C
  if (deliberateCount > 0) {
    return (
      <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: 24 }}>
        <Text
          style={{
            fontSize: 24,
            fontWeight: "700",
            color: tw.color.slate100,
            lineHeight: 32,
            marginBottom: 12,
          }}
        >
          <Text style={{ color: tw.color.amber300 }}>✦</Text>
          {` ${deliberateCount} deliberate transfer${deliberateCount !== 1 ? "s" : ""} to savings.`}
        </Text>
        <Text
          style={{
            fontSize: 15,
            lineHeight: 22,
            color: tw.color.slate300,
          }}
        >
          {`You moved ${fmt(deliberateTotal, hideNetWorth)} on purpose.`}
        </Text>
      </View>
    );
  }

  // Fallback — should not render if buildSlides gated correctly
  return null;
}
