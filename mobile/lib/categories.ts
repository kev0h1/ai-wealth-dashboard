export const CATEGORY_COLOURS: Record<string, string> = {
  "Eating Out": "#f97316",
  "Groceries": "#22c55e",
  "Transport": "#3b82f6",
  "Entertainment": "#a855f7",
  "Shopping": "#ec4899",
  "Subscriptions": "#14b8a6",
  "Bills & Utilities": "#64748b",
  "Health": "#ef4444",
  "Travel": "#06b6d4",
  "Personal Care": "#f59e0b",
  "Education": "#8b5cf6",
  "Transfers": "#6b7280",
  "Savings": "#10b981",
  "Income": "#059669",
  "Other": "#94a3b8",
};

export function categoryColour(category: string | undefined): string {
  return CATEGORY_COLOURS[category ?? "Other"] ?? CATEGORY_COLOURS.Other;
}

export const CATEGORY_ICONS: Record<string, string> = {
  "Eating Out": "🍽️",
  "Groceries": "🛒",
  "Transport": "🚌",
  "Entertainment": "🎬",
  "Shopping": "🛍️",
  "Subscriptions": "📱",
  "Bills & Utilities": "💡",
  "Health": "🏥",
  "Travel": "✈️",
  "Personal Care": "💅",
  "Education": "📚",
  "Transfers": "↔️",
  "Savings": "🏦",
  "Income": "💰",
  "Other": "📦",
};
