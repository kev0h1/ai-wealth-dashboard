import { View, Text, StyleSheet } from "react-native";
import { tw, HAIRLINE } from "@/lib/tw";
import { CATEGORY_COLOURS } from "@/lib/shared";

interface Driver {
  category: string;
  total: number;
}

interface Props {
  drivers: Driver[];
  pattern_line: string | null;
  colours: Record<string, string>;
  dark: boolean;
  mask: (s: string) => string;
}

function fmt(pence: number): string {
  return `£${Math.round(Math.abs(pence)).toLocaleString("en-GB")}`;
}

function resolveColour(
  category: string,
  colours: Record<string, string>
): string {
  return (
    colours[category] ??
    CATEGORY_COLOURS[category] ??
    CATEGORY_COLOURS["Other"] ??
    "#795548"
  );
}

export function CategoryBreakdown({ drivers, pattern_line, colours, dark, mask }: Props) {
  const glassBg = dark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.55)";
  const glassBorder = dark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.6)";
  const textPrimary = dark ? tw.color.slate100 : tw.color.slate900;
  const textSecondary = dark ? tw.color.slate400 : tw.color.slate500;
  const borderColor = dark ? "rgba(51,65,85,0.6)" : tw.color.cardBorderLight;

  return (
    <View
      style={[
        styles.glass,
        { backgroundColor: glassBg, borderColor: glassBorder },
      ]}
    >
      {drivers.map((d, i) => {
        const colour = resolveColour(d.category, colours);
        const chipBg = `${colour}26`;
        return (
          <View
            key={d.category}
            style={[
              styles.row,
              i > 0 && {
                borderTopWidth: HAIRLINE,
                borderTopColor: borderColor,
              },
            ]}
          >
            {/* Chip */}
            <View style={[styles.chip, { backgroundColor: chipBg }]}>
              <View style={[styles.dot, { backgroundColor: colour }]} />
            </View>
            {/* Category name */}
            <Text style={[styles.categoryName, { color: textPrimary }]}>
              {d.category}
            </Text>
            {/* Amount — spec: text-slate-900 dark:text-slate-100 (primary, not muted) */}
            <Text style={[styles.amount, { color: textPrimary }]}>
              {mask(fmt(d.total))}
            </Text>
          </View>
        );
      })}

      {pattern_line != null && (
        <View
          style={[
            styles.patternRow,
            { borderTopWidth: HAIRLINE, borderTopColor: borderColor },
          ]}
        >
          <Text style={[styles.patternText, { color: textSecondary }]}>
            {pattern_line}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  glass: {
    borderRadius: tw.radius["2xl"], // rounded-2xl = 16px per spec (WHAT DROVE IT is a card, not a hero)
    borderWidth: 1,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: tw.space[4], // px-4 = 16px per spec (was wrongly space[5]=20px)
    paddingVertical: tw.space[3],
    gap: tw.space[3],
  },
  chip: {
    width: 32,
    height: 32,
    borderRadius: tw.radius.lg,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: tw.radius.full,
  },
  categoryName: {
    flex: 1,
    ...tw.text.sm,
    fontWeight: tw.weight.medium,
  },
  amount: {
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
  },
  patternRow: {
    paddingHorizontal: tw.space[4], // px-4 = 16px per spec (was wrongly space[5]=20px)
    paddingVertical: tw.space[3],
  },
  patternText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: tw.weight.medium,
  },
});
