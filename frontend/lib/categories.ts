export const CATEGORIES = [
  "Groceries",
  "Eating Out",
  "Transport",
  "Entertainment",
  "Shopping",
  "Bills",
  "Subscriptions",
  "Health",
  "Beauty",
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

// CVD-safe qualitative palette (Paul Tol / Okabe–Ito), hue + luminance spaced so
// adjacent categories stay distinct for colour-blind viewers and in greyscale.
// Semantic anchors kept: Debt=red, Income=green, Savings=gold, Transfer=grey.
export const CATEGORY_COLOURS: Record<string, string> = {
  Groceries:     "#117733",  // green   — food (dark)
  "Eating Out":  "#EE7733",  // orange  — warm food
  Transport:     "#4477AA",  // blue    — movement
  Entertainment: "#AA4499",  // purple  — fun
  Shopping:      "#EE3377",  // magenta — retail
  Bills:         "#882255",  // wine    — recurring
  Subscriptions: "#66CCEE",  // cyan    — digital
  Health:        "#44AA99",  // teal    — medical
  Beauty:        "#F781BF",  // pink    — personal care
  Travel:        "#332288",  // indigo  — far/adventure
  Software:      "#999933",  // olive   — tech
  Savings:       "#E69F00",  // gold    — wealth (semantic)
  Debt:          "#EE3333",  // red     — liability (semantic)
  Transfer:      "#BBBBBB",  // grey    — neutral
  Income:        "#228833",  // green   — positive cash in (not shown in spend donut)
  Cash:          "#DDCC77",  // sand    — physical money
  Charity:       "#CC79A7",  // rose    — giving
  Other:         "#8B6B5A",  // brown   — misc
};

export const DEFAULT_CUSTOM_COLOUR = "#6366f1";

export function getCategoryColour(category?: string): string {
  if (!category) return CATEGORY_COLOURS.Other;
  return CATEGORY_COLOURS[category] ?? DEFAULT_CUSTOM_COLOUR;
}
