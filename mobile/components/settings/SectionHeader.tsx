import { View, Text, StyleSheet } from "react-native";
import { tw } from "@/lib/tw";

interface SectionHeaderProps {
  label: string;
  subtext?: string;
  dark: boolean;
  /** When true, bottom border is shown (section body follows directly) */
  withBorder?: boolean;
}

/**
 * Section header used in every Settings card.
 *
 * Spec: text-xs (12px) / font-semibold (600) / tracking-wide / uppercase /
 * slate-500 in light, slate-400 in dark. Border-b hairline when body follows.
 */
export function SectionHeader({ label, subtext, dark, withBorder = true }: SectionHeaderProps) {
  return (
    <View
      style={[
        styles.container,
        withBorder && {
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: dark ? tw.color.slate700 : tw.color.slate100,
        },
      ]}
    >
      <Text
        style={[
          styles.label,
          { color: dark ? tw.color.slate400 : tw.color.slate500 },
        ]}
      >
        {label}
      </Text>
      {subtext ? (
        <Text style={[styles.subtext, { color: dark ? tw.color.slate400 : tw.color.slate500 }]}>
          {subtext}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[3],
  },
  label: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
    fontWeight: tw.weight.semibold,
    letterSpacing: tw.tracking(tw.trackingEm.wide, tw.text.xs.fontSize),
    textTransform: "uppercase",
  },
  subtext: {
    fontSize: tw.text["11"].fontSize,
    lineHeight: tw.text["11"].lineHeight,
    fontWeight: "400",
    marginTop: tw.space[0.5],
  },
});
