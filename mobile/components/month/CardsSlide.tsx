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

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  slide: Extract<Slide, { kind: "cards" }>;
  hideNetWorth?: boolean;
}

export function CardsSlide({ slide, hideNetWorth = false }: Props) {
  const { story } = slide;
  const cards = story.chapters?.cards;
  const sw = story.chapters?.switch;

  if (!cards) return null;

  const delta = cards.delta;
  const deltaZero = delta === 0;
  const deltaPositive = delta > 0;

  return (
    <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: 24 }}>
      {/* "YOUR CARDS" whisper label — spec: 11px semibold uppercase slate-400 */}
      <Text
        style={{
          fontSize: 11,
          fontWeight: "600",
          textTransform: "uppercase",
          letterSpacing: tw.tracking(tw.trackingEm.wide, 11),
          color: tw.color.slate400,
          marginBottom: 12,
        }}
      >
        YOUR CARDS
      </Text>

      {/* Headline — spec: text-2xl (24px) font-bold slate-100 */}
      <Text
        style={{
          fontSize: 24,
          fontWeight: "700",
          color: tw.color.slate100,
          lineHeight: 32,
          marginBottom: 12,
        }}
      >
        {`${fmt(cards.new_spend, hideNetWorth)} of it rode on your cards.`}
      </Text>

      {/* Delta line — spec: text-[15px] leading-relaxed; emerald-400 if delta < 0 */}
      {deltaZero ? (
        <Text
          style={{
            fontSize: 15,
            lineHeight: 22,
            color: tw.color.slate300,
            marginBottom: sw?.switch_day ? 8 : 0,
          }}
        >
          Balances held steady.
        </Text>
      ) : deltaPositive ? (
        <Text
          style={{
            fontSize: 15,
            lineHeight: 22,
            color: tw.color.slate300,
            marginBottom: sw?.switch_day ? 8 : 0,
          }}
        >
          {`Balances closed ${fmt(Math.abs(delta), hideNetWorth)} higher.`}
        </Text>
      ) : (
        <Text
          style={{
            fontSize: 15,
            lineHeight: 22,
            color: tw.color.emerald400,
            marginBottom: sw?.switch_day ? 8 : 0,
          }}
        >
          {`Balances closed ${fmt(Math.abs(delta), hideNetWorth)} lower.`}
        </Text>
      )}

      {/* Switch day — spec: text-sm slate-400, conditional */}
      {sw?.switch_day && (
        <Text
          style={{
            fontSize: 14,
            color: tw.color.slate400,
            lineHeight: 20,
          }}
        >
          {`Your cards took over from cash on ${fmtDate(sw.switch_day)}.`}
        </Text>
      )}
    </View>
  );
}
