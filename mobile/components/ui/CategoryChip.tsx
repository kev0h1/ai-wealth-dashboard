import { View, Text } from "react-native";

const CAT_COLORS: Record<string, string> = {
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

const CAT_ICONS: Record<string, string> = {
  "Groceries": "🛒",
  "Eating Out": "🍽️",
  "Transport": "🚌",
  "Entertainment": "🎬",
  "Shopping": "🛍️",
  "Bills": "💡",
  "Bills & Utilities": "💡",
  "Subscriptions": "📱",
  "Health": "🏥",
  "Beauty": "💅",
  "Travel": "✈️",
  "Software": "💻",
  "Savings": "🏦",
  "Debt": "💳",
  "Transfer": "↔️",
  "Transfers": "↔️",
  "Income": "💰",
  "Cash": "💵",
  "Charity": "❤️",
  "Other": "📦",
};

interface Props {
  category: string;
  size?: number;
}

export function CategoryChip({ category, size = 32 }: Props) {
  const color = CAT_COLORS[category] ?? "#94a3b8";
  const icon = CAT_ICONS[category] ?? "📦";
  // 15% alpha approximation: append "26" in hex
  const bgColor = color + "26";

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: 8,
        backgroundColor: bgColor,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ fontSize: size * 0.5 }}>{icon}</Text>
    </View>
  );
}
