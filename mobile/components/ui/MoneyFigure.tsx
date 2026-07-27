import { View, Text, StyleSheet } from "react-native";

interface Props {
  amount: number;
  currency?: string;
  size?: "display" | "headline";
  tone?: "default" | "success" | "danger";
  label?: string;
}

const TONES: Record<string, string> = {
  default: "#0f172a",
  success: "#10b981",
  danger: "#ef4444",
};

export function MoneyFigure({
  amount,
  currency = "GBP",
  size = "headline",
  tone = "default",
  label,
}: Props) {
  const fontSize = size === "display" ? 30 : 20;
  const color = TONES[tone] ?? TONES.default;
  const formatted = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(amount);

  return (
    <View>
      {label ? (
        <Text style={styles.label}>{label}</Text>
      ) : null}
      <Text
        style={[
          styles.figure,
          {
            fontSize,
            color,
            letterSpacing: size === "display" ? -0.75 : 0,
          },
        ]}
      >
        {formatted}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: "#94a3b8",
    marginBottom: 2,
  },
  figure: {
    fontWeight: "700",
  },
});
