import React from "react";
import { View, Text } from "react-native";
import { tw } from "@/lib/tw";
import type { Slide } from "@/lib/api/month";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtGBP(n: number) {
  return `£${Math.round(Math.abs(n)).toLocaleString("en-GB")}`;
}

// Category colour palette — mirrors CATEGORY_COLOURS in lib/categories.ts
const CATEGORY_COLOURS: Record<string, string> = {
  "Groceries": "#34d399",
  "Eating Out": "#fb923c",
  "Transport": "#60a5fa",
  "Entertainment": "#c084fc",
  "Shopping": "#f472b6",
  "Bills": "#fb7185",
  "Bills & Utilities": "#fb7185",
  "Subscriptions": "#22d3ee",
  "Health": "#2dd4bf",
  "Beauty": "#e879f9",
  "Travel": "#818cf8",
  "Software": "#a3e635",
  "Savings": "#fbbf24",
  "Debt": "#f87171",
  "Transfer": "#cbd5e1",
  "Transfers": "#cbd5e1",
  "Income": "#4ade80",
  "Cash": "#facc15",
  "Charity": "#f9a8d4",
  "Other": "#94a3b8",
};

const DEFAULT_COLOUR = "#94a3b8";

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  slide: Extract<Slide, { kind: "whereItWent" }>;
}

export function WhereItWentSlide({ slide }: Props) {
  const { story } = slide;
  const cats = story.chapters?.spending?.top_categories ?? [];
  const cliff = story.chapters?.cliff;
  const week1Pct = cliff?.week1_pct ?? 0;

  // Top 5 only — spec
  const top = cats.slice(0, 5);

  return (
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        paddingHorizontal: 24,
      }}
    >
      {/* "WHERE IT WENT" whisper label — spec: 11px semibold uppercase slate-400 */}
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
        WHERE IT WENT
      </Text>

      {/* Category rows — spec: flex row, gap-3 (12dp), 36×36 chip, 8×8 dot, name flex-1 left, amount right */}
      <View style={{ gap: 16 }}>
        {top.map((cat) => {
          const colour = CATEGORY_COLOURS[cat.category] ?? DEFAULT_COLOUR;
          const chipBg = colour + "26"; // 15% alpha approximation

          return (
            <View
              key={cat.category}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
              }}
            >
              {/* 36×36 chip, borderRadius 8 — spec */}
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  backgroundColor: chipBg,
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {/* 8×8 dot at full colour — spec: w-2 h-2 = 8px */}
                <View
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: colour,
                  }}
                />
              </View>

              {/* Category name — flex-1, left */}
              <Text
                style={{
                  flex: 1,
                  fontSize: 14,
                  fontWeight: "500",
                  color: tw.color.slate200,
                }}
                numberOfLines={1}
              >
                {cat.category}
              </Text>

              {/* Amount — right, semibold */}
              <Text
                style={{
                  fontSize: 14,
                  fontWeight: "600",
                  color: tw.color.slate100,
                }}
              >
                {fmtGBP(cat.total)}
              </Text>
            </View>
          );
        })}
      </View>

      {/* Week-1 cliff note — spec: conditional, text-sm slate-400, threshold ≥ 40% */}
      {week1Pct >= 40 && (
        <Text
          style={{
            fontSize: 14,
            color: tw.color.slate400,
            marginTop: 20,
          }}
        >
          {week1Pct >= 60
            ? "Most of it went in the first week."
            : "Nearly half of it went in the first week."}
        </Text>
      )}
    </View>
  );
}
