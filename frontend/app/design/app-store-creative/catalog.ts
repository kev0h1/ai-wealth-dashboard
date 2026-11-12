export const THEMES = ["light", "dark"] as const;
export const SLOTS = ["header", "search"] as const;
export const VARIANTS = ["a", "b"] as const;
export type Theme = (typeof THEMES)[number];
export type Slot = (typeof SLOTS)[number];
export type Variant = (typeof VARIANTS)[number];

// Measured from the Art Safe Area layers in Apple's official PSD templates,
// downloaded 12 November 2026. See marketing/c41-app-store/specs.json.
export const FORMATS = {
  header: { width: 3840, height: 1646, safe: { x: 1097, y: 493, width: 1646, height: 661 }, label: "Header" },
  search: { width: 3840, height: 2560, safe: { x: 836, y: 765, width: 2168, height: 1030 }, label: "Search Results" },
} as const;

export const OPTIONS = {
  a: {
    name: "Money, shown plainly",
    description: "The Left to spend estimate leads, with its real account context and disclosures.",
    proof: "amount",
    alt: "Sorted. Money, shown plainly. The production Left to spend card shows a fictional £312 estimate until 30 October 2026, after bills and a £110 buffer.",
  },
  b: {
    name: "A clearer picture",
    description: "A quiet typographic Header, paired with Penny’s actual spending comparison in Search Results.",
    proof: "penny",
    alt: "Sorted. Ask Penny. See the comparison. A fictional day-10 chart compares spending of £860 with £740 usual, including Eating Out at £240 against £120 usual.",
  },
} as const;

export function assetFile(slot: Slot, variant: Variant, theme: Theme, small = false) {
  const size = small && slot === "search" ? "1920x1280" : `${FORMATS[slot].width}x${FORMATS[slot].height}`;
  return `sorted-${slot}-${variant}-${theme}-${size}.png`;
}

export const MEDIA = "/design-media/c41-app-store";
