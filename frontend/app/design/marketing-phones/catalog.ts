export const STORY_IDS = ["amount", "upcoming", "cover", "spend", "aside", "goal", "schedule"] as const;
export type StoryId = (typeof STORY_IDS)[number];
export type PhoneTheme = "light" | "dark";
export type PhoneVariant = "a" | "b";
export type PhoneModel = "iphone16" | "iphone11" | "pixel9";

/** One monthly-payday scenario, matching the pure-engine goal preview. */
export const SCENARIO = {
  person: "Alex Taylor", asOf: "2026-11-17", periodStart: "2026-10-30", periodEnd: "2026-11-29",
  periodLabel: "30 Oct to 29 Nov", elapsedDays: 19, daysLeft: 12,
  nextPayday: "2026-11-30", daysUntilPayday: 13,
} as const;

export const FORMAT_IDS = ["iphone-63", "iphone-69", "iphone-65", "android"] as const;
export type PhoneFormat = (typeof FORMAT_IDS)[number];

/**
 * The export canvas is rendered directly at 3x, without a proof-image
 * intermediate. `viewportWidth` is the product's canonical logical width;
 * it is intentionally separate from the smaller Android marketing canvas.
 * The display and chassis ratios are separate because their bezels differ.
 */
export const FORMATS: Record<PhoneFormat, {
  label: string; model: PhoneModel; modelLabel: string;
  width: number; height: number; cssWidth: number; cssHeight: number;
  viewportWidth: number; displayAspectRatio: number; bodyAspectRatio: number;
}> = {
  "iphone-63": { label: "iPhone 6.3 inch", model: "iphone16", modelLabel: "iPhone 16 Pro", width: 1206, height: 2622, cssWidth: 402, cssHeight: 874, viewportWidth: 402, displayAspectRatio: 1206 / 2622, bodyAspectRatio: 71.5 / 149.6 },
  "iphone-69": { label: "iPhone 6.9 inch", model: "iphone16", modelLabel: "iPhone 16 Pro Max", width: 1320, height: 2868, cssWidth: 440, cssHeight: 956, viewportWidth: 440, displayAspectRatio: 1320 / 2868, bodyAspectRatio: 77.6 / 163 },
  "iphone-65": { label: "iPhone 6.5 inch", model: "iphone11", modelLabel: "iPhone 11 Pro Max", width: 1242, height: 2688, cssWidth: 414, cssHeight: 896, viewportWidth: 414, displayAspectRatio: 1242 / 2688, bodyAspectRatio: 77.8 / 158 },
  android: { label: "Android phone (20:9)", model: "pixel9", modelLabel: "Pixel 9 Pro XL", width: 1080, height: 2400, cssWidth: 360, cssHeight: 800, viewportWidth: 412, displayAspectRatio: 1344 / 2992, bodyAspectRatio: 76.6 / 162.8 },
};

export const STORIES: Record<StoryId, {
  title: string; headline: string; caption: string; screenTitle: string;
  tab: "Home" | "Spend" | "Upcoming" | "Planning" | "Penny";
}> = {
  amount: { title: "Left to spend", headline: "Know what is yours to spend.", caption: "An estimate after upcoming bills, plans and your buffer.", screenTitle: "Good morning, Alex", tab: "Home" },
  upcoming: { title: "Upcoming payments", headline: "See what is coming up.", caption: "Your bills and one-off payments, in one view.", screenTitle: "Upcoming", tab: "Upcoming" },
  cover: { title: "Cover the gap", headline: "Know what needs moving.", caption: "A suggested move. You make the transfer in your bank.", screenTitle: "Good morning, Alex", tab: "Home" },
  spend: { title: "Spending changes", headline: "See where spending changed.", caption: "Compare the same point in your usual pay period.", screenTitle: "Spend", tab: "Spend" },
  aside: { title: "Set money aside", headline: "Give your money a purpose.", caption: "Keep a plan for groceries alongside the bills.", screenTitle: "Upcoming", tab: "Upcoming" },
  goal: { title: "Plan with Penny", headline: "Turn a goal into a plan.", caption: "Review the plan before you confirm. No money moves.", screenTitle: "Ask Penny", tab: "Penny" },
  schedule: { title: "Change a planned payment", headline: "Plans change. Update yours.", caption: "Review a new amount and date with Penny.", screenTitle: "Ask Penny", tab: "Penny" },
};

export const VARIANTS: Record<PhoneVariant, { label: string; description: string }> = {
  a: { label: "A · Full phone", description: "A compact headline above the complete handset." },
  b: { label: "B · Close view", description: "A smaller title and a closer view of the complete handset." },
};

export const ASSET_BASE = "/design-media/c22/phones";
export const imageName = (variant: PhoneVariant, format: PhoneFormat, theme: PhoneTheme, story: StoryId) =>
  `${variant}-${format}-${theme}-${String(STORY_IDS.indexOf(story) + 1).padStart(2, "0")}-${story}.png`;
export const packName = (variant: PhoneVariant, format: PhoneFormat, theme: PhoneTheme) =>
  `sorted-${variant}-${format}-${theme}.zip`;

export const isStory = (value: string | null): value is StoryId => STORY_IDS.includes(value as StoryId);
export const isFormat = (value: string | null): value is PhoneFormat => FORMAT_IDS.includes(value as PhoneFormat);
