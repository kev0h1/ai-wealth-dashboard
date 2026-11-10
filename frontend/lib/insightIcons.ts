import type { LucideIcon } from "lucide-react";
import { getCategoryIcon } from "./categoryIcons";

// Insight keys are server contracts rather than user-facing category names.
// Resolve them through the same Phosphor map so chips do not become a second
// icon system, while keeping their existing insight-specific meaning.
const INSIGHT_CATEGORY_NAMES: Record<string, string> = {
  car_finance: "Car finance",
  car_insurance: "Insurance",
  subscriptions: "Subscriptions",
  energy: "Energy",
  groceries: "Groceries",
  mobile: "Mobile",
  mortgage: "Mortgage",
  gym: "Gym",
  broadband: "Broadband",
  eating_out: "Eating Out",
  insurance: "Insurance",
  water: "Water",
  home_insurance: "Insurance",
  life_insurance: "Health",
  council_tax: "Bills",
  tv_licence: "Subscriptions",
  pension: "Investment",
};

export function insightCategoryIcon(category: string, overrides?: Record<string, string>): LucideIcon {
  const name = Object.hasOwn(INSIGHT_CATEGORY_NAMES, category) ? INSIGHT_CATEGORY_NAMES[category] : category.replaceAll("_", " ");
  return getCategoryIcon(name, overrides);
}
