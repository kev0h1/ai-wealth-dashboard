// TEMPORARY PREVIEW — delete after design review.
//
// Static category → {colour, icon} lookup for /design/planning. The real
// page reads getCategoryColour/getCategoryIcon off live ColourProvider /
// IconProvider context (per-user overrides); this preview has no such
// context, so it hardcodes the same DESIGN.md category hues (frontmatter
// `cat-*` tokens) against a small icon set from the app's existing
// lucide-react family (Category Voice Rule: colour as a ~15% tint behind
// a full-strength icon, never a flooded surface).

import {
  Receipt,
  Car,
  HeartPulse,
  PiggyBank,
  ArrowLeftRight,
  Wallet,
  Zap,
  type LucideIcon,
} from "lucide-react";

export const CATEGORY_VISUALS: Record<string, { colour: string; icon: LucideIcon }> = {
  Bills: { colour: "#fb7185", icon: Receipt },
  Transport: { colour: "#60a5fa", icon: Car },
  Health: { colour: "#2dd4bf", icon: HeartPulse },
  Savings: { colour: "#fbbf24", icon: PiggyBank },
  Transfer: { colour: "#cbd5e1", icon: ArrowLeftRight },
  Income: { colour: "#4ade80", icon: Wallet },
  Other: { colour: "#94a3b8", icon: Zap },
};

export function categoryVisual(category: string) {
  return CATEGORY_VISUALS[category] ?? CATEGORY_VISUALS.Other;
}
