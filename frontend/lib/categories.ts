export const CATEGORIES = [
  "Groceries",
  "Eating Out",
  "Transport",
  "Entertainment",
  "Shopping",
  "Bills",
  "Subscriptions",
  "Health",
  "Travel",
  "Software",
  "Savings",
  "Debt",
  "Transfer",
  "Income",
  "Cash",
  "Charity",
  "Other",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_COLOURS: Record<string, string> = {
  Groceries:     "#06b6d4",  // cyan   — fresh/food
  "Eating Out":  "#f97316",  // orange — warm/food
  Transport:     "#2196F3",  // blue   — movement
  Entertainment: "#9C27B0",  // purple — fun
  Shopping:      "#E91E63",  // pink   — retail
  Bills:         "#6366f1",  // indigo — financial/recurring
  Subscriptions: "#8b5cf6",  // violet — digital
  Health:        "#14b8a6",  // teal   — medical
  Travel:        "#0284c7",  // sky    — adventure
  Software:      "#607D8B",  // slate  — tech
  Savings:       "#d97706",  // amber  — wealth/gold
  Debt:          "#ef4444",  // red    — liability (semantic)
  Transfer:      "#9E9E9E",  // grey
  Income:        "#22c55e",  // green  — positive cash in
  Cash:          "#78909C",  // blue-grey
  Charity:       "#f472b6",  // pink   — giving
  Other:         "#795548",  // brown
};

export const DEFAULT_CUSTOM_COLOUR = "#6366f1";

export function getCategoryColour(category?: string): string {
  if (!category) return CATEGORY_COLOURS.Other;
  return CATEGORY_COLOURS[category] ?? DEFAULT_CUSTOM_COLOUR;
}
