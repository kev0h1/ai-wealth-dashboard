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

export type PickerVariant = "today" | "a" | "b" | "c";
export const VARIANTS: { value: PickerVariant; label: string; placement: DisclosurePlacement; sticky: boolean }[] = [
  { value: "today", label: "Today", placement: "footer", sticky: false },
  { value: "a", label: "A · End of the list", placement: "list-end", sticky: true },
  { value: "b", label: "B · Expands in place", placement: "expandable", sticky: true },
  { value: "c", label: "C · In the header", placement: "header", sticky: true },
];
export const STATES = [
  { value: "empty", label: "Empty" },
  { value: "typing", label: "Typing" },
  { value: "scrolled", label: "Scrolled" },
  { value: "expanded", label: "Expanded notice" },
] as const;
