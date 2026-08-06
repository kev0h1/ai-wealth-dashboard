import { View, Text, StyleSheet } from "react-native";
import { tw, HAIRLINE } from "@/lib/tw";

interface Props {
  name: string;
  provider: string;
  balance: number;
  delta: number;
  apr: number | null;
  dark: boolean;
  mask: (s: string) => string;
  isLast: boolean;
}

const BANK_COLOURS: Record<string, string> = {
  natwest:       "#5a0069",
  amex:          "#007bc1",
  barclays:      "#00aeef",
  hsbc:          "#db0011",
  monzo:         "#ff3464",
  starling:      "#6935d8",
  lloyds:        "#024731",
  revolut:       "#191c1f",
  santander:     "#ec0000",
  halifax:       "#1c5aa0",
  nationwide:    "#1a2e6b",
  chase:         "#117aca",
  first_direct:  "#111111",
  tsb:           "#006ab0",
};

function bankColor(provider: string): string {
  const key = provider.toLowerCase().replace(/\s+/g, "_");
  for (const [k, v] of Object.entries(BANK_COLOURS)) {
    if (key.includes(k)) return v;
  }
  return tw.color.indigo600;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function fmt(pence: number): string {
  return `£${Math.round(Math.abs(pence)).toLocaleString("en-GB")}`;
}

export function CardRow({ name, provider, balance, delta, apr, dark, mask, isLast }: Props) {
  const textPrimary = dark ? tw.color.slate100 : tw.color.slate900;
  const textSecondary = dark ? tw.color.slate400 : tw.color.slate500;
  const borderColor = dark ? "rgba(51,65,85,0.6)" : tw.color.cardBorderLight;

  let deltaText: string;
  let deltaColor: string;

  if (delta > 0) {
    deltaText = `+${mask(fmt(delta))}`;
    deltaColor = textPrimary;
  } else if (delta < 0) {
    deltaText = `−${mask(fmt(delta))}`;
    deltaColor = dark ? tw.color.emerald400 : tw.color.emerald500;
  } else {
    deltaText = mask(fmt(0));
    deltaColor = textPrimary;
  }

  return (
    <View
      style={[
        styles.row,
        !isLast && {
          borderBottomWidth: HAIRLINE,
          borderBottomColor: borderColor,
        },
      ]}
    >
      {/* Bank badge */}
      <View style={[styles.badge, { backgroundColor: bankColor(provider) }]}>
        <Text style={styles.badgeText}>{initials(name)}</Text>
      </View>

      {/* Middle: name + APR pill (flex-1, left-aligned) */}
      <View style={styles.info}>
        <Text style={[styles.cardName, { color: textPrimary }]} numberOfLines={1}>
          {name}
        </Text>
        {apr != null && (
          <View
            style={[
              styles.aprPill,
              { backgroundColor: dark ? tw.color.slate700 : tw.color.slate100 },
            ]}
          >
            <Text style={[styles.aprText, { color: dark ? tw.color.slate400 : tw.color.slate500 }]}>
              {apr}% APR
            </Text>
          </View>
        )}
      </View>

      {/* Right: delta + balance owed (text-right) */}
      <View style={styles.right}>
        <Text style={[styles.delta, { color: deltaColor }]}>{deltaText}</Text>
        <Text style={[styles.balance, { color: textSecondary }]}>
          {mask(fmt(balance))} owed
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[3],
    gap: tw.space[3],
  },
  badge: {
    width: 36,
    height: 36,
    borderRadius: tw.radius.xl,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: tw.weight.bold,
    color: tw.color.white,
  },
  info: {
    flex: 1,
    gap: tw.space[0.5],
  },
  cardName: {
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
  },
  balance: {
    ...tw.text["11"],
    fontWeight: tw.weight.medium,
  },
  right: {
    alignItems: "flex-end",
    gap: tw.space[1],
    flexShrink: 0,
  },
  delta: {
    ...tw.text.sm,
    fontWeight: tw.weight.semibold,
  },
  aprPill: {
    paddingHorizontal: tw.space[2],
    paddingVertical: 2,
    borderRadius: tw.radius.full,
  },
  aprText: {
    fontSize: tw.text["10"].fontSize,
    lineHeight: tw.text["10"].lineHeight,
    fontWeight: tw.weight.bold,
  },
});
