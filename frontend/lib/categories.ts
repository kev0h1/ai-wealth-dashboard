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

// One tonal family: every colour sits at the same saturation/lightness band
// (Tailwind's 400 row), so charts read as a blended set rather than fighting
// tones. Hues stay semantic (food green, transport blue, debt red…).
// Deliberate trade-off vs the previous CVD-optimised Tol palette: colour is
// never the only channel here — every chart labels categories by name — and
// users can override any colour in the category manager.
export const CATEGORY_COLOURS: Record<string, string> = {
  Groceries:     "#34d399",  // emerald — food
  "Eating Out":  "#fb923c",  // orange  — warm food
  Transport:     "#60a5fa",  // blue    — movement
  Entertainment: "#c084fc",  // purple  — fun
  Shopping:      "#f472b6",  // pink    — retail
  Bills:         "#fb7185",  // rose    — recurring
  Subscriptions: "#22d3ee",  // cyan    — digital
  Health:        "#2dd4bf",  // teal    — medical
  Beauty:        "#e879f9",  // fuchsia — personal care
  Travel:        "#818cf8",  // indigo  — far/adventure
  Software:      "#a3e635",  // lime    — tech
  Savings:       "#fbbf24",  // amber   — wealth (semantic)
  Debt:          "#f87171",  // red     — liability (semantic)
  Transfer:      "#cbd5e1",  // slate   — neutral
  Income:        "#4ade80",  // green   — positive cash in (not shown in spend donut)
  Cash:          "#facc15",  // yellow  — physical money
  Charity:       "#f9a8d4",  // soft pink — giving
  Other:         "#94a3b8",  // slate   — misc
};

export const DEFAULT_CUSTOM_COLOUR = "#6366f1";

export function getCategoryColour(category?: string): string {
  if (!category) return CATEGORY_COLOURS.Other;
  return CATEGORY_COLOURS[category] ?? DEFAULT_CUSTOM_COLOUR;
}
