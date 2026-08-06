import { View, Text, StyleSheet } from "react-native";
import { tw } from "@/lib/tw";

interface SettingRowProps {
  title: string;
  description?: string;
  right?: React.ReactNode;
  dark: boolean;
  /** When true, top hairline border separates this row from above */
  withTopBorder?: boolean;
}

/**
 * Generic settings row: label + optional description on the left,
 * arbitrary right content (Toggle, ChevronRight, etc.).
 *
 * Spec: flex row, items-center, justify-between, px-4 py-3.5, min-height 44.
 */
export function SettingRow({ title, description, right, dark, withTopBorder = false }: SettingRowProps) {
  return (
    <View
      style={[
        styles.row,
        withTopBorder && {
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: dark ? tw.color.slate700 : tw.color.slate100,
        },
      ]}
    >
      <View style={styles.left}>
        <Text style={[styles.title, { color: dark ? tw.color.slate100 : tw.color.slate800 }]}>
          {title}
        </Text>
        {description ? (
          <Text style={[styles.desc, { color: dark ? tw.color.slate400 : tw.color.slate500 }]}>
            {description}
          </Text>
        ) : null}
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: tw.space[4],
    paddingVertical: tw.space[3.5], // py-3.5 = 14px per spec
    minHeight: 44,
  },
  left: {
    flex: 1,
    paddingRight: tw.space[3],
  },
  title: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    fontWeight: tw.weight.medium,
  },
  desc: {
    fontSize: tw.text.xs.fontSize,
    lineHeight: tw.text.xs.lineHeight,
    fontWeight: "400",
    marginTop: tw.space[0.5],
  },
  right: {
    flexShrink: 0,
  },
});
