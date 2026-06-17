export const CATEGORY_COLOURS: Record<string, string> = {
  Groceries:          "#06b6d4",
  "Eating Out":       "#f97316",
  Transport:          "#2196F3",
  Entertainment:      "#9C27B0",
  Shopping:           "#E91E63",
  Bills:              "#6366f1",
  "Bills & Utilities":"#6366f1",
  Subscriptions:      "#8b5cf6",
  Health:             "#14b8a6",
  Travel:             "#0284c7",
  Software:           "#607D8B",
  Savings:            "#d97706",
  Debt:               "#ef4444",
  Transfer:           "#9E9E9E",
  Transfers:          "#9E9E9E",
  Income:             "#22c55e",
  Cash:               "#78909C",
  Charity:            "#f472b6",
  Education:          "#8b5cf6",
  "Personal Care":    "#f59e0b",
  Other:              "#795548",
};

export const DEFAULT_CUSTOM_COLOUR = "#6366f1";

export function categoryColour(category: string | undefined): string {
  return CATEGORY_COLOURS[category ?? "Other"] ?? DEFAULT_CUSTOM_COLOUR;
}

// Alias kept for backwards compat
export const getCategoryColour = categoryColour;

export const CATEGORY_ICONS: Record<string, string> = {
  "Eating Out":       "🍽️",
  Groceries:          "🛒",
  Transport:          "🚌",
  Entertainment:      "🎬",
  Shopping:           "🛍️",
  Subscriptions:      "📱",
  "Bills & Utilities":"💡",
  Bills:              "💡",
  Health:             "🏥",
  Travel:             "✈️",
  "Personal Care":    "💅",
  Education:          "📚",
  Transfers:          "↔️",
  Transfer:           "↔️",
  Savings:            "🏦",
  Income:             "💰",
  Software:           "💻",
  Cash:               "💵",
  Charity:            "❤️",
  Other:              "📦",
};
