import React from "react";
import { View, Text, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { tw } from "@/lib/tw";
import type { Slide } from "@/lib/api/month";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtGBP(n: number) {
  return `£${Math.round(Math.abs(n)).toLocaleString("en-GB")}`;
}

function maskAmounts(text: string) {
  return text.replace(/£[\d,]+(\.\d+)?/g, "£••••");
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  slide: Extract<Slide, { kind: "close" }>;
  hideNetWorth?: boolean;
}

export function CloseSlide({ slide, hideNetWorth = false }: Props) {
  const router = useRouter();
  const { story, preview, persona } = slide;
  const close = story.chapters?.close;
  const selfText = story.narrative?.self;

  // "Read the full story" href — spec: persona → /month?persona=X, preview → /month?preview=1, else → /month?which=last
  const fullStoryHref = persona
    ? `/month?persona=${encodeURIComponent(persona)}`
    : preview
    ? "/month?preview=1"
    : "/month?which=last";

  return (
    <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: 24 }}>
      {/* "THE CLOSE" whisper label — spec */}
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
        THE CLOSE
      </Text>

      {/* Headline — spec: text-2xl font-bold slate-100 */}
      {close && (
        <Text
          style={{
            fontSize: 24,
            fontWeight: "700",
            color: tw.color.slate100,
            lineHeight: 32,
            marginBottom: selfText ? 16 : 24,
          }}
        >
          {`You reached payday with ${hideNetWorth ? "£••••" : fmtGBP(close.month_end_cash)} in your current accounts.`}
        </Text>
      )}

      {/* Self narrative — spec: text-[15px] leading-relaxed slate-300 */}
      {selfText && (
        <Text
          style={{
            fontSize: 15,
            lineHeight: 22,
            color: tw.color.slate300,
            marginBottom: 24,
          }}
        >
          {hideNetWorth ? maskAmounts(selfText) : selfText}
        </Text>
      )}

      {/* "Read the full story ›" button — spec: bg white/10, border white/15, rounded-xl (12px), px-5 py-3, text-sm semibold white */}
      <Pressable
        onPress={() => router.push(fullStoryHref as never)}
        style={({ pressed }) => ({
          alignSelf: "flex-start",
          backgroundColor: "rgba(255,255,255,0.10)",
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.15)",
          borderRadius: 12,
          paddingVertical: 12,
          paddingHorizontal: 20,
          opacity: pressed ? 0.75 : 1,
          transform: [{ scale: pressed ? 0.97 : 1 }],
        })}
        accessibilityLabel="Read the full story"
      >
        <Text
          style={{
            fontSize: 14,
            fontWeight: "600",
            color: tw.color.white,
          }}
        >
          Read the full story ›
        </Text>
      </Pressable>
    </View>
  );
}
