export const STORE_IDS = ["amount", "account", "spend", "month", "split", "movement", "penny", "aside"] as const;
export type StoreId = (typeof STORE_IDS)[number];
export const STORE_PLATFORMS = ["apple-medium", "apple-large", "apple-classic", "play", "feature"] as const;
export type StorePlatform = (typeof STORE_PLATFORMS)[number];
export type StoreTheme = "light" | "dark";

export const STORE_SIZES: Record<StorePlatform, { width: number; height: number }> = {
  "apple-medium": { width: 1206, height: 2622 },
  "apple-large": { width: 1320, height: 2868 },
  "apple-classic": { width: 1242, height: 2688 },
  play: { width: 1080, height: 1920 },
  feature: { width: 1024, height: 500 },
};

export const STORE_ART: Record<StoreId, {
  title: string;
  kicker: string;
  headline: string;
  heading: string;
  caption: string;
  supporting: string;
  proof: string;
  alt: string;
  qualifier: string;
}> = {
  amount: {
    title: "Left to spend",
    kicker: "LEFT TO SPEND",
    headline: "Know what is yours to spend.",
    heading: "Know what is yours to spend.",
    caption: "One clear estimate for the time until payday.",
    supporting: "One clear estimate for the time until payday.",
    proof: "next/proof-safe",
    alt: "Left to spend estimate in the Sorted app with its account context.",
    qualifier: "Fictional example · Estimated until 30 October 2026",
  },
  account: {
    title: "Upcoming payments",
    kicker: "UPCOMING",
    headline: "See which account needs attention.",
    heading: "See which account needs attention.",
    caption: "A payment is only covered when its own account is ready.",
    supporting: "A payment is only covered when its own account is ready.",
    proof: "next/proof-accounts",
    alt: "Upcoming payment in the Sorted app showing an account shortfall.",
    qualifier: "Fictional example · Payment expected 18 October 2026",
  },
  spend: {
    title: "Spending pace",
    kicker: "SPENDING",
    headline: "See your pace before it surprises you.",
    heading: "See your pace before it surprises you.",
    caption: "Spending and money moved are shown separately.",
    supporting: "Spending and money moved are shown separately.",
    proof: "features/proof-spend",
    alt: "Pay-period spending pace in the Sorted app.",
    qualifier: "Fictional example · 8–30 October 2026",
  },
  month: {
    title: "Month in review",
    kicker: "MONTH IN REVIEW",
    headline: "Your month. The whole picture.",
    heading: "Your month. The whole picture.",
    caption: "Income, spending, moves and what stayed left.",
    supporting: "Income, spending, moves and what stayed left.",
    proof: "features/proof-month-spending",
    alt: "Month in review in the Sorted app showing income and spending.",
    qualifier: "Fictional example · 1–30 September 2026",
  },
  split: {
    title: "Your money split",
    kicker: "YOUR MONEY",
    headline: "A guide for how money is divided.",
    heading: "A guide for how money is divided.",
    caption: "Compare your actual split with a reference, without a score.",
    supporting: "Compare your actual split with a reference, without a score.",
    proof: "features/proof-split-card",
    alt: "A spending split comparison in the Sorted app.",
    qualifier: "Fictional example · Adapted reference, not a target",
  },
  movement: {
    title: "Money movements",
    kicker: "MONEY MOVEMENTS",
    headline: "The right amount, in the right account.",
    heading: "The right amount, in the right account.",
    caption: "Sorted points out a gap. You make every bank transfer.",
    supporting: "Sorted points out a gap. You make every bank transfer.",
    proof: "features/proof-movement",
    alt: "Suggested movement in the Sorted app explaining a payment gap.",
    qualifier: "Fictional example · You make any transfer in your bank",
  },
  penny: {
    title: "Penny",
    kicker: "PENNY",
    headline: "Ask Penny. Keep the final say.",
    heading: "Ask Penny. Keep the final say.",
    caption: "Review a proposal before a plan is saved.",
    supporting: "Review a proposal before a plan is saved.",
    proof: "features/proof-penny-proposal",
    alt: "Penny proposal in the Sorted app awaiting the user confirmation.",
    qualifier: "Fictional example · Your confirmation creates the plan",
  },
  aside: {
    title: "Set money aside",
    kicker: "SET ASIDES",
    headline: "Future costs, already in the plan.",
    heading: "Future costs, already in the plan.",
    caption: "Review the amount, source and tracking before saving.",
    supporting: "Review the amount, source and tracking before saving.",
    proof: "features/proof-aside-form",
    alt: "Annual-costs set-aside review in Sorted, showing its amount and paying account before saving.",
    qualifier: "Fictional example · A plan, not a bank transfer",
  },
};

export const isStoreId = (value: string | null): value is StoreId => STORE_IDS.includes(value as StoreId);
export const isStorePlatform = (value: string | null): value is StorePlatform => STORE_PLATFORMS.includes(value as StorePlatform);

/** The direct download filename used by the gallery and store upload pack. */
export const storeAssetName = (platform: StorePlatform, id: StoreId, theme: StoreTheme) =>
  platform === "feature" ? `feature-${id}-${theme}.png` : `${id}-${theme}-${platform}.png`;

export const STORE_ITEMS = STORE_ART;
export const STORE_FORMATS = Object.fromEntries(STORE_PLATFORMS.map(id => [id, { id, label: id.replace("apple-", "Apple ").replace("play", "Google Play").replace("feature", "Play feature graphic"), ...STORE_SIZES[id] }])) as Record<StorePlatform, { id: StorePlatform; label: string; width: number; height: number }>;
