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
  Groceries: "#4CAF50",
  "Eating Out": "#FF9800",
  Transport: "#2196F3",
  Entertainment: "#9C27B0",
  Shopping: "#E91E63",
  Bills: "#F44336",
  Subscriptions: "#FF5722",
  Health: "#00BCD4",
  Travel: "#3F51B5",
  Software: "#607D8B",
  Savings: "#8BC34A",
  Debt: "#b91c1c",
  Transfer: "#9E9E9E",
  Income: "#26C6DA",
  Cash: "#78909C",
  Charity: "#66BB6A",
  Other: "#795548",
};

export const DEFAULT_CUSTOM_COLOUR = "#6366f1";

export function getCategoryColour(category?: string): string {
  if (!category) return CATEGORY_COLOURS.Other;
  return CATEGORY_COLOURS[category] ?? DEFAULT_CUSTOM_COLOUR;
}
