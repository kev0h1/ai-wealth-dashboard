import { View, Text, StyleSheet } from "react-native";
import { tw } from "@/lib/tw";
import { WhisperLabel } from "@/components/ui";

interface Props {
  days_elapsed: number;
  delta: number;
  new_spend: number;
  payments: number;
  dark: boolean;
  mask: (s: string) => string;
}

function fmt(pence: number): string {
  return `£${Math.round(Math.abs(pence)).toLocaleString("en-GB")}`;
}

export function MovementHero({ days_elapsed, delta, new_spend, payments, dark, mask }: Props) {
  const deltaAbs = Math.abs(delta);

  let headline: string;
  let headlineColour: string;

  // Spec: paid-down (delta <= -20) → emerald-500/400; grew or held → slate-900/slate-100 (neutral, NOT muted)
  if (deltaAbs < 20) {
    headline = "Held steady";
    headlineColour = dark ? tw.color.slate100 : tw.color.slate900;
  } else if (delta >= 20) {
    // Balance grew — neutral slate (never red)
    headline = `↑ ${mask(fmt(delta))}`;
    headlineColour = dark ? tw.color.slate100 : tw.color.slate900;
  } else {
    // delta <= -20: paid down — emerald
    headline = `↓ ${mask(fmt(delta))}`;
    headlineColour = dark ? tw.color.emerald400 : tw.color.emerald500;
  }

  let clarification: string;
  const spendStr = mask(fmt(new_spend));
  const paidStr = mask(fmt(payments));

  if (deltaAbs < 20) {
    clarification = `Your balances barely moved — you put on ${spendStr} and paid off ${paidStr}.`;
  } else if (delta >= 20) {
    clarification = `Your balances grew by ${mask(fmt(deltaAbs))} — you put on ${spendStr} and paid off ${paidStr}.`;
  } else {
    clarification = `Your balances shrank by ${mask(fmt(deltaAbs))} — you put on ${spendStr} and paid off ${paidStr}.`;
  }

  const glassBg = dark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.55)";
  const glassBorder = dark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.6)";
  const textSecondary = dark ? tw.color.slate400 : tw.color.slate500;

  return (
    <View
      style={[
        styles.glass,
        { backgroundColor: glassBg, borderColor: glassBorder },
      ]}
    >
      {/* Spec: "CARD MOVEMENT · {days_elapsed} DAYS" whisper label */}
      <WhisperLabel>CARD MOVEMENT · {days_elapsed} DAYS</WhisperLabel>

      {/* Verdict figure: text-3xl font-bold */}
      <Text style={[styles.headline, { color: headlineColour }]}>
        {headline}
      </Text>

      {/* Breakdown line: only when delta >= 20 pence movement */}
      {deltaAbs >= 20 && (
        <Text style={[styles.breakdown, { color: textSecondary }]}>
          {`New spend ${mask(fmt(new_spend))} · Payments ${mask(fmt(payments))}`}
        </Text>
      )}

      {/* Clarifying sentence: text-xs leading-snug (mt-3 gap handled by container gap) */}
      <Text style={[styles.clarification, { color: textSecondary }]}>
        {clarification}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  glass: {
    borderRadius: tw.radius["3xl"],
    borderWidth: 1,
    padding: tw.space[5],
    gap: tw.space[2],
  },
  headline: {
    fontSize: tw.text["3xl"].fontSize,
    lineHeight: tw.text["3xl"].lineHeight,
    fontWeight: tw.weight.bold,
  },
  breakdown: {
    ...tw.text.sm,
    fontWeight: tw.weight.medium,
  },
  // Spec: text-xs leading-snug (not text-sm)
  clarification: {
    ...tw.text.xs,
    lineHeight: 16, // leading-snug for xs ≈ 1.375 × 12
    fontWeight: tw.weight.medium,
  },
});
