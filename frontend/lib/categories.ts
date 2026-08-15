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
  "Investment",
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
  Investment:    "#38bdf8",  // sky — invested / at-risk growth
  Debt:          "#f87171",  // red     — liability (semantic)
  Transfer:      "#cbd5e1",  // slate   — neutral
  Income:        "#4ade80",  // green   — positive cash in (not shown in spend donut)
  Cash:          "#facc15",  // yellow  — physical money
  Charity:       "#f9a8d4",  // soft pink — giving
  Other:         "#94a3b8",  // slate   — misc
};

export const DEFAULT_CUSTOM_COLOUR = "#6366f1";

// ── Deterministic custom-category hue (ENGINE.md "What Dies / What
// Survives" — "Colour becomes engine-assigned and deterministic from the
// category name — stable across devices, no localStorage") ────────────────
// A hash of the (trimmed, lower-cased) name picks a hue on a fixed
// saturation/lightness band that matches the built-in palette's Tailwind
// "400 row" — so a generated colour reads as a sibling of the built-ins, not
// a different chart. Two bands are excluded from the hash's output range:
// ~195°-280°, which covers both the neutral slate ramp the chrome itself is
// built from (slate sits ~210-215°) AND the Adviser Indigo → Penny Violet
// hues (~243° / ~262°) that DESIGN.md's Penny Gradient Rule reserves for the
// brand and the AI adviser alone. Same name -> same colour, always; rename
// the category and the colour moves with it.
const HUE_EXCLUDE_START = 195;
const HUE_EXCLUDE_END = 280; // slate + indigo + violet, one contiguous band
const HUE_RANGE = 360 - (HUE_EXCLUDE_END - HUE_EXCLUDE_START);
const CUSTOM_SAT = 72; // %
const CUSTOM_LIGHT = 62; // % — matches the ~55-65% band the built-ins sit in

// FNV-1a — small, stable across JS engines, no bias toward any bucket.
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function hslToHex(h: number, s: number, l: number): string {
  const sN = s / 100;
  const lN = l / 100;
  const c = (1 - Math.abs(2 * lN - 1)) * sN;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = lN - c / 2;
  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** A custom category's colour: deterministic from its name, excluding the
 * slate ramp and the Adviser Indigo / Penny Violet hues. Replaces the flat
 * DEFAULT_CUSTOM_COLOUR fallback in `getCategoryColour` — every user-made
 * category gets its own stable identity instead of every custom category
 * sharing one generic indigo. */
export function customCategoryColour(name: string): string {
  const key = (name ?? "").trim().toLowerCase();
  if (!key) return DEFAULT_CUSTOM_COLOUR;
  const raw = hashString(key) % HUE_RANGE;
  const hue = raw < HUE_EXCLUDE_START ? raw : raw + (HUE_EXCLUDE_END - HUE_EXCLUDE_START);
  return hslToHex(hue, CUSTOM_SAT, CUSTOM_LIGHT);
}

// Single source of truth for "what colour is this category?".
// Custom categories get a deterministic per-name hue (`customCategoryColour`),
// NOT Other's grey — otherwise every user-made category renders as the same
// anonymous slate and the Category Voice Rule breaks (identical adjacent
// slices in the spend donut). Pass the user's colour overrides as the
// second argument wherever they're available.
export function getCategoryColour(
  category?: string,
  overrides?: Record<string, string>,
): string {
  if (!category) return CATEGORY_COLOURS.Other;
  return overrides?.[category] ?? CATEGORY_COLOURS[category] ?? customCategoryColour(category);
}

// ── Category kind ────────────────────────────────────────────────────────────
// A category name alone can't say whether it's money SPENT or money MOVED.
// "House Fund" looks like spending to every headline figure (Safe-to-Spend,
// pace, budgets, the payday plan) unless the user tells us otherwise.
// Vocabulary is the wire contract from backend app/services/categories.py
// (USER_SELECTABLE_KINDS = discretionary | commitment | movement). The
// backend's fourth kind, `income`, is internal-only and never offered here.
export type CategoryKind = "discretionary" | "commitment" | "movement";

export const CATEGORY_KINDS: readonly CategoryKind[] = [
  "discretionary",
  "commitment",
  "movement",
] as const;

// Today every custom category is treated as ordinary discretionary spend.
// Staying with that when we can't tell means inference can never regress
// anyone's numbers — it can only improve them when it's confident.
export const DEFAULT_CATEGORY_KIND: CategoryKind = "discretionary";

// Money leaving for the user's own pot / account / debt: not spending.
// Deliberately narrow — a wrong guess here silently removes money from the
// spend figures, so only phrases that are overwhelmingly "I moved it" qualify.
const MOVEMENT_PATTERNS: RegExp[] = [
  /\b(fund|pot|pots|jar|kitty)\b/i,                       // House Fund, Holiday pot
  /\bsav(e|es|ed|ing|ings)?\b/i,                          // Savings, Save for…
  /\b(isa|sipp|pension|invest|investing|investment|investments|stocks?|shares?|crypto)\b/i,
  /\b(transfer|transfers)\b|\btop[-\s]?up\b/i,
  /\baccount\b/i,                                         // Joint account, Kids account
  /\b(emergency|rainy[-\s]?day|nest[-\s]?egg|buffer)\b/i,
  /\b(debt|loan|repayment|overpayment)\b|\bcredit\s?card\b/i,
];

// Real spending the user has already committed to — still spend, but not a
// free choice this month, so it shouldn't be judged as discretionary pace.
const COMMITMENT_PATTERNS: RegExp[] = [
  /\bbills?\b/i,
  /\b(rent|mortgage)\b/i,
  /\bcouncil tax\b|\butilit|\benergy\b|\belectric|\bgas\b|\bwater\b/i,
  /\binsurance\b/i,
  /\bsubscriptions?\b|\bmembership\b/i,
  /\b(childcare|nursery|childminder|nanny|au pair|creche|crèche)\b/i,
  /\bchild care\b|\bschool fees\b|\btuition\b/i,
  /\bgym\b/i,
  /\b(broadband|internet|wifi|phone|mobile|sim)\b/i,
  /\blicen[cs]e\b/i,
  /\b(service charge|ground rent|season ticket|permit)\b/i,
  /\b(direct debit|standing order)\b/i,
];

// Guess what a custom category means from its name ("House Fund" → money
// moved, "Childcare" → commitment, "Golf" → everyday spending). First match
// wins and movement is checked first, so "mortgage overpayment" reads as a
// move rather than a bill. The user always sees — and can change — the guess.
export function inferCategoryKind(name: string): CategoryKind {
  const n = (name ?? "").trim();
  if (!n) return DEFAULT_CATEGORY_KIND;
  for (const re of MOVEMENT_PATTERNS) if (re.test(n)) return "movement";
  for (const re of COMMITMENT_PATTERNS) if (re.test(n)) return "commitment";
  return DEFAULT_CATEGORY_KIND;
}
