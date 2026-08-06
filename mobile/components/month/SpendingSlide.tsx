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
  slide: Extract<Slide, { kind: "spending" }>;
  hideNetWorth?: boolean;
}

export function SpendingSlide({ slide, hideNetWorth = false }: Props) {
  const { story } = slide;
  const spending = story.chapters?.spending;

  const totalSpend = spending?.total_spend ?? 0;
  const incomeIn = spending?.income_in ?? 0;

  return (
    <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: 24 }}>
      {/* "YOUR SPENDING" whisper label — spec: 11px semibold uppercase slate-400 */}
      <Text
        style={{
          fontSize: 11,
          fontWeight: "600",
          letterSpacing: tw.tracking(tw.trackingEm.wide, 11),
          color: tw.color.slate400,
          textTransform: "uppercase",
          marginBottom: 12,
        }}
      >
        YOUR SPENDING
      </Text>

      {/* Big number — spec: <p> text-5xl (48px) font-bold slate-100; NOT a heading */}
      <Text
        style={{
          fontSize: 48,
          fontWeight: "700",
          color: tw.color.slate100,
          lineHeight: 48,
          marginBottom: 12,
        }}
      >
        {fmt(totalSpend, hideNetWorth)}
      </Text>

      {/* Body — spec: text-[15px] leading-relaxed slate-300 */}
      <Text
        style={{
          fontSize: 15,
          lineHeight: 22,
          color: tw.color.slate300,
          marginBottom: incomeIn > 0 ? 8 : 0,
        }}
      >
        {`You spent ${fmt(totalSpend, hideNetWorth)} this cycle.`}
      </Text>

      {/* Income line — spec: text-sm slate-400, conditional */}
      {incomeIn > 0 && (
        <Text
          style={{
            fontSize: 14,
            color: tw.color.slate400,
          }}
        >
          {`${fmt(incomeIn, hideNetWorth)} came in.`}
        </Text>
      )}
    </View>
  );
}
