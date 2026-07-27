import { Pressable, Text, StyleSheet } from "react-native";

type Variant = "primary" | "secondary" | "destructive";

interface Props {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
}

const STYLES: Record<Variant, { bg: string; text: string; border?: string }> = {
  primary:     { bg: "#4f46e5", text: "#ffffff" },
  secondary:   { bg: "transparent", text: "#0f172a", border: "#f1f5f9" },
  destructive: { bg: "#ef4444", text: "#ffffff" },
};

export function Button({ label, onPress, variant = "primary", disabled }: Props) {
  const s = STYLES[variant];

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: s.bg,
          borderWidth: s.border ? 1 : 0,
          borderColor: s.border,
          opacity: disabled ? 0.5 : 1,
          transform: [{ scale: pressed ? 0.95 : 1 }],
        },
      ]}
    >
      <Text style={[styles.label, { color: s.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
  },
});
