import { View, Text, Pressable, StyleSheet } from "react-native";
import { tw } from "@/lib/tw";

interface SegmentedControlProps {
  options: string[];
  selected: number;
  onChange: (index: number) => void;
}

export function SegmentedControl({ options, selected, onChange }: SegmentedControlProps) {
  return (
    <View style={styles.container}>
      {options.map((opt, i) => {
        const active = i === selected;
        return (
          <Pressable
            key={opt}
            onPress={() => onChange(i)}
            style={[styles.segment, active && styles.segmentActive]}
          >
            <Text style={[styles.label, active && styles.labelActive]}>
              {opt}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    backgroundColor: tw.color.slate100,
    borderRadius: tw.radius.xl,
    padding: 2,
  },
  segment: {
    flex: 1,
    paddingVertical: 7,
    alignItems: "center",
    borderRadius: tw.radius.xl - 2,
  },
  segmentActive: {
    backgroundColor: tw.color.white,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  label: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    fontWeight: tw.weight.medium,
    color: tw.color.slate500,
  },
  labelActive: {
    fontWeight: tw.weight.semibold,
    color: tw.color.slate900,
  },
});
