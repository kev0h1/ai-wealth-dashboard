import React from "react";
import { View, Text } from "react-native";
import { tw } from "@/lib/tw";
import type { Slide } from "@/lib/api/month";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  slide: Extract<Slide, { kind: "title" }>;
}

export function TitleSlide({ slide }: Props) {
  const { story, preview, persona } = slide;
  const period = story.period;

  return (
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        paddingHorizontal: 24,
      }}
    >
      {/* Demo badge */}
      {persona && (
        <View
          style={{
            alignSelf: "flex-start",
            flexDirection: "row",
            alignItems: "center",
            backgroundColor: "rgba(139,92,246,0.10)",
            borderWidth: 1,
            borderColor: "rgba(139,92,246,0.30)",
            borderRadius: 999,
            paddingHorizontal: 12,
            paddingVertical: 4,
            marginBottom: 16,
          }}
        >
          <Text
            style={{
              fontSize: 11,
              fontWeight: "600",
              color: "#c4b5fd", // violet-300; tw.ts has no violet300 token
            }}
          >
            DEMO · {persona}
          </Text>
        </View>
      )}

      {/* Preview badge */}
      {!persona && preview && (
        <View
          style={{
            alignSelf: "flex-start",
            flexDirection: "row",
            alignItems: "center",
            backgroundColor: "rgba(245,158,11,0.10)",
            borderWidth: 1,
            borderColor: "rgba(245,158,11,0.30)",
            borderRadius: 999,
            paddingHorizontal: 12,
            paddingVertical: 4,
            marginBottom: 16,
          }}
        >
          <Text
            style={{
              fontSize: 11,
              fontWeight: "600",
              color: tw.color.amber300,
            }}
          >
            PREVIEW · your month closes tonight
          </Text>
        </View>
      )}

      {/* "YOUR MONTH" whisper label — spec: 11px semibold uppercase slate-400 */}
      <Text
        style={{
          fontSize: 11,
          fontWeight: "600",
          textTransform: "uppercase",
          letterSpacing: tw.tracking(tw.trackingEm.wide, 11),
          color: tw.color.slate400,
          marginBottom: 8,
        }}
      >
        YOUR MONTH
      </Text>

      {/* h1 — spec: text-3xl (30px) font-bold slate-100 */}
      <Text
        style={{
          fontSize: 30,
          fontWeight: "700",
          color: tw.color.slate100,
          lineHeight: 36,
          marginBottom: 8,
        }}
      >
        Your month, closed.
      </Text>

      {/* Period — spec: text-sm slate-400 */}
      {period && (
        <Text
          style={{
            fontSize: 14,
            color: tw.color.slate400,
            lineHeight: 20,
          }}
        >
          {fmtDate(period.start)} – {fmtDate(period.end)}
        </Text>
      )}
    </View>
  );
}
