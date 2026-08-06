import { Switch, View, Text, StyleSheet } from "react-native";
import { tw } from "@/lib/tw";

interface ToggleProps {
  value: boolean;
  onValueChange: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
}

export function Toggle({ value, onValueChange, label, disabled }: ToggleProps) {
  return (
    <View style={styles.row}>
      {label ? (
        <Text style={styles.label}>{label}</Text>
      ) : null}
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: tw.color.slate200, true: tw.color.indigo500 }}
        thumbColor={tw.color.white}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 44,
  },
  label: {
    fontSize: tw.text.sm.fontSize,
    lineHeight: tw.text.sm.lineHeight,
    color: tw.color.slate900,
    flex: 1,
  },
});
