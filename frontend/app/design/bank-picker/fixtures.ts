// A155: fixture bank list for the picker round. No API calls. Logos are the
// same-origin marks already shipped under /public/banks (A148 serves the real
// ones from /logo/provider/{id}); banks without a file show the first-letter
// fallback, exactly like production does when a provider has no logo.
import type { Bank } from "@/components/BankPickerSheet";
import type { DisclosurePlacement } from "@/components/BankPickerSheet";

const FILES: Record<string, string> = {
  "American Express": "amex.png", Barclays: "barclays.png", Chase: "chase.png",
  "First Direct": "first_direct.png", Halifax: "halifax.png", HSBC: "hsbc.png",
  "Lloyds Bank": "lloyds.png", Monzo: "monzo.png", Nationwide: "nationwide.png",
  NatWest: "natwest.png", Revolut: "revolut.png", Santander: "santander.png",
  "Starling Bank": "starling.png", TSB: "tsb.png",
};

const NAMES = [
  "American Express", "Bank of Scotland", "Barclaycard", "Barclays", "Chase", "Co-operative Bank",
  "Danske Bank", "First Direct", "Halifax", "HSBC", "Lloyds Bank", "Metro Bank", "Monzo",
  "Nationwide", "NatWest", "Revolut", "Santander", "Starling Bank", "Tesco Bank", "TSB",
  "Ulster Bank", "Virgin Money", "Yorkshire Building Society", "Zopa",
];

export function fixtureBanks(origin: string): Bank[] {
  return NAMES.map(name => ({
    id: name.toLowerCase().replace(/[^a-z]+/g, "-"),
    name,
    logo: FILES[name] && origin ? `${origin}/banks/${FILES[name]}` : "",
  })).sort((a, b) => a.name.localeCompare(b.name));
}

export type PickerVariant = "today" | "a" | "b" | "c" | "d" | "e" | "f";
/** "layout" variants (D, E, F, round 2) are hand-authored proposals in proposals.tsx; the rest are props on the production sheet. */
export type PickerKind = "production" | "proposal";
export const VARIANTS: { value: PickerVariant; label: string; placement: DisclosurePlacement; sticky: boolean; kind: PickerKind }[] = [
  { value: "today", label: "Today", placement: "footer", sticky: false, kind: "production" },
  { value: "a", label: "A · End of the list", placement: "list-end", sticky: true, kind: "production" },
  { value: "b", label: "B · Expands in place", placement: "expandable", sticky: true, kind: "production" },
  { value: "c", label: "C · In the header", placement: "header", sticky: true, kind: "production" },
  { value: "d", label: "D · Popular first", placement: "footer", sticky: true, kind: "proposal" },
  { value: "e", label: "E · Index rail", placement: "footer", sticky: true, kind: "proposal" },
  { value: "f", label: "F · Two-step page", placement: "footer", sticky: true, kind: "proposal" },
];
export const STATES = [
  { value: "empty", label: "Empty" },
  { value: "typing", label: "Typing" },
  { value: "scrolled", label: "Scrolled" },
  { value: "chooser", label: "Step 2 (F)" },
  { value: "noresults", label: "No results" },
  { value: "expanded", label: "Expanded notice (B)" },
] as const;
